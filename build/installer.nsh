!macro customUnInstall
  ; 保护 JSecProbeData 目录，卸载时将其移到安全备份位置
  IfFileExists "$INSTDIR\JSecProbeData\*.*" 0 done
    CreateDirectory "$LOCALAPPDATA"
    Rename "$INSTDIR\JSecProbeData" "$LOCALAPPDATA\JSecProbeData_Backup"
  done:
!macroend

!macro customInstall
  ; 恢复 JSecProbeData 备份（从备份位置移回安装目录）
  IfFileExists "$LOCALAPPDATA\JSecProbeData_Backup\*.*" 0 done
    Rename "$LOCALAPPDATA\JSecProbeData_Backup" "$INSTDIR\JSecProbeData"
  done:
!macroend