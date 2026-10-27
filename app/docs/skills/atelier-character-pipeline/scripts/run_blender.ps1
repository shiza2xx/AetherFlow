param([Parameter(Mandatory=$true)][string]$Blender,[Parameter(Mandatory=$true)][ValidateSet('audit_scene.py','repair_normal_mask.py','repair_pbr_mask.py','limit_weights_local.py','convert_preview.py','validate_workflow.py','fingerprint_scene.py','export_candidate.py','seed_validation_evidence.py','transform_assembly.py','transfer_weights_barycentric.py','uv_surface_tools.py','join_assembly.py')][string]$Script,[Parameter(Mandatory=$true)][string]$Input,[string]$SourceBlend)
$ErrorActionPreference='Stop'
$trusted=Join-Path $PSScriptRoot $Script
if(-not (Test-Path -LiteralPath $trusted -PathType Leaf)){throw 'Trusted script is missing.'}
$fingerprints=Join-Path $PSScriptRoot 'preservation_fingerprint.py'
if(-not (Test-Path -LiteralPath $fingerprints -PathType Leaf)){throw 'Shared preservation fingerprint module is missing.'}
$resolved=Resolve-Path -LiteralPath $Blender
if(-not (Test-Path -LiteralPath $resolved -PathType Leaf)){throw 'Blender executable was not found.'}
$args=@('--background','--disable-autoexec')
if($SourceBlend){$scene=Resolve-Path -LiteralPath $SourceBlend;$sourceRoot=[IO.Path]::GetFullPath((Split-Path -Parent $scene.Path));if(-not $scene.Path.StartsWith($sourceRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'The source scene must remain in its selected dependency folder.'};$args+=$scene.Path}else{$args+='--factory-startup'}
$args+=@('--python',$trusted,'--',$Input)
& $resolved.Path @args
if($LASTEXITCODE -ne 0){throw "Blender operation failed ($LASTEXITCODE). Candidate files were not accepted."}
