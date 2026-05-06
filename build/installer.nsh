; Kill any running instance of the app before installing or uninstalling.
; This prevents "Failed to uninstall old application files" (error code 2)
; when NSIS tries to overwrite files that are still locked by the process.

!macro customInstall
  nsExec::Exec 'taskkill /F /IM "Ergoflow Craftsmen.exe" /T'
  Sleep 2000
!macroend

!macro customUnInstall
  nsExec::Exec 'taskkill /F /IM "Ergoflow Craftsmen.exe" /T'
  Sleep 2000
!macroend
