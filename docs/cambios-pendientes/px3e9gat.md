## Automatizaciones
- `vigilancia_proxy_netmagi`: recibe en POST /api/cron/proxy-netmagi el estado del túnel de aizen1 y de cada cuenta mfN, y abre o cierra alertas en /cliente/alertas; nunca cambia IP ni proxy.

## Qué no existe hoy
- `alertas_por_cuenta_netmagi`: las alertas por cuenta (mf1 a mf14) solo llegan cuando la extensión NETMAGI las mande (eso es otra tarjeta, en messenger-basic); hoy solo el chequeo del túnel puede avisar.
- `aviso_si_cae_13_140`: si el servidor 13.140.235.16 se cae entero, el vigilante del túnel también se calla y no hay aviso del túnel.

## Advertencias de operación
- `vigilante_tunel_netmagi`: el vigilante del túnel (docker/vigilante-tunel-netmagi) se instala a mano en 13.140.235.16 y corre cada 5 minutos; la IP esperada (`IP_ESPERADA`) se pone a mano y nunca se aprende sola, así que si EMCALI cambia la IP la alerta `netmagi:ip` queda abierta hasta corregirla en /etc/vigilante-tunel-netmagi.env.
