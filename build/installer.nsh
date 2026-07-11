; SECURITY-REVIEW: C-NET-8 / S-NET-3 (SECURITY-CHECKLIST.md, SECURITY-FIXES.md).
; Windows Firewall outbound-block rule for the installed binary — the only
; defense layer that lives outside Chromium itself (every other control in
; SECURITY.md is enforced inside the renderer/main process: webRequest, CSP,
; the WebRTC UDP policy). Belt-and-suspenders: if every in-process control
; were ever defeated at once, the OS firewall still drops the packet.
;
; customInstall / customUnInstall are electron-builder's documented NSIS
; extension points (app-builder-lib/templates/nsis/installSection.nsh and
; uninstaller.nsh insert them via !ifmacrodef ... !insertmacro, so simply
; defining the macro here is enough to wire it in — no other config needed
; beyond nsis.include in electron-builder.yml). ${APP_EXECUTABLE_FILENAME} is
; the same electron-builder-provided constant the stock templates use for the
; installed exe name, so this can't drift from productName.
;
; The install is always perMachine (electron-builder.yml, B3), so $INSTDIR is
; the fixed, non-writable %ProgramFiles%\Lokalny anonimizator, and this section
; already runs elevated (perMachine forces RequestExecutionLevel admin) — no
; separate elevation dance needed for netsh.
;
; Known limits (documented, not hidden — see SECURITY-CHECKLIST.md C-NET-8):
;   - a local administrator can remove or disable the rule at any time;
;   - it does not cover shell.openExternal (SECURITY.md §5) — that hands the
;     URL to the system browser, a different process entirely;
;   - a netsh failure (e.g. Windows Firewall service disabled) is logged as a
;     warning and does NOT abort installation — this is defense-in-depth on
;     top of the in-process network guard (SECURITY.md §3), not the last line
;     of defense, so it must not be able to block installing the app at all.

!macro customInstall
  DetailPrint "Adding Windows Firewall outbound-block rule for ${APP_EXECUTABLE_FILENAME}..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Lokalny anonimizator (block out)" dir=out program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" action=block enable=yes'
  Pop $0
  ${if} $0 != 0
    DetailPrint "WARNING: could not add the firewall rule (netsh exit code $0). Installation continues — this is a defense-in-depth layer, not a blocker."
  ${endIf}
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows Firewall outbound-block rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Lokalny anonimizator (block out)"'
  Pop $0
!macroend
