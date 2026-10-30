import { ORIGEN_COORDINADOR } from "@/features/alertas/dominio/reglas";
import { marcarSalioPorWhatsApp, registrarAlerta } from "@/features/alertas/servicios/alertas";
import { prisma } from "@/lib/prisma";

import { avisosPrendidos, enSilencioDeAvisos, enviarAlDueno } from "./avisos-al-dueno";
import { tituloCorto } from "./resumen-corto";
import { codigoDeTarjeta } from "./reglas";
import { linkDeHoy, linkDeLaTarjeta } from "./tableros";

/*
  AVISO "TERMINÓ LA TAREA" AL DUEÑO por WhatsApp (30-oct-2026). EXCEPCIÓN NUEVA a dos decisiones anteriores: el 26-oct se
  decidió no avisar "terminó" y el 29-oct que por WhatsApp salen solo los urgentes (ver avisos-al-dueno.ts). Esta es solo
  para "terminada", con su propio interruptor, y es la única que sale por WhatsApp sin ser urgente.

  Qué cuenta: una tarjeta CON repositorio, en HECHO hace menos de 24 horas, que puso en HECHO el Coordinador (SUBIENDO→HECHO,
  "ya-hecha" o el cierre de una madre partida). El HECHO a mano (pantalla o MCP) no cuenta. Quién la puso sale del historial.

  Reglas:
  - Respeta el interruptor general de los avisos al dueño y el propio `tablero:avisos-dueno:terminadas:<ws>`, que EMPIEZA PRENDIDO.
  - Silencio de 9 p. m. a 7 a. m. (Bogotá): no manda ni anota nada; lo que terminó de noche sale en la vuelta de las 7 a. m.
  - La primera vez (bandera en AppSetting) lo que ya estaba HECHO se anota YA_VISTO sin mandarlo (sin ola de mensajes).
  - Un aviso por tarjeta: la fila de AvisoTarjetaEquipo con motivo "terminada" (índice único tarjetaId+motivo). Las pendientes
    de una vuelta van juntas en UN solo mensaje.
  - Sale con enviarAlDueno: solo por la línea Admin y solo al número del dueño de Mi empresa → Claude.
  - Queda también en la campanita (/cliente/alertas) con prioridad BAJA.
  - Si falla, suma intentos y después del 3.º queda FALLIDO.
  Las filas "terminada" son de este aviso: avisos-al-equipo.ts las ignora en su resumen y en sus consultas.
*/

export const MOTIVO_TERMINADA = "terminada";
export const claveInterruptorDeTerminadas = (workspaceId: string) => `tablero:avisos-dueno:terminadas:${workspaceId}`;
/** Existe cuando ya se anotó (YA_VISTO) lo que estaba HECHO antes de la primera vuelta. */
const claveBase = (workspaceId: string) => `tablero:avisos-dueno:terminadas-base:${workspaceId}`;

const MS_HORA = 3_600_000;
const HORAS_RECIENTE = 24;
const MAXIMO_INTENTOS = 3;
const TITULOS_EN_EL_TEXTO = 2;
/** Estados desde los que el Coordinador deja una tarjeta en HECHO: subida, "ya-hecha" y cierre de una madre partida. */
const ESTADOS_DE_ORIGEN = ["SUBIENDO", "PLANEANDO", "EN_CURSO"];

/* ───────────────────────────────────────────────────────────────────── las reglas (puras) ── */

export type TarjetaTerminada = { id: string; numero?: number | null; titulo: string };
export type TarjetaParaTerminada = { repo: string | null; estado: string };
export type CambioDeTarjeta = { origen: string; accion: string; antes?: unknown; despues?: unknown; creadoEn: Date; deshechoEn?: Date | null };

const comoObjeto = (valor: unknown): Record<string, unknown> => (valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {});

/** ¿La tarjeta quedó terminada por el Coordinador hace menos de 24 horas? El HECHO a mano, sin repo o viejo no cuenta. */
export function esTerminadaDelCoordinador(tarjeta: TarjetaParaTerminada, cambios: readonly CambioDeTarjeta[], ahora: Date = new Date()): boolean {
  if (!tarjeta.repo || tarjeta.estado !== "HECHO") return false;
  // El último cambio que la dejó en HECHO es el que dice quién la terminó y cuándo.
  let ultimo: CambioDeTarjeta | null = null;
  for (const cambio of cambios) {
    if (cambio.accion !== "estado" || cambio.deshechoEn || comoObjeto(cambio.despues).estado !== "HECHO") continue;
    if (!ultimo || cambio.creadoEn.getTime() > ultimo.creadoEn.getTime()) ultimo = cambio;
  }
  if (!ultimo || ultimo.origen !== "TRABAJADOR") return false;
  const edad = ahora.getTime() - ultimo.creadoEn.getTime();
  if (edad < 0 || edad >= HORAS_RECIENTE * MS_HORA) return false;
  return ESTADOS_DE_ORIGEN.includes(String(comoObjeto(ultimo.antes).estado ?? ""));
}

const lineaDeTarjeta = (tarjeta: TarjetaTerminada) => {
  const codigo = codigoDeTarjeta(tarjeta.numero);
  return `${codigo ? `${codigo} ` : ""}${tituloCorto(tarjeta.titulo)}`.trim();
};

/** El mensaje: una tarjeta con su link; varias con las primeras y "y N más". El que llama elige el link (tarjeta o el de hoy). */
export function textoDeTerminadas(tarjetas: readonly TarjetaTerminada[], link: string): string {
  if (!tarjetas.length) return "";
  if (tarjetas.length === 1) {
    const codigo = codigoDeTarjeta(tarjetas[0].numero);
    return `✅ ¡Listo! Terminó la tarea${codigo ? ` ${codigo}` : ""}: ${tituloCorto(tarjetas[0].titulo)} 🚀\n${link}`;
  }
  const dichas = tarjetas.slice(0, TITULOS_EN_EL_TEXTO).map(lineaDeTarjeta);
  const resto = tarjetas.length - dichas.length;
  const cuales = resto > 0 ? `${dichas.join(", ")} y ${resto} más` : dichas.join(" y ");
  return `✅ ¡Listo! Terminaron ${tarjetas.length} tareas: ${cuales} 🚀\n${link}`;
}

/* ───────────────────────────────────────────────────────────────────── la base ── */

const esChoqueDeUnico = (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");

async function leerAjuste(key: string) {
  return (await prisma.appSetting.findUnique({ where: { key }, select: { value: true } }))?.value ?? null;
}

async function guardarAjuste(key: string, value: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** El interruptor propio de este aviso: EMPIEZA PRENDIDO (solo "false" lo apaga). */
export async function avisosDeTerminadasPrendidos(workspaceId: string): Promise<boolean> {
  return (await leerAjuste(claveInterruptorDeTerminadas(workspaceId))) !== "false";
}

const alcance = (workspaceId: string) => ({ borradoEn: null, repo: { not: null }, estado: "HECHO" as const, tablero: { workspaceId } });
const claveDeAlerta = (tarjetaId: string) => `terminada:${tarjetaId}`;

/** La primera vez: todo lo que ya estaba HECHO queda como YA_VISTO, sin mandarlo. */
async function anotarLoQueYaEstabaHecho(workspaceId: string) {
  const hechas = await prisma.tarjetaTablero.findMany({ where: alcance(workspaceId), select: { id: true } });
  if (hechas.length) {
    await prisma.avisoTarjetaEquipo.createMany({
      data: hechas.map((tarjeta) => ({ workspaceId, tarjetaId: tarjeta.id, motivo: MOTIVO_TERMINADA, estado: "YA_VISTO", detalle: "ya estaba hecha antes de prender este aviso" })),
      skipDuplicates: true,
    });
  }
  await guardarAjuste(claveBase(workspaceId), new Date().toISOString());
}

type Candidata = TarjetaTerminada & { repo: string | null; estado: string };

/** Las tarjetas que el Coordinador dejó en HECHO en las últimas 24 horas. */
async function terminadasRecientes(workspaceId: string, ahora: Date): Promise<Candidata[]> {
  const desde = new Date(ahora.getTime() - HORAS_RECIENTE * MS_HORA);
  const filas = await prisma.historialTarjeta.findMany({
    where: { accion: "estado", creadoEn: { gte: desde }, tarjeta: alcance(workspaceId) },
    orderBy: { creadoEn: "asc" },
    select: { tarjetaId: true, origen: true, accion: true, antes: true, despues: true, creadoEn: true, deshechoEn: true, tarjeta: { select: { numero: true, titulo: true, repo: true, estado: true } } },
  });
  const porTarjeta = new Map<string, { tarjeta: Candidata; cambios: CambioDeTarjeta[] }>();
  for (const fila of filas) {
    const entrada = porTarjeta.get(fila.tarjetaId) ?? { tarjeta: { id: fila.tarjetaId, ...fila.tarjeta }, cambios: [] };
    entrada.cambios.push(fila);
    porTarjeta.set(fila.tarjetaId, entrada);
  }
  return [...porTarjeta.values()].filter((x) => esTerminadaDelCoordinador(x.tarjeta, x.cambios, ahora)).map((x) => x.tarjeta);
}

/** La revisión de un negocio. Devuelve cuántos mensajes salieron (0 o 1: las pendientes van juntas). */
async function revisarNegocio(workspaceId: string, ahora: Date): Promise<{ enviados: number }> {
  if (!(await avisosPrendidos(workspaceId)) || !(await avisosDeTerminadasPrendidos(workspaceId))) return { enviados: 0 };
  if ((await leerAjuste(claveBase(workspaceId))) === null) {
    await anotarLoQueYaEstabaHecho(workspaceId);
    return { enviados: 0 };
  }
  // De noche no sale ni se anota nada: queda para la vuelta de las 7 a. m.
  if (enSilencioDeAvisos(ahora)) return { enviados: 0 };

  const candidatas = await terminadasRecientes(workspaceId, ahora);
  if (!candidatas.length) return { enviados: 0 };
  const filas = await prisma.avisoTarjetaEquipo.findMany({
    where: { workspaceId, motivo: MOTIVO_TERMINADA, tarjetaId: { in: candidatas.map((c) => c.id) } },
    select: { id: true, tarjetaId: true, estado: true, intentos: true },
  });
  const existentes = new Map(filas.map((fila) => [fila.tarjetaId, fila]));

  // Se reserva cada aviso ANTES de mandarlo: crear la fila (o subir sus intentos) solo le sale bien a una vuelta.
  const reservadas: { tarjeta: Candidata; id: string; intentos: number }[] = [];
  for (const tarjeta of candidatas) {
    const existente = existentes.get(tarjeta.id);
    if (existente) {
      if (existente.estado !== "PENDIENTE") continue;
      if (existente.intentos >= MAXIMO_INTENTOS) {
        await prisma.avisoTarjetaEquipo.updateMany({ where: { id: existente.id, estado: "PENDIENTE" }, data: { estado: "FALLIDO" } });
        continue;
      }
      const tomado = await prisma.avisoTarjetaEquipo.updateMany({
        where: { id: existente.id, estado: "PENDIENTE", intentos: existente.intentos },
        data: { intentos: existente.intentos + 1 },
      });
      if (tomado.count) reservadas.push({ tarjeta, id: existente.id, intentos: existente.intentos + 1 });
      continue;
    }
    try {
      const creada = await prisma.avisoTarjetaEquipo.create({
        data: { workspaceId, tarjetaId: tarjeta.id, motivo: MOTIVO_TERMINADA, estado: "PENDIENTE", intentos: 1 },
        select: { id: true },
      });
      reservadas.push({ tarjeta, id: creada.id, intentos: 1 });
    } catch (error) {
      if (!esChoqueDeUnico(error)) throw error;
    }
  }
  if (!reservadas.length) return { enviados: 0 };

  const tarjetas = reservadas.map((r) => r.tarjeta);
  const link = tarjetas.length === 1 ? linkDeLaTarjeta(tarjetas[0].id) : linkDeHoy();
  for (const tarjeta of tarjetas) {
    await registrarAlerta({
      workspaceId,
      clave: claveDeAlerta(tarjeta.id),
      prioridad: "BAJA",
      titulo: `Terminó la tarea ${lineaDeTarjeta(tarjeta)}`,
      detalle: link,
      origen: ORIGEN_COORDINADOR,
      refrescar: false,
    });
  }

  const envio = await enviarAlDueno(workspaceId, textoDeTerminadas(tarjetas, link));
  for (const { tarjeta, id, intentos } of reservadas) {
    if (envio.salio) {
      await prisma.avisoTarjetaEquipo.updateMany({ where: { id }, data: { estado: "ENVIADO", enviadoEn: new Date(), numero: envio.numero ?? null, detalle: null } });
      await marcarSalioPorWhatsApp(workspaceId, claveDeAlerta(tarjeta.id));
    } else {
      await prisma.avisoTarjetaEquipo.updateMany({
        where: { id },
        data: { estado: intentos >= MAXIMO_INTENTOS ? "FALLIDO" : "PENDIENTE", detalle: `no salió (intento ${intentos}): ${envio.motivo}` },
      });
    }
  }
  return { enviados: envio.salio ? 1 : 0 };
}

/** La vuelta del reloj: revisa cada negocio con tableros. Nunca lanza por un negocio. */
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
