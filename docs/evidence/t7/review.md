# T7 implementation review

Reviewed the changes from `8efe1fc5d48d172b775cd27642abe32964fd36bd` for
[issue #19](https://github.com/stepanosokin/hmc-app-prototype/issues/19).
The implement skill invoked separate Standards and Spec reviewers.

## Standards

No documented-standard breaches or baseline smell findings. Sources included
AGENTS.md, docs/development-workflow.md, GLOSSARY.md, the numeric tile contract
and both ADRs. No CONTRIBUTING or CODING_STANDARDS file was present.

## Spec

Two defects were found in the first implementation and fixed in `32b11ff`:

- A try-only exclusive reader lock allowed continuous unrelated traffic to
  starve collection. Collection now queues a writer behind active readers;
  later readers wait behind it. A 110-second lock timeout fails safely, and
  health checks no longer take an asset lock. The gateway acceptance test waits
  for traffic from four reader threads and requires overlap with collection.
- Migration registered incremental revisions before legacy selections, allowing
  an older legacy root to supersede the current revision. Backfill combines
  chronology across both sources. Registration separately records publication
  order and the explicit policy event clock, updates chronological predecessors
  without extending old deadlines, and supports late adoption. The upgrade
  acceptance test runs frozen pre-T7 T4 and T5 workers, adopts their records,
  applies a zero superseded-count budget under a demo pin and checks that the
  newest publication survives real GIS/file cleanup.

The Spec reviewer rechecked the fixes and found no further concrete storage,
SQL or crash-boundary defect. Partial-backfill replay was reviewed statically;
the automated upgrade fixture exercises full mixed-source adoption. Persistent
manifest locations make interrupted pruning/unlink retryable. These reviews
are not substitutes for the recorded Compose results.
