# Agree the implementation handoff and bilingual specification

Label: wayfinder:grilling
Type: grilling
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/7
Assignee: stepanosokin
Parent: [Hydrometcenter meteorology prototype](../map.md)
Blocked by: 04, 05, 08, 09

## Question

Does the assembled specification define a buildable prototype, its API contract, container topology, data lifecycle, implementation sequence, acceptance checks, unresolved operational assumptions, and deferred capabilities precisely enough to hand off? Review an English specification and matching Russian copy; close only after human agreement. Do not invent answers to earlier decisions.

## Resolution — accepted handoff

On 2026-10-19, the user explicitly accepted Q1: "Accept the handoff."

Both specification copies (revision 0.2), milestones M1–M5 and acceptance criteria A1–A12 are accepted for implementation. Local artifacts: `.scratch/hmc-meteo/spec.md` and `.scratch/hmc-meteo/spec.ru.md` (not uploaded).

The accepted API strategy keeps GeoServer temporal WMS/QGIS, a domain catalogue/point API, and an OGC numerical adapter selected during M1 by comparing pygeoapi with a narrow Xarray/HTTP adapter using the same manifest-backed Zarr sampling function. Martin is deferred until vector layers arrive. No measured winner is claimed.

All compatibility, decoding, consistency, conformance and performance gates remain implementation work. No new planning questions were surfaced. The planning destination is reached; building and deployment remain a separate effort.

[Canonical resolution](https://github.com/stepanosokin/hmc-app-prototype/issues/7#issuecomment-6263046933).
