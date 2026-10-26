import { prisma } from "@/lib/prisma";
import { destinoWhatsAppCritico, leerConfigGravedad, whatsAppAAlexander } from "@/features/avisos-gravedad/servicios/enrutador";
import { QUIEN_AUTOMATICO, aprobacionAutomaticaPrendida } from "./aprobacion-automatica";
import { linkDeVista } from "./enlaces";
import { resumenCorto, tituloCorto } from "./resumen-corto";

/*
  RESUMEN DIARIO del Tablero IA (22-oct-2026; cambiado el 25-oct-2026 a pedido del dueño: "mensajes con
  harto texto que no tengo tiempo de leer"). Cada noche a las 8:55 p. m. (hora de Bogotá, antes del silencio
  de 9 p. m. a 7 a. m.) Alexander recibe por WhatsApp, desde la línea Admin (nunca una línea de ventas),
  DOS líneas:
    Hoy: 4 listas ✅, 1 con problema ⚠️, 2 esperando tu sí 👆
    Ver: <link al tablero en la vista "Hoy">
  Sin commits, ramas, ids ni planes: el detalle se queda dentro de cada tarjeta. La parte que vale 0 no sale
  y, si las tres valen 0, no se manda nada. El mismo texto se ve en la caja "Resumen de hoy" del tablero, con
  si el WhatsApp salió o por qué no, y la vista "Hoy" (?vista=hoy) lista las tarjetas, una línea cada una.

  Lo revisa el reloj del servidor (api/cron/follows, cada minuto): entre las 8:55 y las 8:59 p. m. y una
  sola vez por día (el sistema anota el día del último envío en AppSetting). Todo sale del historial
  de las tarjetas (HistorialTarjeta) y de las tarjetas, sin tablas nuevas.
*/

const HORA_DEL_RESUMEN = 20;
const MINUTO_DEL_RESUMEN = 55;
const MS_HORA = 3_600_000;
const BOGOTA_MS = 5 * MS_HORA;
const MAX_LINEAS_DE_HOY = 100;

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

export function minutoDeBogota(ahora: Date): number {
  return new Date(ahora.getTime() - BOGOTA_MS).getUTCMinutes();
}

/** ¿Es la ventana del resumen? De las 8:55 a las 8:59 p. m. de Bogotá (antes del silencio de las 9). */
export function enLaVentanaDelResumen(ahora: Date): boolean {
  return horaDeBogota(ahora) === HORA_DEL_RESUMEN && minutoDeBogota(ahora) >= MINUTO_DEL_RESUMEN;
}

/** ¿Toca mandar el resumen? Entre las 8:55 y las 8:59 p. m. de Bogotá y solo si hoy no salió ya. */
export function tocaElResumen(ahora: Date, ultimoDia: string | null | undefined): boolean {
  return enLaVentanaDelResumen(ahora) && ultimoDia !== diaDeBogota(ahora);
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
  /** Tarjetas que hoy quedaron listas (subieron o terminaron), una sola vez cada una. */
  listas: { tarjetaId: string; titulo: string }[];
  /** Tarjetas que hoy quedaron en error y no se arreglaron el mismo día, una sola vez cada una. */
  conProblema: { tarjetaId: string; titulo: string }[];
};

const comoObjeto = (valor: unknown): Record<string, unknown> =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

/** Arma el resumen de un día con las filas del historial: solo cuenta lo que pasó ese día de Bogotá. */
export function armarResumen(dia: string, filas: readonly FilaDelHistorial[]): ResumenDelDia {
  const { desde, hasta } = rangoDelDia(dia);
  const resumen: ResumenDelDia = { dia, aprobadas: [], subidas: [], fallas: [], listas: [], conProblema: [] };
  const terminadas = new Map<string, string>();
  const conError = new Map<string, string>();
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
      if (Object.keys(subida).length || despues.estado === "HECHO") terminadas.set(fila.tarjetaId, fila.titulo);
      else if (despues.estado === "ERROR") conError.set(fila.tarjetaId, fila.titulo);
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
  // Una tarjeta que falló y después subió el mismo día cuenta una sola vez, como lista.
  resumen.listas = [...terminadas].map(([tarjetaId, titulo]) => ({ tarjetaId, titulo }));
  resumen.conProblema = [...conError].filter(([id]) => !terminadas.has(id)).map(([tarjetaId, titulo]) => ({ tarjetaId, titulo }));
  return resumen;
}

export const haySinMovimiento = (resumen: ResumenDelDia, esperando: number) =>
  !resumen.listas.length && !resumen.conProblema.length && esperando <= 0;

/** El texto del WhatsApp y de la caja "Resumen de hoy": dos líneas, sin nada técnico. */
export function textoDelResumen(resumen: ResumenDelDia, esperando: number): string {
  if (haySinMovimiento(resumen, esperando)) return "Hoy no hubo movimiento.";
  const partes = [
    resumen.listas.length ? `${resumen.listas.length} ${resumen.listas.length === 1 ? "lista" : "listas"} ✅` : null,
    resumen.conProblema.length ? `${resumen.conProblema.length} con problema ⚠️` : null,
    esperando > 0 ? `${esperando} esperando tu sí 👆` : null,
  ].filter((parte): parte is string => parte !== null);
  return `Hoy: ${partes.join(", ")}\nVer: ${linkDeVista("hoy")}`;
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

/**
 * Las tarjetas que en este momento esperan el sí o la revisión del dueño: la misma regla de "Te toca a ti"
 * (tableros.ts, pendientesDelDueno), vista de todo el negocio.
 */
const DONDE_ESPERA_AL_DUENO = {
  borradoEn: null,
  OR: [
    { estado: { in: ["POR_APROBAR", "PLAN_LISTO", "POR_REVISAR", "ERROR"] as ("POR_APROBAR" | "PLAN_LISTO" | "POR_REVISAR" | "ERROR")[] }, tipo: { requiereAprobacion: true, usaEstados: true } },
    { estado: "FALLIDO" as const, tipo: { usaEstados: true } },
  ],
};

export async function contarEsperandoAlDueno(workspaceId: string): Promise<number> {
  return prisma.tarjetaTablero.count({ where: { ...DONDE_ESPERA_AL_DUENO, tablero: { workspaceId } } });
}

/** Una línea de la vista "Hoy": el título corto y el resumen de una línea de la tarjeta. */
export type LineaDeHoy = { id: string; titulo: string; resumen: string | null };

export type VistaDeHoy = { dia: string; listas: LineaDeHoy[]; conProblema: LineaDeHoy[]; teToca: LineaDeHoy[] };

/** Los tres grupos de la vista "Hoy" (?vista=hoy): listas hoy, con problema hoy y te toca a ti. */
export async function vistaDeHoy(workspaceId: string, ahora = new Date()): Promise<VistaDeHoy> {
  const dia = diaDeBogota(ahora);
  const resumen = await resumenDelDia(workspaceId, dia);
  const ids = [...new Set([...resumen.listas, ...resumen.conProblema].map((t) => t.tarjetaId))];
  const select = { id: true, titulo: true, detalle: true, plan: true, resultado: true } as const;
  const [delDia, esperan] = await Promise.all([
    ids.length ? prisma.tarjetaTablero.findMany({ where: { id: { in: ids }, tablero: { workspaceId } }, select }) : Promise.resolve([]),
    prisma.tarjetaTablero.findMany({
      where: { ...DONDE_ESPERA_AL_DUENO, tablero: { workspaceId } },
      orderBy: { actualizadoEn: "asc" },
      take: MAX_LINEAS_DE_HOY,
      select,
    }),
  ]);
  type Fila = (typeof esperan)[number];
  const linea = (fila: Fila): LineaDeHoy => ({
    id: fila.id,
    titulo: tituloCorto(fila.titulo),
    resumen:
      resumenCorto({ resultadoResumen: texto(comoObjeto(fila.resultado).resumen), plan: fila.plan, detalle: fila.detalle }, 140)?.texto ?? null,
  });
  const porId = new Map(delDia.map((fila) => [fila.id, fila]));
  const deLaLista = (tarjetas: { tarjetaId: string; titulo: string }[]) =>
    tarjetas.slice(0, MAX_LINEAS_DE_HOY).map((t) => {
      const fila = porId.get(t.tarjetaId);
      return fila ? linea(fila) : { id: t.tarjetaId, titulo: tituloCorto(t.titulo), resumen: null };
    });
  return { dia, listas: deLaLista(resumen.listas), conProblema: deLaLista(resumen.conProblema), teToca: esperan.map(linea) };
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
    const [datos, esperando] = await Promise.all([resumenDelDia(workspaceId, dia), contarEsperandoAlDueno(workspaceId)]);
    // Si no pasó nada, no se manda nada.
    if (haySinMovimiento(datos, esperando)) {
      const envio: EnvioDelResumen = { dia, enviado: false, motivo: "Hoy no hubo movimiento: no se mandó nada.", cuando: ahora.toISOString() };
      await anotarEnvio(workspaceId, envio);
      return envio;
    }
    const mensaje = textoDelResumen(datos, esperando);
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
 * La vuelta del reloj (cada minuto): entre las 8:55 y las 8:59 p. m. de Bogotá manda el resumen una vez
 * por negocio con tableros. Anota el día ANTES de armarlo, así dos vueltas seguidas no lo mandan dos veces.
 */
export async function enviarResumenDiarioSiToca(ahora = new Date()): Promise<{ enviados: number }> {
  if (!enLaVentanaDelResumen(ahora)) return { enviados: 0 };
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
  const [resumen, esperando, ultimo, prendida] = await Promise.all([
    resumenDelDia(workspaceId, dia),
    contarEsperandoAlDueno(workspaceId),
    leerUltimoEnvio(workspaceId),
    aprobacionAutomaticaPrendida(workspaceId),
  ]);
  return {
    dia,
    resumen,
    texto: textoDelResumen(resumen, esperando),
    esperando,
    envioDeHoy: ultimo && ultimo.dia === dia ? ultimo : null,
    ultimoEnvio: ultimo,
    aprobacionAutomatica: prendida,
  };
}
