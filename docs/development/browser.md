# Browser prototypes

For the approved T22 visual baseline, start with the
[opening instructions](../prototypes/weather-map.README.md) and
[acceptance record](../evidence/t22/validation.md). Its existing browser runner drives
visible controls, records input hashes/screenshots and verifies browser cleanup.
New runs write to ignored reports; select a fresh `T22_REPORT_DIRECTORY` per
attempt. Keep the accepted archive unchanged. Real Compose/GPU/QGIS gates remain
separate from this mockup's demonstration data and emulated mobile viewport.

Define timing boundaries before the first performance probe. A full-page cold
show starts at navigation time origin and includes local scripts, workers,
metadata/field I/O, shader compilation and uploads through the first complete
field render. Record cache reset scope; keep field-load and warm-switch timings
separate. Profile a missed budget before changing execution mechanisms.

For T23 interaction work, start with the [diagnosis](../evidence/t23/diagnosis/diagnosis.md)
and [accepted implementation](../evidence/t23/implementation/validation.md). Prove
continuous rotation on the same Map before timing it; a flat-camera jump or a
new view after pointerup measures a different operation. Before freezing desktop
and mobile inputs, exercise a real click/tap, drag and pinch through the actual
input driver. Record requested and observed DOM coordinates separately and keep
the independent geometry/numerical tolerances fixed. Inspect full-page mobile
screenshots as well as the GPU canvas.

For Android native controls, wait for the observed DOM click or resulting control
state after touch release. Pointerdown/up alone and a fixed delay do not establish
that Chrome dispatched its compatibility click. T13's
[physical runner](../../tools/check-weather-viewer.mjs) records actual targets
and waits for click before opening the native select dialog; reuse that input
path before a full device run.
For a native range, observe trusted `input`/`change` and the resulting value;
Chrome may commit the value without a compatibility click. Exercise the range
followed by the next button/select on the same device: the current driver uses
`Input.synthesizeTapGesture` for taps and waits for the observed control result.
For a native select, match Android `CheckedTextView`/`RadioButton` options,
then wait for both the completing click and the DOM selected index. Record
visual viewport width/offset before repeated mode changes: offscreen map labels
can expand a phone viewport and make otherwise correct touch coordinates miss.
Use `-Updates -UpdatesOnly` for the T15 update/failure scenario before the full
`-Navigation -Updates` gate; see the [T15 retrospective](../evidence/retro-t15.md).
If pointerdown/up arrive but the click does not, retain the failed attempt and
probe the same control on the same device before replaying the full gate.
A successful replay does not establish the cause or a fix for the missed click.

For runtime network isolation, first exercise page, dedicated-worker and nested
worker requests with the installed browser/CDP version, before allocating the
full Compose gate. Worker targets may reject the Fetch domain; the existing
[page interceptor](../../tools/viewer-network.mjs) checks all three blocked probes
with cache disabled and service workers bypassed. A rejected fetch alone does
not prove interception: retain the exact blocked URLs and fail on any attempted
public application dependency. Use `-Offline` with the full viewer gate.
For browser retirement, a Windows `taskkill /T` warning can reflect a child-exit
race. Always run the independent profile-specific process inventory; only a
successful zero-process inventory establishes retirement.

Before declaring a browser unavailable, check its installed executable/version,
including both Program Files locations on Windows. For physical-device checks,
confirm reachability from the device before allocating a long acceptance run.
Wireless Android pairing, its isolated ADB server/mappings and any task-created
host keys need explicit ownership records and final cleanup; retain the user's
confirmation of unpairing. Match the required platform matrix to the ticket;
record an explicit user deferral separately from a passing platform result.

For production run/time checks, start with `-Navigation -NavigationOnly` in the
[viewer runner](../../viewer/README.md) before the complete browser gate.
The run list includes several publication revisions: find the intended run and
revision by identity, then observe the resulting controls and drawer visibility.
A run change can already close the drawer. For controlled races, observe the
held/released completion and deletion of the exact old texture; an accumulated
deletion count does not establish that this selection was retired. Capture the
reviewed prototype's visible transitions and source hash with the existing
[navigation scenario](../../tools/viewer-navigation.mjs).
Before this first Development run, apply the [input-freeze procedure](acceptance.md)
and wait for retirement before editing captured bind-mounted inputs.

For time-switch changes, run `-TimeSwitch -TimeSwitchOnly` on each required
platform first; status-layout fixes can use `-TimeStatusOnly` with those flags.
Inspect the focused full-page phone screenshots before freezing the full gate.
Exercise loading/error with a retained point outside the projection, the timeline
collapsed, and both fonts: a correct DOM message can still be covered by a button.
The [T25 retrospective](../evidence/retro-t25.md) links the failure and the focused
rectangle/screenshot checks.

Inspect screenshots as well as assertions before requesting visual approval.
Include the smallest supported viewport, both font choices and every basemap;
check close controls, footer overlap, label outlines and text contrast. If a
browser assertion fails, capture its actual value before changing the input
driver: T22's Kelvin failure was rounding, while its later mobile selection
failure came from a sticky control covering the click target. The existing
runner scrolls controls to the centre of their panel.

For responsive layout changes, run the focused interaction matrix before the
full browser gate: portrait and short landscape, both sides of width breakpoints,
each expanded group, point-to-controls transitions and rotation with selection
preserved. Use `--projections --landscape-only` for the T24 layout regression;
a focused report remains development evidence. Closed `details` descendants can
retain layout rectangles: combine `checkVisibility()` with rectangle intersection
checks. Compare the actual drawer DOM visibility with the retained selection.
The T24 archive check in CI requires full acceptance scope, all five landscape
sizes and the recorded collapse/point/rotation interactions for both browsers.

After visual approval, record it in the concept and keep runtime inputs fixed.
Documentation-only completion changes need hash verification and documentation
checks; repeat the browser suite when a recorded runtime input changes. During
review, verify default run/time selection against the interaction contract as
well as the layout. The existing CI evidence checker verifies T22 archive bytes,
passing report/cleanup and recorded input identities. External input references
in its historical index belong to the accepted revision, not future workspace
contents; their recorded identities must agree with the selected report.
