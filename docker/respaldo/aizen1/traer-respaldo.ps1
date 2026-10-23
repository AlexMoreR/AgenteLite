# Copia en aizen1 del respaldo nocturno de AizenCRM.
#
# La corre la tarea programada de las 4:00 a. m. (ver instalar-tarea-respaldo.ps1). Baja de Google
# Drive la copia de esa noche (Respaldos/AizenCRM/aizencrm-AAAA-MM-DD.dump), la guarda en la carpeta
# local y deja ahi solo las ultimas 30. Si la copia del dia no esta en Drive (el servicio del servidor
# se cayo sin poder avisar) o no se puede bajar, manda el correo de aviso.
#
# Uso a mano: powershell -ExecutionPolicy Bypass -File docker\respaldo\aizen1\traer-respaldo.ps1
# Configuracion: config.local.json en esta misma carpeta (copiar config.example.json). No se sube al
# repositorio: tiene la contrasena del correo.

$ErrorActionPreference = "Stop"

$carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$rutaConfig = Join-Path $carpeta "config.local.json"
if (-not (Test-Path $rutaConfig)) {
  Write-Error "Falta $rutaConfig. Copia config.example.json a config.local.json y completalo."
}
$config = Get-Content $rutaConfig -Raw -Encoding UTF8 | ConvertFrom-Json

$rclone = if ($config.rclone) { $config.rclone } else { "rclone" }
$remoto = if ($config.remoto) { $config.remoto } else { "drive" }
$carpetaDrive = if ($config.carpetaDrive) { $config.carpetaDrive } else { "Respaldos/AizenCRM" }
$guardar = if ($config.guardar) { [int]$config.guardar } else { 30 }
$carpetaLocal = $config.carpetaLocal
if (-not $carpetaLocal) { Write-Error "Falta carpetaLocal en $rutaConfig." }

New-Item -ItemType Directory -Force -Path $carpetaLocal | Out-Null
$logs = Join-Path $carpetaLocal "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$registro = Join-Path $logs ("traer-respaldo-{0}.log" -f (Get-Date -Format "yyyy-MM"))

function Anotar([string]$texto) {
  $linea = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $texto
  Write-Host $linea
  Add-Content -Path $registro -Value $linea -Encoding UTF8
}

function Avisar([string]$paso, [string]$detalle) {
  Anotar "FALLO: $paso. $detalle"
  $smtp = $config.smtp
  if (-not $smtp -or -not $smtp.host -or -not $config.avisoA) {
    Anotar "No se pudo mandar el correo: falta smtp o avisoA en config.local.json."
    return
  }
  try {
    $clave = ConvertTo-SecureString $smtp.pass -AsPlainText -Force
    $credencial = New-Object System.Management.Automation.PSCredential ($smtp.user, $clave)
    $puerto = if ($smtp.port) { [int]$smtp.port } else { 587 }
    $cuerpo = "La copia del respaldo de AizenCRM en aizen1 fallo.`r`n`r`nPaso: $paso`r`nFecha: $hoy`r`n`r`n$detalle`r`n`r`nRevisar en Drive la carpeta $carpetaDrive y los registros del servicio aizenbot_respaldo en Portainer."
    Send-MailMessage -SmtpServer $smtp.host -Port $puerto -UseSsl -Credential $credencial `
      -From $smtp.from -To $config.avisoA -Subject "AizenCRM: fallo la copia del respaldo en aizen1 ($paso)" `
      -Body $cuerpo -Encoding UTF8 -WarningAction SilentlyContinue
    Anotar "Correo de aviso enviado a $($config.avisoA)."
  } catch {
    Anotar "No se pudo mandar el correo de aviso: $($_.Exception.Message)"
  }
}

# Fecha de Colombia (UTC-5 todo el ano), la misma con que el servidor nombra la copia. Si corre antes
# de las 3:00 (aizen1 se prendio tarde y la tarea corrio despues de medianoche), la copia de esta noche
# todavia no existe: se busca la de la noche anterior.
$colombia = [DateTime]::UtcNow.AddHours(-5)
if ($colombia.Hour -lt 3) { $colombia = $colombia.AddDays(-1) }
$hoy = $colombia.ToString("yyyy-MM-dd")
$nombre = "aizencrm-$hoy.dump"
$destino = Join-Path $carpetaLocal $nombre
$origen = "${remoto}:$carpetaDrive/$nombre"

Anotar "Bajando $origen"
# En Windows PowerShell, con "Stop", lo que rclone escribe en stderr cortaria el script sin avisar.
$ErrorActionPreference = "Continue"
$salida = & $rclone copyto $origen $destino 2>&1 | Out-String
$codigo = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($codigo -ne 0 -or -not (Test-Path $destino) -or (Get-Item $destino).Length -eq 0) {
  if ($salida -match "not found|doesn't exist|object not found|directory not found") {
    Avisar "no esta la copia del dia en Drive" "No se encontro $origen. El servicio aizenbot_respaldo puede estar caido o no haber podido subir. $salida"
  } else {
    Avisar "bajar de Drive" "rclone termino con codigo $codigo. $salida"
  }
  exit 1
}
Anotar ("Copia guardada: {0} ({1:N0} bytes)" -f $destino, (Get-Item $destino).Length)

# Quedan solo las ultimas $guardar copias locales (solo archivos aizencrm-AAAA-MM-DD.dump).
Get-ChildItem -Path $carpetaLocal -File -Filter "aizencrm-*.dump" |
  Where-Object { $_.Name -match '^aizencrm-\d{4}-\d{2}-\d{2}\.dump$' } |
  Sort-Object Name -Descending |
  Select-Object -Skip $guardar |
  ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Force
    Anotar "Borrada copia vieja: $($_.Name)"
  }

Anotar "Listo."
