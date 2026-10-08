import { prisma } from "@/lib/prisma";
import {
  alActivarAMano,
  alLatir,
  alPausarAMano,
  estaRecibiendo,
  finMedido,
  MARGEN_DE_MEDICION_MS,
  PAUSA_SOLA_SIN_ABRIR_MS,
  pausaManualVigente,
  type PeriodoCerrado,
  type Presencia,
} from "@/lib/en-linea-reglas";

/**
 * "RECIBIENDO CLIENTES" contra la base. Las reglas están en `en-linea-reglas.ts`.
 *
 * Carga (regla de Alex: no subir la carga del servidor de forma notable): no hay pedidos nuevos
 * desde la app; se aprovecha el latido que ya existía (cada 4 min con la app visible). En el caso
 * normal —sigue recibiendo— el latido hace UN `UPDATE` por clave primaria y nada más. Solo al
 * cambiar de estado (entra, se vence, pausa) se lee la fila y se escribe el periodo cerrado.
 */

export type EstadoEnLinea = { recibiendo: boolean; pausaManual: boolean };

type Clave = { workspaceId: string; userId: string };

async function leerPresencia(clave: Clave): Promise<Presencia | null> {
  return prisma.presenciaEnLinea.findUnique({
    where: { workspaceId_userId: clave },
    select: { ultimoLatido: true, enLineaDesde: true, pausaManualEn: true },
  });
}

/**
 * Escribe el nuevo estado solo si nadie lo cambió entre la lectura y esta escritura (el celular y
 * el PC pueden latir a la vez): así un periodo no se registra dos veces.
 */
async function guardarTransicion(
  clave: Clave,
  anterior: Presencia | null,
  cambio: { presencia: Presencia; cerrar: PeriodoCerrado | null },
): Promise<boolean> {
  if (anterior) {
    const escrito = await prisma.presenciaEnLinea.updateMany({
      where: { ...clave, ultimoLatido: anterior.ultimoLatido },
      data: cambio.presencia,
    });
    if (escrito.count === 0) {
      return false;
    }
  } else {
    try {
      await prisma.presenciaEnLinea.create({ data: { ...clave, ...cambio.presencia } });
    } catch {
      return false;
    }
  }
  if (cambio.cerrar && cambio.cerrar.fin > cambio.cerrar.inicio) {
    await prisma.periodoEnLinea.create({ data: { ...clave, ...cambio.cerrar } });
  }
  return true;
}

function estadoDe(presencia: Presencia | null, ahora: Date): EstadoEnLinea {
  return { recibiendo: estaRecibiendo(presencia, ahora), pausaManual: pausaManualVigente(presencia, ahora) };
}

/** El latido de la app. Nunca lanza: si falla, devuelve null y el latido sigue como siempre. */
export async function latirEnLinea(clave: Clave, ahora = new Date()): Promise<EstadoEnLinea | null> {
  try {
    // Camino normal: ya estaba recibiendo, sin pausa y latió hace poco (el tramo medido sigue).
    // Un UPDATE por clave primaria. Si volvió tras tener el celular bloqueado, va por la transición
    // para cerrar el tramo medido (ver alLatir).
    const seguido = await prisma.presenciaEnLinea.updateMany({
      where: {
        ...clave,
        pausaManualEn: null,
        enLineaDesde: { not: null },
        ultimoLatido: { gte: new Date(ahora.getTime() - MARGEN_DE_MEDICION_MS) },
      },
      data: { ultimoLatido: ahora },
    });
    if (seguido.count === 1) {
      return { recibiendo: true, pausaManual: false };
    }

    const anterior = await leerPresencia(clave);
    const cambio = alLatir(anterior, ahora);
    await guardarTransicion(clave, anterior, cambio);
    return estadoDe(cambio.presencia, ahora);
  } catch (error) {
    console.warn("[en-linea] latido fallo", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** El interruptor de la barra: ella elige Recibiendo o Pausada. */
export async function cambiarRecibiendo(clave: Clave, recibiendo: boolean, ahora = new Date()): Promise<EstadoEnLinea> {
  for (let intento = 0; intento < 3; intento += 1) {
    const anterior = await leerPresencia(clave);
    const cambio = recibiendo ? alActivarAMano(anterior, ahora) : alPausarAMano(anterior, ahora);
    if (await guardarTransicion(clave, anterior, cambio)) {
      return estadoDe(cambio.presencia, ahora);
    }
  }
  return estadoDe(await leerPresencia(clave), ahora);
}

export async function leerEstadoEnLinea(clave: Clave, ahora = new Date()): Promise<EstadoEnLinea> {
  return estadoDe(await leerPresencia(clave), ahora);
}

/** De una lista de personas, las que están recibiendo ahora. Una sola consulta. */
export async function filtrarEnLinea(workspaceId: string, userIds: string[], ahora = new Date()): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }
  const filas = await prisma.presenciaEnLinea.findMany({
    where: {
      workspaceId,
      userId: { in: userIds },
      enLineaDesde: { not: null },
      ultimoLatido: { gte: new Date(ahora.getTime() - PAUSA_SOLA_SIN_ABRIR_MS) },
    },
    select: { userId: true, ultimoLatido: true, enLineaDesde: true, pausaManualEn: true },
  });
  return new Set(filas.filter((fila) => estaRecibiendo(fila, ahora)).map((fila) => fila.userId));
}

/**
 * Periodos en línea por persona que tocan [desde, hasta), incluido el tramo que sigue abierto
 * (medido hasta su último latido + margen, aunque para el reparto siga en línea hasta 2 h).
 */
export async function periodosEnLinea(
  workspaceId: string,
  desde: Date,
  hasta: Date,
  ahora = new Date(),
): Promise<Map<string, PeriodoCerrado[]>> {
  const [cerrados, abiertos] = await Promise.all([
    prisma.periodoEnLinea.findMany({
      where: { workspaceId, fin: { gt: desde }, inicio: { lt: hasta } },
      select: { userId: true, inicio: true, fin: true },
    }),
    prisma.presenciaEnLinea.findMany({
      where: { workspaceId, enLineaDesde: { not: null, lt: hasta } },
      select: { userId: true, ultimoLatido: true, enLineaDesde: true, pausaManualEn: true },
    }),
  ]);
  const salida = new Map<string, PeriodoCerrado[]>();
  const sumar = (userId: string, periodo: PeriodoCerrado) => {
    salida.set(userId, [...(salida.get(userId) ?? []), periodo]);
  };
  for (const fila of cerrados) {
    sumar(fila.userId, { inicio: fila.inicio, fin: fila.fin });
  }
  for (const fila of abiertos) {
    if (fila.enLineaDesde) {
      sumar(fila.userId, {
        inicio: fila.enLineaDesde,
        fin: finMedido(fila, ahora),
      });
    }
  }
  return salida;
}

/* La asesora de respaldo: a quién va el cliente nuevo si nadie está recibiendo. Por negocio. */

const claveDeRespaldo = (workspaceId: string) => `equipo:asesora-de-respaldo:${workspaceId}`;

export async function leerAsesoraDeRespaldo(workspaceId: string): Promise<string | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDeRespaldo(workspaceId) } });
  const valor = fila?.value?.trim();
  return valor ? valor : null;
}

export async function guardarAsesoraDeRespaldo(workspaceId: string, userId: string | null): Promise<void> {
  const key = claveDeRespaldo(workspaceId);
  if (!userId) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: userId }, update: { value: userId } });
}
