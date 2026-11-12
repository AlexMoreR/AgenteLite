## Automatizaciones
- `reparto_por_turno`: desde el 11-11-2026, en las líneas de ventas el chat sin asesora se reparte solo cuando la necesita (src/lib/reparto-cuando-lo-necesita.ts). Si el agente pide asesora (nota "El agente pide un asesor"), se asigna siempre. Lo que escribe la clienta no asigna antes de que el bot mande fotos, video o catálogo; con las fotos ya mandadas, asigna si pregunta precio, pago, envío o contraentrega, o dice su ciudad. El rescate de chats sin asesora (cada minuto) usa la misma regla. La reasignación a los 10 minutos sin respuesta no cambia. Asignar no pausa al agente.

## Advertencias de operación
- `reparto_por_turno`: si el bot nunca manda fotos (por ejemplo, da el precio solo en texto) y no pide asesora, el chat no se asigna por lo que escriba la clienta; lo cubren la nota del agente al cierre y la red de 30 minutos cuando la clienta queda esperando sin respuesta.
