## Entidades
- `MaterialDeColores`: un material de la carta de colores digital (Cuerotex, Prana y Corsos son CUERO; Telas es TELA), con su `orden`. En `imagenesUrl` guarda las imágenes ya armadas de la carta (12 colores por imagen) e `imagenActualizadaEn`. Nombre único por negocio. Reglas en `src/lib/carta-de-colores.ts`; todavía no hay pantalla ni botón (partes 2 a 4).
- `ColorDeCarta`: un color de un material: `codigo` (el que el cliente escribe en el chat, único dentro del material), `nombre`, `fotoUrl`, `orden` y `oculto` (no sale en la carta pero no se borra).

## Advertencias de operación
- `carta_de_colores_ventana_24h`: por la API oficial de WhatsApp la imagen de la carta de colores solo sale dentro de la ventana de 24 h desde el último mensaje del cliente; fuera de ella Meta no deja mandar imágenes sueltas (solo plantillas).
