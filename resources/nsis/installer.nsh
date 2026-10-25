!macro customHeader
  ManifestDPIAware true
!macroend

; Older builds shipped a sherpa-onnx server (local transcription) and added a
; firewall rule for it. The app no longer ships it, so the rule is only
; deleted. netsh needs elevation — per-user installs skip this silently.
!define SHERPA_FIREWALL_RULE "only-whispers Local Transcription Server (sherpa-onnx)"

; Electron writes the launch-at-login entry itself, so nothing in the generated
; uninstaller knows to remove it, and Windows keeps listing a startup item that
; points at a deleted executable. The Run value is named after the
; AppUserModelId main.js sets, which appends the release channel for non-
; production builds (keep in sync with BASE_WINDOWS_APP_ID and VALID_CHANNELS
; there). Disabling an item leaves a second value behind under StartupApproved,
; so both have to go.
!define APP_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define APP_STARTUP_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

!macro DeleteAutoStartEntry NAME
  DeleteRegValue HKCU "${APP_RUN_KEY}" "${NAME}"
  DeleteRegValue HKCU "${APP_STARTUP_APPROVED_KEY}" "${NAME}"
!macroend

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${SHERPA_FIREWALL_RULE}"'
!macroend

!macro customUnInstall
  ; Guarded by isUpdated so an in-place update does not silently turn launch at
  ; login off for a user who had enabled it.
  ${ifNot} ${isUpdated}
    !insertmacro DeleteAutoStartEntry "com.raythurnvoid.only-whispers"
    !insertmacro DeleteAutoStartEntry "com.raythurnvoid.only-whispers.staging"
    !insertmacro DeleteAutoStartEntry "com.raythurnvoid.only-whispers.development"
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${SHERPA_FIREWALL_RULE}"'
    ; Downloaded models stay: they are user data, and a reinstall or the dev
    ; app reuses them.
  ${endIf}
!macroend
