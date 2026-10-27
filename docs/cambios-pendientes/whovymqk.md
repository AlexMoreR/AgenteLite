## Entidades
- `ChatSendError`: un error de envío del chat (línea, gateway, hora, motivo, asesora, chat, número del intento y si lo anotó el servidor o el navegador). Solo sirve para medir; la herramienta del MCP `errores_de_envio_de_chats` lo cuenta por día, línea y motivo.

## Advertencias de operación
- `envio_de_texto_del_chat`: el texto de /cliente/chats ya no va por una acción del servidor sino por `POST /api/cliente/chats/enviar` (así no se rompe al subir una versión nueva). Lleva un número único por mensaje (`clientMessageId`, guardado dentro de los datos del mensaje): si llega repetido no se vuelve a mandar a WhatsApp. El navegador reintenta solo 1 o 2 veces, y únicamente cuando es seguro que no salió; si el gateway se agota (25 s) queda "No se envió · Reintentar".
