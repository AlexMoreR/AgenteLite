## Automatizaciones
- `recoger_errores_tablero`: una vez al día (y la primera vez que arranca con este cambio) el Coordinador de aizen1 revisa las tarjetas del Tablero IA en ERROR y las reintenta, las parte en hijas o deja una línea para el dueño; máximo 2 recogidas por tarjeta y 6 tarjetas por día. Nunca pasa una tarjeta a FALLIDO: eso lo decide el dueño.

## Qué no existe hoy
- `esperando_a_otra_sin_estado`: "Esperando a otra" no es un estado de la base: se calcula con las flechas de dependencia (`ConexionTarjeta.esDependencia`) de las tarjetas APROBADO / PLAN_APROBADO cuyo origen no está HECHO; las muestran el panel "Coordinador en vivo" y `ver_coordinador`, no la tarjeta del tablero.

## Advertencias de operación
- `medir_antes_de_planear`: el Coordinador mide el tamaño de una tarjeta antes de planearla y, si es grande, la parte en 2 a 4 hijas (quedan "Aprobadas, por planear") sin abrir sesión de plan para la madre; si el texto nombra por su id otra tarjeta como molde o requisito, pone la flecha de dependencia solo y la tarjeta queda "Esperando a «X»", no en ERROR.
- `candado_de_build`: si Next dice "Unable to acquire lock / another instance of next build", el Coordinador espera, limpia el candado y reintenta; esas esperas no cuentan como intento ni reparación.
- `vencida_con_candado_no_es_error`: corrección al texto "vencida = ERROR": una tarjeta que se queda sin latido vuelve a la fila sin error; solo pasa a ERROR si se pasó del tope de su etapa, estaba subiendo o ya esperó 5 veces seguidas.
