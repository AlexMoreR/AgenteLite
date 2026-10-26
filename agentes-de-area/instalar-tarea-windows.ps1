# Registra los AGENTES DE ÁREA como tareas programadas de Windows, de lunes a sábado:
#   - "Agente de Marketing" a las 6:45 a. m. (antes de Ventas, para que Ventas pueda usar su dato)
#   - "Agente de Ventas"    a las 7:00 a. m.
# Si aizen1 estaba apagado a esa hora, corren apenas prenda ("ejecutar en cuanto se pueda si se pasó la hora"): Ventas
# avisa en el mensaje a Alexander que salió tarde y el resumen de Marketing queda marcado "salió tarde". Lo corre el
# dueño, una vez, en el PC "aizen1", cuando ya probó los agentes a mano (ver README.md). Se copia del instalador del
# trabajador del tablero.
#
#   powershell -ExecutionPolicy Bypass -File agentes-de-area\instalar-tarea-windows.ps1
#   (para quitarlas:  Unregister-ScheduledTask -TaskName "Agente de Ventas" -Confirm:$false
#                     Unregister-ScheduledTask -TaskName "Agente de Marketing" -Confirm:$false)
#
# Corren con el usuario que inicia sesión (el que tiene `claude` con el plan de Alexander), sin permisos de
# administrador: el `claude` logueado vive en la sesión del usuario.

$ErrorActionPreference = "Stop"

$carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $carpeta "correr-agente.mjs"
$config = Join-Path $carpeta "config.local.json"
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $config)) {
  Write-Error "Falta $config. Copia config.example.json a config.local.json y complétalo antes de instalar las tareas."
}
foreach ($area in @("ventas", "marketing")) {
  if (-not (Test-Path (Join-Path $carpeta "$area\.mcp.json"))) {
    Write-Error "Falta $area\.mcp.json. Copia $area\.mcp.json.example a $area\.mcp.json y pon las claves (CRM, Gestión y, en marketing, el conector de Meta Ads)."
  }
}

# StartWhenAvailable = si se pasó la hora porque el PC estaba apagado, corre apenas se pueda.
# Hasta 8 h por si hay que esperar que se reinicie el límite del plan de Claude; una sola copia a la vez.
$ajustes = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 8) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$quien = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$dias = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")

$tareas = @(
  @{ Nombre = "Agente de Marketing"; Area = "marketing"; Hora = "6:45AM"; Descripcion = "Agente de Marketing: revisión diaria de la pauta (solo lee Meta Ads) y resumen para el Agente de Ventas (agentes-de-area/correr-agente.mjs)." },
  @{ Nombre = "Agente de Ventas"; Area = "ventas"; Hora = "7:00AM"; Descripcion = "Agente de Ventas: números de ayer, subagentes y WhatsApp internos a las 7:30 (agentes-de-area/correr-agente.mjs)." }
)
foreach ($tarea in $tareas) {
  $accion = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" --area $($tarea.Area)" -WorkingDirectory $carpeta
  $disparador = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dias -At $tarea.Hora
  Register-ScheduledTask -TaskName $tarea.Nombre -Action $accion -Trigger $disparador -Settings $ajustes -Principal $quien `
    -Description $tarea.Descripcion -Force | Out-Null
  Write-Host "Listo: la tarea '$($tarea.Nombre)' corre de lunes a sábado a las $($tarea.Hora). Para probarla ya: Start-ScheduledTask -TaskName '$($tarea.Nombre)'"
}
Write-Host "El registro de cada día queda en agentes-de-area\logs."
