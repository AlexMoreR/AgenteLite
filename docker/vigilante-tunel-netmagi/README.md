# Vigilante del túnel de aizen1 (NETMAGI)

Las cuentas de Marketplace (mf1 a mf14) salen a internet por un túnel que llega desde aizen1, en Cali, al
servidor 13.140.235.16. Ese túnel es un proxy en `172.19.0.1:1080`. Si el túnel se cae, las cuentas se quedan sin
internet; si la IP de salida cambia, Facebook ve las cuentas desde otro lugar.

Este vigilante corre en 13.140.235.16 cada 5 minutos y le cuenta al CRM cómo está el túnel. El CRM abre o cierra
dos alertas en **Alertas** (Sistemas), sin mandar nada por WhatsApp:

- **El túnel no responde** (`netmagi:tunel`): el puerto 1080 está cerrado. Para no avisar por una reconexión corta,
  solo avisa cuando falla **2 veces seguidas** (unos 10 minutos). Cuando vuelve, la alerta se cierra sola.
- **La IP de salida cambió** (`netmagi:ip`): el túnel responde, pero sale por una IP distinta a la esperada.

**Solo mira y avisa.** Nunca cambia la IP, el proxy, las rutas ni la red. Lo único que hace es probar el puerto
(`nc`), preguntar la IP de salida (`curl` a api.ipify.org por el túnel) y mandar el aviso al CRM (`curl`).

## La IP esperada

Con el túnel funcionando bien, en 13.140.235.16 correr:

```sh
curl --socks5-hostname 172.19.0.1:1080 https://api.ipify.org
```

La IP que muestre (la de EMCALI, en Cali) es la que va en `IP_ESPERADA`.

- **Nunca se aprende sola.** Se pone a mano.
- Si EMCALI la cambia de verdad, la alerta de IP queda abierta hasta que se actualice `IP_ESPERADA` a mano
  en `/etc/vigilante-tunel-netmagi.env`. En el siguiente chequeo (máximo 5 minutos) la alerta se cierra.

## Instalar en 13.140.235.16

Desde esta carpeta, con `nc` y `curl` instalados en el servidor:

```sh
sudo mkdir -p /opt/vigilante-tunel-netmagi
sudo cp vigilante.sh /opt/vigilante-tunel-netmagi/
sudo cp vigilante-tunel-netmagi.service vigilante-tunel-netmagi.timer /etc/systemd/system/
sudo tee /etc/vigilante-tunel-netmagi.env >/dev/null <<'EOF'
CRM_URL=https://crm.magilus.com
CRON_SECRET=<el mismo valor de DAILY_REPORT_CRON_SECRET que está en Portainer>
IP_ESPERADA=<la IP que mostró el curl de arriba>
PROXY_HOST=172.19.0.1
PROXY_PORT=1080
EOF
sudo chmod 600 /etc/vigilante-tunel-netmagi.env
```

Antes de prenderlo, probar sin mandar nada (solo imprime lo que mandaría):

```sh
sudo sh -c 'set -a; . /etc/vigilante-tunel-netmagi.env; sh /opt/vigilante-tunel-netmagi/vigilante.sh --simular'
```

Tiene que salir algo así: `{"fuente":"tunel","puertoAbierto":true,"ipSalida":"...","ipEsperada":"..."}`.
Si salen las dos IP iguales, todo bien. Entonces prenderlo:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now vigilante-tunel-netmagi.timer
systemctl list-timers vigilante-tunel-netmagi.timer   # cuándo corre la próxima vez
journalctl -u vigilante-tunel-netmagi -n 20           # qué mandó las últimas veces
```

El aviso se manda con el secreto en la cabecera `x-daily-report-secret` (el CRM acepta cualquiera de los secretos
del reloj). Si en el registro sale "respondió 401", el `CRON_SECRET` no coincide con el de Portainer.

## Lo que no hace

- **Si se cae el servidor 13.140.235.16 entero, el vigilante también se calla** y no llega ningún aviso del túnel.
- No arregla nada: si el túnel se cae, hay que levantarlo a mano en aizen1.
- Dejar el túnel de aizen1 como un servicio que se reinicia solo es **otra tarjeta**.
- Las alertas de cada cuenta (mf1 a mf14) llegan desde la extensión NETMAGI: también es otra tarjeta.
