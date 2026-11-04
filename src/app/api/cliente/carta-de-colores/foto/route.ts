import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { CARPETA_FOTOS_DE_COLORES } from "@/lib/imagen-de-carta-de-colores";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

/*
  Sube la foto de un color de la carta (parte 2 de «Carta de colores digital dentro del CRM»).
  Mismo permiso que cambiar la carta: dueño, administrador o supervisora. Solo JPG o PNG de hasta 3 MB.
  El tipo se comprueba por los primeros bytes del archivo, no solo por lo que dice el navegador.
*/

const TAMANO_MAXIMO = 3 * 1024 * 1024;

function extensionPorContenido(bytes: Buffer): ".jpg" | ".png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return ".png";
  }
  return null;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !(await puedeSupervisar(access))) {
    return NextResponse.json(
      { ok: false, error: "Solo el dueño, un administrador o una supervisora pueden cambiar la carta de colores." },
      { status: 403 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No llegó ninguna foto." }, { status: 400 });
  }
  if (file.type !== "image/jpeg" && file.type !== "image/png") {
    return NextResponse.json({ ok: false, error: "La foto tiene que ser JPG o PNG." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > TAMANO_MAXIMO) {
    return NextResponse.json({ ok: false, error: "La foto puede pesar máximo 3 MB." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = extensionPorContenido(bytes);
  if (!extension) {
    return NextResponse.json({ ok: false, error: "La foto tiene que ser JPG o PNG." }, { status: 400 });
  }

  const carpeta = path.join(process.cwd(), "public", "uploads", ...CARPETA_FOTOS_DE_COLORES.split("/"));
  await mkdir(carpeta, { recursive: true });
  const archivo = `${randomUUID()}${extension}`;
  await writeFile(path.join(carpeta, archivo), bytes);

  return NextResponse.json({ ok: true, url: `/uploads/${CARPETA_FOTOS_DE_COLORES}/${archivo}` });
}
