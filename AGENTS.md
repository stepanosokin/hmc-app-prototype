# Project agent instructions

## Ticket completion

After implementing a ticket, check its acceptance criteria and required validation before reporting completion. In the final response, link its issue, state whether the ticket's scope is complete, and explicitly suggest closing the issue when it is ready. If any required work or validation remains, explain what blocks closure.

During implementation, update the ticket's acceptance checkboxes as each criterion is verified, using the [issue-tracking workflow](docs/development-workflow.md#issue-tracking). These checklist updates have standing user authorization. Keep incomplete or unvalidated criteria unchecked, and read back the checklist before reporting completion.

Close an issue when the user has authorized closure, then read it back and report the verified state. If it is already closed, report that state instead of suggesting closure. Keep parent issues and unrelated milestones unchanged unless they are also in scope.

Commit and push completed changes on the current branch. Verify that the remote branch points to the local HEAD before reporting the push as complete.

## Workflow customization

Keep project-specific workflow changes in this repository's agent instructions. Leave original third-party skills, including Matt Pocock's skills, unchanged unless the user explicitly requests edits to those skills.

For validation, Compose runner changes, scientific compatibility changes, or issue-tracker permission failures, read [the development workflow](docs/development-workflow.md).

## Test environment cleanup

After every validation attempt, including failures, follow [the cleanup procedure](docs/development-workflow.md#test-environment-cleanup): archive evidence, retire the project, and verify zero test resources remain before reporting completion. Cleanup has standing user authorization. Retain only explicitly user-requested live stacks and name them in the handoff. The procedure defines the protected sources, evidence, unrelated projects, and shared caches.
