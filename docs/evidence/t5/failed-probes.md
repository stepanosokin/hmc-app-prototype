# Retained T5 failed probes

These attempts are retained alongside the successful run; none is treated as
successful implementation evidence.

1. Initial gateway test: native exit **1**, because `worker submit --hours 1`
   returned argparse exit **2** (`unrecognized arguments: --hours 1`). This was
   the expected red test before incremental delivery was implemented.
2. First expanded HTTP probe: native exit **1**, `KeyError: 'etag'`. The API had
   been restarted with ETag support, but the gateway still ran its old header
   forwarding code. Restarting that test gateway resolved the deployment mismatch.
   The subsequent expanded actual-sample probe passed in 182.953 seconds.
3. Runner project `hmc-publication-t5-verified`: interpreter subprobes all exited
   **0**, but the Windows PowerShell launcher returned a null native-process
   ExitCode after polling a `Start-Process` object. The runner rejected that
   result. It now uses hidden `Start-Process -Wait -PassThru`, recording the
   actual Docker process exit code explicitly.
4. Runner project `hmc-publication-t5-verified2`: Compose native exit **1**,
   `Bind for 127.0.0.1:8099 failed: port is already allocated`. Inspection showed
   the historical accepted T4 project owned that port. No T4 service was changed.
   The runner now checks the requested port and existing project volumes before
   creating its independent evidence and services.
5. Runner project `hmc-publication-t5-verified3`: worker native exit **1**,
   pg8000 `InterfaceError: Can't create a connection to host db and port 5432`.
   Initial database startup was not complete when migration began. The runner
   now waits for real database and GeoServer readiness before migration.

Stopped experimental services retain their named volumes and ignored reports;
no source or publication volume was deleted. None of these probes changed the
approved encoding, CRS operation, native dependency lock or architecture. The
successful run separately records deliberately injected missing metadata and
real indexing failures; those are expected acceptance rejections, not a silent
substitution for passing compatibility checks.
