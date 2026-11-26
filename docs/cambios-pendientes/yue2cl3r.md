## Qué no existe hoy

- `supervisor`: el análisis de cada hora del Supervisor mira como máximo los 1.500 chats más nuevos de la ventana (16 a 30 días) y, de cada chat, sus últimos 300 mensajes; lo que pase de ahí no entra en las fichas. La lectura tiene tope de 20 s: si la base tarda más, esa vuelta del negocio se salta y queda la línea `[supervisor] hora` en los registros.

## Advertencias de operación

- `supervisor`: en el chequeo de atención del Supervisor, un chat cuya última respuesta de una persona (asesora o el teléfono) es de hace más de 30 días cuenta como "nadie le respondió". El MCP (`ver_supervisor`), el Supervisor accionable y las alertas abiertas siguen mirando toda la historia.
