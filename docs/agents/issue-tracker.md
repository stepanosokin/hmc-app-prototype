# Issue tracker: GitHub

Issues and specs live in GitHub Issues:
https://github.com/stepanosokin/hmc-app-prototype/issues

Follow [the issue-tracking workflow](../development-workflow.md#issue-tracking)
for reads, mutations, acceptance checklists and permission failures.
Follow [ticket completion](../../AGENTS.md#ticket-completion)
for validation, review, evidence, cleanup, commit, push and closure.

Use the GitHub connector for issue reads and supported operations.
For authorized writes unavailable through the connector, follow the
repository-scoped helper procedure in the workflow above.

Publishing to the issue tracker means creating a GitHub issue.
Fetching a relevant ticket means reading its current body, labels,
comments and state. Files under `.scratch/` are local working material
or mirrors; GitHub remains authoritative.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Planning relationships

Use native GitHub sub-issues for parent/child relationships and native
issue dependencies for blockers. Dependency API operations require the
issue's database ID, not its issue number or node ID.
If unavailable, record `Part of #<parent>` and `Blocked by: #<number>`
in child bodies and maintain the parent's task list.

For wayfinder, use `wayfinder:map` for the map and
`wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`
or `wayfinder:task` for children. Select unassigned open children
without open blockers in map order; assign the driving developer.
Record the result and context pointer in the map when resolving a child,
subject to the repository's ticket completion rules.
