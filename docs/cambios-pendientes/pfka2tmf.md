## Automatizaciones
- `resumen_diario_dueno`: una vez al día (entre las 6 y las 9 p. m. de Bogotá, por la línea Admin) Alexander recibe por WhatsApp un resumen de máximo 4 líneas: qué se arregló, qué falló y qué está pendiente, sin links ni listas. Lo manda el reloj `api/cron/follows`; interruptor `tablero:resumen-diario:activo:<ws>` (prendido sin fila) y último día enviado en `tablero:resumen-diario:ultimo:<ws>`.
- `avisos_tecnicos_emanuel`: las alertas técnicas (Coordinador caído, sin trabajo, tarjetas en ERROR o atascadas, límite de Claude) salen al WhatsApp de Emanuel (ajuste `tablero:avisos-sistemas:telefono:<ws>`, interruptor `tablero:avisos-sistemas:activo:<ws>`, se editan en Mi empresa → Claude). Lo que pide dinero, Meta Ads o una clave sigue yendo a Alexander. Sin teléfono válido de Emanuel, todo sale al dueño como antes.

## Qué no existe hoy
- `aprobador_sistemas_prueba`: Emanuel (aprobador con alcance SISTEMAS) aprueba la tarea, el plan y el sí final de tarjetas de Tecnología, pero solo hasta el 29-nov-2026 (`PRUEBA_SISTEMAS_HASTA`, o el ajuste `tablero:aprobador-sistemas:hasta:<ws>` para prorrogar). Nunca aprueba tarjetas que tocan dinero de Gestión o Meta Ads ni las de zona protegida: las aprueba Alexander. Esas se detectan por palabras (abonos, saldos, nómina, comisiones, facturación, pagos, presupuesto, gasto, campañas, anuncios): ante la duda se bloquea.

## Advertencias de operación
- `crear_usuario_emanuel`: el CRM no crea usuarios solo. Si Emanuel no tiene usuario, el dueño lo invita desde Mi empresa → Equipo (clave temporal que él cambia con el link) y después lo pasa a "Sistemas (prueba)" en Tablero IA → Coordinador → Quién más aprueba. No se escribe ninguna clave en el código.
