## Qué no existe hoy
- `mapa_departamento_de_celulares`: el teléfono solo ubica fijos 601 (Bogotá o Cundinamarca); un chat o una venta de celular sin ciudad en la ficha (`metadata.city`) ni departamento de Gestión queda "sin ubicar" en el mapa de Colombia (`numeros_de_marketing` con `por_departamento`).

## Advertencias de operación
- `mapa_rojo_60_dias`: en el mapa de Colombia el rojo (gasta y no vende) siempre mira los últimos 60 días hasta hoy, sin importar el mes pedido; sin la llave de Meta (`META_ADS_ACCESS_TOKEN`, `META_ADS_ACCOUNT_ID`) el gasto sale "no disponible" y ningún departamento queda en rojo.
