# Hydrometcenter meteorology prototype ? wayfinder map

Label: wayfinder:map
Status: closed
GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/1

## Destination

Agree a prototype specification in English and Russian, a recommended architecture, and an implementation plan for a containerized meteorology web application and external data API. Implementation follows as a separate effort.

## Notes

- Workflow: wayfinder; consult grilling and domain-modeling for human decisions, research for outside facts, and prototype for interaction design.
- Tracker: GitHub Issues. This is the canonical map; native sub-issues and dependencies define the frontier. Local Markdown files are archival snapshots and artifact locations.
- Confirmed by the user: demonstrate ingestion of the supplied GRIB2 sample, map overlay with legend, time selection when supported, value on map click, and a documented API exposing the same data.
- Confirmed by the user: start with Docker Compose on one organization-controlled Linux server; separate ingestion, data serving, API, and web interface responsibilities.
- Planning language: English. Final agreed specification must also have a Russian copy. This map is not the final specification.
- Wider context: frequently updated GRIB2 models and GeoTIFF imagery on file servers; observations in multiple databases; future PostgreSQL/PostGIS hydrology; future mobile client, additional modules, and API billing.
- Do not select COG, Zarr, OGC interfaces, or a product stack before investigating their fit.
- GitHub issue tracking was authorized by the user on 2026-10-19. Planning artifacts are included in the repository handoff commit; source data and transient tracker responses are excluded.
- Evidence: [sample inventory](assets/sample-inventory.md). This evidence does not substitute for decoded data validation or production workload measurements.
- Accepted handoff assets: [English specification](spec.md) and [Russian specification](spec.ru.md). Final agreement is recorded in the specification ticket.

- The user accepted revision 0.2 of both specification copies, milestones M1–M5 and acceptance criteria A1–A12 on 2026-10-19. Planning is complete; implementation follows separately.

## Decisions so far

- [Agree the prototype's operating envelope and external consumers](https://github.com/stepanosokin/hmc-app-prototype/issues/2): QGIS display/time/value inspection; public web demo and keyed organization API; incremental publication; seven-day initial retention; scale and sizing limits recorded explicitly.
- [Evaluate GRIB decoding and publication storage](https://github.com/stepanosokin/hmc-app-prototype/issues/3): preserve scientific identity and validate CCSDS decoding; compare COG map slices against workload-specific Zarr arrays before choosing storage.
- [Evaluate web delivery and external API standards](https://github.com/stepanosokin/hmc-app-prototype/issues/4): evaluate temporal WMS for desktop GIS alongside browser tiles; distinguish numeric products, forecast dimensions, and client authentication from portrayal.
- [Compare a Zarr-first baseline with COG publication](https://github.com/stepanosokin/hmc-app-prototype/issues/8): Zarr-first is feasible with provider/WMS integration and explicit publication rules; compare against COG and hybrid without claiming unmeasured speed or storage benefits.
- [Choose the ingestion, publication, and module architecture](https://github.com/stepanosokin/hmc-app-prototype/issues/5): user chose a Zarr numeric core with selected derived COGs, GeoServer GIS delivery, and a shared revision contract; implementation compatibility and consistency gates remain explicit.
- [Agree the sample-based map and API experience](https://github.com/stepanosokin/hmc-app-prototype/issues/6): user accepted fixed run/snapshot interaction, explicit updates and missing-data behavior; production UI is Russian with UTC timestamps.
- [Evaluate pygeoapi, Martin, and vector tiles in the hybrid design](https://github.com/stepanosokin/hmc-app-prototype/issues/9): documented OGC API/Martin integration fits feature layers; provider run support and Martin image-COG restrictions require explicit treatment.

- [Compare OGC API server alternatives and efficiency for the hybrid prototype](https://github.com/stepanosokin/hmc-app-prototype/issues/11): no measured overall winner; compare numerical adapters on equivalent Zarr operations and assess feature servers against future vector workloads.

- [Choose the standards API facade and vector tile timing](https://github.com/stepanosokin/hmc-app-prototype/issues/10): user accepted the M1 pygeoapi/Xarray numerical-adapter comparison gate; reuse GeoServer temporal WMS and defer Martin until vector layers arrive.

- [Agree the implementation handoff and bilingual specification](https://github.com/stepanosokin/hmc-app-prototype/issues/7): user accepted bilingual revision 0.2, implementation milestones and acceptance criteria; compatibility and measurement gates remain implementation work.

## Not yet specified

No additional planning fog remains for the agreed sample-based prototype. Compatibility checks and operational inputs are explicit gates in the specification; the final handoff is accepted and no planning decisions remain.

## Out of scope

- Building or deploying the application during this planning effort.
- Delivering a mobile app, payments, production billing, hydrology, long-term forecasts, or operational database integrations in the first prototype.
- Claiming production capacity or OGC conformance without implementation and appropriate validation.
- Specifying tariff policy, payment processing, native mobile interactions, or the full behavior of future modules.
- Selecting production server resources or guaranteeing capacity before representative data and measurements are available; the user deferred sizing.
- Defining complete source-specific contracts for future imagery, observations, hydrology and long-term forecasts before representative data/schema/access are available; the prototype defines shared extension interfaces.
