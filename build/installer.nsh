; Installer hooks for electron-builder (package.json build.nsis.include).
;
; The app was called ExcaliDesk up to 0.1.0. Installing Doodlebay removes that per-user
; install silently, so only one app owns .excalidraw files. Its data folder
; (%APPDATA%\ExcaliDesk) is kept: Doodlebay copies settings, library and Drafts from it on
; first start. The old uninstaller also removes the .excalidraw registration, so it is
; registered again for Doodlebay afterwards.
!macro customInstall
  StrCpy $0 "$LOCALAPPDATA\Programs\ExcaliDesk"
  ${If} ${FileExists} "$0\Uninstall ExcaliDesk.exe"
    DetailPrint "Removing ExcaliDesk 0.1.0 (renamed to Doodlebay)"
    ; _?= runs the uninstaller in place, so ExecWait really waits for it.
    ExecWait '"$0\Uninstall ExcaliDesk.exe" /S _?=$0'
    Delete "$0\Uninstall ExcaliDesk.exe"
    RMDir /r "$0"
    !insertmacro registerFileAssociations
  ${EndIf}
!macroend
