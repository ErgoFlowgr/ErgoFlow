; Kill any running instance before electron-builder's own app-running check.
; Minimize-to-tray can leave the app hidden but still running, which blocks NSIS
; from uninstalling/replacing old files. customInstall runs too late for that;
; customCheckAppRunning is invoked by CHECK_APP_RUNNING near the start.

!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM "Ergoflow Craftsmen.exe" /T'
  nsExec::Exec 'taskkill /F /IM "Ergoflow.exe" /T'
  Sleep 2000
!macroend

!macro customUnInstall
  nsExec::Exec 'taskkill /F /IM "Ergoflow Craftsmen.exe" /T'
  nsExec::Exec 'taskkill /F /IM "Ergoflow.exe" /T'
  Sleep 2000
!macroend
