## Automatizaciones
- `reparto_por_turno`: desde el 11-11-2026, en las líneas de ventas el chat sin asesora se reparte solo cuando la necesita (src/lib/reparto-cuando-lo-necesita.ts). Nadie se asigna antes de que el bot mande fotos, video o catálogo. Con las fotos ya mandadas, se asigna si el agente pidió asesora (nota "El agente pide un asesor") o si la clienta pregunta precio, pago, envío o contraentrega, o dice su ciudad. El rescate de chats sin asesora (cada minuto) usa la misma regla. La reasignación a los 10 minutos sin respuesta no cambia. Asignar no pausa al agente.

## Advertencias de operación
- `reparto_por_turno`: si el agente pide asesora ANTES de mandar las fotos, el chat no se asigna; solo lo rescata la red de 30 minutos cuando la clienta queda esperando sin respuesta.
