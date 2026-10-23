# Registra en aizen1 la tarea programada que trae cada dia la copia del respaldo de AizenCRM desde
# Google Drive (traer-respaldo.ps1), a las 4:00 a. m. La corre el dueno una vez.
# Uso: powershell -ExecutionPolicy Bypass -File docker\respaldo\aizen1\instalar-tarea-respaldo.ps1
# Para quitarla: Unregister-ScheduledTask -TaskName "Respaldo AizenCRM" -Confirm:$false
# Corre con el usuario de la sesion, sin permisos de administrador. Por eso necesita la sesion abierta:
# si aizen1 se reinicio y nadie entro, corre apenas alguien inicie sesion (StartWhenAvailable).

$ErrorActionPreference = "Stop"

$nombre = "Respaldo AizenCRM"
$carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $carpeta "traer-respaldo.ps1"
$config = Join-Path $carpeta "config.local.json"

if (-not (Test-Path $config)) {
  Write-Error "Falta $config. Copia config.example.json a config.local.json y completalo."
}

$accion = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $carpeta
$disparador = New-ScheduledTaskTrigger -Daily -At "4:00AM"
# StartWhenAvailable: si aizen1 estaba apagado a las 4, corre apenas se prenda.
$ajustes = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable
$quien = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes -Principal $quien `
  -Description "Baja de Google Drive la copia nocturna de la base de AizenCRM y guarda las ultimas 30 (docker/respaldo/aizen1/traer-respaldo.ps1)." -Force | Out-Null

Write-Host "Listo: tarea '$nombre' registrada para las 4:00 a. m. Para probarla ya: Start-ScheduledTask -TaskName '$nombre'"
Write-Host "El registro queda en la carpetaLocal de config.local.json, subcarpeta logs."
