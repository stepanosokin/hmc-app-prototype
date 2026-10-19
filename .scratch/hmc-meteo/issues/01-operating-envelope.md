# Agree the prototype's operating envelope and external consumers

Label: wayfinder:grilling
Type: grilling
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/2
Assignee: root
Parent: [Hydrometcenter meteorology prototype](../map.md)
Blocked by: none

## Question

Which API use cases, access rules, network constraints, source update/retention behavior, workload assumptions, and measurable demonstration criteria should govern the prototype? Distinguish confirmed requirements from unknowns and proposed benchmark targets. Clarify the relationship between model, model run, forecast lead time, valid time, field, and published layer when those concepts become relevant.

## Comments

The initial destination, sample-based demonstration, and single Linux server/Docker Compose target are confirmed in the map Notes.

### Confirmed in the second interview round

- Desktop GIS interoperability is the main external API use case. Required clients and analytical versus rendered access remain to be clarified.
- External organizations need separate API keys, request limits, and usage records. Payments and tariff calculation are deferred.
- The demo web map is public. How this interacts with API quotas and caching must be designed explicitly.
- Self-hosted runtime; internet is available during setup. No dependency on public cloud services is required.
- The user can provide approximate workload and server figures; these have not yet been supplied.

### Confirmed in the third interview round

- QGIS is the first external client: layer display, time selection, and value inspection. Numerical raster downloads/analysis are not required for this first milestone.
- Planning envelope: tens of models; an individual GRIB can reach several GB; some models update every 15 minutes, others hourly. This is not a measured total daily volume, and not every model necessarily has the fastest cadence.
- Initial time depth: one week, with possible extension to one month. The architecture ticket must settle the retention clock and which assets it governs.
- Current audience estimate: fewer than 100 concurrent users. It does not establish request rate or a tested service capacity.
- Server CPU, RAM and storage evaluation is explicitly deferred by the user.
- Publish validated forecast times incrementally, expose incomplete-run status, and preserve previous usable data if an update fails.

## Answer

The prototype proves the complete path from the supplied GRIB2 sample to a public web map and an organization-authenticated external service usable from QGIS. Initial client capabilities are map display, time selection and numerical value inspection, not bulk raster analysis/downloads. Keys, limits and request usage records are required; tariff calculation and payment processing are deferred. Runtime is self-hosted on one Linux server with Docker Compose; internet can be used during setup.

Use the workload envelope recorded above for architectural tradeoffs and a later benchmark plan. Initial retention is seven days, configurable toward a month; its precise clock/asset scope moves to the architecture decision. Do not infer total ingestion throughput from file size, the sample, or concurrent-user count, and do not select a server or promise a latency/freshness SLA before measurement. Full production onboarding of tens of models is distinct from the sample-based demonstration.

Publication is incremental at validated forecast times, with explicit availability/completeness and preserved fallback data. The architecture decision must specify consistent run/revision selection across the web map and QGIS, source-file completion detection, and retention. The interaction ticket will agree loading, missing-data and update behavior; the specification ticket will state concrete correctness checks and configurable performance measurements.
