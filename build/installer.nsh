; Custom NSIS include for Nob's Soundboard
; Adds an optional VoiceMeeter installation prompt

!include "LogicLib.nsh"

!macro customInstall
  ; Only prompt on fresh install, not updates
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "Would you like to install VoiceMeeter?$\r$\n$\r$\nVoiceMeeter is a free virtual audio mixer that lets you route soundboard audio through your microphone in Discord, Zoom, Teams, etc.$\r$\n$\r$\nIt will be downloaded from vb-audio.com." IDYES installVM IDNO skipVM

    installVM:
      DetailPrint "Downloading VoiceMeeter..."
      inetc::get "https://download.vb-audio.com/Download_CABLE/VoicemeeterSetup.exe" "$PLUGINSDIR\VoicemeeterSetup.exe" /END
      Pop $0
      ${If} $0 == "OK"
        DetailPrint "Installing VoiceMeeter..."
        ExecWait '"$PLUGINSDIR\VoicemeeterSetup.exe"'
        ; Write a hint file so the app auto-sets the VM path on first run
        CreateDirectory "$APPDATA\Nob\soundboard"
        IfFileExists "$PROGRAMFILES32\VB\Voicemeeter\voicemeeter.exe" 0 +3
          FileOpen $1 "$APPDATA\Nob\soundboard\vm-install-path.txt" w
          FileWrite $1 "$PROGRAMFILES32\VB\Voicemeeter\voicemeeter.exe"
          FileClose $1
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "VoiceMeeter download failed ($0).$\r$\nYou can install it manually from https://vb-audio.com/Voicemeeter/"
      ${EndIf}

    skipVM:
  ${endIf}
!macroend
