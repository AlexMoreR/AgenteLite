## Qué no existe hoy
- `segundo_asesor_api_oficial`: los chats de la API oficial no tienen segundo asesor; solo los de WhatsApp normal (`Conversation.segundoAsesorId`). Todavía no hay botón en pantalla para agregarlo (lo traen las partes 3 y 4): el servidor ya tiene `asignarSegundoAsesorAction`.

## Advertencias de operación
- `segundo_asesor_sin_principal`: si a un chat con segundo asesor se le quita el principal, el segundo se queda (no se borra solo). Si después el segundo contesta y se queda el chat, deja de ser segundo; lo mismo si lo asignan como principal.
