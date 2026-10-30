## Automatizaciones
- `avisos_de_terminadas_tablero`: cuando el Coordinador deja una tarjeta en HECHO (subida y vigilada, ya estaba hecha o cierre de una partida), le manda al dueño por la línea Admin "✅ ¡Listo! Terminó la tarea T-123: <título> 🚀" (agrupa varias en un mensaje), un aviso por tarjeta, en silencio de 9 p. m. a 7 a. m., e interruptor tablero:avisos-dueno:terminadas:<negocio>

## Conceptos del negocio
- `codigo_corto_de_tarjeta`: cada tarjeta del Tablero IA tiene un código corto T-<número> (T-123) que se ve en el tablero y en los avisos de WhatsApp.

## Advertencias de operación
- `avisos_de_terminadas_tablero`: los números T-<número> de las tarjetas viejas no siguen la fecha de creación (se numeraron al agregar el código), así que T-12 puede ser más nueva que T-300.
