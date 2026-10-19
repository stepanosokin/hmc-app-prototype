# Incremental publication through the gateway

Scope: [#17](https://github.com/stepanosokin/hmc-app-prototype/issues/17), T5,
extends the retained T4 foundation below. The default worker submission publishes
all 24 actual sample times **one validated time at a time**. A run with one
map-ready time is usable. `completeness: unknown` is intentional: the supplied
file's 24 messages are not an expected producer inventory.

## Reproduce T5

```powershell
./publication/run-revisions.ps1 -Project hmc-publication-t5-example -Port 8101
```

Choose a fresh project and free port. The runner refuses existing project volumes
or report directories, creates independent secrets/volumes, and retains every
attempt under `data/reports/t5/<project>`. It waits for real database/GeoServer
readiness, checks native startup/shutdown exits and types, exercises concurrent
gateway reads during incremental ingestion, then restarts the persistent services
and rechecks retained revisions, real granules and identify values. Finally it
runs the complete decoder/storage/numeric/HTTP suite and archived-evidence check.
Its inherited engine decision and browser probes are byte-identical copies of
the approved T4 evidence; T5 changes no tile encoding, CRS or dependency lock.

Worker commands use that project's environment and Compose options:

```powershell
# All 24 actual times, incrementally (default).
docker compose --env-file data/reports/t5/<project>/environment.env --project-name <project> --file compose.publication.yaml run --rm worker submit --clock 2026-10-19T05:00:00Z
# Optional bounded delivery: demonstrate missing 02, followed by late 02.
# Add --hours 1,3 to submit, consume with worker once, then submit --hours 2.
```

Set `PUBLICATION_EVIDENCE_DIR=./data/reports/t5/<project>`,
`PUBLICATION_IMAGE=hmc-publication:t5` and `T4_PORT` as in the runner when using
these commands outside its process. On an existing T4 database, run
`worker once --migrate` **before restarting the upgraded API**. This additive
migration preserves legacy catalogue rows and grants the reader only SELECT on
the new revision table. Historical T4 submissions remain reproducible with
`--legacy-one-time`; `run.ps1` explicitly selects that mode.

## Revision and read contract

Each compatible field/level/time/grid/member occupies one immutable batch:
one native Zarr, one validated COG, numeric metadata/representative bytes and one
private GeoServer ImageMosaic workspace/index. The mosaic uses a hard link to
the immutable COG. A correction writes a replacement batch/workspace; existing
assets and indexes remain untouched. Identical validated message deliveries
reuse their existing batch without another revision. Each new time/correction
creates a small revision JSON listing hashed batch references and its parent;
it does not copy a growing run. The bounded sample resolver caches up to 64
verified batch manifests, while every request still checks catalogue eligibility.

The queue's existing advisory lock serializes writers. Each time commits after
numeric readiness and actual GeoServer positive/negative granule, discovery,
visible-map and native-value/placement checks. Later failures leave committed
times usable, even when the overall job becomes `failed`. `jobs.selection` may
therefore identify the last successfully published time of a partially failed job.
Automatic retry/recovery policy remains the subsequent slice.

Catalogue selections are explicitly pinned to a run/revision and exact time;
`valid_times` advertises that revision's actual time set. The opaque selection
binds revision and compatible batch key. Numerical sampling resolves the chosen
batch's native sampler and reports the public revision. Numeric metadata and
URLs include the full selection identity, matrix, resampling, engine and encoding
version; coordinates are in each tile URL. ETag is the numeric-byte SHA256.
Palette/shader state does not participate in numeric identity. WMS rendered
identities separately include the requested style and portrayal parameters.
Cache responses require revalidation (`private, no-cache`); no new unbounded
server cache or policy-bypass path is introduced.

WMS capabilities combine only the verified batch times in the requested revision.
Maps/identify dispatch to the exact batch's real GeoServer workspace; missing or
ambiguous times return 404 before forwarding. Other runs/revisions cannot supply
a fallback. No staged workspace is discoverable through the gateway.

Fixtures `--fixture overlap` and `--fixture correction` are **synthetic
supplements**, never corrected producer input: the first explicitly names a
synthetic overlapping run, the second adds exactly 1 K to a replacement time.
Catalogue, manifests and provenance label them. Omitting hour 02 before late
delivery supplies the explicitly labelled missing-time scenario.

The T5 evidence covers the server portion of A5. Delayed browser decode/upload,
navigation races and explicit viewer updates belong to #25–#26; desktop QGIS,
producer datum confirmation and agreed-host capacity remain their separate
acceptance gates. T5 does not complete all of A5 or M2/M3.

## Retained T4 foundation

Scope: [#16](https://github.com/stepanosokin/hmc-app-prototype/issues/16), T4 / M2
foundation. This sample-only slice publishes the actual ICON-EU surface temperature
at **2026-10-15 01:00 UTC**. The canonical point reads native Zarr cells; numeric
display tiles use the separately agreed bilinear display contract. GeoServer
serves the same published selection as WMS. The source is never a fabricated field.

## Reproduce

Requirements: Docker Desktop with Linux/amd64 containers, PowerShell, Node with
built-in WebSocket support, local Chrome (override `T4_CHROME` if necessary), and
`data/grib/ICON_EU_T_G_2026101500.grib2`. Dependencies use SHA256 wheel locks;
Python, PostGIS and GeoServer images are digest-pinned.

```powershell
./publication/run.ps1
```

The runner creates independent named PostgreSQL, asset and GeoServer volumes in
project `hmc-publication-t4-check`, random ignored secrets in
`data/reports/t4/environment.env`, and explicit demo clocks. It compares the three
numeric engines, runs the browser decoder/upload probe, submits actual input,
observes availability during processing, injects missing tile metadata and a real
PostGIS indexing failure, restarts persistent services, checks types, and runs the
decoder/storage/publication suite. It aborts on failure. Use a fresh `-Project`
and a free `-Port` for an independent repeat; the runner retains earlier attempts
and never removes a volume or source. Run sequentially because the report directory
is shared. Saved comparison evidence must match the frozen contract and current
browser fixture before it can select an engine.

Only the gateway binds a host port, default `127.0.0.1:8097`. API, database and
GeoServer remain on an internal network. The edge network belongs only to the
gateway. Backend REST/web, staging, raw arrays and arbitrary proxy routes have no
gateway entry point. Readers mount immutable assets read-only. Application and
mosaic schemas have distinct PostgreSQL roles; the API has no mosaic access.
Local secrets are test credentials, never organization deployment credentials.
The PostgreSQL client is pure-Python pg8000 1.31.5, chosen after a retained native
client/PROJ shutdown incompatibility. Runtime probes check interpreter exit codes
in both import orders; a test printing `OK` with a failed process exit is rejected.

Operator commands, with the same environment/project options used by the runner:

```powershell
docker compose --env-file data/reports/t4/environment.env -p hmc-publication-t4-check -f compose.publication.yaml run --rm worker submit --clock 2026-10-19T00:03:00Z --legacy-one-time
docker compose --env-file data/reports/t4/environment.env -p hmc-publication-t4-check -f compose.publication.yaml run --rm worker once
# Alternatively keep one durable queue consumer running:
docker compose --env-file data/reports/t4/environment.env -p hmc-publication-t4-check -f compose.publication.yaml up --detach worker
```

Jobs persist discovered → staged → decoded → normalized → derivatives_ready →
validated → published, with terminal failed jobs retained. A restarted consumer
reprocesses an unfinished job into a new immutable attempt. An advisory lock
prevents concurrent consumers from processing the same queue. Failed jobs require
a new operator submission in this slice; the broader retry/correction lifecycle
belongs to subsequent tickets. Normalization retains all 24 actual times for T2
validation, but only the first time is available through the published wrapper.

## Published HTTP surface

`GET /api/v1/catalogue` returns actual published selections and their links.
`GET /api/v1/jobs/{uuid}` returns progress without filesystem paths or GIS secrets.
Point requests require **all** of `selection`, `run`, `revision`, `valid_time`,
`layer`, `lon`, `lat`. Copy identity values from the catalogue. Longitude/latitude
are native spherical degrees; point results retain native-cell coordinates,
units, value/no-data reason and source provenance. Missing times never fall back.

Follow `tiles` for versioned JSON metadata, then its `url` for numeric bytes.
[Frozen contract v2](../publication/contract.v2.json) pins WebMercatorQuad, zooms
0–6, a 256×256 interior plus one-pixel halo, north-first orientation, bilinear
sampling, validity semantics and the complete binary layout. Selected transport:
**little-endian float32 plus uint8 validity**, 258×258×5 = 332,820 bytes per tile,
without compression. The renderer consumes scalar values, not a palette image.
Lazy generation is bounded by the matrix and one sample field. Representative
tiles are generated twice, byte-compared, reopened, hashed and retained before
publication; there is no full global tile prebuild or persistent cache in T4.

Follow `wms` with `SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`.
Maps require `LAYERS=temperature`, exact catalogue `TIME`, `FORMAT=image/png`,
`STYLES=` and dimensions 1–1024; allowed CRSs are EPSG:4326 and EPSG:3857. WMS
1.3.0 EPSG:4326 BBOX order is latitude/longitude. Full-resolution GetFeatureInfo
supports `QUERY_LAYERS=temperature&INFO_FORMAT=text/plain&I=...&J=...` on that
same map request. Other operations/forwarding options are rejected. Scoped
capabilities advertise only implemented operations/formats/CRSs and rewrite
service URLs to the gateway. Legends and the complete authenticated QGIS profile
remain the separate external GIS slice.

## Publication and compatibility gate

The shared `publication.domain` resolves published wrappers for worker and API.
Each wrapper binds source checksum, pipeline, immutable T2 manifest, field/grid/
member/time identity, tile contract/engine metadata, representative tile hashes,
the GIS selection, and asset lengths/hashes. Referenced bytes are read back and
checked before the catalogue insert. Each attempt has a separate ImageMosaic
table/workspace; a failed or staged workspace never has a public catalogue route.

After indexing, the worker queries actual GeoServer granules with positive and
negative time filters, checks the advertised layer/time domain, renders a visible
map and compares a full-resolution identify value/placement to the native
baseline. It rechecks GIS visibility before the database publication switch.
The SQL commit controls gateway eligibility; it does not pretend to synchronize
GeoServer indexing or filesystem durability. Required immutable files are flushed
and hashed before visibility. A future backend outage can return 503 for GIS;
it cannot turn an unfinished job into an available selection.

The source sphere requires project-local CRS code **100001**, registered in both
GeoServer and PostGIS. This is not an EPSG registry assignment. After a retained
CRS failure the owner approved an explicit **zero-shift geocentric prototype
datum hypothesis**. v2 applies it in both paths; original Zarr/COG CRS and the
separate ≤0.0001 K COG bound remain unchanged. Producer datum confirmation and
desktop QGIS checks remain separate compatibility inputs. v1's angular placement
is retained for diagnosis and is not eligible for publication.

The [comparison evidence](evidence/t4/validation.md) records GeoServer numerical
WMS/WCS, rio-tiler 7.9.2 (including no-overview/explicit-CRS probes), and the project
bilinear candidate. Do not generalize a tested configuration's failure to every
possible use of that product. GeoServer remains the GIS renderer; numeric WCS
downloads are private comparison tooling, with no public route. Hardware GPU
rendering/interpolation, mobile/browser targets and operational Linux-host sizing
remain #25/#31 and later gates. T4 does not complete M2/M3 as a whole.
