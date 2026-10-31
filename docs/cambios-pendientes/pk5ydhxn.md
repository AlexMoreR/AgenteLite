## Módulos
- `mapa-colombia`: `/cliente/direccion/mapa-colombia` (solo dueño y administradores, la misma protección que Pauta): mapa de Colombia por departamento para un mes (`?mes=AAAA-MM`, por defecto el mes en curso). Cada departamento sale más oscuro cuanto más gasto de Meta Ads tuvo, y en rojo si en los últimos 60 días gastó y no vendió. Al tocar un departamento se ve su gasto (y su % del total), los chats que llegaron, las ventas y el valor vendido. Debajo salen aparte "Sin ubicar" y "Otras regiones". Solo lee: usa `leerMapa`.

## Qué no existe hoy
- `ciudad_de_la_venta`: Gestión todavía no manda la ciudad ni el departamento de la venta; el mapa ubica la venta por la ciudad del chat o el indicativo del teléfono, y las que no se pueden ubicar quedan en "Sin ubicar" (si son muchas, el rojo puede no ser exacto).
