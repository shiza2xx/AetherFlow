$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:TEMP = Join-Path $projectRoot '.local-cache\temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
public class AetherFlowIconFrame {
 public int Group; public int Width; public int Height; public string Sha256;
}
public static class AetherFlowIconResources {
 delegate bool ResourceName(IntPtr module, IntPtr type, IntPtr name, IntPtr parameter);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, ResourceName callback, IntPtr parameter);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
 [DllImport("kernel32.dll")] static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
 [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr resource);
 [DllImport("kernel32.dll")] static extern uint SizeofResource(IntPtr module, IntPtr resource);
 [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
 static byte[] Read(IntPtr module,IntPtr name,int type) {
  IntPtr resource=FindResource(module,name,new IntPtr(type));
  if(resource==IntPtr.Zero) throw new Exception("Missing executable icon resource.");
  uint size=SizeofResource(module,resource);if(size==0 || size>4194304) throw new Exception("Invalid icon resource size.");
  byte[] bytes=new byte[size];IntPtr data=LockResource(LoadResource(module,resource));if(data==IntPtr.Zero)throw new Exception("Cannot read icon resource.");Marshal.Copy(data,bytes,0,(int)size);return bytes;
 }
 public static string Hash(byte[] bytes) { using(SHA256 hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant(); }
 public static AetherFlowIconFrame[] Frames(string file) {
  // LOAD_LIBRARY_AS_DATAFILE reads resources without executing the application or installer.
  IntPtr module=LoadLibraryEx(file,IntPtr.Zero,2);if(module==IntPtr.Zero)throw new Exception("Cannot open executable resources: "+file);
  try {
   List<AetherFlowIconFrame> result=new List<AetherFlowIconFrame>();int groupIndex=0;
   ResourceName callback=delegate(IntPtr handle,IntPtr type,IntPtr name,IntPtr parameter) {
    byte[] group=Read(handle,name,14);if(group.Length<6)throw new Exception("Invalid icon group.");int count=BitConverter.ToUInt16(group,4);
    if(count<1 || count>64 || group.Length<6+14*count)throw new Exception("Invalid icon frame count.");
    for(int i=0;i<count;i++) {int offset=6+14*i;byte[] bytes=Read(handle,new IntPtr(BitConverter.ToUInt16(group,offset+12)),3);result.Add(new AetherFlowIconFrame {Group=groupIndex,Width=group[offset]==0?256:group[offset],Height=group[offset+1]==0?256:group[offset+1],Sha256=Hash(bytes)});}
    groupIndex++;return true;
   };
   EnumResourceNames(module,new IntPtr(14),callback,IntPtr.Zero);if(result.Count==0)throw new Exception("Executable has no icon group.");return result.ToArray();
  } finally {FreeLibrary(module);}
 }
}
'@
$icon = [IO.File]::ReadAllBytes((Join-Path $projectRoot 'build\icon.ico'))
$count = [BitConverter]::ToUInt16($icon,4)
$expected = @{}
for ($index=0; $index -lt $count; $index++) {
 $entry=6+16*$index
 $size=if($icon[$entry] -eq 0){256}else{[int]$icon[$entry]}
 $length=[BitConverter]::ToUInt32($icon,$entry+8)
 $offset=[BitConverter]::ToUInt32($icon,$entry+12)
 $frame=New-Object byte[] $length
 [Array]::Copy($icon,$offset,$frame,0,$length)
 $expected[$size]=[AetherFlowIconResources]::Hash($frame)
}
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$targets=@('release\nsis-payload\win-unpacked\AetherFlow.exe','release\nsis-payload\win-unpacked\Uninstall AetherFlow.exe',('release\AetherFlow-Setup-'+$version+'.exe'))
$receipts=@()
foreach($target in $targets) {
 $frames=@([AetherFlowIconResources]::Frames((Join-Path $projectRoot $target)) | Where-Object {$_.Group -eq 0})
 if($frames.Count -ne $count){throw ('Default executable icon has the wrong frame count: '+$target)}
 foreach($frame in $frames){if($frame.Width -ne $frame.Height -or $expected[[int]$frame.Width] -ne $frame.Sha256){throw ('Default executable icon differs from the approved brand icon: '+$target)}}
 $receipts+=@{file=$target;frames=$frames.Count;matches=$true}
}
$receipts | ConvertTo-Json -Depth 4
