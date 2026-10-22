$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $repository 'publication/process.ps1')
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('hmc-demo-' + [guid]::NewGuid().ToString('N'))
$originalPath = $env:PATH
$originalFixture = $env:HMC_DEMO_FIXTURE
$server = $null
$toolRepository = Join-Path $fixture 'repo'
$operations = Join-Path $toolRepository 'data/live/hmc-app/operations'
$archive = Join-Path $repository ('data/reports/hmc-demo/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    foreach ($path in @('tools','publication','data/live/hmc-app')) {
        New-Item -ItemType Directory -Path (Join-Path $toolRepository $path) -Force | Out-Null
    }
    foreach ($path in @('tools/hmc-demo.ps1','publication/process.ps1','compose.publication.yaml')) {
        Copy-Item -LiteralPath (Join-Path $repository $path) -Destination (Join-Path $toolRepository $path)
    }
    'fixture-only=true' | Set-Content (Join-Path $toolRepository 'data/live/hmc-app/environment.env')
    '{}' | Set-Content (Join-Path $toolRepository 'data/live/hmc-app/published.json')
    # A fake executable exercises the real Windows process boundary. Its HTTP
    # listener serves only fixture data; no Docker resource is allocated.
    Add-Type -OutputAssembly (Join-Path $fixture 'docker.exe') -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Text;
public class DemoFixture {
    public static int Main(string[] args) {
        string root = Environment.GetEnvironmentVariable("HMC_DEMO_FIXTURE");
        if (args[0] == "serve") {
            var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, Int32.Parse(args[1]));
            listener.Start();
            while (true) {
                var client = listener.AcceptTcpClient();
                var stream = client.GetStream();
                var reader = new StreamReader(stream);
                string request = reader.ReadLine();
                while (!String.IsNullOrEmpty(reader.ReadLine())) {}
                string body = request.StartsWith("GET /api/v1/catalogue ")
                    ? File.ReadAllText(Path.Combine(root, "catalogue.json")) : "<html>demo fixture</html>";
                byte[] bytes = Encoding.UTF8.GetBytes(body);
                byte[] header = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + bytes.Length + "\r\nConnection: close\r\n\r\n");
                stream.Write(header, 0, header.Length);
                stream.Write(bytes, 0, bytes.Length);
                client.Close();
            }
        }
        File.AppendAllText(Path.Combine(root, "calls.log"), String.Join(" ", args) + "\n");
        string command = args[7];
        string mode = File.ReadAllText(Path.Combine(root, "mode.txt"));
        if (mode == "native-failure") { Console.Error.WriteLine("fixture native error"); return 7; }
        if (command == "up") File.WriteAllText(Path.Combine(root, "state.txt"), "running");
        if (command == "stop" && mode != "stop-failure") File.WriteAllText(Path.Combine(root, "state.txt"), "stopped");
        if (command == "ps" && File.ReadAllText(Path.Combine(root, "state.txt")) == "running")
            Console.WriteLine("db\napi\ngateway\ngeoserver\nviewer");
        else if (command == "ps") Console.WriteLine();
        if (command == "port") Console.WriteLine("127.0.0.1:" + File.ReadAllText(Path.Combine(root, "port.txt")));
        return 0;
    }
}
'@
    $env:PATH = $fixture + ';' + $originalPath
    $env:HMC_DEMO_FIXTURE = $fixture
    'normal' | Set-Content -NoNewline (Join-Path $fixture 'mode.txt')
    'stopped' | Set-Content -NoNewline (Join-Path $fixture 'state.txt')
    '{"selections":[{"id":"fixture"}]}' | Set-Content (Join-Path $fixture 'catalogue.json')
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    $port | Set-Content -NoNewline (Join-Path $fixture 'port.txt')
    $server = Start-Process -FilePath (Join-Path $fixture 'docker.exe') -ArgumentList @('serve',"$port") -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture 'server.stdout.log') -RedirectStandardError (Join-Path $fixture 'server.stderr.log')
    $serverReady = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        if ($server.HasExited) { throw (Get-Content -Raw (Join-Path $fixture 'server.stderr.log')) }
        try {
            $null = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/" -TimeoutSec 1
            $serverReady = $true
            break
        } catch { Start-Sleep -Milliseconds 100 }
    }
    if (-not $serverReady) { throw 'Fixture HTTP server did not start' }
    function Check-Demo {
        param([string]$Action,[bool]$Success,[string]$Expected)
        $name = $Action + '-' + [guid]::NewGuid().ToString('N')
        $accepted = $true
        try {
            Invoke-CheckedProcess -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $toolRepository 'tools/hmc-demo.ps1'),'-Action',$Action,'-WaitSeconds','1') -ReportDirectory $fixture -Name $name | Out-Null
        } catch { $accepted = $false }
        $result = (Get-Content -Encoding utf8 -Raw (Join-Path $fixture ($name + '.stdout.log'))) + (Get-Content -Encoding utf8 -Raw (Join-Path $fixture ($name + '.stderr.log')))
        if ($accepted -ne $Success -or $result -notmatch $Expected) {
            throw "Unexpected $Action result (success=$accepted): $result"
        }
        Write-Output "PASS $Action success=$Success pattern=$Expected"
    }
    Check-Demo status $true 'остановлен'
    Check-Demo start $true "http://127.0.0.1:$port/"
    Check-Demo status $true 'готов'
    'stop-failure' | Set-Content -NoNewline (Join-Path $fixture 'mode.txt')
    Check-Demo stop $false 'остались работающие'
    'normal' | Set-Content -NoNewline (Join-Path $fixture 'mode.txt')
    Check-Demo stop $true 'тома сохранены'
    Check-Demo stop $true 'тома сохранены'
    '{"selections":[]}' | Set-Content (Join-Path $fixture 'catalogue.json')
    Check-Demo start $false 'не готов'
    Check-Demo status $false 'недоступен'
    'native-failure' | Set-Content -NoNewline (Join-Path $fixture 'mode.txt')
    Check-Demo start $false 'native exit 7'
    $calls = Get-Content -LiteralPath (Join-Path $fixture 'calls.log')
    if (@($calls | Where-Object { $_ -notmatch '--project-name hmc-app-live --file ' -or $_ -match '\b(down|rm|prune)\b' }).Count) {
        throw 'Command escaped the demo project or removed data'
    }
    Write-Output 'PASS project isolation and preservation; no Docker resources created'
} finally {
    $env:PATH = $originalPath
    $env:HMC_DEMO_FIXTURE = $originalFixture
    if ($null -ne $server) {
        if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
        $server.WaitForExit()
        if (-not $server.HasExited) { throw 'Fixture server survived cleanup' }
    }
    New-Item -ItemType Directory -Path $archive -Force | Out-Null
    Get-ChildItem -LiteralPath $fixture -File | Where-Object Extension -EQ '.log' | Copy-Item -Destination $archive
    if (Test-Path -LiteralPath $operations) { Copy-Item -LiteralPath $operations -Destination $archive -Recurse }
    'Synthetic Docker/HTTP fixture only; no real publication or Docker resources.' | Set-Content (Join-Path $archive 'fixture.txt')
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedFixture.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture outside temp root' }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    if (Test-Path -LiteralPath $resolvedFixture) { throw 'Fixture cleanup failed' }
    'Fixture server exited; temporary directory absent; no Docker resources allocated.' | Set-Content (Join-Path $archive 'cleanup.txt')
    Write-Output "Fixture server and temporary directory retired. Archive: $archive"
}
