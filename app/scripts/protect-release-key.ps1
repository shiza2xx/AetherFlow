param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$full = [System.IO.Path]::GetFullPath($Path)
if (-not (Test-Path -LiteralPath $full)) { throw 'Release signing path must already exist.' }
$item = Get-Item -LiteralPath $full -Force
if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Release signing path cannot be a junction or symbolic link.' }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$system = 'S-1-5-18'
$icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
if (-not (Test-Path -LiteralPath $icacls)) { throw 'Windows icacls.exe is unavailable for protecting the release signing key.' }
$rights = if ($item.PSIsContainer) { '(OI)(CI)F' } else { 'F' }
$commands = @(
  @($full, '/reset', '/C'),
  @($full, '/inheritance:r', '/C'),
  @($full, '/grant:r', "*$identity`:$rights", "*$system`:$rights", '/C'),
  @($full, '/verify', '/C')
)
foreach ($arguments in $commands) {
  & $icacls @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Windows could not apply or verify the restricted release signing ACL.' }
}
