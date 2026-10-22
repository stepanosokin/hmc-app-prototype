param([int]$ExitCode, [string]$Message)
[Console]::Out.WriteLine($Message)
[Console]::Error.WriteLine('child diagnostic')
exit $ExitCode
