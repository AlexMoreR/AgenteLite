import { prisma } from "@/lib/prisma";
import { METAS_POR_DEFECTO_NOV_2026, type MetasDelMes } from "@/features/metas/dominio/calculo";
import {
  claveDeMetas,
  cruzarConMiembros,
  esMesValido,
  leerMetasDeTexto,
  mesAnterior,
  type MiembroDelNegocio,
} from "@/features/metas/dominio/metas-guardadas";

/**
 * Metas del mes guardadas en `AppSetting` (`metas-ventas:<workspaceId>:<AAAA-MM>`), igual que las demás banderas
 * del negocio (ver `src/lib/sincronizacion-gestion.ts`). Sin migración: es una fila de texto con el JSON.
 *
 * Si algo falla (la base no responde, el JSON está dañado) las funciones devuelven `null`: la pantalla dice que no
 * se pudo y nada se rompe.
 */

export { claveDeMetas, mesActualBogota } from "@/features/metas/dominio/metas-guardadas";

export async function leerMetasDelMes(workspaceId: string, mes: string): Promise<MetasDelMes | null> {
  if (!esMesValido(mes)) return null;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveDeMetas(workspaceId, mes) } });
    return leerMetasDeTexto(fila?.value);
  } catch {
    return null;
  }
}

/** Los miembros activos del negocio, con el nombre que se muestra en el CRM. */
export async function miembrosDelNegocio(workspaceId: string): Promise<MiembroDelNegocio[] | null> {
  try {
    const miembros = await prisma.workspaceMember.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { userId: true, user: { select: { name: true, email: true } } },
    });
    return miembros.map((miembro) => ({
      userId: miembro.userId,
      nombre: miembro.user.name?.trim() || miembro.user.email,
    }));
  } catch {
    return null;
  }
}

export type OrigenDeLasMetas = "guardadas" | "mes-anterior" | "por-defecto";

export type MetasParaFormulario = {
  metas: MetasDelMes;
  origen: OrigenDeLasMetas;
  miembros: MiembroDelNegocio[];
};

/**
 * Lo que se muestra en el formulario: las del mes si ya se guardaron; si no, las del mes anterior; si tampoco,
 * las de noviembre de 2026, con el userId puesto a las asesoras cuyo nombre coincide con un miembro del negocio.
 * Mostrar las del mes anterior no las guarda: el mes queda vacío hasta que el dueño da "Guardar".
 */
export async function metasParaFormulario(workspaceId: string, mes: string): Promise<MetasParaFormulario | null> {
  if (!esMesValido(mes)) return null;
  try {
    const miembros = await miembrosDelNegocio(workspaceId);
    if (!miembros) return null;
    // Una fila dañada se lee como "sin metas" y se ofrece la anterior para volver a guardarla bien.
    const delMes = await leerMetasDelMes(workspaceId, mes);
    if (delMes) return { metas: delMes, origen: "guardadas", miembros };
    const anteriores = await leerMetasDelMes(workspaceId, mesAnterior(mes));
    if (anteriores) return { metas: cruzarConMiembros(anteriores, miembros), origen: "mes-anterior", miembros };
    return { metas: cruzarConMiembros(METAS_POR_DEFECTO_NOV_2026, miembros), origen: "por-defecto", miembros };
  } catch {
    return null;
  }
}

/** Guarda (crea o reemplaza) las metas del mes. Devuelve `null` si no se pudo. */
export async function guardarMetasDelMes(
  workspaceId: string,
  mes: string,
  metas: MetasDelMes,
): Promise<MetasDelMes | null> {
  if (!esMesValido(mes)) return null;
  try {
    const key = claveDeMetas(workspaceId, mes);
    const value = JSON.stringify(metas);
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return metas;
  } catch {
    return null;
  }
}
