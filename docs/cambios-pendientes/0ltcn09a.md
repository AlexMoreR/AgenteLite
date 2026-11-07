## Advertencias de operación
- `miniaturas_de_la_lista_de_chats`: las fotos de la lista de chats salen achicadas por el optimizador de Next (`/_next/image`, 96 px). Esas miniaturas se guardan solo en el contenedor: se pierden en cada despliegue y se rehacen cuando alguien las pide, así que la primera carga de la lista después de desplegar es un poco más lenta.

## Qué no existe hoy
- `miniatura_de_fotos_de_whatsapp`: las fotos de perfil que quedaron con dirección de WhatsApp (`pps.whatsapp.net`) no se achican; en la lista se bajan a tamaño completo. Solo se achican las guardadas en `/uploads/`.
