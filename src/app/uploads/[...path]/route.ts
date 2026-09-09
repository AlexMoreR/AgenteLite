import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";

/*
  De que tipo es cada archivo.

  Estaban solo las imagenes, y todo lo demas salia como "application/octet-stream", que para un
  navegador significa "no se que es esto, bajalo". De ahi que un PDF se descargara en vez de
  abrirse: no era la burbuja del chat, era esta lista. Lo mismo valia para los audios y los
  videos que manda un cliente.
*/
const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  // Audios: los de WhatsApp son .oga/.ogg; los que se graban desde la app, .webm o .m4a.
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".3gp": "video/3gpp",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

function getContentType(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function resolveUploadPath(segments: string[]): string | null {
  if (segments.length === 0) {
    return null;
  }

  const uploadsRoot = path.join(process.cwd(), "public", "uploads");
  const candidate = path.resolve(uploadsRoot, ...segments);

  if (!candidate.startsWith(uploadsRoot)) {
    return null;
  }

  return candidate;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path: rawSegments } = await context.params;
  const filePath = resolveUploadPath(rawSegments);

  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(filePath);
    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": getContentType(filePath),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
