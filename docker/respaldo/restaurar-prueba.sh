#!/bin/sh
# Prueba de restauracion de un respaldo de AizenCRM en una base DESECHABLE.
#
# Se corre en el servidor (necesita docker). Arma un Postgres aparte, sin red (--network none: no
# puede llegar a la base real aunque quisiera), le carga el respaldo y cuenta los registros de las
# tablas principales. Si el servicio aizenbot_respaldo esta corriendo, cuenta lo mismo en produccion
# desde ese contenedor (con su RESPALDO_DATABASE_URL), en una sesion de SOLO LECTURA: solo hace
# SELECT count(*). Al terminar borra la base de prueba.
#
# Uso:
#   sh restaurar-prueba.sh /ruta/aizencrm-AAAA-MM-DD.dump
# Opcionales: PG_IMAGEN (postgres:18-alpine; de la misma version que el pg_dump o mas nueva),
#   SERVICIO_RESPALDO (aizenbot_respaldo: el contenedor desde donde se cuenta en produccion).

set -eu

dump="${1:-}"
PG_IMAGEN="${PG_IMAGEN:-postgres:18-alpine}"
SERVICIO_RESPALDO="${SERVICIO_RESPALDO:-aizenbot_respaldo}"

if [ -z "$dump" ] || [ ! -s "$dump" ]; then
  echo "uso: sh restaurar-prueba.sh /ruta/aizencrm-AAAA-MM-DD.dump (el archivo no existe o esta vacio)" >&2
  exit 2
fi

# Tablas que se comparan: clientes, conversaciones, mensajes, agentes, flujos, embudos, seguimientos,
# tableros (y AppSetting, donde vive el libro del Agente V3).
TABLAS="User Workspace Contact Conversation Message OfficialApiConversation OfficialApiMessage Agent
Product Diagram SalesFunnelStep ProductFunnelStage Follow AppSetting TableroInteligente TarjetaTablero"

consulta=""
for tabla in $TABLAS; do
  [ -z "$consulta" ] || consulta="$consulta UNION ALL "
  consulta="${consulta}SELECT '$tabla', count(*) FROM \"$tabla\""
done

contenedor="aizencrm-restaurar-prueba-$$"
conteo_copia="/tmp/conteo-copia.$$"
conteo_prod="/tmp/conteo-prod.$$"
limpiar() {
  docker rm -f "$contenedor" >/dev/null 2>&1 || true
  rm -f "$conteo_copia" "$conteo_prod"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

echo "== Base desechable ($PG_IMAGEN, sin red): $contenedor"
docker run -d --rm --name "$contenedor" --network none \
  -e POSTGRES_PASSWORD=prueba -e POSTGRES_DB=restaurada "$PG_IMAGEN" >/dev/null

listo=0
for _ in $(seq 1 60); do
  if docker exec "$contenedor" pg_isready -U postgres -d restaurada >/dev/null 2>&1; then
    listo=1
    break
  fi
  sleep 1
done
[ "$listo" = 1 ] || { echo "La base desechable no arranco" >&2; exit 1; }
# pg_isready responde antes de que termine el arranque inicial; se espera un poco mas.
sleep 3

echo "== Cargando $dump"
docker cp "$dump" "$contenedor:/tmp/respaldo.dump"
if docker exec "$contenedor" pg_restore -U postgres -d restaurada --no-owner --no-privileges \
  /tmp/respaldo.dump; then
  echo "== Carga sin errores"
  restauro=0
else
  echo "== La carga tuvo errores (ver arriba)" >&2
  restauro=1
fi

echo "== Conteos en la copia restaurada"
if ! docker exec "$contenedor" psql -U postgres -d restaurada -At -F ' ' -c "$consulta" >"$conteo_copia"; then
  echo "== No se pudo contar en la copia: falta alguna tabla principal" >&2
  exit 1
fi

respaldo=$(docker ps -q -f "name=$SERVICIO_RESPALDO" | head -n 1)
if [ -n "$respaldo" ]; then
  echo "== Conteos en produccion (solo lectura, desde $SERVICIO_RESPALDO)"
  # shellcheck disable=SC2016
  docker exec -e PGOPTIONS="-c default_transaction_read_only=on" -e CONSULTA="$consulta" "$respaldo" \
    sh -c 'psql "$RESPALDO_DATABASE_URL" -At -F " " -c "$CONSULTA"' >"$conteo_prod" \
    || echo "(no se pudo contar en produccion; la carga de la copia igual quedo probada)" >&2
  printf '%-26s %12s %12s %10s\n' "tabla" "copia" "produccion" "diferencia"
  while read -r tabla copia; do
    prod=$(awk -v t="$tabla" '$1 == t { print $2 }' "$conteo_prod")
    printf '%-26s %12s %12s %10s\n' "$tabla" "$copia" "${prod:-?}" "$(( ${prod:-0} - copia ))"
  done <"$conteo_copia"
  echo "(La diferencia es lo que entro a produccion despues de la copia; deberia ser pequena y >= 0.)"
else
  echo "(no esta corriendo $SERVICIO_RESPALDO: no se compara con produccion)"
  printf '%-26s %12s\n' "tabla" "copia"
  while read -r tabla copia; do
    printf '%-26s %12s\n' "$tabla" "$copia"
  done <"$conteo_copia"
fi

echo "== Borrando la base desechable"
exit "$restauro"
