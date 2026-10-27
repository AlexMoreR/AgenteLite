## Automatizaciones
- `descarte_tras_seguimientos`: cada 10 minutos, si el seguimiento de 3 días del paso Bienvenida salió hace 24 h o más y el cliente no escribió (ni una asesora le escribió a mano), pasa el lead a Descartado con motivo "Sin respuesta". Si mostró ganas de comprar (precio, envío o ciudad, pago, cotización, anticipo; no cuenta lo de sus primeros 2 minutos) o está en Caliente, no lo descarta: le pone la etiqueta LLAMAR para una llamada. Si el cliente vuelve a escribir, lo reabre en su etapa anterior. Interruptor `crm:descarte-tras-seguimientos:<negocio>` (prendido salvo "off"); máximo 50 por vuelta.

## Advertencias de operación
- `descarte_tras_seguimientos`: no hace nada hasta crear el seguimiento de 3 días en el paso Bienvenida (dato del embudo). Solo cubre a quienes recibieron ese mensaje: los chats viejos que no lo recibieron no se tocan. Para apagarlo, poner `crm:descarte-tras-seguimientos:<negocio>` en "off".
