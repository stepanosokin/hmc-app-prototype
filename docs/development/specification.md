# Specification updates

The current bilingual contract is tracked in
`.scratch/hmc-meteo/spec.md` and `spec.ru.md`; the local mirror of canonical
GitHub specification #12 is `implementation-spec.md` in that directory.
Update both language copies and the canonical issue together. Preserve historical
planning snapshots and acceptance IDs; a newly created implementation ticket
keeps its criteria unchecked until implementation is verified.

Run `powershell -NoProfile -File tools/check-documentation.ps1` for the current
specification and workflow links. For multiple paths, call the script inside
PowerShell: `& ./tools/check-documentation.ps1 -Path @('README.md','AGENTS.md')`.
The check resolves local inline Markdown links relative to each file, including
root README links; it does not validate remote URLs or section fragments.
Its default scope includes the [administrator recipe](../../ADMIN.md), whose
PowerShell fences are parsed without executing the commands. Other documents
can contain templates; use `-ParsePowerShell` only for runnable examples in an
explicit `-Path` selection. The Windows local/CI checks also run
`tools/check-documentation-tests.ps1` against valid/invalid examples and links.

For ad hoc PowerShell validation, set `$ErrorActionPreference = 'Stop'` before
checking inputs and inspect native exit codes before reporting success. Resolve
file paths before deriving their directory. A trailing success message or exit
zero does not establish that earlier nonterminating errors were absent.
For a PowerShell script invoked with `&`, check `$?` or let its terminating error
propagate; `$LASTEXITCODE` belongs to the last native process and can be stale.
