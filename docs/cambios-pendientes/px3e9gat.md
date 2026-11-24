## Automatizaciones
- `vigilancia_proxy_netmagi`: recibe en POST /api/cron/proxy-netmagi el estado del túnel de aizen1 y de cada cuenta mfN, y abre o cierra alertas en /cliente/alertas; nunca cambia IP ni proxy.

## Qué no existe hoy
- `alertas_por_cuenta_netmagi`: las alertas por cuenta (mf1 a mf14) solo llegan cuando la extensión NETMAGI las mande (eso es otra tarjeta, en messenger-basic); hoy solo el chequeo del túnel puede avisar.
