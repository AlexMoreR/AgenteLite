import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as ReadableStreamWeb } from "node:stream/web";
import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import {
  TOPE_SUBIDA_BYTES,
  carpetaDeReuniones,
  extensionDeAudio,
  rutaDeArchivo,
} from "@/features/reuniones/servicios/archivos-de-reuniones";
import { puedeVerReuniones } from "@/features/reuniones/servicios/permisos";

export const dynamic = "force-dynamic";

/*
  "SUBIR AUDIO": una reunión hecha por fuera (m4a, mp3, wav, ogg, webm; hasta 500 MB) entra a la
  misma cola de transcripción y acta. En estos audios no se separa quién habló.

  El archivo llega como cuerpo del pedido (no como formulario) y se escribe al disco por partes:
  así un audio de 500 MB no se carga entero en la memoria del servidor. Va a la carpeta privada de
  reuniones, nunca a /uploads.

  POST /api/reuniones/subir?titulo=...&archivo=<nombre original>
*/

class Demasiado extends Error {}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Inicia sesión." }, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!puedeVerReuniones(access)) {
    return NextResponse.json({ ok: false, error: "No tienes el módulo Reuniones." }, { status: 403 });
  }

  const parametros = new URL(request.url).searchParams;
  const nombreOriginal = parametros.get("archivo")?.trim() ?? "";
  const extension = extensionDeAudio(nombreOriginal);
  if (!extension) {
    return NextResponse.json({ ok: false, error: "Sube un audio m4a, mp3, wav, ogg o webm." }, { status: 400 });
  }
  const declarado = Number(request.headers.get("content-length") ?? 0);
  if (declarado > TOPE_SUBIDA_BYTES) {
    return NextResponse.json({ ok: false, error: "El audio pasa de 500 MB." }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ ok: false, error: "No llegó ningún archivo." }, { status: 400 });
  }

  const titulo =
    parametros.get("titulo")?.replace(/\s+/g, " ").trim().slice(0, 120) ||
    path.basename(nombreOriginal, path.extname(nombreOriginal)).slice(0, 120) ||
    "Audio subido";
  const relativa = `subidas/${Date.now()}-${randomBytes(8).toString("hex")}.${extension}`;
  const destino = rutaDeArchivo(relativa);

  let bytes = 0;
  try {
    await mkdir(path.dirname(destino), { recursive: true });
    const contador = new Transform({
      transform(pedazo: Buffer, _codificacion, listo) {
        bytes += pedazo.length;
        if (bytes > TOPE_SUBIDA_BYTES) {
          listo(new Demasiado());
          return;
        }
        listo(null, pedazo);
      },
    });
    await pipeline(Readable.fromWeb(request.body as unknown as ReadableStreamWeb<Uint8Array>), contador, createWriteStream(destino));
  } catch (error) {
    await rm(destino, { force: true });
    if (error instanceof Demasiado) {
      return NextResponse.json({ ok: false, error: "El audio pasa de 500 MB." }, { status: 413 });
    }
    console.error("[reuniones] no se pudo guardar el audio", carpetaDeReuniones(), error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar el audio." }, { status: 500 });
  }
  if (!bytes) {
    await rm(destino, { force: true });
    return NextResponse.json({ ok: false, error: "El archivo está vacío." }, { status: 400 });
  }

  const ahora = new Date();
  const reunion = await prisma.reunion.create({
    data: {
      workspaceId: access.workspaceId,
      creadaPorId: access.userId,
      titulo,
      codigo: randomBytes(18).toString("base64url"),
      sala: `subida_${randomBytes(9).toString("hex")}`,
      origen: "SUBIDA",
      estado: "EN_COLA",
      empezoEn: ahora,
      terminoEn: ahora,
      pistas: { create: { archivo: relativa, bytes, empiezaEn: ahora, terminaEn: ahora, estado: "LISTA" } },
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: reunion.id });
}
