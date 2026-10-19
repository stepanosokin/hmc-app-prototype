# Agree the sample-based map and API experience

Label: wayfinder:prototype
Type: prototype
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/6
Assignee: root
Parent: [Hydrometcenter meteorology prototype](../map.md)
Blocked by: 01, 04

## Question

Using a cheap interaction outline or mockup, what should users see and do when selecting the available field, run, valid time, map location, and API example? Agree behavior for missing coverage, unavailable times, loading, ingestion failure, units, attribution, and no wind data. Include a responsive web layout without expanding into a native mobile app.

## Comments

Review asset: [Forecast selection walkthrough](../../../docs/prototypes/forecast-interaction.prototype.html). Open the single HTML file locally; no server, packages, network or persistence are needed. It is a throwaway logic prototype, not a real weather viewer, and all values and the second run are explicitly illustrative. No tests or sample decoding were performed.

### Behaviors proposed for human review

- Default to the newest usable run and its first available forecast time. Show reference time, valid time, availability/completeness and data age separately.
- Pin run and publication revision during navigation. Newer runs and additional published times produce a notification; accepting a newer run is explicit, and refreshing availability within the same run is explicit.
- Selecting an unavailable time clears the map layer and point result. Show the gap; do not choose a nearby time or another run automatically.
- Selecting a run starts at that run's first available forecast time and clears the old point result. Changing time also clears the point result. The production viewer requests a new result only for the current selection and must discard stale responses.
- Show units and provenance with point values; distinguish no coverage, nodata, loading and service error. The prototype illustrates time gaps and outside coverage; detailed error rendering remains specified as acceptance behavior rather than claiming a running service.
- Update failure leaves the last published selection usable. A new publication does not change the current snapshot until refreshed.
- The selected run/revision has a QGIS connection and a point-API example. URLs in the walkthrough are examples under `demo.invalid`; organization credentials are sent in headers and never embedded in public pages.
- Intended production layout: map fills the viewport, compact model/field/run controls, bottom time bar, stable legend and point card. Small screens use a collapsible control sheet while retaining time and run context. The walkthrough tests state transitions, not final styling.
- Initial production interface language and displayed time zone are pending the next human response. English terminology in the walkthrough is for this planning session; the final specification will have English and Russian copies.

## Answer

The user accepted the proposed behaviors above, including fixed run/snapshot selection, explicit updates, visible gaps, clearing stale point results, and retaining usable data after update failure. The user also selected a Russian production interface with UTC timestamps, a full-screen map, compact model/field/run controls, bottom time bar, legend and point card. English in the walkthrough is a planning aid; the specification will have matching English and Russian copies.

The reviewed HTML originated on `prototype/hmc-forecast-interaction`, commit `35e7b59`. The handoff commit archives it at `docs/prototypes/forecast-interaction.prototype.html` so the accepted interaction evidence remains available with the planning documents. It uses illustrative data and is not application implementation.
