## Qué no existe hoy
- `buscador_de_chats`: mientras hay algo escrito en el buscador de la bandeja, el filtro de estado no aplica (salen abiertos, cerrados y descartados) y también salen los chats pospuestos. El número se encuentra con o sin 57. La búsqueda dentro de mensajes sigue limitada a 90 días y 4 letras o más.
- `enlace_directo_a_chat`: `/cliente/chats?conversacion=<id>` abre ese chat (WhatsApp normal u oficial) con el estado en "Todos"; con un id que no existe sale la bandeja normal.
