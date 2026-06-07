# Memory Index

- [Chats: roadmap de mejoras](chats-mejoras-roadmap.md) — plan por fases para preparar el inbox para agentes de atención; Fase 1.1 (estado de envío) hecha.
- [Media de chat: disco local vs BD compartida](chat-media-persistencia-disco-compartido.md) — stickers/imágenes rotos porque el archivo persistido vivía en otro servidor; fix de resolución auto-reparable.
- [Verificar sin contaminar la app activa](verificacion-no-contaminar-app-activa.md) — nunca crear .env.local/cambiar DATABASE_URL que el next dev del usuario pueda recoger; aislar pruebas o reportar BLOCKED.
