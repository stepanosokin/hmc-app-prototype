# GRIB decoding and publication storage investigation

Date: 2026-10-19. Scope: wayfinder research ticket 02; advisory evidence for an architecture decision. No decoder was installed, no sample values were decoded, and no benchmark was run. Current upstream documentation was checked; implementation must pin versions and repeat compatibility checks.

## Local evidence and its limits

The main workspace inventory (`.scratch/hmc-meteo/assets/sample-inventory.md`) records `ICON_EU_T_G_2026101500.grib2`: 26,658,586 bytes, 24 messages, reference time 2026-10-15 00:00 UTC, hourly leads +1 through +24, 1377 by 657 regular latitude/longitude points at 0.0625 degrees, discipline/category/parameter 0/0/0, first surface type 1, product template 4.0 and packing template 5.42. These are binary-section observations supplied to this investigation, not independently decoded results. The encoded surface must not be presented as 2 m air temperature. No wind components were identified.

Outstanding evidence: decoded units and ranges, missingness, orientation and geographic placement, decoder behavior, full producer metadata, additional variables/grids, source update cadence and completeness guarantees, expected API queries, retention and server capacity.

## Decode before choosing a store

Template 5.42 is CCSDS recommended lossless compression of scaled/referenced grid-point values; it is not simply an uncompressed array. Lossless compression here does not establish the precision of the original physical measurement or remove GRIB packing scales. [ECMWF template 5.42](https://codes.ecmwf.int/grib/format/grib2/templates/5/42/).

A suitable first decoder candidate is ecCodes with Adaptive Entropy Coding support: ECMWF documents `ENABLE_AEC` for CCSDS GRIB decoding/encoding. Require the actual container build to decode all sample messages; the library name or a successful header listing is insufficient proof. Record binary/library and definition-table versions, build capabilities and errors. [ecCodes installation](https://confluence.ecmwf.int/spaces/ECC/pages/45757987/ecCodes+installation).

GDAL's GRIB driver is a different decoding path based on degrib/g2clib. Its general format documentation does not establish 5.42 support in the intended binary. Also, GDAL defaults normalize temperatures to Celsius and adjust some longitude layouts. Set explicit unit/longitude policy and compare coordinate/value samples before allowing a conversion pipeline. External GRIB indexes can accelerate selected-message access, but do not imply arbitrary spatial random access within the compressed field. [GDAL GRIB driver](https://gdal.org/en/stable/drivers/raster/grib.html).

If using xarray/cfgrib, partition heterogeneous input into compatible datasets. Its documentation warns that messages with one short name can still require different hypercubes for different level types; shared step coordinates must agree. Preserve the inventory even if a convenience reader rejects grouping. [cfgrib](https://github.com/ecmwf/cfgrib#filter-heterogeneous-grib-files).

## Preserve scientific identity separately from display

Suggested normalized identity: provider/model/product, run reference time, variable identifier including GRIB tables, level type/value or layer bounds, ensemble member when applicable, grid fingerprint, forecast step and validity interval, source revision. Valid time alone cannot distinguish overlapping runs. Keep original numeric codes and provenance alongside human labels.

Reference time, originating centre and table versions belong to the identification section. [ECMWF section 1](https://codes.ecmwf.int/grib/format/grib2/sections/1/). Product template 4.0 includes parameter, forecast-time unit/value and fixed surfaces; future accumulated/averaged products require their own template semantics and time bounds rather than treating every value as instantaneous. [ECMWF template 4.0](https://codes.ecmwf.int/grib/format/grib2/templates/4/0/).

Grid metadata must retain earth shape/CRS, dimensions, coordinate values, increments and scanning mode. A geographic bounding box alone is insufficient; regular-grid support does not imply support for rotated, projected or unstructured future inputs. [ECMWF template 3.0](https://codes.ecmwf.int/grib/format/grib2/templates/3/0/), [template catalogue](https://codes.ecmwf.int/grib/format/grib2/templates/).

Proposed API behavior: return dataset revision, run, requested/selected validity, field, surface, unit and sampling method with every numeric result. Numeric queries should read native-resolution scientific values. Display interpolation, overviews and reprojection must not silently redefine those results.

## Conditional storage choices

| Candidate | What authoritative sources establish | Fit to investigate; limitations inferred for this project |
| --- | --- | --- |
| Original GRIB2 plus message inventory | GRIB retains producer identification, product and packing semantics described above. | Preserve immutable originals for traceability and reprocessing. Good baseline for ingestion and downloads; repeated decoding may dominate point/time-series and tile requests. Measure caching and selected-message reads. |
| COG per field/time/level, with a catalogue | OGC COG 1.0 uses tiled GeoTIFF, reduced-resolution subfiles and HTTP byte ranges for partial spatial access. | Strong candidate for a map-first regular-grid prototype and later imagery. Catalogue must provide run/time/level semantics and asset identity. A long point time series spanning separate assets may require many reads. COG is a storage format, not by itself an external API contract. |
| Zarr per compatible run/grid grouping | Zarr v3 defines typed multidimensional arrays, chunk grids, codecs, fill values and key/value storage. | Candidate for repeated subsets and time/level queries if chunk layout matches the workload. Spatial maps and point time series pull in different directions; measure read amplification and request counts. Geographic/scientific meaning still needs agreed coordinate conventions and metadata. |
| Scientific source plus disposable map products | Combination of the preceding mechanisms; project proposal, not a standard requirement. | Keep raw GRIB and optionally normalized numeric data; create COG or tile products only for published fields. Adds storage/processing but lets display tuning evolve independently. Do not duplicate every format without a measured reason. |

COG statements above follow the approved [OGC COG 1.0 standard](https://docs.ogc.org/is/21-026/21-026.html). Treat creation as producing a finished immutable asset. GDAL documents tiled creation, overview generation and temporary-space requirements; measure peak disk use, not just final size. Candidate lossless numeric compression, block sizes and overview resampling remain experiment parameters. [GDAL COG driver](https://gdal.org/en/stable/drivers/raster/cog.html).

Zarr statements follow its [v3 core specification](https://zarr-specs.readthedocs.io/en/latest/v3/core/index.html). Pin format version, codecs, dimension naming and reader support; do not treat v2 and v3 as interchangeable. Sharding can place smaller chunks within larger storage objects, changing request and update tradeoffs; it does not remove the need to measure them. [Zarr indexed sharding codec](https://zarr-specs.readthedocs.io/en/latest/v3/codecs/sharding-indexed/index.html).

Xarray supports appending and region writes, but region concurrency must address distinct chunks or use locking; coordinate alignment during modification is the caller's responsibility. Missing chunks and missing scientific values also require an explicit fill/mask policy. These facilities are not a dataset-wide publication transaction. [Xarray Zarr I/O](https://docs.xarray.dev/en/stable/user-guide/io.html#zarr).

## Proposed ingestion and publication safeguards

These are design proposals inferred from multi-file publication and the expected updates, not behavior promised by COG or Zarr:

1. Discover into a durable queue/inventory. Agree a producer completion signal; otherwise use a documented stability check with retry, acknowledging it cannot prove producer completeness. Copy/checksum and inventory complete source bytes before conversion.
2. Make processing idempotent using source identity/checksum and pipeline version. Quarantine truncation, unknown packing, inconsistent metadata and failed validation; retain the previous usable revision.
3. Stage assets under a new immutable revision. Track completeness by field/lead/level against a producer manifest when one exists. Distinguish available, expected and absent fields; never label an incomplete run complete by assuming 24 messages is universal.
4. Validate staged assets and manifests, then publish one catalogue pointer in an application database transaction. Readers resolve a revision once and use its immutable assets for the request/session. Database publication does not make filesystem writes transactional; write durable assets before committing the pointer and collect failed staging later.
5. Accept late/corrected files into a new revision. Define whether newest means latest reference time, latest complete run or latest available lead; expose availability and keep old run URLs reproducible for their documented retention period.
6. Serialize writes to overlapping Zarr chunks/shards, or stage separate run revisions. Do not mutate the public store while tile and numeric requests read it. A populated array's fill values cannot serve as the publication-completeness signal.
7. Retain source, scientific and display products under separate policies, set after capacity measurement and organization requirements. Expire catalogue eligibility before delayed asset deletion; protect active revision leases, report expired data clearly and garbage-collect abandoned stages. Include cache retention in the policy.

## Measurements needed to select the first implementation

Use the supplied file for a correctness spike, then representative multi-variable, multi-level runs, different grids, missing values and normal/late updates. Benchmark on the agreed Linux server and file-server connection; no throughput or latency promise can be inferred from this one sample.

Measure ingestion wall time, CPU, RAM and peak temporary/final disk; source reads; decoding repeat cost; failed/replayed jobs; complete-run and partial-run freshness. Compare raw GRIB plus cache, COG, Zarr and only the justified hybrid variants.

Replay cold and warm spatial tiles across zooms, a click, a 24-step point series, bounding-box/time/level subsets and simultaneous clients while ingesting. Record p50/p95 latency, request/object counts, bytes read versus returned, queue delay, cache hit ratio, error rate and restart recovery. Vary COG block size/overviews and Zarr time/space chunks, codecs and sharding. Include network and inode/object overhead, not just compression ratio.

Validate units, masks, native sample values, coordinate orientation, grid-cell location, reprojection/resampling and precision against the decoder baseline with agreed tolerances. Simulate missing/late files and failure immediately before publication; a published revision must never mix assets or expose unfinished data.

## Advisory conclusion

Retain original GRIB2 and establish successful CCSDS decoding first. If the initial measured workload is primarily map slices on this regular grid, evaluate a catalogue plus per-slice COG as the smaller implementation candidate. If repeated multidimensional subsets/time series dominate, evaluate Zarr with workload-specific chunks. A scientific store with disposable map products is an option when the two access patterns justify it. The next decision requires correctness results, representative workload evidence and operator constraints; this investigation does not select an architecture or claim performance.