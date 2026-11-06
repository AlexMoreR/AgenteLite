import { ORIGEN_COORDINADOR } from "@/features/alertas/dominio/reglas";
import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { prisma } from "@/lib/prisma";

import { avisosPrendidos } from "./avisos-al-dueno";
import { codigoDeTarjeta } from "./reglas";
import { esHechoAMano, partidaDelResultado } from "./reglas-trabajador";
import { tituloCorto } from "./resumen-corto";
import { linkDeLaTarjeta } from "./tableros";

/*
  AVISO "TERMINADA" DEL TABLERO IA. Cuando el Coordinador deja una tarea en HECHO, queda una alerta de prioridad BAJA en
  la campanita (/cliente/alertas) con el link a la tarjeta.

  6-nov-2026 (decisión del dueño): YA NO SE MANDA POR WHATSAPP. Del 30-oct al 6-nov el dueño recibía "✅ ¡Listo! Terminó
  la tarea T-123 …" por cada tarea; le llenaba el WhatsApp y le tapaba los avisos importantes. Lo terminado le llega solo
  en el resumen de las 6 p. m. (resumen-diario.ts), que trae el link a la lista de lo trabajado ese día. Los avisos de
  fallas, aprobaciones y urgentes (avisos-al-dueno.ts) y los del Supervisor no cambian.

  Reglas:
  - Cuenta solo el HECHO que puso el Coordinador: la subida SUBIENDO→HECHO, "ya-hecha" o el cierre de una madre
    partida (origen TRABAJADOR, o el cierre automático de la madre). El HECHO a mano del dueño no cuenta. La tarjeta
    tiene que tener repositorio y haber quedado HECHO hace menos de 24 horas.
  - Sigue con su interruptor propio (`tablero:avisos-dueno:terminadas:<ws>`; EMPIEZA PRENDIDO, solo se apaga con
    "false") y el general de los avisos al dueño: apagados, no se crea la alerta.
  - La primera vuelta (sin la bandera `tablero:avisos-dueno:terminadas:base:<ws>`) anota todo lo que ya estaba HECHO como
    YA_VISTO sin alerta: no sale una ola de alertas.
  - Una alerta por tarjeta: una fila de AvisoTarjetaEquipo con motivo "terminada" (el índice único tarjetaId+motivo lo
    garantiza aunque el reloj corra dos veces) que queda en YA_VISTO al crear la alerta. Esas filas NO son avisos al
    equipo: avisos-al-equipo.ts las ignora. Las que quedaron PENDIENTE de antes del 6-nov se cierran igual, sin WhatsApp.
  Lo llama el reloj del servidor (api/cron/follows) cada minuto.
*/

export const MOTIVO_TERMINADA = "terminada";
export const claveInterruptorDeTerminadas = (workspaceId: string) => `tablero:avisos-dueno:terminadas:${workspaceId}`;
export const claveBaseDeTerminadas = (workspaceId: string) => `tablero:avisos-dueno:terminadas:base:${workspaceId}`;

const MS_HORA = 3_600_000;
const HORAS_DE_VENTANA = 24;
const MAXIMO_DEL_CAMBIO = 10;
/** Lo que queda anotado en la fila al cerrar el aviso (ya no hay WhatsApp que mandar). */
export const DETALLE_SOLO_CAMPANITA = "solo en la campanita: sin WhatsApp desde el 6-nov-2026";
const NOTA_DEL_CIERRE_DE_LA_MADRE = /^terminada: sus \d+ partes están hechas$/;

/* ───────────────────────────────────────────────────────────────────── las reglas (puras) ── */

export type TarjetaParaTerminada = { repo: string | null; estado: string; borradoEn: Date | null; resultado?: unknown };
export type CambioParaTerminada = {
  accion: string;
  origen: string;
  quien: string;
  despues: unknown;
  deshechoEn: Date | null;
  creadoEn: Date;
};
export type TarjetaTerminada = { id: string; numero: number | null; titulo: string };

const comoObjeto = (valor: unknown): Record<string, unknown> =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};

/**
 * ¿La tarjeta quedó HECHO hace poco (menos de 24 horas) por obra del Coordinador? Mira el último paso a HECHO del
 * historial (sin deshacer): si es un HECHO a mano no cuenta; si lo hizo el trabajador (origen TRABAJADOR) o es el
 * cierre automático de una madre partida, sí.
 */
export function esTerminadaDelCoordinador(tarjeta: TarjetaParaTerminada, cambios: readonly CambioParaTerminada[], ahora: Date = new Date()): boolean {
  if (!tarjeta.repo || tarjeta.estado !== "HECHO" || tarjeta.borradoEn) return false;
  const aHecho = cambios
    .filter((cambio) => cambio.accion === "estado" && !cambio.deshechoEn && comoObjeto(cambio.despues).estado === "HECHO")
    .sort((a, b) => b.creadoEn.getTime() - a.creadoEn.getTime())[0];
  if (!aHecho) return false;
  const edad = ahora.getTime() - aHecho.creadoEn.getTime();
  if (edad >= HORAS_DE_VENTANA * MS_HORA) return false;
  if (esHechoAMano(aHecho)) return false;
  if (aHecho.origen === "TRABAJADOR" && aHecho.quien.startsWith("trabajador:")) return true;
  const nota = comoObjeto(aHecho.despues).nota;
  return Boolean(partidaDelResultado(tarjeta.resultado)) && typeof nota === "string" && NOTA_DEL_CIERRE_DE_LA_MADRE.test(nota);
}

const nombreDeLaTarea = (tarjeta: TarjetaTerminada) => `${codigoDeTarjeta(tarjeta.numero)} ${tituloCorto(tarjeta.titulo)}`.trim();

/* ───────────────────────────────────────────────────────────────────── los ajustes ── */

/** El interruptor propio del aviso "terminada" (hoy solo la alerta de la campanita): empieza prendido y solo se apaga con "false". */
export async function terminadasPrendidas(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveInterruptorDeTerminadas(workspaceId) }, select: { value: true } });
  return fila?.value !== "false";
}

const esChoqueDeUnico = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

async function guardarAjuste(key: string, value: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/* ───────────────────────────────────────────────────────────────────── la revisión ── */

/** La revisión de un negocio. Devuelve cuántas alertas BAJA dejó en la campanita (nunca manda WhatsApp). */
async function revisarNegocio(workspaceId: string, ahora: Date): Promise<{ alertas: number }> {
  if (!(await avisosPrendidos(workspaceId)) || !(await terminadasPrendidas(workspaceId))) return { alertas: 0 };

  const dondeBase = { tablero: { workspaceId }, estado: "HECHO" as const, borradoEn: null, repo: { not: null } };
  const baseGuardada = await prisma.appSetting.findUnique({ where: { key: claveBaseDeTerminadas(workspaceId) }, select: { value: true } });
  if (!baseGuardada) {
    // Primera vuelta: lo que ya estaba HECHO se anota como visto, sin alerta.
    const yaHechas = await prisma.tarjetaTablero.findMany({ where: dondeBase, select: { id: true } });
    if (yaHechas.length) {
      await prisma.avisoTarjetaEquipo.createMany({
        data: yaHechas.map((tarjeta) => ({ workspaceId, tarjetaId: tarjeta.id, motivo: MOTIVO_TERMINADA, estado: "YA_VISTO", detalle: "ya estaba hecha cuando se prendió el aviso" })),
        skipDuplicates: true,
      });
    }
    await guardarAjuste(claveBaseDeTerminadas(workspaceId), ahora.toISOString());
    return { alertas: 0 };
  }

  // Las que quedaron HECHO en las últimas 24 horas y las que el Coordinador terminó.
  const desde = new Date(ahora.getTime() - HORAS_DE_VENTANA * MS_HORA);
  const candidatas = await prisma.tarjetaTablero.findMany({
    where: { ...dondeBase, historial: { some: { accion: "estado", creadoEn: { gte: desde } } } },
    select: {
      id: true,
      numero: true,
      titulo: true,
      repo: true,
      estado: true,
      borradoEn: true,
      resultado: true,
      historial: {
        where: { accion: "estado" },
        orderBy: { creadoEn: "desc" },
        take: MAXIMO_DEL_CAMBIO,
        select: { accion: true, origen: true, quien: true, despues: true, deshechoEn: true, creadoEn: true },
      },
    },
  });
  const terminadas = new Map(candidatas.filter((tarjeta) => esTerminadaDelCoordinador(tarjeta, tarjeta.historial, ahora)).map((tarjeta) => [tarjeta.id, tarjeta]));

  // Un aviso por tarjeta: lo que ya tiene fila (ENVIADO, YA_VISTO, FALLIDO o PENDIENTE) no se crea otra vez.
  const filas = await prisma.avisoTarjetaEquipo.findMany({
    where: { workspaceId, motivo: MOTIVO_TERMINADA, OR: [{ estado: "PENDIENTE" }, { tarjetaId: { in: [...terminadas.keys()] } }] },
    select: { id: true, tarjetaId: true, estado: true, intentos: true },
  });
  const conFila = new Set(filas.map((fila) => fila.tarjetaId));
  const pendientes = filas.filter((fila) => fila.estado === "PENDIENTE").map((fila) => ({ ...fila }));
  for (const id of terminadas.keys()) {
    if (conFila.has(id)) continue;
    try {
      const creada = await prisma.avisoTarjetaEquipo.create({
        data: { workspaceId, tarjetaId: id, motivo: MOTIVO_TERMINADA, estado: "PENDIENTE" },
        select: { id: true, tarjetaId: true, estado: true, intentos: true },
      });
      pendientes.push(creada);
    } catch (error) {
      if (!esChoqueDeUnico(error)) throw error;
    }
  }

  // Una pendiente que ya no aplica (se borró, se deshizo o pasaron más de 24 horas) no deja alerta.
  const porAnotar = pendientes.filter((fila) => terminadas.has(fila.tarjetaId));
  for (const fila of pendientes.filter((fila) => !terminadas.has(fila.tarjetaId))) {
    await prisma.avisoTarjetaEquipo.updateMany({ where: { id: fila.id, estado: "PENDIENTE" }, data: { estado: "YA_VISTO", detalle: "ya no aplicaba al mandarla" } });
  }
  if (!porAnotar.length) return { alertas: 0 };

  // La campanita: una alerta BAJA por tarjeta; con refrescar en false, otra vuelta no la duplica.
  for (const fila of porAnotar) {
    const tarjeta = terminadas.get(fila.tarjetaId)!;
    const terminada: TarjetaTerminada = { id: tarjeta.id, numero: tarjeta.numero, titulo: tarjeta.titulo };
    await registrarAlerta({
      workspaceId,
      clave: `terminada:${terminada.id}`,
      prioridad: "BAJA",
      titulo: `Terminó la tarea ${nombreDeLaTarea(terminada)}`,
      detalle: `${terminada.titulo}\n${linkDeLaTarjeta(terminada.id)}`,
      origen: ORIGEN_COORDINADOR,
      refrescar: false,
    });
  }
  // 6-nov-2026: sin WhatsApp. La fila queda YA_VISTO para que la tarjeta no vuelva a dejar alerta.
  await prisma.avisoTarjetaEquipo.updateMany({
    where: { id: { in: porAnotar.map((fila) => fila.id) }, estado: "PENDIENTE" },
    data: { estado: "YA_VISTO", detalle: DETALLE_SOLO_CAMPANITA },
  });
  return { alertas: porAnotar.length };
}

/** La vuelta del reloj: revisa cada negocio con tableros. Si falla uno, sigue con los otros. */
export async function revisarAvisosDeTerminadas(ahora: Date = new Date()): Promise<{ alertas: number }> {
  const negocios = await prisma.tableroInteligente.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });
  let alertas = 0;
  for (const { workspaceId } of negocios) {
    try {
      alertas += (await revisarNegocio(workspaceId, ahora)).alertas;
    } catch (error) {
      console.error("[avisos-de-terminadas] no se pudo revisar el negocio", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { alertas };
}
