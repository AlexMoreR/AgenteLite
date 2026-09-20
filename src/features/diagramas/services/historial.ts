import { prisma } from "@/lib/prisma";

/**
 * El historial de un diagrama: fotos de cómo estaba el mapa en distintos momentos.
 *
 * Va en AppSetting y no en una tabla nueva a propósito: la base de producción se toca a mano y una
 * migración por una función chica no se paga sola. Cada diagrama tiene su propia fila, así que
 * abrir un mapa NO carga su historial; solo se lee cuando alguien pide verlo.
 *
 * Se guarda una foto cada RATO_ENTRE_VERSIONES y se conservan las últimas MAXIMO_DE_VERSIONES: un
 * mapa mental se toca de a ratos largos, y una foto por cada tecla llenaría la fila de basura sin
 * dar ningún punto útil al que volver.
 */

const MAXIMO_DE_VERSIONES = 20;
const RATO_ENTRE_VERSIONES_MS = 3 * 60 * 1000;
/** Tope por fila. Pasado esto se tiran las más viejas: el historial no puede crecer sin fin. */
const TOPE_DE_LA_FILA = 4_000_000;

export type VersionDeDiagrama = {
  id: string;
  /** ISO. */
  at: string;
  autor: string;
  /** Cuántas cajas tenía, para reconocer la versión sin abrirla. */
  cajas: number;
  data: unknown;
};

export type VersionEnLaLista = Omit<VersionDeDiagrama, "data">;

function clave(diagramId: string) {
  return `diagrama:historial:${diagramId}`;
}

function contarCajas(data: unknown): number {
  const nodos = (data as { nodes?: unknown[] } | null)?.nodes;
  return Array.isArray(nodos) ? nodos.length : 0;
}

export async function leerHistorial(diagramId: string): Promise<VersionDeDiagrama[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave(diagramId) } });
  if (!fila?.value) {
    return [];
  }
  try {
    const guardado = JSON.parse(fila.value) as unknown;
    return Array.isArray(guardado) ? (guardado as VersionDeDiagrama[]) : [];
  } catch {
    return [];
  }
}

/**
 * Anota una versión nueva, si corresponde.
 *
 * `forzar` la guarda sin mirar el reloj: se usa antes de restaurar, para que lo que hay ahora no se
 * pierda al volver atrás.
 */
export async function anotarVersion(input: {
  diagramId: string;
  data: unknown;
  autor: string;
  forzar?: boolean;
}): Promise<void> {
  const historial = await leerHistorial(input.diagramId);
  const ultima = historial[0];
  if (!input.forzar && ultima && Date.now() - new Date(ultima.at).getTime() < RATO_ENTRE_VERSIONES_MS) {
    return;
  }

  const version: VersionDeDiagrama = {
    id: `v-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    at: new Date().toISOString(),
    autor: input.autor,
    cajas: contarCajas(input.data),
    data: input.data ?? null,
  };

  let siguiente = [version, ...historial].slice(0, MAXIMO_DE_VERSIONES);
  let value = JSON.stringify(siguiente);
  while (value.length > TOPE_DE_LA_FILA && siguiente.length > 1) {
    siguiente = siguiente.slice(0, siguiente.length - 1);
    value = JSON.stringify(siguiente);
  }

  await prisma.appSetting.upsert({
    where: { key: clave(input.diagramId) },
    create: { key: clave(input.diagramId), value },
    update: { value },
  });
}

export async function borrarHistorial(diagramId: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: clave(diagramId) } });
}
