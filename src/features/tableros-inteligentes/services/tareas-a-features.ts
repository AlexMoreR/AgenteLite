import type { EstadoTarjeta } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { diaDeBogota } from "./archivadas";
import { TABLERO_DE_FEATURES_ID, TARJETA_AREA_FEATURES_ID } from "./reglas-features";
import { SQL_TAREAS_FUERA_DE_FEATURES } from "./sql-features";

/*
  TAREAS A FEATURES (27-nov-2026, "Toda Tarea nueva cae sola en Features", parte 2). El Coordinador solo toma lo que cuelga de
  Features (T-736). Desde la parte 1 una Tarea nueva sin padre cae sola en Features, pero las que ya estaban aprobadas fuera
  (sueltas o en otra área) nadie las hacía. Una vez al día (fecha de Bogotá) el reloj (/api/cron/follows) las pasa a Features:
  las Tareas APROBADO o PLAN_APROBADO con repo del tablero Empresa Magilus (SQL_TAREAS_FUERA_DE_FEATURES).
  - Solo cambia padreId; el estado, el plan y el orden quedan igual.
  - Cada una por separado y con un update condicional: si alguien la cambió (padre, estado o actualizadoEn) desde que se leyó,
    no se toca y queda para la vuelta siguiente.
  - Historial "mover" firmado por QUIEN_TAREAS_A_FEATURES.
  No manda nada por WhatsApp ni a clientes.

  Interruptor por negocio en AppSetting `tablero:tareas-a-features:<negocio>`: sin la fila está PRENDIDO; con "false" no hace nada.
*/

export const claveDelInterruptorDeTareasAFeatures = (negocioId: string) => `tablero:tareas-a-features:${negocioId}`;
/** La fecha (AAAA-MM-DD de Bogotá) de la última vuelta completa. */
export const claveDeLaUltimaVueltaDeTareasAFeatures = (negocioId: string) => `tablero:tareas-a-features:ultimo-dia:${negocioId}`;
/** Cuántas movió esa última vuelta. */
export const claveDeLasMovidasDeTareasAFeatures = (negocioId: string) => `tablero:tareas-a-features:movidas:${negocioId}`;

/** Quien firma en el historial (no es una persona ni el Coordinador de aizen1). */
export const QUIEN_TAREAS_A_FEATURES = "sistema:tareas-a-features";

/** La nota del historial del movimiento. */
export const NOTA_TAREA_MOVIDA_A_FEATURES = "movida dentro de Features sola: el Coordinador solo toma lo que cuelga de Features";

type Fila = { id: string; padreId: string | null; estado: EstadoTarjeta; actualizadoEn: Date };

async function guardar(clave: string, valor: string) {
  await prisma.appSetting.upsert({ where: { key: clave }, create: { key: clave, value: valor }, update: { value: valor } });
}

/** Mueve UNA tarjeta si sigue como se leyó. true si la movió. */
async function moverUna(fila: Fila, ahora: Date): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const cambio = await tx.tarjetaTablero.updateMany({
      where: {
        id: fila.id,
        padreId: fila.padreId,
        estado: fila.estado,
        actualizadoEn: fila.actualizadoEn,
        borradoEn: null,
        archivadaEn: null,
      },
      data: { padreId: TARJETA_AREA_FEATURES_ID },
    });
    if (cambio.count !== 1) return false;
    await tx.historialTarjeta.create({
      data: {
        tarjetaId: fila.id,
        quien: QUIEN_TAREAS_A_FEATURES,
        origen: "TRABAJADOR",
        accion: "mover",
        antes: { estado: fila.estado, padreId: fila.padreId },
        despues: { estado: fila.estado, padreId: TARJETA_AREA_FEATURES_ID, nota: NOTA_TAREA_MOVIDA_A_FEATURES },
      },
    });
    await tx.tableroInteligente.updateMany({ where: { id: TABLERO_DE_FEATURES_ID }, data: { actualizadoEn: ahora } });
    return true;
  });
}

/**
 * La vuelta del reloj, una vez al día por fecha de Bogotá (la marca queda en AppSetting, como archivarLasTerminadas). Sin el
 * tablero de Features, o con el interruptor apagado, no hace nada. Una tarjeta que falla no corta a las demás.
 */
export async function moverTareasAFeatures(ahora: Date = new Date()): Promise<{ movidas: number }> {
  const tablero = await prisma.tableroInteligente.findUnique({ where: { id: TABLERO_DE_FEATURES_ID }, select: { workspaceId: true } });
  if (!tablero) return { movidas: 0 };
  const negocioId = tablero.workspaceId;
  const dia = diaDeBogota(ahora);
  const [interruptor, ultimo] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: claveDelInterruptorDeTareasAFeatures(negocioId) }, select: { value: true } }),
    prisma.appSetting.findUnique({ where: { key: claveDeLaUltimaVueltaDeTareasAFeatures(negocioId) }, select: { value: true } }),
  ]);
  if (interruptor?.value === "false") return { movidas: 0 };
  if (ultimo?.value === dia) return { movidas: 0 };

  const filas = await prisma.$queryRawUnsafe<Fila[]>(SQL_TAREAS_FUERA_DE_FEATURES, TARJETA_AREA_FEATURES_ID, TABLERO_DE_FEATURES_ID, negocioId);
  let movidas = 0;
  for (const fila of filas) {
    try {
      if (await moverUna(fila, ahora)) movidas += 1;
    } catch (error) {
      console.error("[tareas-a-features] no se pudo mover la tarjeta", fila.id, error instanceof Error ? error.message : String(error));
    }
  }

  await guardar(claveDeLasMovidasDeTareasAFeatures(negocioId), String(movidas));
  await guardar(claveDeLaUltimaVueltaDeTareasAFeatures(negocioId), dia);
  return { movidas };
}

/** Lo que dice la automatización en que_es_esta_aplicacion: prendida o no, la última vuelta y cuántas movió. */
export async function estadoDeTareasAFeatures(): Promise<string> {
  const tablero = await prisma.tableroInteligente.findUnique({ where: { id: TABLERO_DE_FEATURES_ID }, select: { workspaceId: true } });
  if (!tablero) return "sin el tablero de Features (Empresa Magilus) en esta base: no hace nada";
  const negocioId = tablero.workspaceId;
  const [interruptor, ultimo, movidas] = await Promise.all(
    [claveDelInterruptorDeTareasAFeatures, claveDeLaUltimaVueltaDeTareasAFeatures, claveDeLasMovidasDeTareasAFeatures].map((clave) =>
      prisma.appSetting.findUnique({ where: { key: clave(negocioId) }, select: { value: true } }),
    ),
  );
  const prendida = interruptor?.value !== "false";
  const vuelta = ultimo?.value ? `última vuelta: ${ultimo.value}, movió ${movidas?.value ?? "0"}` : "última vuelta: todavía ninguna";
  return `${prendida ? "prendida" : `apagada (${claveDelInterruptorDeTareasAFeatures(negocioId)}=false)`}: una vez al día pasa a Features (T-736) las Tareas APROBADO/PLAN_APROBADO con repo del tablero Empresa Magilus que quedaron fuera, sin cambiarles el estado; ${vuelta}`;
}
