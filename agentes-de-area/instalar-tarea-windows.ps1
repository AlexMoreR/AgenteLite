# Registra el AGENTE DE VENTAS como tarea programada de Windows: lunes a sábado a las 7:00 a. m.
# Si aizen1 estaba apagado a esa hora, corre apenas prenda ("ejecutar en cuanto se pueda si se pasó la hora") y
# el mensaje a Alexander dice que salió tarde. Lo corre el dueño, una vez, en el PC "aizen1", cuando ya probó
# el agente a mano (ver README.md). Se copia del instalador del trabajador del tablero.
#
#   powershell -ExecutionPolicy Bypass -File agentes-de-area\instalar-tarea-windows.ps1
#   (para quitarla:  Unregister-ScheduledTask -TaskName "Agente de Ventas" -Confirm:$false)
#
# Corre con el usuario que inicia sesión (el que tiene `claude` con el plan de Alexander), sin permisos de
# administrador: el `claude` logueado vive en la sesión del usuario.

$ErrorActionPreference = "Stop"

$nombre = "Agente de Ventas"
$carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $carpeta "correr-agente.mjs"
$config = Join-Path $carpeta "config.local.json"
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $config)) {
  Write-Error "Falta $config. Copia config.example.json a config.local.json y complétalo antes de instalar la tarea."
}
if (-not (Test-Path (Join-Path $carpeta "ventas\.mcp.json"))) {
  Write-Error "Falta ventas\.mcp.json. Copia ventas\.mcp.json.example a ventas\.mcp.json y pon la clave del MCP del CRM y la de Gestión."
}

$accion = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" --area ventas" -WorkingDirectory $carpeta
$disparador = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday -At 7:00AM
# StartWhenAvailable = si se pasó la hora porque el PC estaba apagado, corre apenas se pueda.
# Hasta 8 h por si hay que esperar que se reinicie el límite del plan de Claude; una sola copia a la vez.
$ajustes = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 8) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$quien = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes -Principal $quien `
  -Description "Agente de Ventas: números de ayer, subagentes y WhatsApp internos a las 7:30 (agentes-de-area/correr-agente.mjs)." -Force | Out-Null

Write-Host "Listo: la tarea '$nombre' corre de lunes a sábado a las 7:00. Para probarla ya: Start-ScheduledTask -TaskName '$nombre'"
Write-Host "El registro de cada día queda en agentes-de-area\logs."
