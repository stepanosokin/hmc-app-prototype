# T1 validation record — 2026-10-19

Source task: [#13 — Decode and inspect the supplied forecast](https://github.com/stepanosokin/hmc-app-prototype/issues/13). Baseline before implementation: `91bbdd6635c0389e396ba7b836f045793a15a319`.

Environment: Windows host, Docker Desktop 4.54.0, Linux engine 29.1.2, linux/amd64, WSL2 kernel 6.6.87.2. Python 3.12.12, ecCodes API/Python 2.44.0, eccodeslib 2.44.0.7, embedded MEMFS definitions 2.44.0, NumPy 2.3.4. All dependencies and base image are locked in the repository. The JSON report records binary hashes and enabled AEC support.

Commands executed successfully:

```sh
docker compose build decode
docker compose run --rm typecheck
docker compose run --rm test
docker compose run --rm decode
```

- Type checking: no issues in 2 Python source files (mypy 1.18.2).
- CLI suite: 6 tests passed, including 5 independent header-mutation subcases and 3 empty/non-GRIB/missing-hour subcases. Actual-sample decoding is mandatory; missing source data fail the suite.
- TDD evidence: the truncated-input test first failed because no report was produced; after implementing structural validation it passed. The actual-sample test next failed with 0 rather than 24 messages; after adding the decoder checks it passed. Additional negative cases exercise the same public command without mocks.
- Actual file: 26,658,586 bytes, SHA256 `dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
- Result: 24/24 messages, 904,689 cells per message, 21,712,536 finite decoded values total, no bitmap/no missing cells. Observed global min/max: 255.3978729248047 / 327.9104919433594 K. Every unmasked value is finite; no additional meteorological range threshold is invented.
- Identity: DWD centre 78 / subcentre 255, tables 19/1, parameter 0/0/0, surface 1, `T_G`, paramId 500010, K. This is ground/water-surface temperature.
- Reference: 2026-10-15 00:00 UTC; hourly leads +1…+24; final validity 2026-10-16 00:00 UTC.
- Native grid: 1377 × 657, 0.0625°; mode 64, west→east then south→north. All ecCodes cell coordinates checked against independently read raw header geometry; no coordinate reordering or interpolation. Six recorded cells per message cover corners, a row transition and the central cell; outer edges explicitly differ from centres by half a cell.
- Failure examples: the original sample minus 32 bytes and a deliberately changed first packing template (5.99) each exit 1, retain checksum/tool diagnostics, and contain an empty `messages` array. These synthetic corruptions are expected rejections, not a failed ecCodes compatibility gate. The source remains read-only.

Evidence: [actual-sample report](a1.json) and [diagnostic reports](failures.json). Recreate the latter using the CLI on a temporary copy shortened by 32 bytes or with zero-based byte 180 changed to 99. Never change the source file. These artifacts use the explicit report clock `2026-10-19T00:00:00Z` and represent local correctness checks, not deployment/throughput measurements.

A1 passes for this sample and pinned decoder. M1 is still incomplete: no Zarr/COG round trip, storage-reader compatibility, numerical-adapter comparison or selection is claimed. No GIS, QGIS, publication, API, operational-host or capacity gate is claimed. No architecture decision needed reopening; accepted specifications, parent #12 and the wayfinder map are unchanged.
