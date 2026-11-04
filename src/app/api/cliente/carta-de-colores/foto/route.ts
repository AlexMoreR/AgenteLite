import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { RUTA_PUBLICA_FOTOS } from "@/lib/imagen-de-carta-de-colores";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

/*
  Sube la foto de un color de la carta (parte 2 de «Carta de colores digital dentro del CRM»).
  Mismo permiso que cambiar la carta: dueño, administradores y supervisoras. Solo JPG o PNG de hasta 3 MB;
  el tipo se revisa por los primeros bytes del archivo, no solo por lo que dice el navegador.
*/

const MAXIMO_BYTES = 3 * 1024 * 1024;
const TIPOS_PERMITIDOS = new Set(["image/jpeg", "image/jpg", "image/png"]);

function extensionPorContenido(datos: Buffer): ".jpg" | ".png" | null {
  if (datos.length >= 3 && datos[0] === 0xff && datos[1] === 0xd8 && datos[2] === 0xff) return ".jpg";
  if (
    datos.length >= 8 &&
    datos.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return ".png";
  }
  return null;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !(await puedeSupervisar(access))) {
    return NextResponse.json(
      { ok: false, error: "Solo el dueño, los administradores y las supervisoras pueden cambiar la carta." },
      { status: 403 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file") ?? formData?.get("foto");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No llegó ninguna foto." }, { status: 400 });
  }
  if (!TIPOS_PERMITIDOS.has(file.type)) {
    return NextResponse.json({ ok: false, error: "La foto tiene que ser JPG o PNG." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAXIMO_BYTES) {
    return NextResponse.json({ ok: false, error: "La foto puede pesar máximo 3 MB." }, { status: 400 });
  }

  const datos = Buffer.from(await file.arrayBuffer());
  const extension = extensionPorContenido(datos);
  if (!extension) {
    return NextResponse.json({ ok: false, error: "La foto tiene que ser JPG o PNG." }, { status: 400 });
  }

  const carpeta = path.join(process.cwd(), "public", ...RUTA_PUBLICA_FOTOS.split("/").filter(Boolean));
  await mkdir(carpeta, { recursive: true });
  const nombreArchivo = `${randomUUID()}${extension}`;
  await writeFile(path.join(carpeta, nombreArchivo), datos);

  return NextResponse.json({ ok: true, url: `${RUTA_PUBLICA_FOTOS}/${nombreArchivo}` });
}
