# Evaluate GRIB decoding and publication storage

Label: wayfinder:research
Type: research
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/3
Assignee: research_storage
Parent: [Hydrometcenter meteorology prototype](../map.md)
Blocked by: none

## Question

For the supplied sample and future frequently updated multidimensional meteorological models, what are the practical tradeoffs between keeping GRIB2, converting fields to COG, using Zarr, and combining an authoritative scientific store with disposable map products? Investigate decoder support for packing template 5.42; grid/level/run/time semantics; point/time-series versus tile and subset access; atomic publication, late files, retention, chunking/overviews, and costs that require measurement. Use primary sources. Recommend conditional choices rather than inventing workload evidence.

## Comments

Input: [sample inventory](../assets/sample-inventory.md). Research is advisory; the architecture ticket makes the human decision. Findings will be captured on a disposable research branch and linked here.

## Answer

Template 5.42 uses CCSDS; verify all sample values with an AEC-enabled ecCodes build before selecting conversion storage. Preserve original GRIB, run/reference time, validity interval, level, grid, units, tables and provenance. COG is a conditional map-slice candidate; Zarr is a conditional multidimensional-query candidate. Neither implies atomic run publication: stage immutable revisions, validate and publish a catalogue pointer; specify completeness, late corrections and retention. The report defines correctness and performance measurements needed before an architecture choice. No decoding, installations or benchmarks were performed.

Report branch: `research/hmc-grib-storage`; commit: `69a62db`. Path: `docs/research/grib-storage.md`.
Local report: [grib-storage.md](C:/Users/s.osokin/AppData/Local/Temp/hmc-grib-storage-research/docs/research/grib-storage.md).
Workspace report snapshot: [GRIB decoding and publication storage investigation](../../../docs/research/grib-storage.md).
Remote URL if approved and pushed: https://github.com/stepanosokin/hmc-app-prototype/blob/research/hmc-grib-storage/docs/research/grib-storage.md (not currently published).

Push status: blocked by automatic approval review. It rejected `git push -u origin research/hmc-grib-storage` because the report includes organization-specific sample metadata, the external remote is unverified and the user did not explicitly authorize that payload and destination. Local branch/report are preserved; do not bypass. Explicit user approval is needed to publish this report to that remote. Research itself is resolved; architecture remains a human decision.
