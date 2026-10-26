import { prisma } from "@/lib/prisma";
import { destinoWhatsAppCritico, leerConfigGravedad, whatsAppAAlexander } from "@/features/avisos-gravedad/servicios/enrutador";
import { QUIEN_AUTOMATICO, aprobacionAutomaticaPrendida } from "./aprobacion-automatica";

/*
  RESUMEN DIARIO del Tablero IA (22-oct-2026): cada noche a las 9:00 p. m. (hora de Bogotá) Alexander
  recibe por WhatsApp, desde la línea Admin (nunca una línea de ventas), tres cosas del día:
    1. qué se aprobó solo (la tarea o el plan de las tarjetas de riesgo bajo) y por qué;
    2. qué subió a producción, con el link del commit;
    3. qué falló y el motivo.
  Si no pasó nada, dice "hoy no hubo movimiento". El mismo texto se ve en la caja "Resumen de hoy" del
  tablero, con si el WhatsApp salió o por qué no.

  Lo revisa el reloj del servidor (api/cron/follows, cada minuto): entre las 9:00 y las 9:59 p. m. y una
  sola vez por día (el sistema anota el día del último envío en AppSetting). Todo sale del historial
  de las tarjetas (HistorialTarjeta), sin tablas nuevas.
*/

const HORA_DEL_RESUMEN = 21;
const MS_HORA = 3_600_000;
const BOGOTA_MS = 5 * MS_HORA;
const MAX_POR_SECCION = 10;
const MAX_TEXTO = 3500;

export const claveDelUltimoResumen = (workspaceId: string) => `tablero:resumen-diario:${workspaceId}`;

/* ───────────────────────────────────────────────────────────────────── el día de Bogotá ── */

/** El día (AAAA-MM-DD) en Bogotá, que no tiene horario de verano (UTC-5 todo el año). */
export function diaDeBogota(ahora: Date): string {
  return new Date(ahora.getTime() - BOGOTA_MS).toISOString().slice(0, 10);
}

export function horaDeBogota(ahora: Date): number {
  return new Date(ahora.getTime() - BOGOTA_MS).getUTCHours();
}

/** Desde y hasta (sin incluirlo) de un día de Bogotá, en UTC. */
export function rangoDelDia(dia: string): { desde: Date; hasta: Date } {
  const desde = new Date(Date.parse(`${dia}T00:00:00Z`) + BOGOTA_MS);
  return { desde, hasta: new Date(desde.getTime() + 24 * MS_HORA) };
}

/** ¿Toca mandar el resumen? Entre las 9:00 y las 9:59 p. m. de Bogotá y solo si hoy no salió ya. */
export function tocaElResumen(ahora: Date, ultimoDia: string | null | undefined): boolean {
  return horaDeBogota(ahora) === HORA_DEL_RESUMEN && ultimoDia !== diaDeBogota(ahora);
}

/* ───────────────────────────────────────────────────────────────────── armar el resumen ── */

/** Una fila del historial con el título de su tarjeta (lo único que el resumen necesita). */
export type FilaDelHistorial = {
  tarjetaId: string;
  titulo: string;
  accion: string;
  origen: string;
  quien: string;
  despues: unknown;
  creadoEn: Date;
};

export type ResumenDelDia = {
  dia: string;
  aprobadas: { tarjetaId: string; titulo: string; momento: string; motivo: string | null; cuando: string }[];
  subidas: { tarjetaId: string; titulo: string; commit: string | null; linkCommit: string | null; cuando: string }[];
  fallas: { tarjetaId: string; titulo: string; motivo: string; cuando: string }[];
};

const comoObjeto = (valor: unknown): Record<string, unknown> =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

/** Arma el resumen de un día con las filas del historial: solo cuenta lo que pasó ese día de Bogotá. */
export function armarResumen(dia: string, filas: readonly FilaDelHistorial[]): ResumenDelDia {
  const { desde, hasta } = rangoDelDia(dia);
  const resumen: ResumenDelDia = { dia, aprobadas: [], subidas: [], fallas: [] };
  const delDia = filas
    .filter((fila) => fila.creadoEn.getTime() >= desde.getTime() && fila.creadoEn.getTime() < hasta.getTime())
    .sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime());
  for (const fila of delDia) {
    const despues = comoObjeto(fila.despues);
    const cuando = fila.creadoEn.toISOString();
    if (fila.accion === "aprobar" && fila.quien === QUIEN_AUTOMATICO && despues.automatica === true) {
      resumen.aprobadas.push({
        tarjetaId: fila.tarjetaId,
        titulo: fila.titulo,
        momento: texto(despues.momento) ?? "tarea",
        motivo: texto(despues.motivo),
        cuando,
      });
    } else if (fila.origen === "TRABAJADOR" && fila.accion === "estado") {
      const subida = comoObjeto(despues.subida);
      if (Object.keys(subida).length) {
        resumen.subidas.push({
          tarjetaId: fila.tarjetaId,
          titulo: fila.titulo,
          commit: texto(subida.commit),
          linkCommit: texto(subida.linkCommit),
          cuando,
        });
      } else if (despues.estado === "ERROR") {
        resumen.fallas.push({ tarjetaId: fila.tarjetaId, titulo: fila.titulo, motivo: texto(despues.motivo) ?? "sin motivo", cuando });
      }
    }
  }
  return resumen;
}

export const haySinMovimiento = (resumen: ResumenDelDia) =>
  !resumen.aprobadas.length && !resumen.subidas.length && !resumen.fallas.length;

const corto = (valor: string, maximo: number) => (valor.length > maximo ? `${valor.slice(0, maximo - 1).trimEnd()}…` : valor);

/** "2026-10-22" -> "22/10/2026". */
const fechaCorta = (dia: string) => dia.split("-").reverse().join("/");

/** Lista de a lo más MAX_POR_SECCION, con "y N más" si hay más. */
function lista(titulo: string, lineas: string[]): string[] {
  if (!lineas.length) return [];
  const verdes = lineas.slice(0, MAX_POR_SECCION);
  if (lineas.length > verdes.length) verdes.push(`• …y ${lineas.length - verdes.length} más`);
  return [titulo, ...verdes, ""];
}

/** El texto que se manda por WhatsApp y se ve en la caja "Resumen de hoy". */
export function textoDelResumen(resumen: ResumenDelDia): string {
  const encabezado = `Resumen del Tablero IA — ${fechaCorta(resumen.dia)}`;
  if (haySinMovimiento(resumen)) return `${encabezado}\n\nHoy no hubo movimiento.`;
  const partes = [
    encabezado,
    "",
    ...lista(
      `✅ Aprobé solas ${resumen.aprobadas.length} (sin esperar tu sí):`,
      resumen.aprobadas.map(
        (a) => `• ${corto(a.titulo, 80)} — ${a.momento === "plan" ? "el plan" : "la tarea"}${a.motivo ? `: ${corto(a.motivo, 100)}` : ""}`,
      ),
    ),
    ...lista(
      `🚀 Subió a producción ${resumen.subidas.length}:`,
      resumen.subidas.map(
        (s) => `• ${corto(s.titulo, 80)}${s.commit ? ` — commit ${s.commit.slice(0, 10)}` : ""}${s.linkCommit ? ` ${s.linkCommit}` : ""}`,
      ),
    ),
    ...lista(
      `⚠️ Falló ${resumen.fallas.length}:`,
      resumen.fallas.map((f) => `• ${corto(f.titulo, 80)} — ${corto(f.motivo.replace(/\s+/g, " "), 160)}`),
    ),
  ];
  return corto(partes.join("\n").trim(), MAX_TEXTO);
}

/* ───────────────────────────────────────────────────────────────────── la base ── */

/** Lo del historial del negocio en ese día: las aprobaciones automáticas y lo que hizo el Coordinador. */
export async function resumenDelDia(workspaceId: string, dia: string): Promise<ResumenDelDia> {
  const { desde, hasta } = rangoDelDia(dia);
  const filas = await prisma.historialTarjeta.findMany({
    where: {
      creadoEn: { gte: desde, lt: hasta },
      tarjeta: { tablero: { workspaceId } },
      OR: [{ accion: "aprobar", quien: QUIEN_AUTOMATICO }, { accion: "estado", origen: "TRABAJADOR" }],
    },
    orderBy: { creadoEn: "asc" },
    take: 1000,
    select: {
      tarjetaId: true,
      accion: true,
      origen: true,
      quien: true,
      despues: true,
      creadoEn: true,
      tarjeta: { select: { titulo: true } },
    },
  });
  return armarResumen(
    dia,
    filas.map((fila) => ({ ...fila, titulo: fila.tarjeta.titulo })),
  );
}

/** Lo que se anota de cada envío (AppSetting): el día, si el WhatsApp salió y, si no, por qué. */
export type EnvioDelResumen = { dia: string; enviado: boolean; motivo: string | null; cuando: string };

export async function leerUltimoEnvio(workspaceId: string): Promise<EnvioDelResumen | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDelUltimoResumen(workspaceId) }, select: { value: true } });
  if (!fila?.value) return null;
  try {
    const leido = JSON.parse(fila.value) as Partial<EnvioDelResumen>;
    return typeof leido.dia === "string"
      ? { dia: leido.dia, enviado: leido.enviado === true, motivo: texto(leido.motivo), cuando: texto(leido.cuando) ?? "" }
      : null;
  } catch {
    return null;
  }
}

async function anotarEnvio(workspaceId: string, envio: EnvioDelResumen) {
  const key = claveDelUltimoResumen(workspaceId);
  const value = JSON.stringify(envio);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Por qué no salió el WhatsApp (para decirlo en el tablero). */
async function motivoDeNoEnvio(workspaceId: string): Promise<string> {
  const config = await leerConfigGravedad(workspaceId);
  if (!config.whatsapp.activo) return "El WhatsApp de avisos está apagado en la configuración de avisos graves.";
  const destino = await destinoWhatsAppCritico(workspaceId, config).catch(() => null);
  if (!destino) return "No hay línea Admin conectada o número configurado para los avisos.";
  return "La línea Admin no pudo enviar el mensaje (¿está desconectada?).";
}

/** Manda el resumen de hoy por WhatsApp (línea Admin) y anota si salió. Nunca lanza. */
async function enviarResumen(workspaceId: string, ahora: Date): Promise<EnvioDelResumen> {
  const dia = diaDeBogota(ahora);
  let envio: EnvioDelResumen;
  try {
    const mensaje = textoDelResumen(await resumenDelDia(workspaceId, dia));
    const config = await leerConfigGravedad(workspaceId);
    const salio = await whatsAppAAlexander({ workspaceId, config, texto: mensaje });
    envio = { dia, enviado: salio, motivo: salio ? null : await motivoDeNoEnvio(workspaceId), cuando: ahora.toISOString() };
  } catch (error) {
    envio = { dia, enviado: false, motivo: `Falló al armarlo o mandarlo: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300), cuando: ahora.toISOString() };
  }
  await anotarEnvio(workspaceId, envio);
  return envio;
}

/**
 * La vuelta del reloj (cada minuto): entre las 9:00 y las 9:59 p. m. de Bogotá manda el resumen una vez
 * por negocio con tableros. Anota el día ANTES de armarlo, así dos vueltas seguidas no lo mandan dos veces.
 */
export async function enviarResumenDiarioSiToca(ahora = new Date()): Promise<{ enviados: number }> {
  if (horaDeBogota(ahora) !== HORA_DEL_RESUMEN) return { enviados: 0 };
  const negocios = await prisma.tableroInteligente.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });
  let enviados = 0;
  for (const { workspaceId } of negocios) {
    const ultimo = await leerUltimoEnvio(workspaceId);
    if (!tocaElResumen(ahora, ultimo?.dia)) continue;
    await anotarEnvio(workspaceId, { dia: diaDeBogota(ahora), enviado: false, motivo: "Enviándose…", cuando: ahora.toISOString() });
    const envio = await enviarResumen(workspaceId, ahora);
    if (envio.enviado) enviados += 1;
  }
  return { enviados };
}

/** La caja "Resumen de hoy" del tablero: lo de hoy hasta ahora, el interruptor y el envío de hoy (si ya salió). */
export async function resumenDeHoyParaLaPantalla(workspaceId: string, ahora = new Date()) {
  const dia = diaDeBogota(ahora);
  const [resumen, ultimo, prendida] = await Promise.all([
    resumenDelDia(workspaceId, dia),
    leerUltimoEnvio(workspaceId),
    aprobacionAutomaticaPrendida(workspaceId),
  ]);
  return {
    dia,
    resumen,
    texto: textoDelResumen(resumen),
    envioDeHoy: ultimo && ultimo.dia === dia ? ultimo : null,
    ultimoEnvio: ultimo,
    aprobacionAutomatica: prendida,
  };
}
