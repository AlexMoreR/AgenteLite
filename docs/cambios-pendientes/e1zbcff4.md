## Qué no existe hoy
- `llamada_entrante_timbre`: el servidor ya avisa cuando entra una llamada de WhatsApp (en vivo `type: "llamada-entrante"` y push "Te está llamando …"), pero todavía no hay timbre ni pantalla de llamada en el CRM abierto: eso es la parte 2 y 3 de la tarjeta. Solo se enteran los asignados al chat que tienen el módulo llamadas; un número sin chat asignado no le avisa a nadie.

## Advertencias de operación
- `wacalls_eventos_de_timbre`: el webhook de WaCalls reconoce el aviso de "empieza a sonar" como `call.ringing`, `call.incoming`, `call.offer` o `call.received`, y el de "contestada" como `call.connected`, `call.answered` o `call.accepted` (con `direction: "inbound"`). Los nombres no se pudieron confirmar contra el código de WaCalls del VPS: si WaCalls usa otro, el aviso se ignora sin error y no timbra nada. Confirmar con `grep -rn '"call\.' internal/` en el código de WaCalls.
