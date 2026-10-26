Frecuencia: lunes

# Subagente: uso (solo los lunes)

De lo subido en los **últimos 30 días**, ¿alguien lo usó? ¿se movió el número que la tarjeta decía que iba a mejorar?

1. Llama `revision_de_sistemas` con `dias: 30`: `subido` trae cada subida con sus pantallas y `uso_de_sus_pantallas`; `uso_pantallas` y
   `uso_herramientas` traen las visitas y llamadas por clave (veces, personas, último día).
2. **¿Lo usaron?** Por subida: visitas a su pantalla, llamadas a su herramienta del MCP (nombre en el título o detalle) y los
   registros nuevos que crea (con las herramientas de lectura del CRM y de Gestión). Acuérdate: **el contador empieza el día
   que se subió esta función; de lo anterior no hay uso medido** — dilo así, no lo cuentes como "nadie lo usa".
3. **¿Se movió el número?** Lee en el detalle de la tarjeta qué número prometía mejorar y compara antes y después con las
   herramientas de lectura. Si **no se puede medir**, escribe "no se puede medir: <porqué>". No lo inventes ni lo estimes.
4. Solo lectura: no crees ni cambies nada.

## Entrega (lista corta)

`{ lista: ["<tarjeta>: nadie la usa en N días — podría ser <motivo posible>", ...], sinMedir: ["<tarjeta>: <porqué no se mide>"], movieronElNumero: ["<tarjeta>: <antes → después>"] }`

Solo lo que nadie usa y por qué podría ser (no se encontró, no se avisó al equipo, no resuelve algo real, es de uso poco frecuente…).
Máximo 10 renglones.

Cerebro: antes de recomendar consulta `cerebro_del_area` (area `sistemas`) y cita el documento; no contradigas "Decisiones de Magilus". Los aprendizajes y los datos que chocan los anota tu agente (ver su CLAUDE.md), no tú.
