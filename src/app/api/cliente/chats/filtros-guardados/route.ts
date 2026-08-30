import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Los filtros que cada quien se guarda en la bandeja.
 *
 * Un filtro guardado es, literalmente, UNA VISTA: la direccion con la que quedo la bandeja. Se
 * guarda asi —el texto de los parametros y nada mas— y no como una lista de campos, para que
 * cualquier filtro que agreguemos despues quede guardado tambien sin tocar esto.
 *
 * Vive en AppSetting con la persona en la clave. No lleva tabla propia porque son cuatro renglones
 * por asesora: una migracion en la base de PRODUCCION es un riesgo que esto no justifica.
 *
 * Son de cada persona: la forma de trabajar de Ingrid no tiene por que aparecerle a las demas.
 */
export const dynamic = "force-dynamic";

type FiltroGuardado = { id: string; nombre: string; query: string };

/** Cuantos se le dejan guardar. Pasado eso deja de ser un atajo y es otra lista para buscar. */
const MAXIMO = 12;
const LARGO_DEL_NOMBRE = 40;

function claveDe(userId: string) {
  return `chats:filtros:${userId}`;
}

async function leerGuardados(userId: string): Promise<FiltroGuardado[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDe(userId) } });
  if (!fila?.value) {
    return [];
  }
  try {
    const datos = JSON.parse(fila.value);
    if (!Array.isArray(datos)) {
      return [];
    }
    return datos.filter(
      (item): item is FiltroGuardado =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.nombre === "string" &&
        typeof item.query === "string",
    );
  } catch {
    // Un valor ilegible no puede dejar la bandeja sin abrir: se empieza de cero.
    return [];
  }
}

async function guardar(userId: string, filtros: FiltroGuardado[]) {
  const value = JSON.stringify(filtros);
  await prisma.appSetting.upsert({
    where: { key: claveDe(userId) },
    create: { key: claveDe(userId), value },
    update: { value },
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, filtros: [] }, { status: 401 });
  }
  return NextResponse.json({ ok: true, filtros: await leerGuardados(session.user.id) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const cuerpo = (await request.json().catch(() => null)) as
    | { nombre?: unknown; query?: unknown }
    | null;
  const nombre = typeof cuerpo?.nombre === "string" ? cuerpo.nombre.trim().slice(0, LARGO_DEL_NOMBRE) : "";
  const query = typeof cuerpo?.query === "string" ? cuerpo.query.trim() : "";

  if (!nombre) {
    return NextResponse.json({ ok: false, error: "Ponele un nombre" }, { status: 400 });
  }

  const guardados = await leerGuardados(session.user.id);
  if (guardados.length >= MAXIMO) {
    return NextResponse.json(
      { ok: false, error: `Ya tenes ${MAXIMO} filtros guardados. Borra alguno para agregar otro.` },
      { status: 400 },
    );
  }

  // Guardar dos veces el mismo nombre deja una lista donde no se sabe cual es cual: se pisa.
  const sinElRepetido = guardados.filter(
    (filtro) => filtro.nombre.toLowerCase() !== nombre.toLowerCase(),
  );
  const nuevo: FiltroGuardado = {
    id: `f${Date.now().toString(36)}`,
    nombre,
    query,
  };
  const actualizados = [...sinElRepetido, nuevo];
  await guardar(session.user.id, actualizados);

  return NextResponse.json({ ok: true, filtros: actualizados });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  const guardados = await leerGuardados(session.user.id);
  const actualizados = guardados.filter((filtro) => filtro.id !== id);
  await guardar(session.user.id, actualizados);

  return NextResponse.json({ ok: true, filtros: actualizados });
}
