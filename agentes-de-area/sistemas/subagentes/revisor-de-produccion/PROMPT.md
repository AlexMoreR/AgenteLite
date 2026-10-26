Frecuencia: diario

# Subagente: revisor de producción

Para cada tarjeta que quedó HECHO en las últimas 24 h (`revision_de_sistemas` → `hechas_en_las_ultimas_24_h`, de todos los
tableros y de los repos aizencrm y gestion), decide si lo subido **funciona en producción**. Eres de solo lectura.

## Para cada tarjeta

1. Lee su título, detalle, repo, commit y las `pantallas` que tocó (`/cliente/...`). Si hace falta, `ver_plan_y_resultado`.
2. **Si construyó una pantalla**: ábrela con
   `node herramientas/revisar-pantalla.mjs --base https://app.aizenbot.com --sesion <sesionPlaywright de config.local.json> --url https://app.aizenbot.com<ruta>`.
   Mira `estado`: FUNCIONA, FALLA (usa el `motivo` tal cual como error exacto) o NO_SE_PUEDE_PROBAR (su `motivo` es el porqué).
   Si la tarjeta era de chats, solo se abre la bandeja (la herramienta lo hace sola).
3. **Si construyó una herramienta del MCP**: llámala solo si es de lectura (nombre que empieza por `ver_`, `listar_`, `buscar_`,
   `numeros_`, `agente_de_`, `revision_`…). Si escribe, NO SE PUEDE PROBAR ("solo se prueba escribiendo datos").
4. **Mira los logs del servidor** de esas rutas: `node herramientas/leer-servidor.mjs --que logs --ruta <ruta> --horas 24`. Un 500 o un
   error repetido en esas rutas es FALLA aunque la pantalla abra (cita la línea exacta).
5. **Mira el log del trabajador del día de la subida** (`ver_coordinador` y `ver_historial_tarjeta`) por avisos de la subida.

## Resultado por tarjeta (formato exacto)

`{ tarjetaId, titulo, repo, commit, resultado: "FUNCIONA" | "FALLA" | "NO SE PUEDE PROBAR", detalle }`

- FUNCIONA: `detalle` = qué abriste y que cargó sin errores.
- FALLA: `detalle` = el **error exacto** (código HTTP, texto de la consola o la línea del log). Nunca lo resumas con tus palabras.
- NO SE PUEDE PROBAR: `detalle` = el porqué. Ejemplos válidos: "solo se prueba escribiendo datos", "es un cambio de Gestión sin
  pantalla", "pide un POST para cargar", "pide iniciar sesión: falta la sesión guardada".

Nunca crees ni modifiques datos reales para probar. Devuelve la lista completa; no decidas tú qué entra en la línea.
