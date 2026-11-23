## Qué no existe hoy
- `causa_de_la_reversion_en_el_crm`: cuando el Coordinador deshace una subida, el CRM guarda solo el commit, el commit que la deshizo y si se pudo deshacer; la clase de la causa (código, arranque, pasajera, desconocida) y las líneas del log no se guardan aparte (la frase sencilla sí llega, dentro del motivo de la tarjeta).

## Advertencias de operación
- `logs_arranque_por_repo`: al deshacer una subida, el Coordinador lee los logs del servidor con `repos.<clave>.logsArranque` (o, si falta, `ssh.logs`, que es el contenedor del CRM); para Gestión hay que poner su propio comando con el nombre real de su contenedor, o la causa sale de GitHub o queda "desconocida".
