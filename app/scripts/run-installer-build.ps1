$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cache = Join-Path $root '.local-cache'
$temp = Join-Path $cache 'temp'
$dirs = @($temp, (Join-Path $cache 'npm'), (Join-Path $cache 'electron'), (Join-Path $cache 'electron-builder'), (Join-Path $cache 'nuget'))
foreach ($directory in $dirs) { [System.IO.Directory]::CreateDirectory($directory) | Out-Null }
$env:TEMP = $temp
$env:TMP = $temp
$env:TMPDIR = $temp
$env:npm_config_cache = Join-Path $cache 'npm'
$env:ELECTRON_CACHE = Join-Path $cache 'electron'
$env:ELECTRON_BUILDER_CACHE = Join-Path $cache 'electron-builder'
$env:NUGET_PACKAGES = Join-Path $cache 'nuget'
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$releaseEvidence = 'aetherflow-' + ($package.version -replace '\.', '') + '-codex-launch-recovery'
$evidence = Join-Path (Join-Path $root 'evidence') $releaseEvidence
[System.IO.Directory]::CreateDirectory($evidence) | Out-Null
$stdout = Join-Path $evidence 'build.stdout.log'
$stderr = Join-Path $evidence 'build.stderr.log'
$node = (Get-Command node.exe).Source
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = $node
$start.Arguments = 'scripts/build-installer.mjs'
$start.WorkingDirectory = $root
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
foreach ($key in @('TEMP','TMP','TMPDIR','npm_config_cache','ELECTRON_CACHE','ELECTRON_BUILDER_CACHE','NUGET_PACKAGES')) { $start.EnvironmentVariables[$key] = [Environment]::GetEnvironmentVariable($key) }
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $start
if (-not $process.Start()) { throw 'The installer build process could not start.' }
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$process.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
$process.WaitForExit()
$process.Refresh()
$stdoutText = $stdoutTask.GetAwaiter().GetResult()
$stderrText = $stderrTask.GetAwaiter().GetResult()
[System.IO.File]::WriteAllText($stdout, $stdoutText)
[System.IO.File]::WriteAllText($stderr, $stderrText)
$exitCode = [int]$process.ExitCode
$receipt = [ordered]@{ command = 'AetherFlow-Build.cmd'; processId = $process.Id; priority = 'BelowNormal'; exitCode = $exitCode; stdout = "evidence/$releaseEvidence/build.stdout.log"; stderr = "evidence/$releaseEvidence/build.stderr.log"; finishedAtUtc = [DateTime]::UtcNow.ToString('o') }
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'build-process-receipt.json') -Encoding utf8
if ($exitCode -ne 0) { throw "Installer build failed with exit code $exitCode. See the recorded build logs." }
Write-Output 'Installer build completed. See release/ and the builder report for artifact hashes.'
