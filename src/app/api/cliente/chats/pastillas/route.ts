import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { limpiarPreferencia } from "@/features/chats/domain/orden-de-las-pastillas";
import {
  guardarPreferenciaDePastillas,
  leerListasGuardadas,
  leerPreferenciaDePastillas,
} from "@/features/chats/services/pastillas-de-la-persona";

/**
 * El orden y las pastillas ocultas de la fila de la bandeja, de CADA persona (AppSetting
 * `chats:pastillas:<userId>`). Lo que acomoda el dueño no cambia la bandeja de las asesoras.
 *
 * Lo que llega se limpia contra las listas de quien guarda: solo fijas conocidas y SUS listas.
 * Una clave de otra persona, inventada o repetida se descarta sin error.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const listas = await leerListasGuardadas(session.user.id);
  const pastillas = await leerPreferenciaDePastillas(
    session.user.id,
    listas.map((lista) => lista.id),
  );
  return NextResponse.json({ ok: true, pastillas });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const cuerpo = (await request.json().catch(() => null)) as unknown;
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    return NextResponse.json({ ok: false, error: "No se entendió el orden" }, { status: 400 });
  }

  const listas = await leerListasGuardadas(session.user.id);
  const pastillas = limpiarPreferencia(
    cuerpo,
    listas.map((lista) => lista.id),
  );
  await guardarPreferenciaDePastillas(session.user.id, pastillas);
  return NextResponse.json({ ok: true, pastillas });
}
