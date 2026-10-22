---
name: hmc-demo
description: Start, stop, or inspect the prepared local Hydrometcenter app demo (hmc-app-live), and display its verified access link. Use for demo lifecycle requests in this repository.
---

Manage the existing `hmc-app-live` Compose project with
[tools/hmc-demo.ps1](../../../tools/hmc-demo.ps1), from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/hmc-demo.ps1 -Action start
powershell -NoProfile -ExecutionPolicy Bypass -File tools/hmc-demo.ps1 -Action stop
powershell -NoProfile -ExecutionPolicy Bypass -File tools/hmc-demo.ps1 -Action status
```

Choose the action requested by the user. With no lifecycle action specified,
inspect status. Start requires Docker Desktop, the prepared image/assets,
`data/live/hmc-app/environment.env` and `published.json` from the existing demo.
For initial provisioning, follow [viewer/README.md](../../../viewer/README.md).
The tool reuses publication, volumes, credentials and historical demo clock;
it does not publish new forecasts. Stop preserves data for the next start.

After successful start, **always display a clickable Markdown access link** in
the Russian response, using the URL printed by the tool after its readiness
check. After status, display the link when the tool reports `ready`.
For example: `Демостенд запущен: [Открыть приложение](http://127.0.0.1:8140/).`
Use the actual returned port. A failed start or stopped state gets its actual
status and diagnostic archive path, without a claim that the app is accessible.

Keep a requested live demo running after launch. On failure, inspect that
operation's archive; report the blocker rather than repeatedly changing the
project or republishing data. Use `stop` for shutdown; preserve source files,
credentials, publication volumes and unrelated Compose projects. Report shutdown
only after the tool verifies that no services in this project are running.
