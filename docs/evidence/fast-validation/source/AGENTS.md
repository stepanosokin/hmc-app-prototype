# Project agent instructions

## Language

The web app prototype's user-facing interface must be in Russian, including controls, states, validation messages and errors shown in the UI. Deliver final user-facing results and completion reports in Russian.

## Ticket completion

Before reporting completion, verify all acceptance criteria and required checks. Report in Russian as 3–5 brief results: behavior, validation, evidence/cleanup, commit/push, issue link, complete/incomplete scope and verified open/closed state. State any blocker.

Update acceptance checkboxes as criteria are verified using [issue tracking](docs/development/tracking.md). Checklist updates have standing authorization; leave unvalidated criteria unchecked and read back the checklist before handoff.

Close the ticket automatically once implementation, all checked criteria, required validation, archived evidence, verified cleanup and push are complete. Closure has standing authorization. Read back closed state and completed checklist; preserve unrelated parent issues/milestones and report already-closed tickets as closed.

Review uncommitted changes against the starting commit. Complete implementation, review, validation, evidence and cleanup before one ticket commit containing code/tests/docs/evidence, then push once on the current branch. This overrides skills requesting intermediate commits. Verify remote branch equals local HEAD before reporting push complete.

## Workflow customization

Keep project-specific workflow changes in this repository's agent instructions. Leave original third-party skills, including Matt Pocock's skills, unchanged unless the user explicitly requests edits to those skills.

For implementation and validation, start with [the change-to-check table](docs/development-workflow.md#choose-validation-by-the-change). Follow its conditional links for browser, service, QGIS, scientific, specification or tracker details. During edits, use affected Development checks; after review fixes, run the required complete acceptance on frozen inputs. Repeat an affected complete gate when its validated inputs change.

## Test environment cleanup

After every validation attempt, including failures, archive evidence and verify cleanup of the resources it created. Browser runners retire their own browser/profile; checks allocating Docker resources follow [the cleanup procedure](docs/development/cleanup.md). Resource-free checks record that no test resources were created. Cleanup has standing user authorization. Retain only explicitly user-requested live stacks and name them in the handoff; preserve sources, historical evidence, unrelated projects and shared caches.

## Agent skills

### Issue tracker

Before reading, creating or updating tickets, read
[the GitHub tracker configuration](docs/agents/issue-tracker.md).

### Triage labels

Before triaging issues, read
[the label mapping](docs/agents/triage-labels.md).

### Domain docs

Before exploring the codebase, read
[the single-context domain rules](docs/agents/domain.md).
