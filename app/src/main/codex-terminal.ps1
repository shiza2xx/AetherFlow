param([Parameter(Mandatory=$true)][string]$ConfigPath,[switch]$Launch)
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if($Launch){
  # Create a visible console with real input/output, instead of inheriting the
  # hidden helper's redirected handles. No prompt is submitted by this launcher.
  $terminalArgs=@('-NoProfile','-NoLogo')
  if($config.keepOpen){$terminalArgs+='-NoExit'}
  $terminalArgs+=@('-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),('"'+$ConfigPath+'"'))
  $terminalProcess=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $terminalArgs -WorkingDirectory $config.cwd -WindowStyle Normal -PassThru
  @{pid=$terminalProcess.Id} | ConvertTo-Json -Compress
  exit 0
}
try {
  if($env:TERM -eq 'dumb'){Remove-Item Env:TERM -ErrorAction SilentlyContinue}
  foreach($key in @('AETHERFLOW_USER_DATA','AETHERFLOW_MCP_PORT','ATELIER_USER_DATA','ATELIER_MCP_PORT')){$value=$config.env.$key;if($value){[Environment]::SetEnvironmentVariable($key,[string]$value,'Process')}}
  Set-Location -LiteralPath $config.cwd
  $Host.UI.RawUI.WindowTitle="AetherFlow "+(Split-Path -Path $config.cwd -Leaf)
  if($config.receiptFile){$process=Get-Process -Id $PID;$startedAtMs=([DateTimeOffset]$process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds();$receipt=@{schemaVersion=1;pid=$PID;startedAtMs=$startedAtMs;cwd=[IO.Path]::GetFullPath($config.cwd);requestId=$config.requestId};$temporary=$config.receiptFile+'.'+$PID+'.tmp';$receipt|ConvertTo-Json -Compress|Set-Content -LiteralPath $temporary -Encoding UTF8;Move-Item -LiteralPath $temporary -Destination $config.receiptFile -Force}
  $launchArgs=@($config.args)
  & $config.command @launchArgs
  if($LASTEXITCODE -ne 0){Write-Host "Codex exited with status $LASTEXITCODE"}
} finally {
  Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue
}
