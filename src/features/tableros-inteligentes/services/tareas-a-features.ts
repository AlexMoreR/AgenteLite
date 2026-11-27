import { prisma } from "@/lib/prisma";
import { diaDeBogota } from "./archivadas";
import { TABLERO_DE_FEATURES_ID, TARJETA_AREA_FEATURES_ID } from "./reglas-features";
import { SQL_TAREAS_FUERA_DE_FEATURES } from "./sql-features";

/*
  TAREAS APROBADAS FUERA DE FEATURES (27-nov-2026, parte 2 de "Tablero IA: toda Tarea nueva cae sola en Features si nadie le
  pone padre"). El Coordinador solo toma lo que cuelga de Features (T-736). Una vez al día (fecha de Bogotá), en el reloj
  (/api/cron/follows, con candado), las Tareas del tablero Empresa Magilus en APROBADO o PLAN_APROBADO, con repo, sin borrar
  ni archivar, que quedaron fuera de Features (sueltas o en otra área) pasan a colgar de Features.

  - Solo cambia padreId: el estado, el plan y el orden quedan igual.
  - Cada tarjeta va por separado y condicionada: solo si sigue con el padre, el estado y el actualizadoEn que se leyeron.
    Si alguien la tocó mientras tanto, no se mueve (la vuelta del día siguiente la vuelve a mirar).
  - Queda en el historial como "mover", con quien = QUIEN_MUEVE_A_FEATURES.
  - PARA APAGARLA: AppSetting `tablero:tareas-a-features:<negocio>` = "false". Sin esa fila está prendida.
  Prueba: npm run test:tareas-a-features.
*/

/** Quién queda en el historial cuando la revisión diaria mueve una Tarea a Features. */
export const QUIEN_MUEVE_A_FEATURES = "sistema:tareas-a-features";
/** La nota del historial del movimiento. */
export const NOTA_TAREA_MOVIDA_A_FEATURES = "movida dentro de Features: era una Tarea aprobada que el Coordinador no iba a tomar";

/** El interruptor: "false" la apaga; sin fila (o cualquier otro valor) está prendida. */
export const claveDeTareasAFeatures = (workspaceId: string) => `tablero:tareas-a-features:${workspaceId}`;
/** El día de Bogotá (AAAA-MM-DD) de la última vuelta: "ya corrió hoy". */
export const claveDelUltimoDia = (workspaceId: string) => `tablero:tareas-a-features:ultimo-dia:${workspaceId}`;
/** Cuántas movió la última vuelta (texto con un entero). */
export const claveDeMovidas = (workspaceId: string) => `tablero:tareas-a-features:movidas:${workspaceId}`;

/** ¿Está prendida? Solo el texto "false" (sin espacios ni mayúsculas) la apaga. */
export function tareasAFeaturesPrendida(valor: string | null | undefined): boolean {
  return (valor ?? "").trim().toLowerCase() !== "false";
}

type FueraDeFeatures = { id: string; padreId: string | null; estado: string; actualizadoEn: Date };

async function ajuste(clave: string) {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave }, select: { value: true } });
  return fila?.value ?? null;
}

async function guardarAjuste(clave: string, valor: string) {
  await prisma.appSetting.upsert({ where: { key: clave }, create: { key: clave, value: valor }, update: { value: valor } });
}

/**
 * Mueve UNA tarjeta a Features, condicionada a que nadie la haya tocado desde que se leyó, y lo anota en el historial.
 * Nunca lanza: si falla lo anota en el registro y devuelve false (la vuelta del día siguiente la vuelve a mirar).
 */
async function moverUna(tarjeta: FueraDeFeatures): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const cambio = await tx.tarjetaTablero.updateMany({
        where: {
          id: tarjeta.id,
          padreId: tarjeta.padreId,
          estado: tarjeta.estado as "APROBADO" | "PLAN_APROBADO",
          actualizadoEn: tarjeta.actualizadoEn,
          borradoEn: null,
          archivadaEn: null,
        },
        data: { padreId: TARJETA_AREA_FEATURES_ID },
      });
      if (cambio.count !== 1) return false;
      await tx.historialTarjeta.create({
        data: {
          tarjetaId: tarjeta.id,
          quien: QUIEN_MUEVE_A_FEATURES,
          origen: "TRABAJADOR",
          accion: "mover",
          antes: { estado: tarjeta.estado, padreId: tarjeta.padreId },
          despues: { estado: tarjeta.estado, padreId: TARJETA_AREA_FEATURES_ID, nota: NOTA_TAREA_MOVIDA_A_FEATURES },
        },
        select: { id: true },
      });
      return true;
    });
  } catch (error) {
    console.error("[tareas-a-features] no se pudo mover", {
      tarjetaId: tarjeta.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * La revisión diaria: pasa a Features las Tareas aprobadas que quedaron fuera. Una vez al día por fecha de Bogotá; apagada
 * con `tablero:tareas-a-features:<negocio>` = "false". Si la consulta falla, lanza (el reloj lo anota) y no pone la marca
 * del día: la vuelta siguiente lo intenta otra vez.
 */
export async function moverTareasAFeatures(ahora: Date = new Date()): Promise<{ movidas: number }> {
  const tablero = await prisma.tableroInteligente.findUnique({ where: { id: TABLERO_DE_FEATURES_ID }, select: { workspaceId: true } });
  if (!tablero) return { movidas: 0 };
  const negocio = tablero.workspaceId;
  if (!tareasAFeaturesPrendida(await ajuste(claveDeTareasAFeatures(negocio)))) return { movidas: 0 };
  const dia = diaDeBogota(ahora);
  if ((await ajuste(claveDelUltimoDia(negocio))) === dia) return { movidas: 0 };

  const fuera = await prisma.$queryRawUnsafe<FueraDeFeatures[]>(
    SQL_TAREAS_FUERA_DE_FEATURES,
    TARJETA_AREA_FEATURES_ID,
    TABLERO_DE_FEATURES_ID,
    negocio,
  );
  let movidas = 0;
  for (const tarjeta of fuera) {
    if (await moverUna(tarjeta)) movidas += 1;
  }
  if (movidas > 0) {
    await prisma.tableroInteligente.updateMany({ where: { id: TABLERO_DE_FEATURES_ID }, data: { actualizadoEn: ahora } });
  }
  await guardarAjuste(claveDelUltimoDia(negocio), dia);
  await guardarAjuste(claveDeMovidas(negocio), String(movidas));
  return { movidas };
}

/** Lo que dice la automatización `tareas_a_features_tablero` en que_es_esta_aplicacion. Si la base falla, lanza. */
export async function estadoDeTareasAFeatures(workspaceId: string): Promise<string> {
  const [interruptor, ultimoDia, movidas] = await Promise.all([
    ajuste(claveDeTareasAFeatures(workspaceId)),
    ajuste(claveDelUltimoDia(workspaceId)),
    ajuste(claveDeMovidas(workspaceId)),
  ]);
  const vuelta = ultimoDia ? `última vuelta: ${ultimoDia} (movió ${movidas ?? "0"})` : "última vuelta: todavía ninguna";
  return tareasAFeaturesPrendida(interruptor)
    ? `prendida: una vez al día pasa a Features (T-736) las Tareas APROBADO/PLAN_APROBADO con repo que quedaron fuera; ${vuelta}`
    : `apagada (${claveDeTareasAFeatures("<negocio>")} = false); ${vuelta}`;
}
