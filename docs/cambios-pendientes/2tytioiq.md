## Automatizaciones
- `resumen_diario_tablero`: sale a las 8:55 p. m. (Bogotá, una vez por día) y son 2 líneas: "Hoy: N listas ✅, N con problema ⚠️, N esperando tu sí 👆" y "Ver: <link a ?vista=hoy>". La parte que vale 0 no sale; si las tres valen 0 no se manda nada. Sin commits, ramas, ids ni planes.

## Módulos
- `tablero-ia`: la página de inicio tiene la pestaña "Hoy" (`?vista=hoy`, solo dueño o ADMIN) con tres grupos (listas hoy, con problema hoy, te toca a ti), una línea por tarjeta con su título corto. La caja "Resumen de hoy" muestra el mismo texto corto del WhatsApp.

## Advertencias de operación
- `silencio_avisos_tablero`: los avisos del Coordinador por WhatsApp (`/api/trabajador/aviso`) no salen de 9 p. m. a 7 a. m. (Bogotá): el servidor responde `silenciado` y el Coordinador lo reintenta hasta que sale a las 7 a. m. si sigue siendo cierto. Además el servidor recorta cualquier aviso a 3 líneas. No aplica a los avisos graves del Supervisor.
