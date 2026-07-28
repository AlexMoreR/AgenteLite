import { persistChatMediaFromDataUrl } from "@/lib/chat-media-storage";

const GRAPH_VERSION = "v23.0";
// Meta permite hasta 100 MB en video/documento, pero acá el límite real lo pone el
// almacenamiento (60 MB en chat-media-storage). No tiene sentido bajar algo que no vamos a poder
// guardar: se corta antes para no gastar memoria del servidor.
const MAX_MEDIA_BYTES = 60 * 1024 * 1024;

export type OfficialApiMediaType = "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "STICKER";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

/**
 * Saca el id del archivo de un mensaje YA GUARDADO, buscándolo dentro del webhook completo que
 * quedó en rawPayload.
 *
 * Sirve para recuperar las fotos viejas: los mensajes que entraron antes de que existiera la
 * descarga quedaron sin archivo, pero el identificador de Meta siempre estuvo ahí guardado.
 */
export function extractMediaRefFromRawPayload(
  rawPayload: unknown,
  externalMessageId: string,
): { mediaId: string; mediaType: OfficialApiMediaType } | null {
  const root = asRecord(rawPayload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(asRecord(entry)?.changes) ? (asRecord(entry)!.changes as unknown[]) : [];

    for (const change of changes) {
      const value = asRecord(asRecord(change)?.value);
      // Mensajes del cliente y ecos de la app del celular guardan la media igual.
      const lists = [value?.messages, value?.message_echoes].filter(Array.isArray) as unknown[][];

      for (const list of lists) {
        for (const item of list) {
          const message = asRecord(item);
          if (!message || String(message.id ?? "").trim() !== externalMessageId) {
            continue;
          }

          const candidates: Array<[string, OfficialApiMediaType]> = [
            ["image", "IMAGE"],
            ["video", "VIDEO"],
            ["document", "DOCUMENT"],
            ["audio", "AUDIO"],
            ["sticker", "STICKER"],
          ];

          for (const [key, mediaType] of candidates) {
            const mediaId = String(asRecord(message[key])?.id ?? "").trim();
            if (mediaId) {
              return { mediaId, mediaType };
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Baja un media entrante de la API oficial y lo deja guardado en /uploads.
 *
 * Cloud API NO manda el archivo en el webhook: manda un `id`. Para tenerlo hay que hacer dos
 * pasos, los DOS con el token:
 *   1. GET /{media_id}  -> devuelve una URL temporal (y el mime_type)
 *   2. GET esa URL       -> devuelve el binario (la URL NO es pública: sin el token da 401)
 *
 * Devuelve la ruta persistida (/uploads/chat-media/...) o null si algo falla. Nunca lanza: un
 * media que no se pudo bajar no puede tumbar el webhook ni perder el mensaje.
 */
export async function downloadOfficialApiMedia(input: {
  mediaId: string;
  accessToken: string;
  mediaType: OfficialApiMediaType;
}): Promise<{ mediaUrl: string; mimeType: string | null } | null> {
  const mediaId = input.mediaId?.trim();
  const accessToken = input.accessToken?.trim();

  if (!mediaId || !accessToken) {
    return null;
  }

  try {
    // Paso 1: metadatos (URL temporal + mime).
    const metaResponse = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );

    if (!metaResponse.ok) {
      console.error("[OFFICIAL_API] media_metadata_failed", {
        mediaId,
        status: metaResponse.status,
        detail: (await metaResponse.text().catch(() => "")).slice(0, 200),
      });
      return null;
    }

    const metadata = (await metaResponse.json().catch(() => null)) as
      | { url?: string; mime_type?: string; file_size?: number }
      | null;

    const downloadUrl = metadata?.url?.trim();
    if (!downloadUrl) {
      return null;
    }

    if (typeof metadata?.file_size === "number" && metadata.file_size > MAX_MEDIA_BYTES) {
      console.error("[OFFICIAL_API] media_too_large", { mediaId, fileSize: metadata.file_size });
      return null;
    }

    // Paso 2: el binario. La URL de lookaside exige el mismo token.
    const fileResponse = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!fileResponse.ok) {
      console.error("[OFFICIAL_API] media_download_failed", { mediaId, status: fileResponse.status });
      return null;
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_MEDIA_BYTES) {
      return null;
    }

    const mimeType =
      metadata?.mime_type?.split(";")[0]?.trim() ||
      fileResponse.headers.get("content-type")?.split(";")[0]?.trim() ||
      null;

    const persisted = await persistChatMediaFromDataUrl({
      dataUrl: `data:${mimeType || "application/octet-stream"};base64,${buffer.toString("base64")}`,
      mediaType: input.mediaType,
    });

    if (!persisted) {
      return null;
    }

    return { mediaUrl: persisted, mimeType };
  } catch (error) {
    console.error("[OFFICIAL_API] media_download_error", { mediaId, error });
    return null;
  }
}
