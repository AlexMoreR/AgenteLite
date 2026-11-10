# Vigilante de mensajes indescifrables

Lee el log del contenedor de WAHA y le avisa al CRM de cada `Undecryptable message` de un cliente
(`<dígitos>@lid`). El CRM espera 2 minutos y, si el mensaje no llegó, deja el chat con la nota
"Mensaje perdido, escríbele" (`src/features/mensajes-indescifrables`). Todo nace **APAGADO** en el CRM:
sin la fila `mensajes-indescifrables:modo:<negocio>` los eventos se reciben y se descartan.

## Antes de instalar: probar el formato del log

El formato exacto de la línea de GOWS no está documentado. Sacar una muestra real y mirar que cada línea
salga con su `sesion`, `idCrudo` y `lid`:

```sh
docker logs --timestamps crm-waha-1 2>&1 | grep -i undecryptable | tail -50 > /tmp/muestra.log
node vigilante.mjs --desde-archivo /tmp/muestra.log --simular
```

Si la sesión sale vacía o mal, poner `SESION_POR_DEFECTO` (cuando hay una sola línea en WAHA) o ajustar
`leerLinea` en `vigilante.mjs` (y su prueba en `scripts/check-mensajes-indescifrables.mjs`).

## Instalar (servidor de WAHA, Node 18 o más)

```sh
sudo mkdir -p /opt/vigilante-indescifrables
sudo cp vigilante.mjs /opt/vigilante-indescifrables/
sudo cp vigilante-indescifrables.service /etc/systemd/system/
sudo tee /etc/vigilante-indescifrables.env >/dev/null <<'EOF'
CRM_URL=https://crm.magilus.com
INDESCIFRABLES_SECRET=<el mismo valor que en Portainer>
CONTENEDOR=crm-waha-1
EOF
sudo chmod 600 /etc/vigilante-indescifrables.env
sudo systemctl daemon-reload
sudo systemctl enable --now vigilante-indescifrables
journalctl -u vigilante-indescifrables -f
```

En el CRM, `INDESCIFRABLES_SECRET` va en las variables de Portainer (`docker-compose.portainer.yml`): sin ella
el endpoint rechaza todo.

## Cómo se comporta

- Cursor en `/var/lib/vigilante-indescifrables/cursor`: al reiniciar sigue desde la última línea enviada
  (sin cursor, los últimos 10 minutos). Repetir eventos no hace nada: el CRM es idempotente por línea e id.
- Reintenta el envío (1 s, 5 s, 15 s, 60 s); si el CRM sigue caído, guarda la cola (hasta 5.000) y no mueve el cursor.
- Latido cada 5 minutos: queda en `mensajes-indescifrables:latido` y se ve en la herramienta
  `que_es_esta_aplicacion` (automatización `mensajes_indescifrables`).

## Encender en el CRM (AppSetting)

1. `mensajes-indescifrables:modo:<negocio>` = `SOMBRA` 48 h y cruzar con `docker logs`.
2. `PRUEBA` con `mensajes-indescifrables:lids-prueba:<negocio>` = LID de un teléfono propio, y un POST manual
   con un id inventado.
3. `ACTIVO`.
