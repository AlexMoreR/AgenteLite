# Instala los AGENTES DE ÁREA en aizen1: copia esta carpeta a D:\Proyectos\agentes y registra las tareas programadas de
# Windows: Agente de Marketing a las 6:45 a. m. y Agente de Ventas a las 7:00 a. m., de lunes a sábado. NO lo corre nadie automáticamente: lo corre el dueño, una vez,
# en el PC "aizen1", cuando ya probó el lanzador a mano (ver README.md).
#
#   powershell -ExecutionPolicy Bypass -File agentes-de-area\instalar-tarea-windows.ps1
#   (para quitarlas:  Unregister-ScheduledTask -TaskName "Agente de Ventas","Agente de Marketing" -Confirm:$false)
#
# "Ejecutar en cuanto se pueda si se pasó la hora" (-StartWhenAvailable): si aizen1 estaba apagado a las 7:00, la tarea
# corre apenas prenda y el mensaje a Alexander sale con "Salió tarde (aizen1 prendió a las …)".
# Corre con el usuario que inicia sesión (el que tiene `claude` con el plan del dueño), sin permisos de administrador.

$ErrorActionPreference = "Stop"

$nombre = "Agente de Ventas"
$nombreMarketing = "Agente de Marketing"
$origen = Split-Path -Parent $MyInvocation.MyCommand.Path
$destino = "D:\Proyectos\agentes"
$node = (Get-Command node -ErrorAction Stop).Source

# 1. Copiar el código sin pisar lo que es solo de aizen1 (claves, config, salidas del agente).
New-Item -ItemType Directory -Force -Path $destino | Out-Null
if ((Resolve-Path $origen).Path -ne (Resolve-Path $destino).Path) {
  robocopy $origen $destino /E /XF config.local.json .mcp.json /XD salida trabajo node_modules /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { Write-Error "No pude copiar $origen a $destino (robocopy $LASTEXITCODE)." }
}

$config = Join-Path $destino "config.local.json"
$mcp = Join-Path $destino "ventas\.mcp.json"
$mcpMarketing = Join-Path $destino "marketing\.mcp.json"
if (-not (Test-Path $config)) {
  Write-Error "Falta $config. Copia config.example.json a config.local.json y complétalo (clave del MCP, número de Alexander) antes de instalar la tarea."
}
if (-not (Test-Path $mcp)) {
  Write-Error "Falta $mcp. Copia ventas\.mcp.json.example a ventas\.mcp.json y pega las claves del CRM y de Gestión (solo viven en aizen1: no se suben al repo)."
}

if (-not (Test-Path $mcpMarketing)) {
  Write-Error "Falta $mcpMarketing. Copia marketing\.mcp.json.example a marketing\.mcp.json y pega las claves del CRM, de Gestión y el acceso de Meta Ads (solo vive en aizen1: no se sube al repo)."
}

# 2. Las tareas: lunes a sábado. Marketing a las 6:45 (antes de Ventas, que lee su resumen) y Ventas a las 7:00.
$script = Join-Path $destino "correr-agente.mjs"
$accion = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" --area ventas" -WorkingDirectory $destino
$disparador = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday -At 7:00AM
$ajustes = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$quien = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes -Principal $quien `
  -Description "Agente de Ventas: números de ayer, subagentes (cerrador, cobrador, analista de perdidos) y mensajes de las 7:30 (agentes-de-area/correr-agente.mjs)." -Force | Out-Null

$accionMarketing = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" --area marketing" -WorkingDirectory $destino
$disparadorMarketing = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday -At 6:45AM
Register-ScheduledTask -TaskName $nombreMarketing -Action $accionMarketing -Trigger $disparadorMarketing -Settings $ajustes -Principal $quien `
  -Description "Agente de Marketing: revisión diaria de la pauta (solo lee Meta Ads) y su línea para el mensaje de las 7:30 (agentes-de-area/correr-agente.mjs --area marketing)." -Force | Out-Null

Write-Host "Listo: la tarea '$nombreMarketing' corre de lunes a sábado a las 6:45 a. m. (si aizen1 estaba apagado, corre apenas prenda y avisa que salió tarde)."
Write-Host "Prueba a mano con el interruptor APAGADO: node `"$script`" --area marketing --forzar --forzar-lunes"
Write-Host "Listo: la tarea '$nombre' corre de lunes a sábado a las 7:00 a. m. (si aizen1 estaba apagado, corre apenas prenda)."
Write-Host "Prueba a mano con el interruptor APAGADO: node `"$script`" --area ventas --forzar --forzar-sabado"
Write-Host "El registro de cada día queda en $destino\trabajo\logs."
