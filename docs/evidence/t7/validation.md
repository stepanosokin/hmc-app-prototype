# T7 / M2 publication-core retention validation

Implements [#19](https://github.com/stepanosokin/hmc-app-prototype/issues/19).
**Ticket scope verified locally.** Parent #12 and unrelated milestones remain
unchanged. This report establishes the approved retention slice and attaches
fresh publication/recovery evidence; it makes no production-capacity claim.

The implementation was frozen at
`32b11fffc9b8b718189519dd95c89886d7f72e54` for every selected run. Both start/end
inventories match, and `current-input-match.json` verifies their 67/69/69 source
and configuration files against the final repository. The private actual sample
SHA256 is `dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
No source bytes are committed. Frozen pre-T7 source from `8efe1fc` is separately
bound by `legacy-inputs.json`. App and service images are pinned/recorded in
`host.json`, Compose and the retirement inventories. Existing T4 numeric engine,
encoding, CRS and display-budget decisions remain unchanged.

## Selected runs

| Gate | Isolated project | Result |
| --- | --- | --- |
| T7 retention and mixed-source upgrade | `hmc-publication-t7-final2` | Four tests passed, no skipped acceptance tests; restart expiry passed |
| T5 immutable incremental publication | `hmc-publication-t5-retention1` | All 24 actual times, missing/late/corrected batches, old readers, failed updates and restart passed |
| T6 durable jobs and recovery | `hmc-publication-t6-retention1` | Seven acceptance tests passed; killed workers at nine stages, capture crashes, quarantine, retries, partial collection, tile/cache faults, source removal and restart passed |
| Focused public-error regression | `hmc-publication-t7-http-preflight` | One real-GeoServer `sanitized_service_failure` test executed and passed before the selected T7 run |

Every recorded selected native process exited 0; intentional worker kills and
failed ingestion attempts are asserted within T6 acceptance. Mypy and native
interpreter startup/shutdown probes passed. Both regression runners completed
the full suite: **27 tests, 11 expected skips** each. The skipped T5/T6/T7 HTTP
gates run separately above; the legacy T4 job-case fixture is not supplied by
these runners. Three published-service HTTP tests execute in the full suites.
Each runner also verified 80 existing archived evidence references.

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Seven-/30-day reference-time retention; preserve an eligible run's published times | `acceptance.stderr.log`, reference-time boundary test and `t7-retention.json`; retention evaluates run reference time, not valid time |
| Expire discovery/access before physical collection | Point, scoped WMS, numeric metadata and warm numeric tiles return 410; catalogue hides expired roots; tombstones survive deletion, policy extension and service restart (`t7-restart.json`) |
| Bounded readers and superseded roots | Fixed superseded grace and count/byte boundary tests; upgrade uses a zero old-revision count budget; physical reader grace preserves assets; queued deletion succeeds with 18 gateway reader requests during the collection exercise |
| Dry-run/report and source protection | Seven-/30-day dry-run candidates equal applied removals; categorized managed originals/Zarr/COGs/numeric products/metadata; original source SHA256 unchanged throughout both policies |
| Historical demo and isolated clocks/volumes | Explicit demo pin keeps the latest mixed T4/T5 publication usable after upgrade; the independent fixed-clock retention fixture checks shared batches and expiry |
| M2 durable jobs, incremental publication, recovery and retention evidence | Fresh T5/T6/T7 reports above; failed development gate retained separately in `rejected-development-*`, never selected |
| Numeric products, caches and browser invalidation contract | Durable representative tiles and metadata are included in dry-run/cleanup; expiry precedes warm cache access; restart stays expired; HTTP/decoded/GPU invalidation is documented in `docs/publication.md` |

The seven-day cleanup case reclaimed **69,495,741 logical bytes**; the separate
30-day case reclaimed **34,755,701 logical bytes**. They contain different test
publications and are not a seven-/30-day storage-capacity comparison. Logical
accounting counts hard-linked COG paths separately. The source remains intact.
The bounded process-local numeric cache has no disk cache; expired entries are
purged before the next API request, and idle unreachable bytes remain bounded.

## Reproduction and limits

Run the committed `publication/run-revisions.ps1`, `publication/run-recovery.ps1`
and `publication/run-retention.ps1` with fresh project names and free ports.
Use the pinned image/Compose services and the approved private sample. Set the
explicit demonstration clock on isolated volumes. Before final T7 acceptance,
publish one actual hour in a separate project and run:

```text
python -m unittest discover -s tests -p test_publication_http.py -k sanitized_service_failure -v
```

Enable `T4_HTTP=1` in that check container and verify it executes rather than
skips. T7's runner records source inputs before/after and captures the historical
upgrade fixture. The selected T5/T6 invocations additionally captured matching
start/end source/configuration inventories around their existing runners.

The host was Windows with Docker Desktop, four exposed CPUs and 6,216,568,832
bytes of Docker memory. This is local correctness evidence, not agreed-host
Linux compatibility, representative multi-GB capacity, a desktop QGIS client
check or a browser GPU lifecycle implementation. Browser invalidation here is
the required client contract; its visible implementation remains in #25-#29.
The approved prototype datum hypothesis and existing compatibility limits remain.
See `review.md` for the two fixed review findings and `failed-probes.md` for
rejected development evidence.

## Cleanup and integrity

**Nine project retirement receipts verified; zero live test projects retained.**
Six had Compose resources; the red/green, focused and review checks were already
resource-free when their evidence was archived. Every receipt records zero
remaining containers, networks and volumes. A final Docker inventory was empty.
`retirement.json` records the exact archive paths under
`data/archives/publication/<project>/<archive-id>` and verified archival results.
Sources, report fixtures and shared images/build cache remain protected.

`artifact-index.json` binds every file in this portable evidence directory.
Historical evidence under T1-T6 remains byte-for-byte unchanged.
