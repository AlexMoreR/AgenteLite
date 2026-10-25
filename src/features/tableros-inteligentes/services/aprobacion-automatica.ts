import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { porQueElPlanEsperaTuSi, porQueNoSeApruebaSola } from "./reglas-riesgo";

/*
  APROBACIÓN AUTOMÁTICA del Tablero IA (22-oct-2026, decisión de Alexander: "las cosas básicas que
  ayudan al negocio y no tienen riesgo, hágalas sin pedirme permiso").

  Una tarjeta con repo y riesgo BAJO (reglas-riesgo.ts) se aprueba sola, con el interruptor prendido:
  - la TAREA (POR_APROBAR -> APROBADO), acá;
  - el PLAN (PLAN_LISTO -> PLAN_APROBADO), en trabajador.ts, cuando el trabajador entrega un plan que
    sigue siendo BAJO.
  Cada aprobación deja su fila en el historial ("aprobado automáticamente por regla de bajo riesgo", el
  momento y el motivo). La revisión de riesgo se repite al aprobar: si el texto de la tarjeta cambió y
  ahora calza con algo de riesgo alto, no se aprueba sola.

  REGLA DEL DUEÑO (24-oct-2026, por voz: "si ya construyó un plan, ¿por qué tiene que esperarme?"): aprobada la
  TAREA, el plan también pasa solo a construir, con cualquier riesgo. Las tarjetas con zona protegida no
  entran: su plan se aprueba en la pantalla (así lo exige /tomar) y siguen pidiendo el sí final. ÚNICA excepción: el plan toca dinero de Gestión o puede subir presupuesto, activar
  campañas o crear gasto en Meta Ads (porQueElPlanEsperaTuSi, en reglas-riesgo.ts): queda PLAN_LISTO con su
  motivo. Tiene su propio interruptor ("Aprobar planes solo", prendido sin fila). La vuelta del reloj
  (aprobarPlanesListosQueEsperan) pasa a construir las PLAN_LISTO que esperaban y no caen en la excepción.

  El interruptor es POR NEGOCIO y vive en AppSetting (sin migración). Sin la fila, está PRENDIDO.
*/

/** Prefijo de `HistorialTarjeta.quien` en las aprobaciones automáticas (no es una persona ni el Coordinador). */
export const QUIEN_AUTOMATICO = "sistema:aprobacion-automatica";
export const NOMBRE_AUTOMATICO = "Aprobación automática";
export const TEXTO_AUTOMATICO = "aprobado automáticamente por regla de bajo riesgo";

export const TEXTO_PLAN_SOLO = "plan aprobado automáticamente (regla del dueño 24-oct)";

export const claveDelInterruptor = (workspaceId: string) => `tablero:aprobacion-automatica:${workspaceId}`;
export const claveDelInterruptorDePlanes = (workspaceId: string) => `tablero:planes-solos:${workspaceId}`;

type Db = Prisma.TransactionClient | typeof prisma;

/** ¿Está prendida la aprobación automática de este negocio? Sin ajuste guardado, sí. */
export async function aprobacionAutomaticaPrendida(workspaceId: string, db: Db = prisma): Promise<boolean> {
  const fila = await db.appSetting.findUnique({ where: { key: claveDelInterruptor(workspaceId) }, select: { value: true } });
  return fila?.value !== "false";
}

/** ¿Está prendido "Aprobar planes solo" (regla del dueño 24-oct)? Sin ajuste guardado, sí. */
export async function aprobarPlanesSoloPrendido(workspaceId: string, db: Db = prisma): Promise<boolean> {
  const fila = await db.appSetting.findUnique({ where: { key: claveDelInterruptorDePlanes(workspaceId) }, select: { value: true } });
  return fila?.value !== "false";
}

export async function ponerAprobarPlanesSolo(workspaceId: string, prendida: boolean) {
  const key = claveDelInterruptorDePlanes(workspaceId);
  const value = prendida ? "true" : "false";
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function ponerAprobacionAutomatica(workspaceId: string, prendida: boolean) {
  const key = claveDelInterruptor(workspaceId);
  const value = prendida ? "true" : "false";
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Lo que queda en `HistorialTarjeta.despues` de una aprobación automática (misma forma que una de la pantalla). */
export function registroDeAprobacionAutomatica(datos: {
  estado: "APROBADO" | "PLAN_APROBADO";
  momento: "tarea" | "plan";
  motivo: string;
  /** "dueno-24-oct": el plan se aprobó por la regla del dueño (no por el riesgo BAJO). */
  regla?: "dueno-24-oct";
}) {
  if (datos.regla) {
    return {
      estado: datos.estado,
      momento: datos.momento,
      via: "automatica",
      quienNombre: NOMBRE_AUTOMATICO,
      userId: QUIEN_AUTOMATICO,
      textoConfirmacion: TEXTO_PLAN_SOLO,
      como: TEXTO_PLAN_SOLO,
      automatica: true,
      regla: datos.regla,
      motivo: datos.motivo,
    };
  }
  return {
    estado: datos.estado,
    momento: datos.momento,
    via: "automatica",
    quienNombre: NOMBRE_AUTOMATICO,
    userId: QUIEN_AUTOMATICO,
    textoConfirmacion: `${TEXTO_AUTOMATICO} (${datos.motivo})`,
    como: TEXTO_AUTOMATICO,
    automatica: true,
    motivo: datos.motivo,
  };
}

/** El motivo que se anota: el que dio quien puso el riesgo, o uno general. */
export function motivoDeLaAprobacionAutomatica(riesgoMotivo: string | null | undefined) {
  return riesgoMotivo?.trim() || "sin zona protegida, sin dinero, permisos ni mensajes a clientes, y sin migración destructiva";
}

/** Anota la aprobación automática dentro de una transacción (la usa también trabajador.ts con el plan). */
export async function anotarAprobacionAutomatica(
  tx: Prisma.TransactionClient,
  tarjetaId: string,
  antes: { estado: string },
  registro: ReturnType<typeof registroDeAprobacionAutomatica>,
) {
  await tx.historialTarjeta.create({
    data: {
      tarjetaId,
      quien: QUIEN_AUTOMATICO,
      origen: "TRABAJADOR",
      accion: "aprobar",
      antes: antes as Prisma.InputJsonValue,
      despues: registro as unknown as Prisma.InputJsonValue,
    },
  });
}

export type ResultadoDeAprobarSola = { aprobada: true; motivo: string } | { aprobada: false; porQue: string };

/**
 * Si la tarea está POR_APROBAR y cumple todo, la pasa a APROBADO por la regla de bajo riesgo. No lanza:
 * dice si la aprobó y, si no, por qué (para el aviso de Claude).
 */
export async function aprobarSolaLaTarea(tarjetaId: string): Promise<ResultadoDeAprobarSola> {
  const tarjeta = await prisma.tarjetaTablero.findFirst({
    where: { id: tarjetaId, borradoEn: null },
    select: {
      id: true,
      tableroId: true,
      titulo: true,
      detalle: true,
      estado: true,
      repo: true,
      zonaProtegida: true,
      riesgo: true,
      riesgoMotivo: true,
      actualizadoEn: true,
      tipoId: true,
      tipo: { select: { requiereAprobacion: true, usaEstados: true } },
      tablero: { select: { workspaceId: true } },
    },
  });
  if (!tarjeta) return { aprobada: false, porQue: "la tarjeta no existe" };
  if (tarjeta.estado !== "POR_APROBAR") return { aprobada: false, porQue: `está ${tarjeta.estado}, no POR_APROBAR` };
  if (!tarjeta.tipo.requiereAprobacion || !tarjeta.tipo.usaEstados) return { aprobada: false, porQue: "su tipo no pide aprobación" };
  const prendido = await aprobacionAutomaticaPrendida(tarjeta.tablero.workspaceId);
  const porQue = porQueNoSeApruebaSola({
    titulo: tarjeta.titulo,
    detalle: tarjeta.detalle,
    repo: tarjeta.repo,
    zonaProtegida: tarjeta.zonaProtegida,
    riesgo: tarjeta.riesgo,
    prendido,
  });
  if (porQue) return { aprobada: false, porQue };

  const motivo = motivoDeLaAprobacionAutomatica(tarjeta.riesgoMotivo);
  const registro = registroDeAprobacionAutomatica({ estado: "APROBADO", momento: "tarea", motivo });
  return prisma.$transaction(async (tx) => {
    // Condicionado a lo que se leyó: si alguien la editó un instante antes, no se aprueba lo que no se revisó.
    const hecho = await tx.tarjetaTablero.updateMany({
      where: {
        id: tarjeta.id,
        estado: "POR_APROBAR",
        actualizadoEn: tarjeta.actualizadoEn,
        tipoId: tarjeta.tipoId,
        repo: tarjeta.repo,
        riesgo: "BAJO",
        zonaProtegida: { isEmpty: true },
        borradoEn: null,
      },
      data: { estado: "APROBADO", trabajoVenceEn: null },
    });
    if (hecho.count !== 1) return { aprobada: false as const, porQue: "la tarjeta cambió mientras tanto" };
    await anotarAprobacionAutomatica(tx, tarjeta.id, { estado: "POR_APROBAR" }, registro);
    await tx.tableroInteligente.update({ where: { id: tarjeta.tableroId }, data: { actualizadoEn: new Date() } });
    return { aprobada: true as const, motivo };
  });
}

/**
 * La vuelta del reloj: aprueba las tareas BAJO que quedaron POR_APROBAR (por ejemplo, las que esperaban
 * con el interruptor apagado y se prendió) sin hacer nada si está apagado en su negocio. Devuelve cuántas.
 */
export async function aprobarSolasLasPendientes(limite = 25): Promise<number> {
  const pendientes = await prisma.tarjetaTablero.findMany({
    where: { estado: "POR_APROBAR", riesgo: "BAJO", repo: { not: null }, borradoEn: null },
    orderBy: { actualizadoEn: "asc" },
    take: limite,
    select: { id: true, tablero: { select: { workspaceId: true } } },
  });
  // Con el interruptor apagado no se hace nada más que leerlo (una vez por negocio).
  const prendidos = new Map<string, boolean>();
  let aprobadas = 0;
  for (const { id, tablero } of pendientes) {
    if (!prendidos.has(tablero.workspaceId)) prendidos.set(tablero.workspaceId, await aprobacionAutomaticaPrendida(tablero.workspaceId));
    if (!prendidos.get(tablero.workspaceId)) continue;
    try {
      const resultado = await aprobarSolaLaTarea(id);
      if (resultado.aprobada) aprobadas += 1;
    } catch (error) {
      console.error("[aprobacion-automatica] no se pudo aprobar sola", id, error);
    }
  }
  return aprobadas;
}

/**
 * La vuelta del reloj de la regla del dueño (24-oct): pasa a PLAN_APROBADO las tarjetas que esperaban en
 * PLAN_LISTO y cuyo plan no cae en la excepción de dinero / Meta Ads. No toca las que están en ERROR ni
 * hace nada en un negocio con "Aprobar planes solo" apagado. Devuelve cuántas pasó.
 */
export async function aprobarPlanesListosQueEsperan(limite = 100): Promise<number> {
  const esperando = await prisma.tarjetaTablero.findMany({
    // Sin zona protegida: el plan de esas se aprueba en la pantalla (así lo exige /tomar).
    where: { estado: "PLAN_LISTO", repo: { not: null }, plan: { not: null }, zonaProtegida: { isEmpty: true }, borradoEn: null },
    orderBy: { actualizadoEn: "asc" },
    take: limite,
    select: { id: true, tableroId: true, plan: true, actualizadoEn: true, tablero: { select: { workspaceId: true } } },
  });
  const prendidos = new Map<string, boolean>();
  let aprobadas = 0;
  for (const tarjeta of esperando) {
    const { workspaceId } = tarjeta.tablero;
    try {
      if (!prendidos.has(workspaceId)) prendidos.set(workspaceId, await aprobarPlanesSoloPrendido(workspaceId));
      if (!prendidos.get(workspaceId) || !tarjeta.plan || porQueElPlanEsperaTuSi(tarjeta.plan)) continue;
      const registro = registroDeAprobacionAutomatica({
        estado: "PLAN_APROBADO",
        momento: "plan",
        motivo: "el plan no toca dinero de Gestión ni gasto en Meta Ads",
        regla: "dueno-24-oct",
      });
      const hecha = await prisma.$transaction(async (tx) => {
        // Condicionado a lo que se leyó: si el plan o la tarjeta cambiaron un instante antes, no se aprueba.
        const hecho = await tx.tarjetaTablero.updateMany({
          where: { id: tarjeta.id, estado: "PLAN_LISTO", actualizadoEn: tarjeta.actualizadoEn, zonaProtegida: { isEmpty: true }, borradoEn: null },
          data: { estado: "PLAN_APROBADO", trabajoVenceEn: null },
        });
        if (hecho.count !== 1) return false;
        await anotarAprobacionAutomatica(tx, tarjeta.id, { estado: "PLAN_LISTO" }, registro);
        await tx.tableroInteligente.update({ where: { id: tarjeta.tableroId }, data: { actualizadoEn: new Date() } });
        return true;
      });
      if (hecha) aprobadas += 1;
    } catch (error) {
      console.error("[aprobacion-automatica] no se pudo pasar el plan a construir", tarjeta.id, error);
    }
  }
  return aprobadas;
}
