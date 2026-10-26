# Desktop QGIS validation

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
and connection configuration. Use the Python-console fallback only when the
user explicitly chooses it; continue independent work while awaiting a reply.

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
