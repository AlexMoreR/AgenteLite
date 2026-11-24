#!/bin/sh
# Vigilante del túnel de aizen1 (NETMAGI, parte 2). Ver README.md de esta carpeta.
#
# Corre en 13.140.235.16 cada 5 minutos (vigilante-tunel-netmagi.timer) y le avisa al CRM:
#   POST <CRM_URL>/api/cron/proxy-netmagi
#   {"fuente":"tunel","puertoAbierto":bool,"ipSalida":"...","ipEsperada":"..."}
#
# SOLO LEE: prueba el puerto con nc, pregunta la IP de salida con curl y manda un curl POST al CRM.
# Nunca cambia la IP, el proxy, las rutas ni la red.
#
# Variables (del archivo /etc/vigilante-tunel-netmagi.env, que lee systemd):
#   CRM_URL       p. ej. https://crm.magilus.com
#   CRON_SECRET   uno de los secretos del reloj del CRM (DAILY_REPORT_CRON_SECRET, FOLLOW_CRON_SECRET...)
#   IP_ESPERADA   la IP de EMCALI que sale por el túnel cuando todo está bien (se pone a mano)
#   PROXY_HOST    por defecto 172.19.0.1
#   PROXY_PORT    por defecto 1080
#   ESTADO_DIR    por defecto /var/lib/vigilante-tunel-netmagi (ahí queda el contador de fallos)
#
# Uso: vigilante.sh [--simular]
#   --simular  imprime el JSON que mandaría y no lo envía (tampoco pide CRM_URL ni CRON_SECRET).

set -eu

SIMULAR=0
for arg in "$@"; do
  case "$arg" in
    --simular) SIMULAR=1 ;;
    *) echo "[vigilante-tunel] opción desconocida: $arg (solo existe --simular)" >&2; exit 2 ;;
  esac
done

PROXY_HOST="${PROXY_HOST:-172.19.0.1}"
PROXY_PORT="${PROXY_PORT:-1080}"
IP_ESPERADA="${IP_ESPERADA:-}"
CRM_URL="${CRM_URL:-}"
CRON_SECRET="${CRON_SECRET:-}"
ESTADO_DIR="${ESTADO_DIR:-/var/lib/vigilante-tunel-netmagi}"
ARCHIVO_FALLOS="$ESTADO_DIR/fallos"

if [ "$SIMULAR" -eq 0 ]; then
  if [ -z "$CRM_URL" ] || [ -z "$CRON_SECRET" ]; then
    echo "[vigilante-tunel] faltan CRM_URL o CRON_SECRET en el archivo de entorno (o usar --simular)" >&2
    exit 1
  fi
fi

# Solo IPs (números, letras hex, puntos y dos puntos), igual que valida el CRM. Lo demás cuenta como vacío.
solo_ip() {
  case "$1" in
    '' | *[!0-9a-fA-F.:]*) echo "" ;;
    *) echo "$1" ;;
  esac
}

# Una IP en JSON: "1.2.3.4" o null.
json_ip() {
  if [ -n "$1" ]; then printf '"%s"' "$1"; else printf 'null'; fi
}

leer_fallos() {
  n=""
  if [ -f "$ARCHIVO_FALLOS" ]; then n="$(cat "$ARCHIVO_FALLOS" 2>/dev/null || true)"; fi
  case "$n" in
    '' | *[!0-9]*) echo 0 ;;
    *) echo "$n" ;;
  esac
}

# Al simular no se toca el contador: así una prueba no cambia lo que hará el próximo chequeo de verdad.
guardar_fallos() {
  if [ "$SIMULAR" -eq 1 ]; then return 0; fi
  mkdir -p "$ESTADO_DIR"
  printf '%s\n' "$1" >"$ARCHIVO_FALLOS"
}

IP_ESPERADA="$(solo_ip "$IP_ESPERADA")"
IP_SALIDA=""

# (a) ¿Abre el puerto del túnel?
if nc -z -w 5 "$PROXY_HOST" "$PROXY_PORT" >/dev/null 2>&1; then
  PUERTO_ABIERTO=true
  # (b) La IP de salida por el túnel (solo lectura). Si no contesta, va null y el CRM no compara la IP.
  IP_SALIDA="$(curl -s --max-time 15 --socks5-hostname "$PROXY_HOST:$PROXY_PORT" https://api.ipify.org 2>/dev/null || true)"
  IP_SALIDA="$(solo_ip "$IP_SALIDA")"
else
  PUERTO_ABIERTO=false
fi

# (c) Una reconexión corta no avisa: el puerto cerrado solo se manda desde el 2.º fallo seguido.
if [ "$PUERTO_ABIERTO" = true ]; then
  guardar_fallos 0
else
  FALLOS=$(( $(leer_fallos) + 1 ))
  guardar_fallos "$FALLOS"
  if [ "$FALLOS" -lt 2 ]; then
    echo "[vigilante-tunel] puerto $PROXY_HOST:$PROXY_PORT cerrado (fallo 1 seguido): se espera al próximo chequeo antes de avisar"
    exit 0
  fi
fi

JSON="{\"fuente\":\"tunel\",\"puertoAbierto\":$PUERTO_ABIERTO,\"ipSalida\":$(json_ip "$IP_SALIDA"),\"ipEsperada\":$(json_ip "$IP_ESPERADA")}"

if [ "$SIMULAR" -eq 1 ]; then
  printf '%s\n' "$JSON"
  exit 0
fi

# (d) El aviso al CRM. El secreto entra por la entrada estándar (-H @-) para que no salga en la lista de procesos.
CODIGO="$(printf 'x-daily-report-secret: %s\n' "$CRON_SECRET" | curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
  -X POST -H @- -H 'content-type: application/json' --data-binary "$JSON" \
  "${CRM_URL%/}/api/cron/proxy-netmagi" || true)"

case "$CODIGO" in
  2??) echo "[vigilante-tunel] enviado ($CODIGO): $JSON" ;;
  401) echo "[vigilante-tunel] el CRM respondió 401: revisar CRON_SECRET en los dos lados" >&2; exit 1 ;;
  *) echo "[vigilante-tunel] no se pudo avisar al CRM (código ${CODIGO:-ninguno}): $JSON" >&2; exit 1 ;;
esac
