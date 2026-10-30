## Entidades
- `ChatSendError`: cada mensaje de una asesora que no salió desde Chats (línea, gateway, hora, motivo, asesora, chat, intento y si lo anotó el servidor o el navegador). Sirve para medir los errores de envío por día; lo lee la herramienta `errores_de_envio_de_chats`.

## Advertencias de operación
- `envio_de_texto_de_chats`: el texto de las asesoras sale por `POST /api/cliente/chats/enviar` (ya no por una acción del servidor), así una subida nueva no rompe el envío en las pestañas abiertas. Cada mensaje lleva un número único (`clientMessageId`, guardado en `rawPayload`): un reintento con el mismo número no sale dos veces. Se reintenta solo, como mucho 2 veces, únicamente si es seguro que no salió; si el gateway tardó más de 25 s queda "No se envió · Reintentar".
- `guardado_fallo`: si WhatsApp aceptó el mensaje pero falló el guardado en la base, la asesora ve "enviado" y se anota el error; el mensaje aparece después por el aviso del gateway o la sincronización.

## Qué no existe hoy
- `no_enviados_entre_dispositivos`: los mensajes "No se envió" se guardan en el navegador de la asesora (24 h); en otro celular u otro navegador no aparecen.
