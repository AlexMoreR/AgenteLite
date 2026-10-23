#!/bin/sh
# Respaldo nocturno de la base de AizenCRM a Google Drive.
#
# Corre como el servicio `aizenbot_respaldo` del stack (misma imagen que la app). Cada minuto mira la
# hora y, a las 2:00 a. m. de Colombia, una sola vez por noche:
#   1. saca una copia completa y comprimida de la base (pg_dump, SOLO LEE): aizencrm-AAAA-MM-DD.dump;
#   2. revisa que la copia este sana (que tenga tamano y que pg_restore la pueda abrir);
#   3. la sube a Google Drive, a la carpeta Respaldos/AizenCRM (rclone);
#   4. en esa carpeta borra solo las copias `aizencrm-AAAA-MM-DD.dump` de mas de 30 dias;
#   5. en el disco del servidor deja solo las 3 ultimas copias (aca son de paso).
# Si falla un paso manda un correo a RESPALDO_AVISO_A con el paso y el error.
#
# Uso:
#   sh respaldo.sh reloj   el servicio: mira la hora cada minuto (no termina nunca)
#   sh respaldo.sh tick    mira la hora una vez y respalda si toca (lo usa el reloj y la prueba)
#   sh respaldo.sh ahora   respalda ya, sin mirar la hora (para probar a mano)
#
# Configuracion (variables de entorno; las claves NUNCA van en este archivo):
#   RESPALDO_DATABASE_URL   conexion a la base (ideal: el usuario de solo lectura del README)
#   RESPALDO_AVISO_A        a quien le llega el correo si falla (gestionmagilus@gmail.com)
#   RCLONE_CONFIG_DRIVE_TYPE=drive, RCLONE_CONFIG_DRIVE_SCOPE=drive.file, RCLONE_CONFIG_DRIVE_TOKEN
#                           el remoto `drive:` de rclone (el token lo autoriza Alexander una vez)
#   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM   el mismo correo de la app
#   Opcionales: RESPALDO_DIR (/respaldos), RESPALDO_HORA (2), RESPALDO_REMOTO (drive),
#   RESPALDO_CARPETA_DRIVE (Respaldos/AizenCRM), RESPALDO_DIAS_DRIVE (30), RESPALDO_COPIAS_LOCALES (3).

set -u
# Las copias tienen datos de clientes: todo lo que se cree aca queda solo para el dueno del archivo.
umask 077

RESPALDO_DIR="${RESPALDO_DIR:-/respaldos}"
RESPALDO_HORA="${RESPALDO_HORA:-2}"
RESPALDO_REMOTO="${RESPALDO_REMOTO:-drive}"
RESPALDO_CARPETA_DRIVE="${RESPALDO_CARPETA_DRIVE:-Respaldos/AizenCRM}"
RESPALDO_DIAS_DRIVE="${RESPALDO_DIAS_DRIVE:-30}"
RESPALDO_COPIAS_LOCALES="${RESPALDO_COPIAS_LOCALES:-3}"
RESPALDO_AVISO_A="${RESPALDO_AVISO_A:-}"

# Colombia es UTC-5 todo el ano (no tiene horario de verano). Se resta a mano para no depender de
# tzdata, que la imagen no trae. RESPALDO_AHORA (segundos desde 1970) solo lo usa la prueba.
COLOMBIA=18000
# Tiempo maximo de la copia y de la subida (3 horas cada una).
LIMITE_SEGUNDOS=10800

log() {
  echo "[respaldo] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
}

ahora() {
  echo "${RESPALDO_AHORA:-$(date +%s)}"
}

# Fecha de Colombia (AAAA-MM-DD) de un instante en segundos.
fecha_colombia() {
  date -u -d "@$(($1 - COLOMBIA))" '+%Y-%m-%d'
}

hora_colombia() {
  date -u -d "@$(($1 - COLOMBIA))" '+%H'
}

# Correo de aviso por SMTP con curl (el mismo servidor de correo que usa la app).
avisar() {
  paso="$1"
  detalle="$2"
  log "FALLO en el paso '$paso'"
  if [ -z "$RESPALDO_AVISO_A" ] || [ -z "${SMTP_HOST:-}" ] || [ -z "${SMTP_USER:-}" ] \
    || [ -z "${SMTP_PASS:-}" ] || [ -z "${SMTP_FROM:-}" ]; then
    log "no se pudo mandar el correo de aviso: falta RESPALDO_AVISO_A o la configuracion SMTP_*"
    return 0
  fi

  # SMTP_FROM puede venir como "Nombre <correo>": para el sobre se usa solo el correo.
  remitente=$(printf '%s' "$SMTP_FROM" | sed -n 's/.*<\([^>]*\)>.*/\1/p')
  [ -n "$remitente" ] || remitente="$SMTP_FROM"

  if [ "${SMTP_SECURE:-}" = "true" ]; then
    url="smtps://$SMTP_HOST:${SMTP_PORT:-465}"
    tls=""
  else
    url="smtp://$SMTP_HOST:${SMTP_PORT:-587}"
    tls="--ssl-reqd"
  fi

  mensaje="$RESPALDO_DIR/.aviso.txt"
  credenciales="$RESPALDO_DIR/.aviso.netrc"
  {
    printf 'From: %s\r\n' "$SMTP_FROM"
    printf 'To: %s\r\n' "$RESPALDO_AVISO_A"
    printf 'Subject: AizenCRM: fallo el respaldo nocturno (%s)\r\n' "$paso"
    printf 'Date: %s\r\n' "$(date -u '+%a, %d %b %Y %H:%M:%S +0000')"
    printf 'MIME-Version: 1.0\r\n'
    printf 'Content-Type: text/plain; charset=UTF-8\r\n'
    printf '\r\n'
    printf 'El respaldo nocturno de la base de AizenCRM fallo.\r\n\r\n'
    printf 'Paso que fallo: %s\r\n' "$paso"
    printf 'Fecha del respaldo: %s\r\n\r\n' "${FECHA:-?}"
    printf 'Error:\r\n'
    # El texto de pg_dump o rclone trae saltos LF sueltos: en un correo van CRLF.
    printf '%s\n' "$detalle" | awk '{ printf "%s\r\n", $0 }'
    printf '\r\nRevisar los registros del servicio aizenbot_respaldo en Portainer.\r\n'
  } >"$mensaje"
  # La contrasena va en un archivo temporal y no en la linea de comandos (no sale en `ps`). Entre
  # comillas, porque las contrasenas de aplicacion de Gmail suelen tener espacios.
  clave=$(printf '%s' "$SMTP_PASS" | sed 's/[\\"]/\\&/g')
  printf 'machine %s login %s password "%s"\n' "$SMTP_HOST" "$SMTP_USER" "$clave" >"$credenciales"

  # shellcheck disable=SC2086
  if curl --silent --show-error --max-time 60 $tls --url "$url" --netrc-file "$credenciales" \
    --mail-from "$remitente" --mail-rcpt "$RESPALDO_AVISO_A" --upload-file "$mensaje"; then
    log "correo de aviso enviado a $RESPALDO_AVISO_A"
  else
    log "no se pudo mandar el correo de aviso"
  fi
  rm -f "$credenciales" "$mensaje"
}

# Las ultimas lineas de un archivo de errores, para el correo.
errores_de() {
  if [ -s "$1" ]; then tail -n 20 "$1"; else echo "(sin mensaje de error)"; fi
}

respaldar() {
  t=$(ahora)
  FECHA=$(fecha_colombia "$t")
  nombre="aizencrm-$FECHA.dump"
  archivo="$RESPALDO_DIR/$nombre"
  parcial="$archivo.parcial"
  errores="$RESPALDO_DIR/.errores.txt"
  : >"$errores"

  log "empieza el respaldo $nombre"

  if [ -z "${RESPALDO_DATABASE_URL:-}" ]; then
    avisar "copiar" "Falta la variable RESPALDO_DATABASE_URL en el servicio."
    return 1
  fi

  # 1. Copiar. pg_dump trabaja en una sola transaccion de lectura; ademas se le pide a la base que la
  # sesion sea de solo lectura, asi que no puede escribir ni por error. --lock-timeout: si una
  # migracion tiene una tabla bloqueada, falla y avisa en vez de quedarse esperando. `timeout`: si la
  # red se cuelga a medias, el reloj no queda trabado para las noches siguientes.
  rm -f "$parcial"
  if ! PGOPTIONS="-c default_transaction_read_only=on" timeout "$LIMITE_SEGUNDOS" pg_dump --format=custom --compress=9 \
    --lock-timeout=120000 --dbname="$RESPALDO_DATABASE_URL" --file="$parcial" 2>"$errores"; then
    rm -f "$parcial"
    avisar "copiar" "$(errores_de "$errores")"
    return 1
  fi

  # 2. Revisar: que tenga tamano y que se pueda abrir. Un archivo danado nunca se sube.
  if [ ! -s "$parcial" ]; then
    rm -f "$parcial"
    avisar "revisar" "La copia quedo vacia."
    return 1
  fi
  if ! pg_restore --list "$parcial" >/dev/null 2>"$errores"; then
    rm -f "$parcial"
    avisar "revisar" "La copia no se puede abrir con pg_restore: $(errores_de "$errores")"
    return 1
  fi
  mv -f "$parcial" "$archivo"
  log "copia lista: $archivo ($(wc -c <"$archivo" | tr -d ' ') bytes)"

  # 3. Subir a Drive. copyto compara el md5 al terminar.
  destino="$RESPALDO_REMOTO:$RESPALDO_CARPETA_DRIVE"
  if ! timeout "$LIMITE_SEGUNDOS" rclone copyto "$archivo" "$destino/$nombre" 2>"$errores"; then
    avisar "subir" "$(errores_de "$errores")"
    return 1
  fi
  log "subida a $destino/$nombre"

  # 4. Borrar en Drive las copias de mas de RESPALDO_DIAS_DRIVE dias: solo en esta carpeta (sin
  # entrar a subcarpetas) y solo las que se llaman exactamente aizencrm-AAAA-MM-DD.dump.
  limite=$(fecha_colombia $((t - RESPALDO_DIAS_DRIVE * 86400)))
  if ! lista=$(rclone lsf --files-only --max-depth 1 --include "aizencrm-*.dump" "$destino" 2>"$errores"); then
    avisar "borrar viejos en Drive" "La copia de hoy SI se subio. $(errores_de "$errores")"
    return 1
  fi
  printf '%s\n' "$lista" | while read -r viejo; do
    case "$viejo" in
      aizencrm-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].dump) ;;
      *) continue ;;
    esac
    fecha_vieja=${viejo#aizencrm-}
    fecha_vieja=${fecha_vieja%.dump}
    # Las fechas AAAA-MM-DD se comparan bien como texto.
    if [ "$(printf '%s\n%s\n' "$fecha_vieja" "$limite" | sort | head -n 1)" = "$fecha_vieja" ]; then
      if rclone deletefile "$destino/$viejo" 2>"$errores"; then
        log "borrada en Drive: $viejo"
      else
        avisar "borrar viejos en Drive" "La copia de hoy SI se subio. No se pudo borrar $viejo: $(errores_de "$errores")"
      fi
    fi
  done

  # 5. En el servidor quedan solo las ultimas RESPALDO_COPIAS_LOCALES copias.
  # shellcheck disable=SC2012
  ls -1 "$RESPALDO_DIR" | grep -E '^aizencrm-[0-9]{4}-[0-9]{2}-[0-9]{2}\.dump$' | sort -r \
    | tail -n +$((RESPALDO_COPIAS_LOCALES + 1)) | while read -r sobra; do
      rm -f "$RESPALDO_DIR/$sobra"
      log "borrada en el servidor: $sobra"
    done

  rm -f "$errores"
  log "respaldo $nombre terminado"
  return 0
}

# Respalda si son las RESPALDO_HORA de Colombia y esta noche todavia no se intento. Se anota el
# intento antes de empezar: si falla, avisa una vez y no reintenta cada minuto. Se anota en el disco
# (por si el servicio se reinicia) y en memoria (por si el disco esta lleno y no se puede escribir).
ULTIMO_INTENTO=""
tick() {
  t=$(ahora)
  hoy=$(fecha_colombia "$t")
  hora=$(hora_colombia "$t")
  [ "${hora#0}" = "${RESPALDO_HORA#0}" ] || return 0
  [ "$ULTIMO_INTENTO" != "$hoy" ] || return 0
  marca="$RESPALDO_DIR/.ultimo-intento"
  if [ -f "$marca" ] && [ "$(cat "$marca")" = "$hoy" ]; then
    return 0
  fi
  ULTIMO_INTENTO="$hoy"
  echo "$hoy" >"$marca" || log "no se pudo anotar el intento en $marca (disco lleno?)"
  respaldar
}

mkdir -p "$RESPALDO_DIR"

case "${1:-reloj}" in
  reloj)
    log "reloj prendido: respalda a las $RESPALDO_HORA:00 de Colombia en $RESPALDO_REMOTO:$RESPALDO_CARPETA_DRIVE"
    while true; do
      tick || true
      sleep 60
    done
    ;;
  tick) tick ;;
  ahora) respaldar ;;
  *)
    echo "uso: sh respaldo.sh [reloj|tick|ahora]" >&2
    exit 2
    ;;
esac
