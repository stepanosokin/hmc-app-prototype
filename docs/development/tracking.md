# Issue tracking

Maintain acceptance checkboxes throughout implementation: mark a criterion only
after its required behavior and validation are supported by evidence. Attach or
link the tracked validation record and its external archive reference in the ticket.
Full archives follow [external storage rules](../validation/evidence-storage.md).
Leave blocked/unvalidated criteria
unchecked and explain what remains. Read back the updated body before handoff;
after satisfying the [ticket completion conditions](../../AGENTS.md#ticket-completion),
close the ticket using standing user authorization and verify the closed state
and completed checklist together. Checklist maintenance is also already authorized.

Use the GitHub connector for issue reads. In this session it allowed reads but
returned `403 Resource not accessible by integration` on writes. When an
authorized issue update encounters that limitation, use the existing
repository-scoped `.scratch/hmc-meteo/github-tracker.mjs` helper. Read it first;
it supports issue/label REST operations and obtains credentials without printing
them. Supply operations and output paths in the ignored scratch directory, then
read back the issue state. If the helper is absent or authentication fails,
report the specific blocker. Keep credentials out of commands, logs and reports.
Discover connector tools by listing matching names first, then read metadata
for the selected operation only. Keep issue bodies in memory or ignored files;
return only the fields needed for the current decision or state verification.
The connector's 403 and an automatic approval rejection are separate boundaries:
if approval review rejects this helper, continue independent implementation and
request explicit permission for that helper and issue before retrying. The
permission granted for issue #24 does not authorize helper use for other issues
after such a rejection.

Resolve mutation schemas from tool metadata or local request validation. Before
an issue-body update, prepare the complete preserved body with only the intended
checklist/evidence changes and inspect the diff. Placeholder body writes are not
schema probes: they replace the task text.

When constructing an issue body in PowerShell, read it as a plain string with
`[System.IO.File]::ReadAllText(<absolute-path>)` before `ConvertTo-Json`.
`Get-Content` can carry PowerShell metadata into the serialized value and turn
the required JSON string into an object, causing a GitHub 422. Verify that the
serialized `body` is a string before submitting. Keep tracker responses in
ignored files and inspect only the fields needed for readback; do not send a
large document through tool output merely to serialize it again.
The repository tracker helper rejects a non-string issue body before credential
lookup or network access.

Documentation-only checks allocate no Compose project and require no runtime
acceptance run. Record that no test resources were created; the retirement
procedure applies whenever a check actually allocates Docker resources.

For final publication, label archived tracker/Git snapshots with their phase and
observation time: a pre-commit snapshot can legitimately say open/push pending.
After pushing, read local HEAD, the named remote branch and the live issue state
again; include a direct commit link in the handoff. Inspect only those fields
from tracker responses. Use `git -c commit.verbose=false commit --quiet` for
ticket commits and keep temporary commit messages in ignored `data/`
or a system temporary directory. Verify the final working tree after removing
task-created temporary files. These commands avoid printing thousands of
archived file names while retaining the actual exit status.
