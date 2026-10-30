## Módulos
- `reuniones`: salas fijas por área, parte 2 de 4: el link fijo de una sala es `/reunion/sala/<codigo>` (público, como `/reunion/<código>`). Si la sala tiene una reunión Esperando o En vivo, el link manda a esa (`/reunion/<código de la reunión>`), así abrirlo dos veces lleva a la misma. Si no hay ninguna, quien tiene el módulo Reuniones en el negocio de la sala (dueño, admin, líder o cualquiera con el módulo) ve «Iniciar reunión», que usa o crea la reunión de la sala (`iniciarReunionDeSalaAction`); el invitado sin sesión ve «La reunión todavía no empieza» y la página se refresca cada 15 segundos hasta que alguien la inicie. Si el código no existe sale la página de "no encontrado". Pruebas: `node scripts/check-reuniones-salas.mjs`.

## Qué no existe hoy
- `reuniones_sala_sin_aviso`: el invitado que espera en el link fijo de una sala no recibe aviso (ni sonido ni WhatsApp) cuando la reunión empieza: solo entra si deja la página abierta.
