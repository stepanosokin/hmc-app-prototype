# Desktop QGIS validation

For common-WMS add/save/reopen/refresh probes, first read the
[ordinary connection procedure](../qgis.md#обычное-подключение-публичного-слоя),
which records the agreed snapshot-link contract from #105/#106.

Before allocating a T11 stand, run `node tools/check-qgis-preflight.mjs`.
This source-only check compares the pinned renderer/Identify sizes with the
current GetMap limit and requires layout initialization plus actual viewport
assertions before Identify. The default invocation also checks the pinned T11
suite order: expanded final modes run the full suite on T5's baseline after its
restart verification and before independent WMS fixtures; Development and
unexpanded modes keep it in Complete. Source-plan drift fails for review rather
than silently skipping this check. Its negative fixtures run in local Windows/All
and manual CI. It neither imports QGIS nor proves desktop compatibility: complete
the pinned-client Development probe before freezing an expensive full gate.

For desktop QGIS or scoped WMS changes, use the two-phase
[T11 runner and desktop procedure](../qgis.md#воспроизведение-приёмки).
Its full mode includes T5 publication/restart, the T8 policy scenario and the
full suite; access-policy changes still require the complete T8 gate above.
First verify the pinned desktop client in Development. For scoped-revision
checks, select a retained revision with a small time domain while later granules
and another run exist; exercise every advertised time of that selected revision.
This checks exclusion of unrelated data without repeating the full publication
matrix at every client probe. Keep the final desktop report bound to the same
selection and input inventory as the HTTP phases.

For default-client compatibility, exercise a fresh connection with the ordinary
QGIS DPI mode and no URI size or operation-URL overrides. Use a canvas larger
than the advertised GetMap limit, then run the actual Identify tool on the same
layer at two available times without pinning URI time. The desktop helper now
asserts these conditions. GetFeatureInfo carries a virtual canvas that can be
larger than GetMap; compare its selected pixel against the native reference in
both CRSs, including NoData. See the [WMS compatibility acceptance](../validation/archives.md).

For agent-driven desktop work, prefer the available
[QGIS MCP connection](../qgis.md#работа-агента-через-qgis-mcp) to the running QGIS
instance. Check local availability before desktop testing. If the QGIS MCP plugin
is missing, request its installation and MCP connection setup from the user;
wait for approval before installation and its associated local QGIS/MCP setup.
For an installed but unreachable plugin, first check the running QGIS instance
and compare its actual server port/PID with the configured MCP instance. A port
mismatch is not a missing plugin; confirm the responding window before desktop
work and preserve other instances. Temporary transport helpers follow
[local-process cleanup](cleanup.md#temporary-local-processes).
Use the Python-console fallback only when the
user explicitly chooses it; continue independent work while awaiting a reply.

Each QGIS MCP `execute_code` call has its own namespace. For a multi-call ordinary
dialog interaction, keep the probe in a uniquely named temporary attribute on
`qgis.utils`, queue dialog actions in separate calls, and remove that attribute
with the temporary connection/layers during cleanup. This preserves UI state
without assuming Python variables survive the next tool invocation.

Queued dialog actions return before asynchronous layer loading finishes.
After Add, read the expected owned layer count and provider readiness in a later
MCP call before capturing evidence. Poll boundedly through the Qt event loop;
keep failed/early observations separate and mark a phase complete only after
its final map, Identify and legend checks. A timer firing is not a ready signal.

For QGIS reviews, trace temporal state separately through map rendering and
identify. The renderer clones its raster pipe; setting its time does not set
the original provider's identify time. Keep both direct-provider sampling and
the same-layer Identify-tool check in the pinned
[desktop helper](../../publication/qgis_desktop.py) and check differing native
values at two available times in both supported CRSs. A valid layer or passing
HTTP test alone does not establish desktop negotiation, time discovery or legend
behavior. Use [the connection procedure](../qgis.md) for URI/header setup rather
than reconstructing it from assumed PyQGIS methods.

Treat authenticated QGIS source URIs as credentials when collecting diagnostics:
they contain HTTP headers, and provider error text can echo the complete URI.
Use a generic invalid-layer message in shared output and redact credential
values before emitting client logs. Retain keys only in the private test files
described by the connection procedure.
