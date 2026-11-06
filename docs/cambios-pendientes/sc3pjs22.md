## Qué no existe hoy
- `precarga_chats_oficiales`: los chats `official:` (API oficial de WhatsApp) no se precargan, porque su cargador los marca leídos; en su primera apertura no alcanzan la meta de 0,15 s y se ven vacíos un momento.

## Advertencias de operación
- `precarga_chats_visibles`: la lista de Chats precarga los chats que se ven en pantalla (máximo 15, de a uno, con el navegador libre y 400 ms después de parar de desplazarse). Cambiar de pestaña o filtro y buscar no precarga. Un chat ya pedido no se vuelve a pedir en 30 minutos, aunque el pedido haya fallado. En la pestaña Red se ven como `/api/cliente/chats/live?...&precarga=1`.
