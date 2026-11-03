## Módulos
- `metas`: `/cliente/metas` (solo el dueño y los administradores; las demás cuentas van a Mi día). Por mes: la meta y el reto de cada asesora, su usuario del CRM y su nombre en Gestión (opcional), la meta y el mínimo del equipo, el bono y los dos % de comisión (hasta la meta y sobre la meta). Si el mes no tiene metas muestra las del mes anterior (o las de noviembre 2026) sin guardarlas; se guardan con "Guardar" en el AppSetting `metas-ventas:<negocio>:<AAAA-MM>`. Código en `src/features/metas`, pruebas `npm run test:metas-del-mes`.

## Qué no existe hoy
- `comision_en_gestion`: la comisión que ve cada asesora en el panel es una estimación del CRM; Gestión todavía no la calcula con el 10 % hasta la meta, el 20 % sobre la meta y el bono del equipo.

## Advertencias de operación
- `metas_del_mes`: las metas se cargan cada mes en /cliente/metas. Si el dueño no guarda las del mes, la pantalla ofrece las del mes anterior, pero hasta dar "Guardar" el mes queda sin metas.
