## Automatizaciones
- `listo_para_pagar`: cuando el Agente V3 avisa "🔥 LISTO PARA PAGAR" (el cliente dio fecha, dijo "apártalo" o pidió la cuenta), deja una marca; si en 5 minutos, en horario de trabajo (lunes a sábado, 8 a. m. a 6 p. m.), nadie del equipo le escribe al cliente (desde el CRM o el teléfono), el reloj de cada minuto le pasa el aviso al líder de ventas: push y WhatsApp por la línea interna con el mensaje de cierre. Un solo aviso al líder por chat cada 24 h; máximo 5 por vuelta. Sin interruptor.

## Advertencias de operación
- `listo_para_pagar`: las marcas viven en `AppSetting` con clave `listo-para-pagar:<conversationId>`. Si no hay líder de ventas elegido ni supervisora activa, la marca queda `sin_destino` y solo se ve un `console.warn`; fuera de horario la marca espera y sale al abrir (después de 24 h se cierra sin avisar).
