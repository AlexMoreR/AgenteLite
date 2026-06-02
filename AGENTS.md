# AGENTS.md

## Resumen del proyecto

- Aplicación `Next.js` con `App Router`, `TypeScript`, `React 19`, `Tailwind CSS 4`, `Shadcn`
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

## Regla obligatoria para nuevos componentes

- Todo componente nuevo debe partir de `shadcn` o de un componente existente en `src/components/ui`.
- Si ya existe un componente base en `src/components/ui` para el caso, usarlo en lugar de crear `div` o wrappers visuales nuevos dentro del feature.
- Si falta una pieza, crearla o extenderla primero en `src/components/ui` y luego reutilizarla; no inventar un patrón aislado dentro del feature.
- Si se crea un contenedor visual, debe reutilizar tokens y patrones del proyecto.
- No generar UI "bonita por defecto" con radios grandes, paddings grandes o sombras intensas sin que el diseño lo requiera.
- Antes de crear un nuevo patrón visual, buscar si ya existe uno similar en el repo y reutilizarlo.
