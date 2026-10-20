# Incremental publication through the gateway

Organization keys, protected numeric/GIS profiles and the T8 runner are
documented in [access policy and operator commands](access.md).

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
service URLs to the gateway. The [QGIS T11 profile](qgis.md) adds scoped PNG
legends (`GetLegendGraphic`, `LAYER=temperature`, `STYLE=raster`) and the pinned
desktop connection/validation procedure. Legends accept optional exact `TIME`;
without it the revision's fixed style is used. New publications have a
workspace-local temperature ramp labelled in K. Existing published manifests
keep their original raster style. Client SLD and arbitrary forwarding remain
disabled.

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
# Recover interrupted deliveries (T6 / #18)

Run `powershell -NoProfile -File publication/run-recovery.ps1 -Project hmc-publication-t6-check1 -Port 8104`.
The runner requires the unchanged actual sample in `data/grib`, creates isolated
input fixtures and service volumes, checks project/port availability and waits
for real service readiness. It preserves reports and volumes on failure. Reports
are under `data/reports/t6/<project>`; use a fresh project for each full run.

The operator interface is `python -m publication.worker` inside the worker image:

```text
submit --recoverable --clock 2026-10-19T07:00:00Z --hours 1,2 --source-name ICON_EU_T_G_2026101500.grib2 --delivery-sha256 dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a
once --migrate
run
retry --job <failed-job-uuid>
collect
collect --apply
```

Prefer a producer completion manifest or an atomic rename/delivery signal and
pass its SHA256 with `--delivery-sha256`. Without that signal, the default
`--stability-seconds 2` compares size and mtime before capture (allowed 1..300
seconds). **Stable size is not proof of completeness.** The worker validates all
24 GRIB envelopes, decodes every message and checks the approved actual-sample
checksum before publishing any hour. This remains a sample-only pipeline;
additional products require a compatibility decision, rather than relaxing the
checksum gate. Source mounts, configured by `PUBLICATION_INPUT_DIR`, are local
and read-only. Symlinks escaping the mount and non-basename inputs are rejected.

Submission registers durable capture intent before writing original bytes to the
managed asset volume. An interrupted capture remains a diagnosed
`CaptureInterrupted` job; resubmitting the same delivery resumes that job and
retains its partial captures. Source hashing and copying both have a byte bound,
require regular files and share a 600-second capture deadline. Only a flushed,
renamed original and durable capture receipt make the job eligible for processing.
If the original is already complete when capture is interrupted, `retry --job`
finishes capture from that managed original, including without the source mount.
Collection can remove abandoned capture fragments once their exact bytes are
verified as a prefix of the retained checksum-verified complete original. Distinct
fragments remain quarantined rather than discarding the only managed copy.
Partial, truncated and unsupported deliveries become terminal
quarantined jobs (`failed`, `retryable=false`, failed stage/error class), with
their original captured bytes retained. Correct the producer delivery and submit
its new checksum; quarantined bytes are never overwritten. A checksum mismatch
against a producer declaration is quarantined during capture. Oversize or still
changing deliveries are rejected before queueing; retry discovery after fixing
the source. The source mount is never cleaned or used as retry storage.

T6 source-checksum/pipeline/request identity has a unique durable delivery key.
Reordered hour lists are canonicalized; repeats return the same job, including
after publication. Producer-declaration identity is also included so a corrected
completion declaration can be assessed. Existing T4/T5 CLI commands remain
available for archived reproduction; use `--recoverable` for new ingestion.
The additive migration preserves existing rows and immutable manifests.

One PostgreSQL advisory lock serializes capture, worker attempts, operator retry
and staging collection. A lost worker connection releases the lock. A restarted
worker retries an interrupted job with a fresh immutable attempt; previously
committed hours are reused by source-message checksum, processing version and
fixture. A revision and its job selection commit in one database transaction.
Uncommitted revisions and batches have no gateway route. Failed attempts have
separate GeoServer workspaces and PostGIS indexes, preventing retry collisions.
This does not promise a multi-hour job is atomic: each independently validated
hour can publish, and a failed later hour preserves the previous usable batch.

Processing exceptions retain the stage, class, attempt count and failed-stage
history in `/api/v1/jobs/<uuid>`. Automatic retries wait two real seconds, with
three attempts per job, counting killed processes; each attempt has a 600-second
alarm. `run` continues after failures. Once the budget is exhausted, an operator
can repair the service and explicitly `retry --job ...` to start a new bounded
cycle. This cannot rearm an invalid source. Forecast/demo clocks are explicit
UTC inputs; retry delays use elapsed wall time and do not alter forecast times.

Resource bounds are prototype limits: one processing attempt, 64 MiB captured
source, 8 MiB per GRIB frame, 24 messages, 1..24 selected hours, 128 unresolved
jobs including quarantine, 2 GiB/2 CPUs for the Compose worker, and a default
16 GiB managed asset budget (`PUBLICATION_STORAGE_BYTES`). Capture reserves
64 MiB and processing reserves 128 MiB per selected hour, including temporary
derivatives. Published, quarantined and abandoned bytes all count. A full budget
fails safely and requires operator collection/capacity repair. Source copies are
retained even when staging collection runs. These bounds are not operational
capacity measurements or the retention policy scheduled in #19.

Numeric tile cache keys include the entire published selection, matrix
coordinates and encoding. Every hit first resolves catalogue eligibility and
the manifest. One lazy generator serves the API process; competing cold misses
return `503`, `Retry-After: 2`, `Cache-Control: no-store`. The LRU cache defaults
to 16 MiB per API process (`TILE_CACHE_BYTES`, allowed 0..256 MiB); each payload
is exactly 332820 bytes. Only completed payloads enter it. Generation/storage or
cache-population failures return the same transient response without switching
selection. Existing cached old tiles remain readable; a restarted API regenerates
identical bytes from retained manifests. There is no disk tile cache to leave
partially populated. Zoom remains 0..6, tile dimensions and numeric contract v2
are unchanged. `T6_TEST_FAULTS=1` enables explicit isolated-stack fault markers
only for the acceptance harness; keep its default `0` for normal service.

`collect` reports unreferenced attempts and abandoned hours without changing
anything. `collect --apply` runs under the writer lock, roots reachability in
**all** published revisions and legacy selections, removes only private
unreferenced workspaces/indexes and then managed staging directories. It keeps
managed originals, every referenced batch, and the immutable old reader graph.
Invalid published manifests abort collection. GeoServer or index cleanup
failures leave staging bytes available for a later retry. Published-data expiry,
source-copy retention and old-revision grace remain #19's scope.

The A6 runner kills actual worker processes during decode, normalization,
numeric tile creation, COG staging, GIS indexing/readiness, metadata publication,
before commit and after commit. It observes old point/tile/WMS readers through
the gateway, tests real derivative/index failures, quarantine, bounded retries,
partial-job collection, source disappearance, lazy tile/cache faults and service
restart. Synthetic malformed deliveries supplement the original sample. Local
Compose establishes this recovery behavior; it does not establish desktop QGIS,
new CRS/encoding compatibility or organization-host capacity.

## Retain and expire managed forecasts (T7 / #19)

The operator CLI is `python -m publication.retention` in the Compose `worker`
container (override its entrypoint to `python`). Start the worker once on an
existing project to apply additive retention metadata/backfill. Policy lives in
PostgreSQL and applies to every API process; API credentials have SELECT only.

```powershell
# With the same environment file/project arguments as the isolated stack:
docker compose --env-file <environment.env> --project-name <project> --file compose.publication.yaml run --rm --entrypoint python worker -m publication.retention configure --days 7
docker compose --env-file <environment.env> --project-name <project> --file compose.publication.yaml run --rm --entrypoint python worker -m publication.retention report
docker compose --env-file <environment.env> --project-name <project> --file compose.publication.yaml run --rm --entrypoint python worker -m publication.retention collect
docker compose --env-file <environment.env> --project-name <project> --file compose.publication.yaml run --rm --entrypoint python worker -m publication.retention collect --apply
```

`configure` replaces the complete policy: include any nondefault grace, budget,
clock and pin options on each invocation. Days are 7..30, measured from the UTC
**run reference time**, never ingestion or forecast valid time. An eligible run
keeps every published valid time. Omitting `--clock` uses wall UTC. The local
Compose demonstration explicitly seeds `2026-10-19T05:00:00Z` via
`PUBLICATION_CLOCK`; the CLI can advance a test clock on its isolated volumes.
For a historical demonstration with wall UTC use
`configure --demo-run ICON-EU/2026-10-15T00:00:00Z`. A pin exempts the run window,
not superseded revision budgets; the latest demo publication stays usable.
Never move a test clock on shared or operational volumes.

Superseded revisions remain accessible for `--superseded-grace-seconds` (default
86400, allowed 0..2592000). Per run, `--superseded-count` (default 64, max 1024)
and `--superseded-bytes` (default 16 GiB, max 1 TiB) bound retained old roots;
the latest revision is outside those budgets. Bytes conservatively sum each
root's logical asset inventory, including shared assets more than once. This
can expire revisions earlier than a unique-byte budget. The report separately
counts actual managed logical bytes by originals, Zarr, COGs, numeric tiles,
metadata and other files; hard-linked COGs can be counted twice. This is storage
accounting, not a measured disk/capacity envelope.

Every request checks current policy before manifest, sampler or warm tile-cache
access. Catalogue entries disappear and known selections return HTTP 410
`Expired`, including point, WMS, tile metadata and numeric tiles. On apply, small
durable tombstones preserve that result after files/catalogue rows are removed,
restart, policy extension or demonstration-clock rewind. Unknown selections
remain 404. Expiry responses and catalogue/metadata responses use `no-store`.
Numeric tile/WMS bytes require revalidation (`private, no-cache`); the API does
not return 304 without checking eligibility. The gateway forwards those headers.

`--reader-grace-seconds` defaults to 120 (allowed 0..3600). Apply commits expiry
first and starts this fixed physical grace at observation, even if cleanup is
late. Repeated cleanup cannot renew it. Already in-flight HTTP operations hold
a shared database reader lock through response generation. Deletion queues an
exclusive lock, so later readers cannot starve collection. Health checks need no
asset lock. Lock acquisition has a 110-second timeout; failure aborts without
unlinking. New readers may receive retryable 503 while deletion drains readers.
Backend HTTP calls have bounded
timeouts; no client session or keepalive renews eligibility/grace. An operator
must diagnose a stuck API process rather than bypass the lock. Expired roots
stay physically reachable until grace ends; eligible roots and their shared
batches remain protected. New calls to expired URLs are already denied during
physical grace. Old superseded URLs remain usable only until their separate
fixed eligibility deadline.

Dry-run lists managed paths and reclaimable product categories without expiry
or file deletion. Apply drops unreferenced private GeoServer workspaces/indexes,
prunes publication rows and removes unreferenced managed data. Tombstones retain
manifest locations so an interrupted unlink can be retried. Durable jobs remain
as audit metadata. Incomplete/retryable jobs are protected; abandoned staging
and malformed deliveries keep T6's separate recovery/collection behavior.
Only the managed `/assets` tree is eligible. Organization `/input` mounts are
read-only and never deletion candidates. A GIS/index/storage failure aborts
collection; keep evidence and retry after repair.

The server numeric cache is process-local and bounded by `TILE_CACHE_BYTES`
(0..256 MiB, default 16 MiB). Each API request purges entries for expired roots
before lookup; idle processes may hold bounded unreachable bytes until the next
request or restart. There is no disk server tile cache. Durable representative
numeric products and `tiles.json` are included in managed cleanup. Cached
samplers cannot bypass the resolver.

Browser clients must revalidate catalogue/selection eligibility on selection,
resume, reconnect and before presenting cached decoded arrays/textures. Keep
selection identity and a generation token on HTTP/decode/upload work; reject
late results after a selection/eligibility change. On 410, clear the layer,
point state, HTTP/application caches, decoded arrays and GPU textures for that
selection, abort pending work and require an eligible selection from the
catalogue. Offline cached textures do not establish current eligibility and
must not be presented as a live selection. Service workers must respect
`no-store`/revalidation and never provide stale-on-error fallbacks for these
URLs. GPU/browser lifecycle implementation and visible-race validation belong
to #25–#29; this slice documents the required invalidation contract.

Run `powershell -NoProfile -File publication/run-retention.ps1 -Project
<fresh-hmc-publication-project> -Port <free-port>`. It uses pinned real services,
isolated volumes, explicit clocks, native exit evidence and automatic archival/
retirement on both success and failure. Its actual-sample test checks seven- and
30-day cleanup, warm expiry, shared batches, demo pinning, source preservation,
grace and permanent expiry after restart. Run current T5 and T6 regression gates
as well before claiming M2. Existing archived passes remain historical evidence;
missing private input or a skipped HTTP test cannot establish M2/A9.

