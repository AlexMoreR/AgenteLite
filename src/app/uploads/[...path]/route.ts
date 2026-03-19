import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";

const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
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
