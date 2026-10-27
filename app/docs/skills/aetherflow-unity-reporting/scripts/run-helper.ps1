param([ValidateSet('report','video','gif')][string]$Tool)
$ErrorActionPreference = 'Stop'
if (-not $Tool) { throw 'Choose report, video, or gif.' }
$installation = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\installation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $installation.executable -PathType Leaf)) { throw 'The installed AetherFlow runtime moved. Repeat Codex setup in AetherFlow.' }
$helper = Join-Path $PSScriptRoot ($Tool + '.mjs')
$previousNode = $env:ELECTRON_RUN_AS_NODE
$previousProfile = $env:AETHERFLOW_USER_DATA
$previousPort = $env:AETHERFLOW_MCP_PORT
$previousFfmpeg = $env:AETHERFLOW_FFMPEG_PATH
$previousFfprobe = $env:AETHERFLOW_FFPROBE_PATH
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  $env:AETHERFLOW_USER_DATA = $installation.userData
  $env:AETHERFLOW_MCP_PORT = [string]$installation.port
  $env:AETHERFLOW_FFMPEG_PATH = $installation.ffmpeg
  $env:AETHERFLOW_FFPROBE_PATH = $installation.ffprobe
  & $installation.executable $helper @args
  $resultCode = $LASTEXITCODE
} finally {
  $env:ELECTRON_RUN_AS_NODE = $previousNode
  $env:AETHERFLOW_USER_DATA = $previousProfile
  $env:AETHERFLOW_MCP_PORT = $previousPort
  $env:AETHERFLOW_FFMPEG_PATH = $previousFfmpeg
  $env:AETHERFLOW_FFPROBE_PATH = $previousFfprobe
}
exit $resultCode
