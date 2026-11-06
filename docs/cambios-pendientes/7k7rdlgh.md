## Qué no existe hoy
- `chats_oficial_sin_recarga`: en los chats de API oficial (Ventas 2) la pantalla se sigue rearmando entera: el aviso del webhook de Meta no trae el mensaje y pide /cliente/chats completo (`chats-auto-refresh.tsx`). Enviar ya no recarga en ninguna línea, pero la meta de 0 recargas solo se cumple en líneas como Ventas 1.
- `ubicacion_en_api_oficial`: el botón "Ubicación del local" se ve en los chats de API oficial y da error al tocarlo; enviar la ubicación solo funciona en las líneas que no son de API oficial.

## Advertencias de operación
- `envio_sin_recarga`: enviar foto, archivo, nota de voz, ubicación, biblioteca, carta de colores o flujo ya no rearma la bandeja (sin `revalidatePath` ni `router.refresh()`). La fila sube al instante y el mensaje real llega por tiempo real o por `/live` del chat abierto a los 1,5 s. Si no llega, la burbuja de archivo o nota de voz se retira sola a los 5 minutos, igual que las fotos.
