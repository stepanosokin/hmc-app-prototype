# T4 local publication validation — 2026-10-19

Ticket: [#16](https://github.com/stepanosokin/hmc-app-prototype/issues/16).
Starting commit: `9bd76710281014a67b80d596987cb6481e384061`.
Scope is the approved one-time publication foundation, not completion of M2/M3.
Parent #12 and the historical wayfinder are unchanged.

## Agreement and decision

The owner explicitly selected **bilinear, ≤0.01 K total display error relative to
an independent source bilinear reference, and ≤0.001 K encoding error** in this
conversation. COG's separate ≤0.0001 K bound remains unchanged. After an actual
CRS incompatibility the owner approved a registered local native CRS and explicit
zero-shift geocentric transformation as a prototype hypothesis. These approvals
do not establish producer datum accuracy or browser performance targets.

[Contract v2](../../../publication/contract.v2.json) was frozen before final
selection. [Selection](selection.json): `project-bilinear/1`, **little-endian
float32 values plus uint8 validity**. Tiles have a 256×256 interior and one-pixel
halo (258×258 stored), north-first rows, WebMercatorQuad z0–6, no compression,
and 332,820 bytes. Generation is lazy except deterministic eager representatives;
no global tile prebuild is required. Palette application/GPU interpolation remain
#25. The [reproduction instructions](../../publication.md) describe commands and
all gateway routes.

## Candidate evidence

All candidates use actual sample SHA256
`dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
The raw GRIB source supplies an independent scalar bilinear reference and literal
sample geometry; inverse projection is independently checked with the WGS84
geocentric-latitude formula. [Comparison](comparison.json) records representative
cells, full-tile encoding errors, and exact horizontal/vertical halo overlaps.

| Candidate | Observed result in the tested configurations |
| --- | --- |
| GeoServer 2.27.0 reuse | [WMS GeoTIFF](geoserver-numeric.json) returned styled uint8 channels. Private WCS returned float32 but exceeded the 0.01 K display contract (including after custom CRS registration), with nonfinite cells reported. Neither measured path passed the complete numeric contract. |
| rio-tiler 7.9.2 | Default COG probes and explicit native-CRS/no-overview probes exceeded the contract at low zooms; the latter high-zoom tile passed float32 precision but the world tile was rejected as outside bounds. Keep these configuration-specific failures; no claim that every possible toolkit configuration must fail. |
| Project bilinear | Independent reference error ≤3.5e-13 K at the probed cells; both candidate encodings met ≤0.001 K, shared halos matched exactly. Selected float32 for its direct scalar/mask layout and smaller decoder surface, accepting its higher uncompressed byte count. |

[Browser evidence](browser.json) compares both float32 and packed numerical PNG,
including actual decoding, mask checks and WebGL R32F/R8 texture upload. Chrome
155 on this Windows workstation used **ANGLE/SwiftShader software rendering**.
Timings use the real browser clock; individual observations are compatibility
evidence, not hardware GPU/mobile performance or frame-time targets. PNG carries
scalar integers rather than a palette. Only float32 is exposed by the selected
gateway path. Uploaded textures are deleted after each probe.

## Real services and visibility

Local Docker Desktop Linux/amd64, engine 29.1.2; pinned Python 3.12.12 base,
PostGIS 18/3.6 image, GeoServer 2.27.0 image and SHA256-locked Python wheels.
The application code is the checked-out repository mounted read-only during
local validation; Dockerfile.publication also packages it for reconstruction.
Explicit isolated PostgreSQL, GeoServer and asset volumes belong to the named
T4 Compose project. Demo clock starts at 2026-10-19 00:00 UTC; the source retains
its real reference/valid times. Raw source is mounted read-only. Secrets are
generated locally and excluded from committed evidence.

[Job cases](job-cases.json) retain actual job IDs, terminal states and gateway
observation counts. The actual submission passes all seven progress states and
publishes only the first actual time. Real missing numeric metadata and a real
GeoServer/PostGIS indexing failure produce failed jobs with no published
selection. Gateway observations throughout processing find no unfinished entry;
both failed updates preserve the existing usable catalogue. Restarting database,
API and GeoServer preserves the publication and its WMS/point/tile behavior.

[Publication manifest](publication-manifest.json) binds immutable assets and
selected dimensions. Real granule filtering returns **one** match for the exact
time and **zero** for an absent time. Actual scoped GeoServer discovery contains
one layer and the same time. A nonempty map is rendered before publication;
gateway tests also compare full-resolution identify against native Zarr within
the separate COG bound. Missing times and staging/admin/raw-asset paths are
rejected. Capabilities contain gateway URLs and only supported operations,
formats and CRSs. The SQL visibility switch follows real GIS checks; a database
transaction is never offered as proof of GeoServer synchronization.

## Validation and remaining boundaries

[Full validation](full-validation.log): **14 tests passed**, including the actual
decoder/storage suite and five new numerical/publication contracts. Pinned mypy
passes all 28 Python source files. [Storage](storage.json) retains all 24 actual
source messages and the separate T2 precision checks; synthetic mask/edge tests
are explicitly supplemental. Reproduce with `./publication/run.ps1` using a
fresh project name/port; this does not delete previous sources/volumes.

Retained failures: v1's [angular comparison](rejected-angular-comparison.json)
and [browser probe](rejected-angular-browser.json) do not prove GIS consistency
and were superseded by approved v2. Initial ImageMosaic indexing failed because
its native custom CRS became PostGIS SRID 0; registration in both services and an
explicit MosaicCRS fixed that real compatibility failure. External-upload URI
attempts failed until the documented absolute filesystem path was used. An early
browser rerun found a stale DevTools endpoint; profiles are now unique and
selection checks the exact browser fixture hash, preventing stale evidence from
authorizing an encoding/CRS revision. None of these attempts establishes success.

The approved local slice does not establish desktop QGIS, the complete protected
GIS profile, producer-confirmed datum accuracy, hardware/browser GPU rendering,
organization-host compatibility or operational capacity. Those remain the
separate downstream gates; no UI, public WCS download, vector service or future
subject-area module was added. Broader correction/retry/retention/access and
performance work remains with its own tickets.
