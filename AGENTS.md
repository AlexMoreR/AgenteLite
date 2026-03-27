# AGENTS.md

## Resumen del proyecto

- Aplicación `Next.js` con `App Router`, `TypeScript`, `React 19` y `Tailwind CSS 4`.
- Usa `Prisma` con PostgreSQL.
- La autenticación está basada en `next-auth` y adaptador de Prisma.
- El código principal vive en `src/`.

## Estructura importante

- `src/app`: rutas, layouts, páginas, server actions y endpoints.
- `src/components`: componentes reutilizables.
- `src/lib`: utilidades, helpers y lógica compartida.
- `src/auth.ts` y `src/auth.config.ts`: configuración de autenticación.
- `src/middleware.ts`: control de acceso y middleware global.
- `prisma/schema.prisma`: modelo de datos.
- `prisma/seed.js`: datos iniciales.

## Comandos útiles

- Instalar dependencias: `npm install`
- Desarrollo: `npm run dev`
- Build de producción: `npm run build`
- Ejecutar producción local: `npm run start`
- Lint: `npm run lint`
- Seed de base de datos: `npm run db:seed`

## Convenciones para agentes

- Antes de editar, revisar si ya existe un patrón similar en `src/app`, `src/components` o `src/lib`.
- Mantener cambios pequeños y enfocados; no mezclar refactors amplios con fixes puntuales.
- Respetar `App Router` y preferir componentes de servidor salvo que realmente se necesite `"use client"`.
- Si se toca autenticación, revisar también `src/auth.ts`, `src/auth.config.ts` y `src/middleware.ts`.
- Si se cambia el modelo de datos, actualizar `prisma/schema.prisma` y considerar si hace falta migración o seed.
- No exponer secretos ni copiar valores reales de `.env` en código, logs o documentación.
- Verificar al menos con `npm run lint` los cambios relevantes antes de cerrar la tarea.

## Notas actuales

- Hay integración con Docker mediante `Dockerfile`, `docker-compose.portainer.yml` y `docker-publish.yml`.
- No se ve una suite de tests automatizados configurada en `package.json`; el chequeo mínimo actual es `lint`.
- `README.md` sigue siendo el de ejemplo de Next.js, así que no debe tomarse como documentación funcional del negocio.

## Expectativas al entregar cambios

- Explicar brevemente qué se cambió.
- Mencionar cualquier archivo sensible o área de riesgo afectada.
- Indicar qué validación se ejecutó y qué quedó sin validar si aplica.

## Nuevo módulo: Generador de anuncios (Marketing IA)

### Objetivo
Crear un submódulo dentro de "Marketing IA" que permita a emprendedores generar anuncios para Meta Ads Manager.

El usuario podrá:
1. subir una imagen o usar una existente
2. completar un formulario del producto
3. generar un anuncio automáticamente
4. copiar el resultado para usar en Meta Ads Manager

### Flujo del módulo
Formulario → análisis del producto → estrategia → generación de copy → salida final

### Entrada del sistema
- imagen del producto
- nombre del producto
- descripción
- precio
- oferta
- público objetivo
- ubicación
- presupuesto
- destino (WhatsApp, web, Instagram, Messenger)

### Salida esperada
- resumen estratégico del producto
- objetivo recomendado
- ángulo de venta recomendado
- estructura de campaña
- segmentación básica
- formato recomendado
- copy principal
- 2 o 3 variantes de copy
- título
- descripción
- CTA recomendado
- idea de creativo
- recomendación de presupuesto
- métrica principal a vigilar
- checklist para publicar en Meta Ads Manager

### Arquitectura esperada
Crear dentro de `src/features/ads-generator/`:

- components/
- services/
- domain/
- types/

### Servicios requeridos
- analyzeProduct
- generateAdStrategy
- generateCopies
- buildMetaOutput

Estos servicios deben estar desacoplados de la UI.

### Reglas importantes
- Reutilizar el módulo "Creativos" para la generación o selección de la imagen del anuncio.
- Evitar cambios internos en "Creativos" salvo que sean estrictamente necesarios para integrarlo.
- El nuevo módulo debe conectarse con "Creativos" como parte del flujo.
- No integrar APIs externas en esta fase.
- Usar datos mock inicialmente para la salida estratégica si todavía no está conectada la IA real.
- Mantener separación entre UI y lógica de negocio.
