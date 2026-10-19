# T6 review

Fixed point: `c9660172b0ba06c27e428d655c8fdb944d2d85c6`.
Implementation: `3d9d9f5`; capture fixes: `8f89d90`, `9674df0`.
The invoked `implement` skill required `code-review`; its two independent agents
reviewed standards and spec separately. Source code was frozen at `9674df0`
before the selected final Compose run.

## Standards

Verified the commits and nonempty diffs against the fixed point. Reviewed changed
hunks against `AGENTS.md`, `docs/development-workflow.md`, `GLOSSARY.md` and both
accepted ADRs. No material documented-standard violations or maintainability
smells warranted changes. The capture intent, bounded checksum/completion helpers
and tests fit the existing module responsibilities. The API preserves the
established error response while adding retry headers.

## Spec

Initial review found two P2 gaps: managed bytes were created before durable job
registration, leaving unregistered copies on capture interruption; preliminary
source hashing had neither a byte nor capture-time bound. `8f89d90` registers
capture intent first, bounds regular-file hashing/copying and applies a deadline,
resumes the same capture identity, and permits recovery from completed managed
originals. SIGKILL acceptance covers both partial capture and capture completion.

Follow-up review found one remaining P2: abandoned temporary capture fragments
were not collectable. `9674df0` collects recognized fragments only after verifying
the complete original checksum and exact prefix-byte equality. The test asserts
fragment collection and retained original bytes; distinct fragments are preserved.
The final follow-up found no remaining material spec findings or scope creep.

Standards: 0 findings. Spec: 3 findings resolved, 0 remaining. Final acceptance
is recorded separately in [validation.md](validation.md).
