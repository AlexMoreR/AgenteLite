## Módulos
- `pauta`: CRM → Pauta (solo dueño, administradores y supervisora). Por campaña y anuncio de Meta, en un rango de fechas: gasto (Meta Ads, solo lectura), chats, Calientes, ventas, monto vendido, tasa de cierre (ventas ÷ chats) y costo por venta (gasto ÷ ventas), con una fila aparte "Orgánico / Marketplace / Otro". También sale por el MCP con la herramienta de solo lectura `ventas_por_campana` (sin fechas usa el mes en curso).

## Entidades
- `OrigenDePauta`: de qué anuncio, conjunto y campaña de Meta llegó cada cliente (uno por cliente y negocio), con la red, el `ctwaClid`, la fecha de llegada y el chat. El anuncio sale de lo que los webhooks ya guardan en la ficha (`adSourceId`...); la campaña y el conjunto se le preguntan a Meta una vez por anuncio.
- `VentaDePauta`: una venta pagada (número en Gestión, cotización, teléfono, monto, fecha de pago) con el cliente y el origen de pauta que le tocó por teléfono (con y sin 57); categoría `PAUTA` u `ORGANICO_OTRO`.

## Automatizaciones
- `origen_de_pauta`: una vez al día (4 a. m. de Colombia, colgada del reloj de seguimientos) crea el origen de cada chat de anuncio (también de los que ya existían), resuelve su campaña con Meta Ads (solo lectura) y cruza las ventas pagadas de los últimos 60 días con esos clientes. Endpoint manual: `/api/cron/pauta`.

## Qué no existe hoy
- `monto_de_ventas_en_el_crm`: el CRM no guarda el monto de la venta. El monto del reporte de pauta solo existe si Gestión responde `GET /api/ventas/pagadas?desde&hasta` (ese endpoint hay que agregarlo en Gestión); si no, se cuentan los GANADO del CRM sin monto y el reporte lo avisa.
- `gasto_de_pauta`: sin META_ADS_ACCESS_TOKEN (permiso `ads_read`) y META_ADS_ACCOUNT_ID el gasto sale "no disponible" y las campañas no tienen nombre (se agrupa por anuncio).
- `origen_de_pauta_api_oficial`: los chats de la API oficial no llenan el anuncio en la ficha, así que no entran al reporte de pauta.

## Advertencias de operación
- `ventas_en_organico_sin_serlo`: un cliente que llegó por anuncio antes de que el CRM guardara el dato, o que compró desde otro número, queda en "Orgánico / Marketplace / Otro"; por eso la tasa de cierre de la pauta puede salir más baja que la real. Un cliente que vio dos anuncios cuenta con el primero.
