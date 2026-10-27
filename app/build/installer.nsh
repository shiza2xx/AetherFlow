!include "owned-files.nsh"
!include "StdUtils.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!macro customInit
  ; The selected final target is checked by the directory-page and install-section callbacks.
!macroend

!ifndef BUILD_UNINSTALLER
Var AetherFlowIdentityValid
Var AetherFlowTargetError
Var AetherFlowLegacyRepair
Var AetherFlowDirectoryEdit
Var AetherFlowBrowseButton

; NSIS GetFullPathName returns empty for a missing final directory. The Win32
; API resolves new installation destinations correctly.
Function AetherFlowCanonicalizePath
  Exch $R0
  Push $R1
  Push $R2
  System::Call 'kernel32::GetFullPathNameW(w "$R0", i ${NSIS_MAX_STRLEN}, w .R1, p 0) i.R2'
  IntCmp $R2 0 canonicalPathInvalid
  IntCmp $R2 ${NSIS_MAX_STRLEN} canonicalPathInvalid canonicalPathValid canonicalPathInvalid
canonicalPathValid:
  StrCpy $R0 "$R1"
  Goto canonicalPathDone
canonicalPathInvalid:
  StrCpy $R0 ""
canonicalPathDone:
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

Function AetherFlowPathIdentityHash
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  System::Call 'kernel32::LCMapStringW(i 0x007F, i 0x100, w "$R0", i -1, w .R1, i ${NSIS_MAX_STRLEN}) i.R2'
  IntCmp $R2 0 pathIdentityHashError
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  ${StdUtils.HashText} $R3 "SHA2-256" "$R1"
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  StrCmp $R3 "error" pathIdentityHashError
  StrCmp $R3 "invalid" pathIdentityHashError
  StrCpy $R0 "$R3"
  Goto pathIdentityHashDone
pathIdentityHashError:
  StrCpy $R0 ""
pathIdentityHashDone:
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; This helper is called only from Browse. A manually typed destination is kept.
Function AetherFlowNormalizeBrowseSelection
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  Push "$R0"
  Call AetherFlowCanonicalizePath
  Pop $R1
  StrCmp $R1 "" browseNormalizeInvalid
  ReadRegStr $R2 HKCU "Software\${APP_GUID}" InstallLocation
  StrCmp $R2 "" browseNormalizeCheckMarker
  Push "$R2"
  Call AetherFlowCanonicalizePath
  Pop $R3
  StrCmp $R3 "" browseNormalizeCheckMarker
  System::Call 'kernel32::lstrcmpiW(w "$R1", w "$R3") i.R4'
  StrCmp $R4 0 browseNormalizeDone
browseNormalizeCheckMarker:
  StrCpy $0 "$R1"
  Call AetherFlowValidateInstallIdentity
  StrCmp $AetherFlowIdentityValid "1" browseNormalizeDone
  StrLen $R2 "${APP_FILENAME}"
  IntOp $R4 $R2 + 1
  StrCpy $R3 $R1 $R4 -$R4
  StrCpy $R5 "\${APP_FILENAME}"
  System::Call 'kernel32::lstrcmpiW(w "$R3", w "$R5") i.R6'
  StrCmp $R6 0 browseNormalizeDone
  IntOp $R4 $R2 + 2
  StrCpy $R3 $R1 $R4 -$R4
  StrCpy $R5 "\${APP_FILENAME}\"
  System::Call 'kernel32::lstrcmpiW(w "$R3", w "$R5") i.R6'
  StrCmp $R6 0 browseNormalizeDone
  StrCpy $R3 $R1 1 -1
  StrCmp $R3 "\" 0 +2
    StrCpy $R1 "$R1${APP_FILENAME}"
  StrCmp $R3 "\" browseNormalizeDone
  StrCpy $R1 "$R1\${APP_FILENAME}"
  Goto browseNormalizeDone
browseNormalizeInvalid:
  StrCpy $R1 ""
browseNormalizeDone:
  StrCpy $R0 "$R1"
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd
Function AetherFlowDirectoryPageCreate
!ifndef AETHERFLOW_PATH_DIAGNOSTIC
  ${if} ${isUpdated}
    Abort
  ${endIf}
!endif
  nsDialogs::Create 1018
  Pop $0
  StrCmp $0 error 0 +2
    Abort
  ${NSD_CreateLabel} 12u 2u 88% 16u "Installation folder:"
  Pop $1
  ${NSD_CreateText} 12u 22u 72% 13u "$INSTDIR"
  Pop $AetherFlowDirectoryEdit
  ${NSD_CreateButton} 76% 22u 24% 13u "Browse..."
  Pop $AetherFlowBrowseButton
  ${NSD_OnClick} $AetherFlowBrowseButton AetherFlowBrowseInstallFolder
  ${NSD_CreateLabel} 12u 41u 88% 32u "Browse to choose a parent folder; AetherFlow is added. Type a dedicated destination directly to keep it exact."
  Pop $1
  nsDialogs::Show
FunctionEnd

Function AetherFlowBrowseInstallFolder
  ${NSD_GetText} $AetherFlowDirectoryEdit $R0
  nsDialogs::SelectFolderDialog "Choose an installation parent folder" "$R0"
  Pop $R1
  StrCmp $R1 "" browseInstallFolderDone
  StrCmp $R1 "error" browseInstallFolderDone
  Push "$R1"
  Call AetherFlowNormalizeBrowseSelection
  Pop $R1
  StrCmp $R1 "" browseInstallFolderDone
  ${NSD_SetText} $AetherFlowDirectoryEdit "$R1"
browseInstallFolderDone:
FunctionEnd

Function AetherFlowDirectoryPageLeave
  ${NSD_GetText} $AetherFlowDirectoryEdit $INSTDIR
  Call AetherFlowCheckInstallTarget
FunctionEnd

Function AetherFlowCheckInstallTarget
  StrCpy $AetherFlowTargetError ""
  StrCpy $AetherFlowLegacyRepair "0"
  Push "$INSTDIR"
  Call AetherFlowCanonicalizePath
  Pop $0
  StrCmp $0 "" targetInvalidPath
  Push "$0\.."
  Call AetherFlowCanonicalizePath
  Pop $1
  StrCmp $1 "" targetInvalidPath
  System::Call 'kernel32::lstrcmpiW(w "$0", w "$1") i.R5'
  StrCmp $R5 0 targetVolumeRoot
  StrCpy $6 "$0"
checkAncestors:
  System::Call 'kernel32::GetFileAttributesW(w "$6") i.R5'
  IntCmp $R5 -1 missingAncestor
  IntOp $R6 $R5 & 0x400
  StrCmp $R6 0 +2
    Goto targetReparsePath
  Push "$6\.."
  Call AetherFlowCanonicalizePath
  Pop $7
  StrCmp $7 "" targetInvalidPath
  System::Call 'kernel32::lstrcmpiW(w "$7", w "$6") i.R5'
  StrCmp $R5 0 checkedAncestors
  StrCpy $6 "$7"
  Goto checkAncestors
missingAncestor:
  Push "$6\.."
  Call AetherFlowCanonicalizePath
  Pop $7
  StrCmp $7 "" targetInvalidPath
  System::Call 'kernel32::lstrcmpiW(w "$7", w "$6") i.R5'
  StrCmp $R5 0 targetVolumeRoot
  StrCpy $6 "$7"
  Goto checkAncestors
checkedAncestors:
  System::Call 'kernel32::GetFileAttributesW(w "$0") i.R5'
  IntCmp $R5 -1 missingTarget
  IntOp $R6 $R5 & 0x10
  StrCmp $R6 0 targetNotDirectory
  IntOp $R6 $R5 & 0x400
  StrCmp $R6 0 +2
    Goto targetReparsePath
  Goto existingTarget
existingTarget:
  StrCpy $8 ""
!ifdef AETHERFLOW_PATH_DIAGNOSTIC
  IfFileExists "$EXEDIR\path-diagnostic-register.txt" 0 checkRetainedDataMarker
  FileOpen $7 "$EXEDIR\path-diagnostic-register.txt" r
  FileRead $7 $8
  FileClose $7
!else
  ReadRegStr $8 HKCU "Software\${APP_GUID}" InstallLocation
!endif
  StrCmp $8 "" checkRetainedDataMarker
  Push "$8"
  Call AetherFlowCanonicalizePath
  Pop $9
  StrCmp $9 "" targetRegisteredConflict
  System::Call 'kernel32::lstrcmpiW(w "$9", w "$0") i.R5'
  StrCmp $R5 0 verifiedAetherFlowTarget
  Goto targetRegisteredConflict
checkRetainedDataMarker:
  Call AetherFlowValidateInstallIdentity
  StrCmp $AetherFlowIdentityValid "1" verifiedLegacyMarker
  StrCmp $8 "" checkEmptyTarget targetIncompleteInstall
verifiedLegacyMarker:
  StrCpy $AetherFlowLegacyRepair "1"
  Goto targetWritable
checkEmptyTarget:
  FindFirst $4 $5 "$0\*"
emptyTargetScan:
  StrCmp $5 "" emptyTargetDone
  StrCmp $5 "." emptyTargetNext
  StrCmp $5 ".." emptyTargetNext
  FindClose $4
  Goto targetUnrelatedData
emptyTargetNext:
  FindNext $4 $5
  Goto emptyTargetScan
emptyTargetDone:
  FindClose $4
  Goto targetWritable
verifiedAetherFlowTarget:
  Call AetherFlowValidateInstallIdentity
  StrCmp $AetherFlowIdentityValid "1" verifiedLegacyMarker targetIncompleteInstall
  Goto targetWritable
missingTarget:
targetWritable:
  ClearErrors
  CreateDirectory "$0"
  IfErrors targetCreateFailed
  StrCpy $INSTDIR "$0"
  StrCpy $3 ""
  ClearErrors
  GetTempFileName $3 "$0"
  IfErrors targetWriteDenied
  ClearErrors
  FileOpen $4 "$3" w
  IfErrors targetWriteDenied
  FileClose $4
  Delete "$3"
  ClearErrors
  Return
targetInvalidPath:
  StrCpy $AetherFlowTargetError "Windows could not resolve this folder path."
  Goto invalid
targetVolumeRoot:
  StrCpy $AetherFlowTargetError "Choose a folder inside the drive root. Browse on a drive root adds an AetherFlow folder automatically."
  Goto invalid
targetReparsePath:
  StrCpy $AetherFlowTargetError "The selected folder or one of its parent folders is a symbolic link or junction."
  Goto invalid
targetNotDirectory:
  StrCpy $AetherFlowTargetError "The selected path is a file, not a folder."
  Goto invalid
targetUnrelatedData:
  StrCpy $AetherFlowTargetError "This folder contains unrelated files and is not a verified AetherFlow installation. Its contents were left untouched."
  Goto invalid
targetIncompleteInstall:
  StrCpy $AetherFlowTargetError "This registered AetherFlow folder has no valid install identity marker, so its contents were left untouched."
  Goto invalid
targetRegisteredConflict:
  StrCpy $AetherFlowTargetError "Windows registers AetherFlow in a different folder. Choose the registered folder or remove the old registration first."
  Goto invalid
targetCreateFailed:
  StrCpy $AetherFlowTargetError "Windows could not create the selected folder. Check that its parent exists and allows folder creation."
  Goto invalid
targetWriteDenied:
  Delete "$3"
  StrCpy $AetherFlowTargetError "Windows denied creating a temporary write-check file in this folder. Choose a folder you can write to."
  Goto invalid
invalid:
!ifdef AETHERFLOW_PATH_DIAGNOSTIC
  FileOpen $9 "$EXEDIR\path-diagnostic-result.txt" w
  FileWrite $9 "$AetherFlowTargetError|INSTDIR=$INSTDIR|target=$0|identity=$AetherFlowIdentityValid"
  FileClose $9
  SetErrorLevel 1
  Quit
!else
  MessageBox MB_ICONSTOP|MB_OK "Unable to use the selected AetherFlow installation folder:$\r$\n$INSTDIR$\r$\n$\r$\n$AetherFlowTargetError"
  Abort
!endif
FunctionEnd

Function AetherFlowValidateInstallIdentity
  StrCpy $AetherFlowIdentityValid "0"
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  StrCpy $R0 "$0\data"
  System::Call 'kernel32::GetFileAttributesW(w "$R0") i.R1'
  IntCmp $R1 -1 identityInvalid
  IntOp $R1 $R1 & 0x410
  StrCmp $R1 16 0 identityInvalid
  StrCpy $R0 "$0\data\aetherflow-install.identity"
  System::Call 'kernel32::GetFileAttributesW(w "$R0") i.R1'
  IntCmp $R1 -1 identityInvalid
  IntOp $R1 $R1 & 0x410
  StrCmp $R1 0 0 identityInvalid
  ClearErrors
  FileOpen $R1 "$R0" r
  IfErrors identityInvalid
  ClearErrors
  FileRead $R1 $R2
  IfErrors identityReadFailed
  FileClose $R1
  StrCpy $R0 "AETHERFLOW_INSTALL_V1|${APP_GUID}|$0"
  System::Call 'kernel32::lstrcmpiW(w "$R2", w "$R0") i.R1'
  StrCmp $R1 0 identityValid
  Push "$0"
  Call AetherFlowPathIdentityHash
  Pop $R3
  StrCmp $R3 "" identityInvalid
  StrCpy $R0 "AETHERFLOW_INSTALL_V2|${APP_GUID}|$R3"
  System::Call 'kernel32::lstrcmpiW(w "$R2", w "$R0") i.R1'
  StrCmp $R1 0 0 identityInvalid
identityValid:
  StrCpy $AetherFlowIdentityValid "1"
  Goto identityDone
identityReadFailed:
  FileClose $R1
identityInvalid:
  StrCpy $AetherFlowIdentityValid "0"
identityDone:
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

Function AetherFlowWriteInstallIdentity
  Push "$INSTDIR"
  Call AetherFlowCanonicalizePath
  Pop $R0
  StrCmp $R0 "" identityWriteInvalid
  StrCpy $R1 "$R0\data"
  CreateDirectory "$R1"
  System::Call 'kernel32::GetFileAttributesW(w "$R1") i.R2'
  IntCmp $R2 -1 identityWriteInvalid
  IntOp $R2 $R2 & 0x410
  StrCmp $R2 16 0 identityWriteInvalid
  StrCpy $R1 "$R1\aetherflow-install.identity"
  System::Call 'kernel32::GetFileAttributesW(w "$R1") i.R2'
  IntCmp $R2 -1 identityCreateMarker
  IntOp $R2 $R2 & 0x410
  StrCmp $R2 0 0 identityWriteInvalid
  StrCpy $0 "$R0"
  Call AetherFlowValidateInstallIdentity
  StrCmp $AetherFlowIdentityValid "1" identityWriteDone identityWriteInvalid
identityCreateMarker:
  Push "$R0"
  Call AetherFlowPathIdentityHash
  Pop $R3
  StrCmp $R3 "" identityWriteInvalid
  ClearErrors
  FileOpen $R2 "$R1" w
  IfErrors identityWriteInvalid
  FileWrite $R2 "AETHERFLOW_INSTALL_V2|${APP_GUID}|$R3"
  FileClose $R2
  Goto identityWriteDone
identityWriteInvalid:
  MessageBox MB_ICONSTOP|MB_OK "AetherFlow could not validate its installation identity file. Existing workspace data was preserved."
  Abort
identityWriteDone:
FunctionEnd

Function AetherFlowShouldInvokeLegacyUninstaller
  StrCpy $R0 "1"
  StrCmp $AetherFlowLegacyRepair "1" skipLegacyUninstaller
  Return
skipLegacyUninstaller:
  StrCpy $R0 "0"
FunctionEnd
!endif

!macro customRemoveFiles
  !insertmacro AetherFlowRemoveInstalledFiles
!macroend

!macro customInstall
  ; This marker in preserved app data identifies this install for a safe reinstall.
  Call AetherFlowWriteInstallIdentity
!macroend
