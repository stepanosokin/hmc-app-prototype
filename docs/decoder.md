# Supplied forecast decoder — T1 / A1

Implements [issue #13](https://github.com/stepanosokin/hmc-app-prototype/issues/13). This is a sample-validation command, restricted to the supplied inventory and SHA256. It creates a report, not published weather products. Accepted bilingual v0.2 and parent #12 remain unchanged. A1 passes locally; the remaining M1 storage/adapter gates and M2–M5 remain open.

## Run

Requires Docker with Linux containers and Compose v2. The lock targets **linux/amd64, CPython 3.12**; other architectures are not validated. Put the organization-supplied file at `data/grib/ICON_EU_T_G_2026101500.grib2`. Source bytes are ignored by Git, mounted read-only and excluded from the image build context.

```sh
docker compose build decode
docker compose run --rm decode
docker compose run --rm typecheck
docker compose run --rm test
```

The report is `data/reports/a1.json`. The default explicit report clock is `2026-10-19T00:00:00Z`; it labels the validation record and never changes forecast times or expires the historical sample. Runtime networking is disabled. Tests use per-invocation temporary directories on a 512 MiB tmpfs (expanded for T2), with no application/database volumes or services.

On Linux, run the containers with the invoking user's UID/GID so they can write the existing report directory:

```sh
export DECODER_UID=$(id -u) DECODER_GID=$(id -g)
```

Docker Desktop on Windows works with the default container user. Build dependencies are downloaded only during image construction. The base image is pinned by digest; every Python dependency, including ecCodes binaries, is version- and SHA256-locked in `requirements.lock`. The current shared image is named `hmc-decoder:t2` locally and rebuilt from these inputs; [T2](storage.md) adds pinned storage readers/writers and libexpat without changing the A1 decoder contract. The checked-in T1 evidence records its original environment.

To inspect another input for diagnostics or choose the report clock/path:

```sh
docker compose run --rm decode /input/incomplete.grib2 --clock 2026-10-19T00:00:00Z --report /reports/failure.json
```

Without `--report`, JSON goes to stdout. Exit 0 means the entire A1 sample gate passed; exit 1 means failure, with an error and **no message values**. A report file is replaced atomically on success or validation failure, so an earlier success cannot masquerade as the current result. Keep separate report paths when retaining attempts. Do not run simultaneous writers to the same report path. Bad CLI syntax returns argparse's exit 2. Filesystem errors writing the report fail the process; operators must check the exit status.

## Checks and interpretation

- Check all 24 GRIB2 envelopes, section boundaries, end markers and the complete source checksum. Truncation, extra bytes, missing hours and unsupported editions/templates fail. No successful partial report is emitted.
- Require an AEC-enabled ecCodes 2.44.0 build and CCSDS template 5.42. Record API/wheel versions, enabled features, embedded definition release and SHA256 of decoder, definition and AEC binaries. External definition overrides are rejected.
- Compare numeric decoder keys with independently parsed section 1/4 headers: centre 78, subcentre 255, master table 19, local table 1, discipline/category/parameter 0/0/0, surface 1 at scale/value 0. The DWD local concept resolves to `T_G`, paramId 500010, `Temperature (G)`, K, `surface`, level 0. This establishes ground/water-surface temperature; it does not establish 2 m air temperature.
- Check reference time `2026-10-15T00:00:00Z`, leads +1…+24, encoded in minutes 60…1440, and valid times ending `2026-10-16T00:00:00Z`. Compare raw times with decoder validity/step keys.
- Decode every native value. Check decoded count, bitmap and missing count; require finite unmasked values and record their min/max in K. Missingness is determined by the bitmap, never by guessing a numeric sentinel. The actual sample has no missing cells; this does not validate future nodata products.
- Parse raw template 3.0 separately from ecCodes. Compare **all** decoded cell coordinates to raw-header positions, with an absolute tolerance of 1e-9 degrees. Check 1377 × 657, 0.0625° spacing and scanning mode 64: longitude varies fastest west to east; rows run south to north. Normalize longitude from the encoded 336.5° origin into [-180, 180). Record corner, row-transition and central native-cell indices, coordinates and decoded values. No reorder or interpolation occurs.
- Distinguish centres (−23.5…62.5° E, 29.5…70.5° N) from outer cell edges (−23.53125, 29.46875, 62.53125, 70.53125 in west/south/east/north order). These are inferred grid footprints; no raster georeferencing or Zarr/COG conversion is performed in T1.

Every message includes SHA256 of its decoded little-endian float64 array and uint8 missing mask as a baseline for later storage checks. These are decoder baselines, not independent truth for numerical round trips. Corrupted-input fixtures in the CLI tests supplement the actual sample; they do not claim A1 compatibility by themselves.

## Evidence and failed gates

The checked-in [A1 report](validation/archives.md), [failure examples](validation/archives.md) and [validation record](validation/archives.md) record the local run. Reproduce the report from the source rather than treating the snapshot as a live test. The source is not redistributed.

If a legitimate source fails CCSDS/identity/grid validation, retain the original read-only source, checksum, diagnostic JSON, tool versions and command. Stop A1 and reopen [GRIB/storage decision #3](https://github.com/stepanosokin/hmc-app-prototype/issues/3), linking the evidence; reopen architecture #5 too if affected. Do not replace the agreed architecture. The CLI prints this required disposition but does not mutate tracker decisions automatically: deliberate truncated/unsupported fixtures are expected rejections, not failed product compatibility. No such compatibility failure occurred in this local run.

Pinned upstream references: [ecCodes Python 2.44.0](https://pypi.org/project/eccodes/2.44.0/), [binary wheel 2.44.0.7](https://pypi.org/project/eccodeslib/2.44.0.7/), [ECMWF Python interface and binary packaging](https://github.com/ecmwf/eccodes-python), [ECMWF explanation of AEC/CCSDS](https://confluence.ecmwf.int/spaces/ECC/pages/265030705/ecCodes%2Bversion%2B2.25.0%2Breleased). Runtime evidence, not release documentation alone, establishes support here.
