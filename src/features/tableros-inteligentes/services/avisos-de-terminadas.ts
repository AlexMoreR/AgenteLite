import { ORIGEN_COORDINADOR } from "@/features/alertas/dominio/reglas";
import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { prisma } from "@/lib/prisma";

import { avisosPrendidos, enSilencioDeAvisos, enviarAlDueno } from "./avisos-al-dueno";
import { codigoDeTarjeta } from "./reglas";
import { esHechoAMano, partidaDelResultado } from "./reglas-trabajador";
import { tituloCorto } from "./resumen-corto";
import { linkDeHoy, linkDeLaTarjeta } from "./tableros";

/*
  AVISO "TERMINADA" AL DUEÑO por WhatsApp (30-oct-2026). Cuando el Coordinador deja una tarea en HECHO, el dueño recibe
  "✅ ¡Listo! Terminó la tarea T-123: <título> 🚀" con el link. Varias a la vez van juntas en UN mensaje.

  Esto es una EXCEPCIÓN pedida por el dueño a dos decisiones anteriores: el 26-oct se decidió no avisar "terminó" y el
  29-oct que por WhatsApp salgan solo los urgentes. Vale solo para "terminada" y tiene su propio interruptor
  (`tablero:avisos-dueno:terminadas:<ws>`; EMPIEZA PRENDIDO, solo se apaga con "false"). El interruptor general de los
  avisos al dueño también manda. En la campanita (/cliente/alertas) queda con prioridad BAJA.

  Reglas:
  - Cuenta solo el HECHO que puso el Coordinador: la subida SUBIENDO→HECHO, "ya-hecha" o el cierre de una madre
    partida (origen TRABAJADOR, o el cierre automático de la madre). El HECHO a mano del dueño no cuenta. La tarjeta
    tiene que tener repositorio y haber quedado HECHO hace menos de 24 horas.
  - Sale solo por la línea Admin y solo al número del dueño de Mi empresa → Claude (enviarAlDueno). Nunca a clientes.
  - Silencio de 9 p. m. a 7 a. m. (Bogotá): no sale nada y lo pendiente sale a las 7 a. m. (la ventana de 24 horas lo cubre).
  - La primera vuelta (sin la bandera `tablero:avisos-dueno:terminadas:base:<ws>`) anota todo lo que ya estaba HECHO como
    YA_VISTO sin mandarlo: no sale una ola de mensajes.
  - Un aviso por tarjeta: una fila de AvisoTarjetaEquipo con motivo "terminada" (el índice único tarjetaId+motivo lo
    garantiza aunque el reloj corra dos veces). Esas filas NO son avisos al equipo: avisos-al-equipo.ts las ignora.
  - Si no sale, suma un intento; al 3.º queda FALLIDO.
  Lo llama el reloj del servidor (api/cron/follows) en la parte siguiente de la tarjeta; este archivo no se programa solo.
*/

export const MOTIVO_TERMINADA = "terminada";
export const claveInterruptorDeTerminadas = (workspaceId: string) => `tablero:avisos-dueno:terminadas:${workspaceId}`;
export const claveBaseDeTerminadas = (workspaceId: string) => `tablero:avisos-dueno:terminadas:base:${workspaceId}`;

const MS_HORA = 3_600_000;
const HORAS_DE_VENTANA = 24;
const MAXIMO_INTENTOS = 3;
const MAXIMO_TITULOS = 2;
const MAXIMO_DEL_CAMBIO = 10;
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

/** El mensaje: una tarea con el link a su tarjeta; varias en un solo mensaje con el link de hoy. */
export function textoDeTerminadas(tarjetas: readonly TarjetaTerminada[], link?: string): string {
  if (!tarjetas.length) return "";
  if (tarjetas.length === 1) {
    const [tarjeta] = tarjetas;
    const codigo = codigoDeTarjeta(tarjeta.numero);
    return `✅ ¡Listo! Terminó la tarea${codigo ? ` ${codigo}` : ""}: ${tituloCorto(tarjeta.titulo)} 🚀\n${link ?? linkDeLaTarjeta(tarjeta.id)}`;
  }
  const nombres = tarjetas.slice(0, MAXIMO_TITULOS).map(nombreDeLaTarea);
  const resto = tarjetas.length - nombres.length;
  const lista = resto > 0 ? `${nombres.join(", ")} y ${resto} más` : nombres.join(" y ");
  return `✅ ¡Listo! Terminaron ${tarjetas.length} tareas: ${lista} 🚀\n${link ?? linkDeHoy()}`;
}

/* ───────────────────────────────────────────────────────────────────── los ajustes ── */

/** El interruptor propio del aviso "terminada": empieza prendido y solo se apaga con "false". */
export async function terminadasPrendidas(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveInterruptorDeTerminadas(workspaceId) }, select: { value: true } });
  return fila?.value !== "false";
}

const esChoqueDeUnico = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

async function guardarAjuste(key: string, value: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/* ───────────────────────────────────────────────────────────────────── la revisión ── */

/** La revisión de un negocio. Devuelve cuántos mensajes salieron (0 o 1). */
async function revisarNegocio(workspaceId: string, ahora: Date): Promise<{ enviados: number }> {
  if (!(await avisosPrendidos(workspaceId)) || !(await terminadasPrendidas(workspaceId))) return { enviados: 0 };
  // De noche no sale nada; lo que terminó queda para la vuelta de las 7 a. m. (la ventana de 24 horas lo cubre).
  if (enSilencioDeAvisos(ahora)) return { enviados: 0 };

  const dondeBase = { tablero: { workspaceId }, estado: "HECHO" as const, borradoEn: null, repo: { not: null } };
  const baseGuardada = await prisma.appSetting.findUnique({ where: { key: claveBaseDeTerminadas(workspaceId) }, select: { value: true } });
  if (!baseGuardada) {
    // Primera vuelta: lo que ya estaba HECHO se anota como visto, sin mandarlo.
    const yaHechas = await prisma.tarjetaTablero.findMany({ where: dondeBase, select: { id: true } });
    if (yaHechas.length) {
      await prisma.avisoTarjetaEquipo.createMany({
        data: yaHechas.map((tarjeta) => ({ workspaceId, tarjetaId: tarjeta.id, motivo: MOTIVO_TERMINADA, estado: "YA_VISTO", detalle: "ya estaba hecha cuando se prendió el aviso" })),
        skipDuplicates: true,
      });
    }
    await guardarAjuste(claveBaseDeTerminadas(workspaceId), ahora.toISOString());
    return { enviados: 0 };
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

  // Una pendiente que ya no aplica (se borró, se deshizo o pasaron más de 24 horas) no se manda.
  const porMandar = pendientes.filter((fila) => terminadas.has(fila.tarjetaId));
  for (const fila of pendientes.filter((fila) => !terminadas.has(fila.tarjetaId))) {
    await prisma.avisoTarjetaEquipo.updateMany({ where: { id: fila.id, estado: "PENDIENTE" }, data: { estado: "YA_VISTO", detalle: "ya no aplicaba al mandarla" } });
  }
  if (!porMandar.length) return { enviados: 0 };

  const tarjetas: TarjetaTerminada[] = porMandar.map((fila) => {
    const tarjeta = terminadas.get(fila.tarjetaId)!;
    return { id: tarjeta.id, numero: tarjeta.numero, titulo: tarjeta.titulo };
  });
  // La campanita: una alerta BAJA por tarjeta; con refrescar en false reintentar no la duplica.
  for (const tarjeta of tarjetas) {
    await registrarAlerta({
      workspaceId,
      clave: `terminada:${tarjeta.id}`,
      prioridad: "BAJA",
      titulo: `Terminó la tarea ${nombreDeLaTarea(tarjeta)}`,
      detalle: `${tarjeta.titulo}\n${linkDeLaTarjeta(tarjeta.id)}`,
      origen: ORIGEN_COORDINADOR,
      refrescar: false,
    });
  }

  const envio = await enviarAlDueno(workspaceId, textoDeTerminadas(tarjetas));
  const ids = porMandar.map((fila) => fila.id);
  if (envio.salio) {
    await prisma.avisoTarjetaEquipo.updateMany({ where: { id: { in: ids } }, data: { estado: "ENVIADO", enviadoEn: ahora, detalle: null } });
    return { enviados: 1 };
  }
  for (const fila of porMandar) {
    const intentos = fila.intentos + 1;
    await prisma.avisoTarjetaEquipo.updateMany({
      where: { id: fila.id },
      data: { intentos, estado: intentos >= MAXIMO_INTENTOS ? "FALLIDO" : "PENDIENTE", detalle: `no salió: ${envio.motivo}` },
    });
  }
  return { enviados: 0 };
}

/** La vuelta del reloj: revisa cada negocio con tableros. Si falla uno, sigue con los otros. */
export async function revisarAvisosDeTerminadas(ahora: Date = new Date()): Promise<{ enviados: number }> {
  const negocios = await prisma.tableroInteligente.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });
  let enviados = 0;
  for (const { workspaceId } of negocios) {
    try {
      enviados += (await revisarNegocio(workspaceId, ahora)).enviados;
    } catch (error) {
      console.error("[avisos-de-terminadas] no se pudo revisar el negocio", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { enviados };
}
