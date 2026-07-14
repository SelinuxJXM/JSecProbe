!macro customUnInstall
  IfFileExists "$INSTDIR\JSecProbeData\*.*" 0 atEnd
    IfFileExists "$LOCALAPPDATA\JSecProbeData_Backup\*.*" 0 noBackupExists
      RMDir /r "$LOCALAPPDATA\JSecProbeData_Backup"
    noBackupExists:
    ClearErrors
    Rename "$INSTDIR\JSecProbeData" "$LOCALAPPDATA\JSecProbeData_Backup"
    IfErrors 0 moveOK
      nsExec::ExecToLog 'cmd /c move /Y "$INSTDIR\JSecProbeData" "$LOCALAPPDATA\JSecProbeData_Backup"'
    moveOK:
  atEnd:
!macroend

!macro customInstall
  IfFileExists "$LOCALAPPDATA\JSecProbeData_Backup\*.*" 0 atEnd
    IfFileExists "$INSTDIR\JSecProbeData\*.*" 0 noTargetDirExists
      RMDir /r "$INSTDIR\JSecProbeData"
    noTargetDirExists:
    ClearErrors
    Rename "$LOCALAPPDATA\JSecProbeData_Backup" "$INSTDIR\JSecProbeData"
    IfErrors 0 moveOK
      nsExec::ExecToLog 'cmd /c move /Y "$LOCALAPPDATA\JSecProbeData_Backup" "$INSTDIR\JSecProbeData"'
    moveOK:
  atEnd:
!macroend
