import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ESTADOS_PARA_ENTRAR, esIdentidadDeInvitado, identidadDeUsuario } from "@/features/reuniones/estados";
import { crearPaseDeEntrada, crearSala, leerConfigLivekit } from "@/features/reuniones/servicios/livekit";
import { identidadFirmada, leerIdentidadFirmada, secretoDeLosLinks } from "@/features/reuniones/servicios/link-firmado";
import { puedeTerminarLaReunion } from "@/features/reuniones/servicios/permisos";

export const dynamic = "force-dynamic";

/*
  EL PASE DE ENTRADA a una reunión (lo pide la página pública /reunion/<código>).

  Lo firma el servidor del CRM y dura 10 minutos; el secreto de LiveKit nunca sale de acá.
  - Quien tiene sesión entra con su nombre (identidad u_<userId>).
  - Un invitado escribe su nombre; su identidad i_<azar> la guarda su navegador, así si se cae y
    vuelve es la misma persona.
  La sala se crea al pedir el primer pase (y espera 10 minutos vacía antes de cerrarse).
*/

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const config = leerConfigLivekit();
  if (!config) {
    return NextResponse.json({ ok: false, error: "Las reuniones todavía no están configuradas en el servidor." }, { status: 503, headers: SIN_CACHE });
  }

  const datos = (await request.json().catch(() => null)) as { codigo?: unknown; nombre?: unknown; identidad?: unknown } | null;
  const codigo = typeof datos?.codigo === "string" ? datos.codigo.trim() : "";
  if (!codigo || codigo.length > 100) {
    return NextResponse.json({ ok: false, error: "Link no válido." }, { status: 400, headers: SIN_CACHE });
  }

  const reunion = await prisma.reunion.findUnique({
    where: { codigo },
    select: { id: true, sala: true, estado: true, origen: true, workspaceId: true, creadaPorId: true },
  });
  if (!reunion || reunion.origen !== "VIVO") {
    return NextResponse.json({ ok: false, error: "Esta reunión no existe." }, { status: 404, headers: SIN_CACHE });
  }
  if (!ESTADOS_PARA_ENTRAR.includes(reunion.estado)) {
    return NextResponse.json({ ok: false, error: "Esta reunión ya terminó." }, { status: 410, headers: SIN_CACHE });
  }

  const session = await auth();
  const secreto = secretoDeLosLinks();
  let identidad: string;
  let nombre: string;
  if (session?.user?.id) {
    identidad = identidadDeUsuario(session.user.id);
    nombre = session.user.name?.trim() || session.user.email?.split("@")[0] || "Alguien";
  } else {
    nombre = typeof datos?.nombre === "string" ? datos.nombre.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (nombre.length < 2) {
      return NextResponse.json({ ok: false, error: "Escribe tu nombre para entrar." }, { status: 400, headers: SIN_CACHE });
    }
    // Solo se reusa una identidad que este servidor firmó: nadie entra como otro invitado.
    const pedida = typeof datos?.identidad === "string" && secreto ? leerIdentidadFirmada(datos.identidad, secreto) : null;
    identidad = pedida && esIdentidadDeInvitado(pedida) ? pedida : `i_${randomBytes(12).toString("base64url")}`;
  }

  try {
    await crearSala(config, reunion.sala);
  } catch (error) {
    console.error("[reuniones] no se pudo crear la sala", reunion.sala, error);
    return NextResponse.json({ ok: false, error: "No se pudo abrir la sala de video. Intenta de nuevo en un momento." }, { status: 502, headers: SIN_CACHE });
  }

  const pase = crearPaseDeEntrada(config, { sala: reunion.sala, identidad, nombre });
  const puedeTerminar = session?.user?.id ? await puedeTerminarLaReunion(session.user.id, reunion) : false;

  // `recuerdo`: la identidad firmada que el navegador del invitado guarda para volver a entrar.
  const recuerdo = !session?.user?.id && secreto ? identidadFirmada(identidad, secreto) : null;
  return NextResponse.json({ ok: true, url: config.url, pase, identidad, recuerdo, nombre, puedeTerminar }, { headers: SIN_CACHE });
}
