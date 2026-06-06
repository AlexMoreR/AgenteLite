---
name: verificacion-no-contaminar-app-activa
description: Regla al verificar/probar — nunca interferir con el servidor o BD reales del usuario
metadata:
  type: feedback
---

Al verificar o probar cambios, NUNCA crear archivos ni configuración que el servidor en ejecución del usuario pueda recoger y que lo apunten a recursos de prueba. En particular: no crear `.env.local` (Next le da prioridad sobre `.env`), no cambiar `DATABASE_URL`, ni nada que el `next dev` activo lea.

**Why:** El 2026-06-06, para verificar la persistencia de medios levanté un Postgres embebido aislado y escribí `.env.local` con su `DATABASE_URL`. El `next dev` del usuario (puerto 3000) recogió ese `.env.local`, y al morir el Postgres de prueba la app real empezó a fallar con "Can't reach database server at 127.0.0.1:54329" y quedó lenta. El usuario lo notó y pidió expresamente que no se repita.

**How to apply:** Para pruebas runtime que requieran app+BD, aislar por completo (puerto distinto, dist dir distinto vía env efímera, y NUNCA un `.env.local`/`.env` que comparta el árbol del proyecto activo). Si no se puede aislar sin riesgo de tocar la app real del usuario, NO hacer la verificación invasiva: reportar BLOCKED y proponer alternativas. Siempre limpiar artefactos de prueba inmediatamente (en `finally`), y si una corrida falla a mitad, verificar a mano que no quedó `.env.local` ni procesos/locks huérfanos. La BD configurada en `.env` es Postgres remoto de producción (31.220.82.79); tratarla como producción. Relacionado con [[chats-mejoras-roadmap]].
