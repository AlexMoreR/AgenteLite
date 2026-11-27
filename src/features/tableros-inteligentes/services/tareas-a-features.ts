import type { EstadoTarjeta } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diaDeBogota } from "./archivadas";
import { TABLERO_DE_FEATURES_ID, TARJETA_AREA_FEATURES_ID } from "./reglas-features";
import { SQL_TAREAS_FUERA_DE_FEATURES } from "./sql-features";

/*
  TAREAS A FEATURES (27-nov-2026, parte 2 de «Tablero IA: toda Tarea nueva cae sola en Features si nadie le pone padre»).

  El Coordinador solo toma lo que cuelga de Features (T-736). Desde la parte 1, una Tarea nueva sin padre cae sola en Features;
  esta revisión recoge las que quedaron FUERA antes (sueltas o en otra área): una vez al día (por fecha de Bogotá), en el reloj
  (api/cron/follows, con candado), las Tareas del tablero de Features en APROBADO o PLAN_APROBADO, con repo, sin borrar ni
  archivar y fuera de Features pasan a colgar de Features. Solo cambia `padreId`: estado, plan y orden quedan igual.

  - Cada tarjeta se mueve sola, con un cambio condicional: solo si sigue con el mismo padre, estado y fecha de cambio que
    cuando se leyó. Si alguien la tocó en el medio, esa no se mueve (y la de mañana la vuelve a mirar).
  - En el historial queda la acción "mover" con quien = "sistema:tareas-a-features", con la misma forma del movimiento a
    Features del arranque del Coordinador (trabajador.ts): antes { estado, padreId }, después { estado, padreId, nota }.
  - PARA APAGARLA: AppSetting `tablero:tareas-a-features:<negocio>` = "false". Sin esa fila está prendida.
  - Lo que hizo (último día y cuántas movió) queda en AppSetting y lo muestra que_es_esta_aplicacion (tareas_a_features_tablero).
  Prueba: npm run test:tareas-a-features.
*/

export const PREFIJO_TAREAS_A_FEATURES = "tablero:tareas-a-features";
/** El interruptor: "false" la apaga; sin fila, prendida. */
export const claveTareasAFeatures = (workspaceId: string) => `${PREFIJO_TAREAS_A_FEATURES}:${workspaceId}`;
/** El día de Bogotá (AAAA-MM-DD) de la última vuelta: "ya corrió hoy". */
export const claveUltimoDiaTareasAFeatures = (workspaceId: string) => `${PREFIJO_TAREAS_A_FEATURES}:ultimo-dia:${workspaceId}`;
/** Cuántas movió la última vuelta (texto con un entero). */
export const claveMovidasTareasAFeatures = (workspaceId: string) => `${PREFIJO_TAREAS_A_FEATURES}:movidas:${workspaceId}`;

/** Quién queda en el historial cuando mueve esta revisión. */
export const QUIEN_MUEVE_A_FEATURES = "sistema:tareas-a-features";
/** La nota del historial de cada movimiento. */
export const NOTA_TAREA_MOVIDA_A_FEATURES = "movida dentro de Features sola: era una Tarea aprobada que estaba fuera";

/** ¿Prendida? Solo el texto "false" (sin espacios ni mayúsculas) la apaga. */
export const tareasAFeaturesPrendida = (valor: string | null | undefined) => (valor ?? "").trim().toLowerCase() !== "false";

type FilaFuera = { id: string; padreId: string | null; estado: EstadoTarjeta; actualizadoEn: Date };

async function ajuste(clave: string) {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave }, select: { value: true } });
  return fila?.value ?? null;
}

async function guardarAjuste(clave: string, valor: string) {
  await prisma.appSetting.upsert({ where: { key: clave }, create: { key: clave, value: valor }, update: { value: valor } });
}

/** Mueve UNA tarjeta a Features si nadie la cambió desde que se leyó. true si la movió. */
async function moverUna(fila: FilaFuera, ahora: Date): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
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
    if (hecho.count !== 1) return false;
    await tx.historialTarjeta.create({
      data: {
        tarjetaId: fila.id,
        quien: QUIEN_MUEVE_A_FEATURES,
        origen: "TRABAJADOR",
        accion: "mover",
        antes: { estado: fila.estado, padreId: fila.padreId },
        despues: { estado: fila.estado, padreId: TARJETA_AREA_FEATURES_ID, nota: NOTA_TAREA_MOVIDA_A_FEATURES },
      },
      select: { id: true },
    });
    await tx.tableroInteligente.updateMany({ where: { id: TABLERO_DE_FEATURES_ID }, data: { actualizadoEn: ahora } });
    return true;
  });
}

/**
 * Una vez al día (por fecha de Bogotá): pasa a Features las Tareas aprobadas con repo que quedaron fuera. Nunca lanza por una
 * tarjeta: la que falla se anota en el registro y se vuelve a mirar al día siguiente.
 */
export async function moverTareasAFeatures(ahora: Date = new Date()): Promise<{ movidas: number }> {
  const tablero = await prisma.tableroInteligente.findUnique({ where: { id: TABLERO_DE_FEATURES_ID }, select: { workspaceId: true } });
  if (!tablero) return { movidas: 0 };
  const negocio = tablero.workspaceId;
  if (!tareasAFeaturesPrendida(await ajuste(claveTareasAFeatures(negocio)))) return { movidas: 0 };
  const dia = diaDeBogota(ahora);
  if ((await ajuste(claveUltimoDiaTareasAFeatures(negocio))) === dia) return { movidas: 0 };

  const filas = await prisma.$queryRawUnsafe<FilaFuera[]>(SQL_TAREAS_FUERA_DE_FEATURES, TARJETA_AREA_FEATURES_ID, TABLERO_DE_FEATURES_ID, negocio);
  let movidas = 0;
  for (const fila of filas) {
    try {
      if (await moverUna(fila, ahora)) movidas += 1;
    } catch (error) {
      console.error("[tareas-a-features] no se pudo mover a Features", {
        tarjetaId: fila.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await guardarAjuste(claveUltimoDiaTareasAFeatures(negocio), dia);
  await guardarAjuste(claveMovidasTareasAFeatures(negocio), String(movidas));
  return { movidas };
}

/** Lo que dice la automatización en que_es_esta_aplicacion (tareas_a_features_tablero). */
export async function estadoDeTareasAFeatures(workspaceId: string): Promise<string> {
  const [interruptor, ultimo, cuantas] = await Promise.all([
    ajuste(claveTareasAFeatures(workspaceId)),
    ajuste(claveUltimoDiaTareasAFeatures(workspaceId)),
    ajuste(claveMovidasTareasAFeatures(workspaceId)),
  ]);
  const vuelta = ultimo ? `última vuelta: ${ultimo}, movió ${cuantas ?? "0"}` : "última vuelta: todavía ninguna";
  return tareasAFeaturesPrendida(interruptor)
    ? `PRENDIDA: una vez al día pasa a Features (T-736) las Tareas APROBADO o PLAN_APROBADO con repo que quedaron fuera, sin cambiarles el estado; ${vuelta}`
    : `APAGADA (${claveTareasAFeatures("<negocio>")} = false); ${vuelta}`;
}
