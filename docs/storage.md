# Sample storage round trip — T2 / A2

Implements [#14](https://github.com/stepanosokin/hmc-app-prototype/issues/14) against the [accepted specification](../.scratch/hmc-meteo/spec.md). This slice produces **validated test manifests**, not published runs. PostgreSQL jobs/catalogue and GeoServer visibility remain M2/M3 work. See the separate [Russian source/storage comparison](source-storage-comparison.ru.md).

## Reproduce

Use Docker Compose with Linux/amd64 containers and the mandatory source at `data/grib/ICON_EU_T_G_2026101500.grib2`. Source bytes never enter the image and are mounted read-only. On Linux set `DECODER_UID`/`DECODER_GID` to the invoking user's IDs, as described in [decoder instructions](decoder.md).

```sh
docker compose build decode
docker compose run --rm storage
docker compose run --rm storage verify /input/ICON_EU_T_G_2026101500.grib2 /storage/sample-t2.3/manifest.json --clock 2026-10-19T00:00:00Z --report /reports/a2-recheck.json
docker compose run --rm storage build /input/ICON_EU_T_G_2026101500.grib2 /storage/nodata-t2.3 --clock 2026-10-19T00:00:00Z --synthetic-nodata --report /reports/synthetic-mask.json
docker compose run --rm typecheck
docker compose run --rm test
```

Build writes `data/storage/sample-t2.3/` and `data/reports/a2.json`. It refuses an existing target, including a partially failed attempt. Choose a new target for a retry; retain failed attempts for diagnosis. No input/archive directory is ever cleaned. All tests use isolated temporary directories on container tmpfs, with no shared application volume. The explicit clock labels the evidence, never changes forecast times, and does not run retention.

Dependencies are SHA256-locked wheels in `requirements.lock`; the Python image is digest-pinned, and system `libexpat1` is pinned in Dockerfile. Zarr **library 3.1.3 writes format 2 explicitly**. The library major version does not select the storage format here. Readers are Zarr 3.1.3 and Xarray 2025.10.1 (`chunks=None`, consolidated metadata, default CF decoding); Rasterio 1.4.3 supplies the GDAL COG writer/reader. The report records actual GDAL/PROJ versions and ecCodes binary/definition hashes. Runtime networking is disabled.

## Numerical batches and derivative contract

The command is deliberately restricted to the supplied sample SHA256 and T1 inventory. It hashes the source incrementally, reads one GRIB message at a time with an 8 MiB frame limit checked before allocating the payload, validates it against ecCodes/raw headers, and writes a separate field/time batch. It never loads the full source or all decoded hours together. The frame limit and one-field concurrency bound are sample validation safeguards, not production sizing. Temporary arrays and raster buffers still consume memory; RSS on real workloads needs measurement.

Each batch contains little-endian float64 temperature, uint8 missing mask (`1 = missing`), and native increasing longitude/latitude centre arrays. Spatial chunks are 256 × 256. Blosc/Zstd level 5/bitshuffle is lossless; no quantization or scale/offset conversion is applied. Zarr fill values are disabled explicitly, so valid zeros and zero coordinates are not silently masked by Xarray. Coordinates, units, parameter/table/surface identifiers, reference/valid times, lead encoding, native-grid/scanning/earth-shape metadata and source provenance remain available. Ensemble members and alternative grids are unsupported by this sample-only command.

COGs are derived by reopening the completed Zarr batch. They use float32, DEFLATE, 256 × 256 blocks, internal validity masks and nearest-neighbour overviews at factors 2 and 4. The dtype conversion is separate from lossless compression; its maximum absolute error must be at most **0.0001 K**. Every unmasked native value and every mask cell is compared to ecCodes, beyond the representative cells required by A2. COG rows are flipped northward relative to native south-to-north Zarr rows; longitude remains west-to-east. Half-cell outer edges are `[-23.53125, 29.46875, 62.53125, 70.53125]`. The operative raster CRS preserves the native sphere, `+proj=longlat +R=6371229 +no_defs`, as defined by [GRIB table 3.2 code 6](https://codes.ecmwf.int/grib/format/grib2/ctables/3/2/); the WKT is also retained in Zarr metadata and evidence. Greenwich is an explicit longitudinal-origin assumption following that table's note; producer confirmation of precise datum/origin remains an input to the GIS gate. No WGS84 relabelling, interpolation or reprojection occurs. GeoServer reprojection into EPSG:4326/3857 and GIS client compatibility remain later gates.

Both Zarr and Xarray reopen all values/masks and coordinates. Rasterio checks COG layout, full-resolution values/masks, affine, bounds and representative centres. Display overviews never supply point values. GeoServer and desktop QGIS are not tested by this storage-only gate.

## Manifest and shared sampler

`manifest.json` records the run, all 24 field/time references, full per-message baseline metadata, original GRIB metadata-section bytes, source/message/grid hashes, pipeline/tools, and sizes/SHA256 of every asset file. Its revision is SHA256 of its canonical body excluding the revision field. It is a test revision identity, not a catalogue publication. A pending manifest is checked by the sampler before the final filename appears. The command refuses overwrite and marks output files read-only. Publication services must enforce immutable access through their own storage permissions; filesystem owners can still deliberately change or delete files.

Both numerical-adapter candidates can import the same boundary:

```python
from pathlib import Path
from decoder.sampling import ManifestSampler

sampler = ManifestSampler(Path('/storage/sample-t2.3/manifest.json'))
point = sampler.sample(
    run='ICON-EU/2026-10-15T00:00:00Z', revision=sampler.revision,
    field='T_G:surface:0', valid_time='2026-10-15T01:00:00Z',
    lon=336.5, lat=29.5,
)
# value: 298.2274169921875 K; native row 0 / column 0, centre -23.5 / 29.5
```

Construct once per trusted immutable manifest; construction verifies its revision and all listed asset hashes. Reuse it for requests. This deliberately conservative integrity scan is not an adapter throughput benchmark. Missing/corrupt assets raise validation failures. Unavailable run/revision/field/time raises `KeyError`, suitable for later HTTP error mapping. Invalid coordinates raise validation errors. There is no fallback to a nearby time or another revision.

Longitudes normalize to `[-180,180)`. Latitude must be finite and within `[-90,90]`. The cell footprint is half-open west/south inclusive, east/north exclusive; an exact internal boundary selects the east/north cell. Outside coverage returns null with `outside_coverage`; native missing returns null with `native_nodata`. Successful responses include the exact selection, units, method, native cell centre and source/batch provenance. Numerical reads use Zarr float64, never the COG or overviews.

Late/corrected-data manifest reuse, old-reader lifetime, durable jobs, recovery and actual publication visibility belong to later slices. This batch layout allows manifests to reference unchanged batches; T2 does not implement a publication manager.

## Evidence and failure handling

See [A2 evidence](validation/archives.md) for observed errors, actual file bytes, checks and limitations. The actual sample contains no missing cells: `--synthetic-nodata` builds only the first field with two explicitly introduced missing cells (southwest and centre). Its manifest records `synthetic_nodata: true` and the unmodified baseline values metadata; the report gate is `synthetic-mask-supplement`, and `verify` refuses to treat it as actual-sample A2 evidence. These checks supplement the actual sample and must never be presented as producer data. No speed, storage-efficiency, production capacity or adapter-selection result is inferred.

Exit 0 means the requested local storage check passed. Exit 1 emits a failed JSON report and blocks publication; report files atomically replace previous reports, so an earlier success cannot stand for a failed attempt. Retain the read-only source, diagnostics, checksum, lock and failed output. A real reader/precision failure requires reopening [storage decision #3](https://github.com/stepanosokin/hmc-app-prototype/issues/3), and architecture #5 if affected; a synthetic corruption is an expected rejection. T2 does not mutate these decisions automatically. External publication must require the later GIS visibility gate even when A2 passes.
