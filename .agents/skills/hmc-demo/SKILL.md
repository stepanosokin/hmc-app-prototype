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
it does not publish new forecasts. Stop force-removes all project containers,
including stopped containers and orphans, then removes their images and project
networks. Publication volumes and local credentials remain. Images must be
rebuilt or pulled before the next start; the custom image build is documented
in [publication setup](../../../docs/publication.md).

After successful start, **always display a clickable Markdown access link** in
the Russian response, using the URL printed by the tool after its readiness
check. After status, display the link when the tool reports `ready`.
For example: `Демостенд запущен: [Открыть приложение](http://127.0.0.1:8140/).`
Use the actual returned port. A failed start or stopped state gets its actual
status and diagnostic archive path, without a claim that the app is accessible.

Keep a requested live demo running after launch. On failure, inspect that
operation's archive; report the blocker rather than repeatedly changing the
project or republishing data. Use `stop` for shutdown; preserve source files,
credentials, publication volumes and unrelated Compose projects. The tool
archives the resource inventory before deletion and retains image targets for
retry even after containers disappear. It never forces image deletion when
another container uses that image. Report such shared images as incomplete
cleanup with the exact blocker from `purge-result.json`. Report complete cleanup
only after containers, project networks and captured images are confirmed absent.
