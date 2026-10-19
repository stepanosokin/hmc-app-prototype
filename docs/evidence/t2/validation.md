# T2 / A2 local validation — 2026-10-19

Task: [#14 — Round-trip sample values through Zarr and COG](https://github.com/stepanosokin/hmc-app-prototype/issues/14). Implementation baseline: `7480f949579cd091d1ec9f2fff8d66a73e8588eb`. Accepted bilingual 0.2, parent #12 and completed wayfinder map are unchanged.

Environment: Windows host, Docker Desktop Linux/amd64, engine 29.1.2, WSL2 kernel 6.6.87.2, Python 3.12.12. Pinned ecCodes 2.44.0 / binary wheel 2.44.0.7, AEC enabled, embedded definitions; NumPy 2.3.4. Added Zarr **library 3.1.3 / storage format 2**, Numcodecs 0.16.3, Xarray 2025.10.1, Rasterio 1.4.3 with GDAL 3.9.3 / PROJ 9.4.1, pandas 3.0.6. System libexpat1 is pinned to 2.5.0-1+deb12u4. All Python wheels are version/SHA256 locked; base image digest is pinned in Dockerfile. This is a local compatibility record, not an agreed-host operational measurement.

## Reproduction and artifacts

Commands, output paths and Linux UID/GID handling are in [storage instructions](../../storage.md). Executed:

```sh
docker compose build decode
docker compose run --rm storage
docker compose run --rm storage verify /input/ICON_EU_T_G_2026101500.grib2 /storage/sample-t2/manifest.json --clock 2026-10-19T00:00:00Z --report /reports/a2-recheck.json
docker compose run --rm storage build /input/ICON_EU_T_G_2026101500.grib2 /storage/nodata-t2 --clock 2026-10-19T00:00:00Z --synthetic-nodata --report /reports/synthetic-mask.json
docker compose run --rm typecheck
docker compose run --rm test
```

Reports use an explicit fixed clock, not the historical source valid time as an execution clock. Source is mounted read-only; tests use isolated temporary directories and real libraries. There are no mocked storage readers and no application service volumes in the tests. Runtime networking is disabled.

- [Actual-sample A2 report](a2.json): all 24 fields and per-field checks, dependency/binary hashes, precision bound and actual bytes.
- [Independent saved-data recheck](a2-recheck.json): reopen manifest/assets, decode source again, compare metadata and all native values/masks.
- [Immutable test manifest snapshot](manifest.json): revision `63ec93bdd579d75ddbb020d8e895d102c1afa4e11455c10d98848ba5f9fea3aa`, field identities, raw metadata sections, provenance, coordinates and inventory of every asset with size/hash. This archival snapshot needs the corresponding locally generated assets to be sampled; no source bytes or raster arrays are redistributed.
- [Synthetic missing-mask supplement](synthetic-mask.json): first sample field with explicitly introduced missing southwest and central cells. Separate gate and manifest flag; never counted as producer nodata evidence.

## Observed correctness

24 fields × 904,689 cells = **21,712,536** actual native values. All source cells are finite and unmasked. Full field identity remains T_G / paramId 500010 / K / surface level 0, raw parameter/table/surface identifiers and metadata sections retained. Reference time is 2026-10-15 00:00 UTC; hourly leads +1…+24. Each field/time has its own immutable numerical batch and COG.

- Zarr float64 + lossless Blosc/Zstd/bitshuffle: **0 K** maximum absolute error for all finite source values. Zarr and default-CF Xarray readers both agree on values, uint8 missing masks and coordinates; fill values are explicitly disabled.
- COG float32 + lossless DEFLATE: **0.0000152587890625 K** maximum absolute error over all finite cells, below the recorded **0.0001 K** temperature bound. The dtype conversion accounts for this error; compression does not quantize values.
- Native geometry: all ecCodes centres checked against raw section 3; increasing Zarr latitude, longitude normalized to [-180,180). TIFF rows are reversed to north-first; no interpolation or reprojection. Every full-resolution raster value/mask is compared in native order. Representative corners, row transition and centre match the affine. West/south/east/north edges are −23.53125 / 29.46875 / 62.53125 / 70.53125°, with a half-cell offset from centres. COG layout, CRS, bounds and overview factors 2/4 pass.
- Sampler agrees with ecCodes at six representative cells for each of 24 times. Example: input longitude 336.5°, latitude 29.5°, first valid time gives **298.2274169921875 K**, centre −23.5° / 29.5°. Numerical responses use Zarr, never raster overviews.
- Synthetic supplement: exactly two introduced missing cells survive Zarr, Xarray and internal COG masks. Sampler returns null / `native_nodata`; an unmasked corner still returns the baseline finite value.
- Contract checks cover the exact footprint and half-cell boundary tie, wrapped longitude, outside coverage, invalid coordinates, unavailable run/revision/field/time without fallback, overwrite refusal, corrupted chunk rejection by sampler/CLI, atomic replacement of a stale successful report, truncated-source rejection and invalid clocks. Failure reports expose no field values.

## Actual storage bytes

These are logical file lengths from this run, including Zarr metadata and COG internal masks/overviews. Filesystem block allocation, image size, backups, cache and peak staging are not measured.

| Component | Bytes |
| --- | ---: |
| Source GRIB2 | 26,658,586 |
| 24 Zarr batches, including metadata/coordinates/masks | 32,563,192 |
| 24 COGs, including internal masks and overviews | 62,689,990 |
| Final manifest | 227,651 |
| Source + Zarr + COG + manifest | 122,139,419 |

Evidence JSON and this documentation are additional archive overhead outside that managed-data total. Generation also needs one temporary working TIFF at a time and raster/library buffers; the final total is not a peak-disk budget. The result establishes neither a storage advantage nor a speed advantage. No forecast-volume multiplier, seven-/30-day capacity estimate or service SLA is inferred.

## Failures, tests and remaining gates

TDD: the agreed seams were the storage CLI and shared manifest sampler. The first actual-sample test failed with missing `decoder.storage`, then passed after implementation. The synthetic-mask test failed on unknown `--synthetic-nodata`, then passed after implementing the explicit supplement. Subsequent boundary/selection/corruption assertions exercise those same agreed public boundaries.

The initial Rasterio reader import failed because the slim base lacked `libexpat.so.1`. No A2 success or final manifest was produced by that attempt. The fixed image adds pinned libexpat1; all reader checks then passed. This was an image dependency defect, resolved without substituting the accepted storage architecture. The early Zarr 2-library dependency probe found a source-only dependency under the binary-only installation policy; the tested Zarr 3 library writes the required format 2 explicitly. These initial failures are retained here; neither is hidden as successful compatibility evidence.

The final actual-sample build and independent saved-data recheck pass. Mypy reports no issues in all six Python source files. Full CLI suite: **9 tests passed in 38.998 seconds**, covering A1 and T2, with actual source mandatory. This test duration is not a throughput benchmark. Deliberate corruptions are expected rejections; no unresolved format/precision/reader incompatibility remains for these pinned readers and sample. A future legitimate failure must retain diagnostics and reopen storage decision #3 (architecture #5 if affected) before publication.

**A2 passes locally for this sample.** M1 still needs the equivalent numerical-adapter comparison and selection. No GeoServer, desktop QGIS, gateway/publication visibility, retention/revision lifecycle, OGC conformance, throughput or organization-host capacity gate is claimed. Source/server completion conventions and multi-GB workload sizing remain separate work. See [Russian comparison](../../source-storage-comparison.ru.md) for the architectural explanation and evidence that could justify reconsideration.
