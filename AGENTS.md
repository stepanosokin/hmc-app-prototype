# Project agent instructions

## Language

The web app prototype's user-facing interface must be in Russian, including controls, states, validation messages and errors shown in the UI. Deliver final user-facing results and completion reports in Russian.

## Ticket completion

After implementing a ticket, check its acceptance criteria and required validation before reporting completion. In the final response, link its issue, state whether the ticket's scope is complete, and report its verified open or closed state. If any required work or validation remains, explain what blocks closure.

During implementation, update the ticket's acceptance checkboxes as each criterion is verified, using the [issue-tracking workflow](docs/development-workflow.md#issue-tracking). These checklist updates have standing user authorization. Keep incomplete or unvalidated criteria unchecked, and read back the checklist before reporting completion.

Automatically close a ticket once implementation is complete, all acceptance criteria are verified and checked, required validation passes, evidence is archived, cleanup is verified, and completed changes are pushed. Closure under these conditions has standing user authorization; proceed without additional confirmation. Read back the closed state and completed checklist before reporting completion. If it is already closed, report that state. Keep parent issues and unrelated milestones unchanged unless they are also in scope.

Complete implementation, review, required validation, evidence archival and cleanup before creating one commit for the ticket. Include its code, tests, documentation and evidence in that commit, then push once on the current branch. Review uncommitted changes against the starting commit. This repository workflow overrides skill instructions that request earlier or intermediate commits. Verify that the remote branch points to the local HEAD before reporting the push as complete.

## Workflow customization

Keep project-specific workflow changes in this repository's agent instructions. Leave original third-party skills, including Matt Pocock's skills, unchanged unless the user explicitly requests edits to those skills.

For desktop QGIS testing, specification updates, validation, retention or request-budget changes and reviews, Compose runner changes, scientific compatibility changes, or issue-tracker permission failures, read [the development workflow](docs/development-workflow.md).

## Test environment cleanup

After every validation attempt, including failures, follow [the cleanup procedure](docs/development-workflow.md#test-environment-cleanup): archive evidence, retire the project, and verify zero test resources remain before reporting completion. Cleanup has standing user authorization. Retain only explicitly user-requested live stacks and name them in the handoff. The procedure defines the protected sources, evidence, unrelated projects, and shared caches.
