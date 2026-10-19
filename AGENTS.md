# Project agent instructions

## Ticket completion

After implementing a ticket, check its acceptance criteria and required validation before reporting completion. In the final response, link its issue, state whether the ticket's scope is complete, and explicitly suggest closing the issue when it is ready. If any required work or validation remains, explain what blocks closure.

Close an issue when the user has authorized closure, then read it back and report the verified state. If it is already closed, report that state instead of suggesting closure. Keep parent issues and unrelated milestones unchanged unless they are also in scope.

Commit and push completed changes on the current branch. Verify that the remote branch points to the local HEAD before reporting the push as complete.

## Workflow customization

Keep project-specific workflow changes in this repository's agent instructions. Leave original third-party skills, including Matt Pocock's skills, unchanged unless the user explicitly requests edits to those skills.

For validation, Compose runner changes, scientific compatibility changes, or issue-tracker permission failures, read [the development workflow](docs/development-workflow.md).

## Test environment cleanup

After each validation attempt, archive its evidence and retire every test-created container, network, and named/anonymous volume using [the cleanup procedure](docs/development-workflow.md#test-environment-cleanup). This cleanup is already authorized, including failed attempts. Verify zero resources remain for every retired project before reporting completion. Retain a live test stack only when the user explicitly requests it; identify that exception in the handoff. Keep organization source mounts, committed evidence, unrelated projects, and shared image/build caches intact.
