# Registra el TRABAJADOR del Tablero IA como tarea programada de Windows, para que arranque solo al
# iniciar sesión (y se reinicie si se cae). NO lo corre nadie automáticamente: lo corre el dueño, una
# vez, en el PC "aizen1", cuando ya probó el trabajador a mano (ver README.md).
#
#   powershell -ExecutionPolicy Bypass -File trabajador-tablero\instalar-tarea-windows.ps1
#   (para quitarla:  Unregister-ScheduledTask -TaskName "Trabajador Tablero IA" -Confirm:$false)
#
# Corre con el usuario que inicia sesión (el que tiene `claude`, `git`, `gh` y la llave ssh), sin
# permisos de administrador. "Al iniciar sesión" y no "al arrancar el equipo": el `claude` logueado y
# las credenciales de git viven en la sesión del usuario.

$ErrorActionPreference = "Stop"

$nombre = "Trabajador Tablero IA"
$carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $carpeta "trabajador.mjs"
$config = Join-Path $carpeta "config.local.json"
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $config)) {
  Write-Error "Falta $config. Copia config.example.json a config.local.json y complétalo antes de instalar la tarea."
}

$accion = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $carpeta
$disparador = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Sin límite de tiempo, reinicio cada minuto si se cae (hasta 999 veces) y una sola copia a la vez.
$ajustes = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable
$quien = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes -Principal $quien `
  -Description "Tablero IA: toma las tareas aprobadas del CRM cada minuto (trabajador-tablero/trabajador.mjs)." -Force | Out-Null

Write-Host "Listo: la tarea '$nombre' arranca al iniciar sesión. Para arrancarla ya: Start-ScheduledTask -TaskName '$nombre'"
Write-Host "El registro queda en la carpetaTrabajo de config.local.json, subcarpeta logs."
