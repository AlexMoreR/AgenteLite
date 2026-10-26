## Automatizaciones
- `recoger_errores_tablero`: una vez al día (y la primera vez que arranca el Coordinador con este cambio) el Coordinador revisa todas las tarjetas del Tablero IA en ERROR, les aplica el diagnóstico de la autorreparación y las reintenta, las parte o deja una línea para el dueño; máximo 6 tarjetas por día y 2 recogidas por tarjeta (la fecha va en recoger-errores.json de la carpeta de trabajo del Coordinador).

## Qué no existe hoy
- `esperando_a_otra`: "Esperando a otra" no es un estado de la tarjeta; se calcula con las flechas de dependencia que ya existen (el panel "Coordinador en vivo" y ver_coordinador muestran "En error" y "Esperando a otra").

## Advertencias de operación
- `medir_antes_de_planear`: antes de planear, el Coordinador mide el tamaño de la tarjeta; si es grande la parte en 2 a 4 hijas "aprobadas, por planear" (sin plan copiado) y pone solo la flecha de dependencia cuando el texto nombra otra tarjeta como molde o requisito. Una flecha equivocada se quita con un clic en el tablero.
- `build_un_solo_candado`: nunca dos builds a la vez en la misma carpeta; si aparece el aviso de candado de Next, espera, limpia el candado viejo y reintenta sin contar intento.
- `tablero_vencida_error`: una tarjeta que vence por falta de latido vuelve a la fila (no cuenta intento) hasta 5 veces seguidas; solo la que se pasa del tope de su etapa o ya hizo 5 esperas pasa a ERROR.
