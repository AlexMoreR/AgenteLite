import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { diaEnBogota, esDiaValido } from "../dominio/panel";
import type { ResumenDelEmbudo } from "../dominio/relleno";
import { enSegundoPlano } from "./eventos";
import { ejecutarRelleno, type BaseDelRelleno, type ProgresoDelRelleno } from "./relleno-motor";

/**
 * EL RELLENO HISTÓRICO DESDE LA APP (sección "Historia" de /cliente/crm/embudo).
 *
 * El dueño elige línea y fechas y aprieta "Simular" (solo cuenta) o "Guardar historia" (escribe en
 * EmbudoEvento/EmbudoLead). Corre en segundo plano y deja su estado en AppSetting
 * `embudo:relleno:<workspaceId>`: estado, modo, progreso, conteos por tipo, inicio/fin y error.
 * Ese mismo ajuste es el candado: mientras uno está "corriendo" y no venció (30 min desde el último
 * avance) no se puede lanzar otro.
 */

export const claveDelRelleno = (workspaceId: string) => `embudo:relleno:${workspaceId}`;
export const DESDE_POR_DEFECTO = "2026-09-21";
const VENCIMIENTO_MS = 30 * 60_000;

export type ModoDelRelleno = "simular" | "guardar";

export type EstadoDelRelleno = {
  corrida: string;
  estado: "corriendo" | "listo" | "error";
  modo: ModoDelRelleno;
  lineaId: string;
  lineaNombre: string | null;
  desde: string;
  hasta: string;
  procesados: number;
  total: number | null;
  porTipo: Record<string, number>;
  resumen: ResumenDelEmbudo | null;
  insertados: number;
  leadsRecalculados: number;
  inicio: string;
  fin: string | null;
  actualizado: string;
  /** Hasta cuándo vale el candado (se renueva con cada lote). */
  vence: string;
  error: string | null;
  lanzadoPor: string | null;
};

/** La base para el motor, con Prisma. Solo SQL parametrizado ($1, $2...). */
export const baseConPrisma: BaseDelRelleno = {
  leer: (sql, valores) => prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...valores),
  escribir: (sql, valores) => prisma.$executeRawUnsafe(sql, ...valores),
};

function leerEstadoGuardado(valor: string | null | undefined): EstadoDelRelleno | null {
  if (!valor) return null;
  try {
    const estado = JSON.parse(valor) as EstadoDelRelleno;
    return estado && typeof estado === "object" && typeof estado.estado === "string" ? estado : null;
  } catch {
    return null;
  }
}

/**
 * El estado del último relleno del negocio. Si figura "corriendo" pero el candado venció (el
 * servidor se reinició a mitad de camino), se muestra como error: se puede volver a lanzar y, al
 * ser idempotente, retoma sin duplicar.
 */
export async function leerEstadoDelRelleno(workspaceId: string): Promise<EstadoDelRelleno | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDelRelleno(workspaceId) } });
  const estado = leerEstadoGuardado(fila?.value);
  if (estado?.estado === "corriendo" && Date.parse(estado.vence) < Date.now()) {
    return { ...estado, estado: "error", error: "Se interrumpió (¿se reinició el servidor?). Se puede lanzar de nuevo: no duplica nada." };
  }
  return estado;
}

/**
 * Toma el candado: escribe el estado nuevo solo si no hay otro corriendo. Compara y escribe con
 * `updatedAt` para que dos clics al mismo tiempo no lancen dos rellenos.
 */
async function tomarCandado(workspaceId: string, nuevo: EstadoDelRelleno): Promise<boolean> {
  const key = claveDelRelleno(workspaceId);
  const value = JSON.stringify(nuevo);
  const fila = await prisma.appSetting.findUnique({ where: { key } });
  if (!fila) {
    try {
      await prisma.appSetting.create({ data: { key, value } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }
  const actual = leerEstadoGuardado(fila.value);
  if (actual?.estado === "corriendo" && Date.parse(actual.vence) > Date.now()) return false;
  const { count } = await prisma.appSetting.updateMany({ where: { key, updatedAt: fila.updatedAt }, data: { value } });
  return count === 1;
}

/** Guarda el avance, solo si la corrida sigue siendo la dueña del candado. */
async function guardarEstado(workspaceId: string, corrida: string, cambios: Partial<EstadoDelRelleno>): Promise<boolean> {
  const key = claveDelRelleno(workspaceId);
  const fila = await prisma.appSetting.findUnique({ where: { key } });
  const actual = leerEstadoGuardado(fila?.value);
  if (!fila || !actual || actual.corrida !== corrida) return false;
  const ahora = new Date();
  const siguiente: EstadoDelRelleno = {
    ...actual,
    ...cambios,
    actualizado: ahora.toISOString(),
    vence: new Date(ahora.getTime() + VENCIMIENTO_MS).toISOString(),
  };
  await prisma.appSetting.update({ where: { key }, data: { value: JSON.stringify(siguiente) } });
  return true;
}

function deProgreso(progreso: ProgresoDelRelleno): Partial<EstadoDelRelleno> {
  return {
    lineaNombre: progreso.lineaNombre,
    procesados: progreso.procesados,
    total: progreso.total,
    porTipo: { ...progreso.porTipo },
    resumen: { ...progreso.resumen },
    insertados: progreso.insertados,
    leadsRecalculados: progreso.leadsRecalculados,
  };
}

class RellenoReemplazado extends Error {}

/** Las líneas de venta del negocio y cuál va por defecto (la del Agente V3, mejor si es "Ventas 1"). */
export async function lineasParaElRelleno(workspaceId: string) {
  const canales = await prisma.whatsAppChannel.findMany({
    where: { workspaceId, purpose: "SALES" },
    select: { id: true, name: true, metadata: true, isActive: true },
    orderBy: { name: "asc" },
  });
  const conV3 = canales.filter((canal) => (canal.metadata as Record<string, unknown> | null)?.agenteV3 === true);
  const porDefecto =
    conV3.find((canal) => canal.name.trim().toLowerCase() === "ventas 1") ??
    conV3[0] ??
    canales.find((canal) => canal.name.trim().toLowerCase() === "ventas 1") ??
    canales[0] ??
    null;
  return {
    lineas: canales.map((canal) => ({ id: canal.id, nombre: canal.name, agenteV3: conV3.includes(canal), activa: canal.isActive })),
    porDefecto: porDefecto?.id ?? null,
  };
}

/**
 * Lanza el relleno en segundo plano. Devuelve enseguida: { ok } o { error } (datos mal, otro
 * corriendo). Quien llama ya verificó que es el dueño.
 */
export async function lanzarRelleno(input: {
  workspaceId: string;
  userId: string;
  lineaId: string;
  desde: string;
  hasta: string;
  modo: ModoDelRelleno;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const hoy = diaEnBogota(new Date());
  if (!esDiaValido(input.desde) || !esDiaValido(input.hasta)) return { ok: false, error: "Fechas inválidas (AAAA-MM-DD)." };
  if (input.desde > input.hasta) return { ok: false, error: "'Desde' no puede ser después de 'hasta'." };
  if (input.hasta > hoy) return { ok: false, error: "'Hasta' no puede ser después de hoy." };
  if (input.modo !== "simular" && input.modo !== "guardar") return { ok: false, error: "Modo desconocido." };

  const linea = await prisma.whatsAppChannel.findFirst({
    where: { id: input.lineaId, workspaceId: input.workspaceId },
    select: { id: true, name: true },
  });
  if (!linea) return { ok: false, error: "Esa línea no es de este negocio." };

  const ahora = new Date();
  const corrida = `${ahora.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const nuevo: EstadoDelRelleno = {
    corrida,
    estado: "corriendo",
    modo: input.modo,
    lineaId: linea.id,
    lineaNombre: linea.name,
    desde: input.desde,
    hasta: input.hasta,
    procesados: 0,
    total: null,
    porTipo: {},
    resumen: null,
    insertados: 0,
    leadsRecalculados: 0,
    inicio: ahora.toISOString(),
    fin: null,
    actualizado: ahora.toISOString(),
    vence: new Date(ahora.getTime() + VENCIMIENTO_MS).toISOString(),
    error: null,
    lanzadoPor: input.userId,
  };
  if (!(await tomarCandado(input.workspaceId, nuevo))) {
    return { ok: false, error: "Ya hay un relleno corriendo. Espera a que termine." };
  }

  enSegundoPlano(async () => {
    try {
      const final = await ejecutarRelleno(
        baseConPrisma,
        {
          workspaceId: input.workspaceId,
          linea: linea.id,
          desde: input.desde,
          hasta: input.hasta,
          escribir: input.modo === "guardar",
        },
        async (progreso) => {
          if (!(await guardarEstado(input.workspaceId, corrida, deProgreso(progreso)))) {
            throw new RellenoReemplazado("Otro relleno tomó el candado");
          }
        },
      );
      await guardarEstado(input.workspaceId, corrida, { ...deProgreso(final), estado: "listo", fin: new Date().toISOString() });
    } catch (error) {
      if (error instanceof RellenoReemplazado) return;
      console.warn("[embudo] relleno con error", { workspaceId: input.workspaceId, corrida, error: error instanceof Error ? error.message : String(error) });
      await guardarEstado(input.workspaceId, corrida, {
        estado: "error",
        fin: new Date().toISOString(),
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      }).catch(() => {});
    }
  });
  return { ok: true };
}
