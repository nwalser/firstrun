; The primary half of the join, on the Windows side.
;
; The installer was downloaded under a filename ending in the download token:
;
;   Themia-Setup-1.4.2-9GQ4T7BX.exe
;
; NSIS knows its own path as $EXEPATH, so at install time we can read the token
; straight back out of the name the browser saved it under and leave it where
; the app will look on first run. This is the reliable path. The SDK's scan of
; the Downloads folder is the fallback for when it is not.
;
; This hook only extracts. It does NOT validate the character set -- the SDK
; does that before sending anything, and duplicating a charset across two
; languages is how the two of them end up disagreeing.
;
; Wire it up in tauri.conf.json:
;
;   "bundle": {
;     "windows": {
;       "nsis": {
;         "installerHooks": "../../sdk/tauri/nsis/install-token-hook.nsh"
;       }
;     }
;   }

!include "FileFunc.nsh"

!macro NSIS_HOOK_POSTINSTALL
  ; $R0 = the installer's own filename, e.g. Themia-Setup-1.4.2-9GQ4T7BX.exe
  ${GetFileName} "$EXEPATH" $R0

  ; $R1 = the name without ".exe"
  ${GetBaseName} "$R0" $R1

  ; The token is the last 8 characters, and the character before them is a dash.
  ; Anything else means this installer was renamed or came from somewhere that
  ; never minted a token, and there is simply nothing to claim.
  StrCpy $R2 $R1 8 -8
  StrCpy $R3 $R1 1 -9

  StrCmp $R3 "-" 0 firstrun_no_token
  StrCmp $R2 "" firstrun_no_token 0

  CreateDirectory "$LOCALAPPDATA\${PRODUCTNAME}"
  ClearErrors
  FileOpen $R4 "$LOCALAPPDATA\${PRODUCTNAME}\install_token" w
  IfErrors firstrun_no_token
  FileWrite $R4 "$R2"
  FileClose $R4

  firstrun_no_token:
!macroend
