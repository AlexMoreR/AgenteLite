/**
 * Respuestas rápidas por asesora (pedido del dueño, 9-nov-2026): cada respuesta rápida es de una asesora.
 *
 * - La asesora ve, usa, crea, edita y borra SOLO las suyas. Lo que mande como dueña o como filtro se ignora.
 * - El dueño y los administradores (`esJefeDelNegocio`) ven todas, filtran por asesora o por "Sin repartir",
 *   crean una copia para cada asesora marcada y pueden cambiar la dueña al editar.
 * - "Sin repartir" = `duenaId` vacío: las respuestas que existían antes de este cambio (el sistema nunca
 *   guardó quién las creó). Solo las ven el dueño y los administradores, que las reparten.
 *
 * Todas las consultas a `QuickReply` del CRM pasan por aquí. La base llega como parámetro para poder probar
 * las reglas con una base falsa (src/lib/respuestas-rapidas.test.ts).
 */
import type { PrismaClient } from "@prisma/client";
import { esJefeDelNegocio, type AccesoDelCrm } from "@/lib/permisos-del-crm";

export type DbRespuestasRapidas = Pick<PrismaClient, "quickReply" | "workspaceMember" | "user">;

/** Quién pide: sale de `requireClientWorkspaceAccess("chats")`, nunca del formulario. */
export type QuienPide = AccesoDelCrm & { userId: string; workspaceId: string };

/** Filtro del jefe: todas, solo las "Sin repartir" o el id de una asesora. */
export const FILTRO_TODAS = "todas";
export const FILTRO_SIN_REPARTIR = "sin_repartir";

export type RespuestaRapida = {
  id: string;
  title: string;
  content: string;
  duenaId: string | null;
  duenaNombre: string | null;
};

/** Asesora del filtro y de las casillas. `activa: false` = retirada que aún tiene respuestas. */
export type AsesoraDeRespuestas = { id: string; nombre: string; activa: boolean };

export type ListaDeRespuestas = {
  items: RespuestaRapida[];
  esJefe: boolean;
  /** Solo para el jefe; a la asesora le llega vacía. */
  asesoras: AsesoraDeRespuestas[];
};

export type DatosDeRespuesta = { title: string; content: string };

const nombreDe = (user: { name: string | null; email: string } | null | undefined) =>
  user?.name?.trim() || user?.email || "Sin nombre";

/** Quita vacíos y repetidos. */
function idsLimpios(ids: unknown[] | undefined): string[] {
  const salida: string[] = [];
  for (const id of ids ?? []) {
    if (typeof id !== "string") continue;
    const limpio = id.trim();
    if (limpio && !salida.includes(limpio)) salida.push(limpio);
  }
  return salida;
}

/** Las que de verdad pueden ser dueñas: miembros ACTIVOS de este mismo negocio. */
async function duenasValidas(db: DbRespuestasRapidas, workspaceId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const filas = await db.workspaceMember.findMany({
    where: { workspaceId, isActive: true, userId: { in: ids } },
    select: { userId: true },
  });
  return new Set(filas.map((fila) => fila.userId));
}

/**
 * Asesoras del filtro y de las casillas: las activas del negocio y las retiradas (miembro inactivo o que
 * ya no está en el negocio) que aún tengan respuestas, para que el dueño las vea y las pase a otra.
 */
async function asesorasDelNegocio(db: DbRespuestasRapidas, workspaceId: string): Promise<AsesoraDeRespuestas[]> {
  const [miembros, conRespuestas] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true, isActive: true, user: { select: { name: true, email: true } } },
    }),
    db.quickReply.findMany({
      where: { workspaceId, duenaId: { not: null } },
      select: { duenaId: true },
      distinct: ["duenaId"],
    }),
  ]);
  const idsConRespuestas = new Set(conRespuestas.map((fila) => fila.duenaId).filter((id): id is string => Boolean(id)));

  const salida: AsesoraDeRespuestas[] = [];
  for (const miembro of miembros) {
    if (miembro.isActive || idsConRespuestas.has(miembro.userId)) {
      salida.push({ id: miembro.userId, nombre: nombreDe(miembro.user), activa: miembro.isActive });
    }
  }
  const faltan = [...idsConRespuestas].filter((id) => !salida.some((asesora) => asesora.id === id));
  if (faltan.length) {
    const usuarios = await db.user.findMany({ where: { id: { in: faltan } }, select: { id: true, name: true, email: true } });
    for (const usuario of usuarios) salida.push({ id: usuario.id, nombre: nombreDe(usuario), activa: false });
  }
  return salida.sort((a, b) => Number(b.activa) - Number(a.activa) || a.nombre.localeCompare(b.nombre, "es"));
}

/** Lista para la ventana del chat. La asesora recibe solo las suyas, pida el filtro que pida. */
export async function listarRespuestasRapidas(
  db: DbRespuestasRapidas,
  quien: QuienPide,
  filtro?: string | null,
): Promise<ListaDeRespuestas> {
  const esJefe = esJefeDelNegocio(quien);
  const select = { id: true, title: true, content: true, duenaId: true } as const;

  if (!esJefe) {
    const filas = await db.quickReply.findMany({
      where: { workspaceId: quien.workspaceId, duenaId: quien.userId },
      orderBy: { createdAt: "asc" },
      select,
    });
    return { items: filas.map((fila) => ({ ...fila, duenaNombre: null })), esJefe, asesoras: [] };
  }

  const pedido = filtro?.trim() || FILTRO_TODAS;
  const duenaId = pedido === FILTRO_TODAS ? undefined : pedido === FILTRO_SIN_REPARTIR ? null : pedido;
  const [filas, asesoras] = await Promise.all([
    db.quickReply.findMany({
      where: { workspaceId: quien.workspaceId, ...(duenaId === undefined ? {} : { duenaId }) },
      orderBy: { createdAt: "asc" },
      select,
    }),
    asesorasDelNegocio(db, quien.workspaceId),
  ]);
  const nombres = new Map(asesoras.map((asesora) => [asesora.id, asesora.nombre]));
  return {
    items: filas.map((fila) => ({ ...fila, duenaNombre: fila.duenaId ? nombres.get(fila.duenaId) ?? "Sin nombre" : null })),
    esJefe,
    asesoras,
  };
}

/**
 * Crea la respuesta. La asesora siempre la crea para ella (se ignora lo que mande). El jefe marca una o
 * varias asesoras activas del negocio y se crea una copia para cada una, todas o ninguna.
 */
export async function crearRespuestasRapidas(
  db: DbRespuestasRapidas,
  quien: QuienPide,
  datos: DatosDeRespuesta,
  duenaIdsPedidas?: unknown[],
): Promise<{ error?: string; creadas?: number }> {
  if (!esJefeDelNegocio(quien)) {
    await db.quickReply.createMany({
      data: [{ workspaceId: quien.workspaceId, duenaId: quien.userId, title: datos.title, content: datos.content }],
    });
    return { creadas: 1 };
  }

  const ids = idsLimpios(duenaIdsPedidas);
  if (!ids.length) return { error: "Marca al menos una asesora." };
  const validas = await duenasValidas(db, quien.workspaceId, ids);
  if (ids.some((id) => !validas.has(id))) return { error: "Una de las asesoras marcadas no está activa en el negocio." };

  // Un solo INSERT: se guardan todas o ninguna.
  await db.quickReply.createMany({
    data: ids.map((duenaId) => ({ workspaceId: quien.workspaceId, duenaId, title: datos.title, content: datos.content })),
  });
  return { creadas: ids.length };
}

/** Busca una respuesta que quien pide puede tocar: del negocio y, si es asesora, suya. */
async function respuestaPropia(db: DbRespuestasRapidas, quien: QuienPide, id: string) {
  const fila = await db.quickReply.findFirst({
    where: { id, workspaceId: quien.workspaceId },
    select: { id: true, duenaId: true },
  });
  if (!fila) return null;
  if (!esJefeDelNegocio(quien) && fila.duenaId !== quien.userId) return null;
  return fila;
}

/**
 * Edita título y mensaje. Solo el jefe cambia la dueña, y solo a una asesora activa del negocio. Si la dueña
 * que llega es la misma que ya tiene (también una retirada o "Sin repartir", que llega como ""), no se toca.
 */
export async function editarRespuestaRapida(
  db: DbRespuestasRapidas,
  quien: QuienPide,
  id: string,
  datos: DatosDeRespuesta,
  duenaIdPedida?: string | null,
): Promise<{ error?: string; success?: boolean }> {
  const fila = await respuestaPropia(db, quien, id);
  if (!fila) return { error: "Respuesta rápida no encontrada" };

  const data: { title: string; content: string; duenaId?: string } = { title: datos.title, content: datos.content };
  if (esJefeDelNegocio(quien) && typeof duenaIdPedida === "string") {
    const nueva = duenaIdPedida.trim();
    if (nueva !== (fila.duenaId ?? "")) {
      if (!nueva) return { error: "Elige a qué asesora le queda la respuesta." };
      const validas = await duenasValidas(db, quien.workspaceId, [nueva]);
      if (!validas.has(nueva)) return { error: "Esa asesora no está activa en el negocio." };
      data.duenaId = nueva;
    }
  }

  await db.quickReply.update({ where: { id: fila.id }, data });
  return { success: true };
}

/** Borra la respuesta si quien pide la puede tocar. */
export async function borrarRespuestaRapida(
  db: DbRespuestasRapidas,
  quien: QuienPide,
  id: string,
): Promise<{ error?: string; success?: boolean }> {
  const fila = await respuestaPropia(db, quien, id);
  if (!fila) return { error: "Respuesta rápida no encontrada" };
  await db.quickReply.delete({ where: { id: fila.id } });
  return { success: true };
}
