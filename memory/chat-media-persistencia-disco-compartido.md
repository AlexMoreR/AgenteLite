---
name: chat-media-persistencia-disco-compartido
description: Por qué stickers/imágenes salían rotos y el fix auto-reparable de resolución de media
metadata:
  type: project
---

Los medios entrantes (sticker/imagen/audio/video) se persisten como binario en disco local en `/public/uploads/chat-media/<sha256>.<ext>` (chat-media-storage.ts → persistChatMediaFromDataUrl) y se guarda esa ruta en `Message.mediaUrl`.

PROBLEMA (2026-06-06): la BD es COMPARTIDA entre el entorno local y el desplegado, pero el disco NO. El webhook de Evolution apunta al servidor desplegado (webhookBaseUrl en system settings), así que el `.webp` se escribía en el disco de PRODUCCIÓN y la fila en la BD compartida quedaba con `/uploads/chat-media/<hash>.webp`. En localhost ese archivo no existe → 404 → sticker/imagen rota. Las imágenes a veces se veían porque se re-resolvían cada carga; los stickers quedaban pegados a la ruta persistida inexistente.

DIAGNÓSTICO: log temporal en cliente `[MEDIA_DEBUG_CLIENT]` (en el render del sticker en shared-inbox.tsx, ya removido) mostró `resolvedStickerUrl: /uploads/chat-media/<hash>.webp`; un `ls public/uploads/chat-media/` confirmó que el archivo NO existía en disco local. Toda la media del inbox pasa por `/api/cliente/chats/live` (loadAgentConversationDetail NO resuelve media; solo el live route lo hace en route.ts líneas ~69-87) → no hay otra ruta de render inicial que evada la resolución.

FIX (auto-reparable, sirve para cualquier servidor): en `resolveEvolutionMessageMediaUrl` (evolution.ts), antes de devolver una ruta `/uploads/chat-media/...` se verifica que el archivo exista en ESTE servidor con `persistedChatMediaFileExists` (nuevo helper en chat-media-storage.ts, con guarda anti path-traversal). Si no existe, NO se devuelve la ruta rota: cae a re-resolver el binario desde Evolution (getBase64FromMediaMessage → data URL). Y el fallback final de la función devuelve `null` (no la ruta `/uploads` rota) para que la UI muestre placeholder en vez de imagen rota. webp ya estaba soportado en inferSupportedImageMimeType/inferMediaMimeType — el problema NUNCA fue el formato ni la caché de media (que se había revertido), era el archivo ausente.

Relacionado: [[chats-mejoras-roadmap]]. La caché de media revertida está documentada ahí (no era la causa, confirmado).
