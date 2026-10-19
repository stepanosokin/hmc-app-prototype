# One-time publication through the gateway

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

Operator commands, with the same environment/project options used by the runner:

```powershell
docker compose --env-file data/reports/t4/environment.env -p hmc-publication-t4-check -f compose.publication.yaml run --rm worker submit --clock 2026-10-19T00:03:00Z
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
