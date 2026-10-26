import { prisma } from "@/lib/prisma";
import { destinoWhatsAppCritico, leerConfigGravedad, whatsAppAAlexander } from "@/features/avisos-gravedad/servicios/enrutador";
import { QUIEN_AUTOMATICO, aprobacionAutomaticaPrendida } from "./aprobacion-automatica";
import { resumenCorto, tituloCorto } from "./resumen-corto";
import { linkDeHoy, pendientesDelDueno, todoElNegocio } from "./tableros";

/*
  RESUMEN DIARIO del Tablero IA (22-oct-2026; formato corto el 26-oct-2026, pedido de Alexander: "mensajes con
  harto texto que no tengo tiempo de leer"): cada noche, entre las 8:55 y las 8:59 p. m. (hora de Bogotá, antes
  del silencio de 9 p. m. a 7 a. m.), Alexander recibe por WhatsApp, desde la línea Admin (nunca una línea de
  ventas), UN mensaje de 2 líneas:
    Hoy: 4 listas ✅, 1 con problema ⚠️, 2 esperando tu sí 👆
    Ver: <link al tablero filtrado en lo de hoy>
  Si una cifra es 0, esa parte no sale; si las tres son 0, no se manda nada. Sin commits, ramas, ids ni
  títulos largos: el detalle se queda dentro de cada tarjeta (vista "Hoy" del tablero). El mismo texto se ve
  en la caja "Resumen de hoy", con si el WhatsApp salió o por qué no.

  Lo revisa el reloj del servidor (api/cron/follows, cada minuto) y una sola vez por día (el sistema anota el
  día del último envío en AppSetting). Todo sale del historial de las tarjetas (HistorialTarjeta) y de la lista
  "Te toca a ti", sin tablas nuevas.
*/

// Sale entre las 8:55 y las 8:59 p. m. de Bogotá (el silencio de los avisos empieza a las 9:00 p. m.).
const HORA_DEL_RESUMEN = 20;
const MINUTO_DEL_RESUMEN = 55;
const MS_HORA = 3_600_000;
const BOGOTA_MS = 5 * MS_HORA;
const MAX_POR_GRUPO = 30;

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

/** ¿Estamos en la ventana del resumen (8:55 a 8:59 p. m. de Bogotá)? */
export function enLaVentanaDelResumen(ahora: Date): boolean {
  return horaDeBogota(ahora) === HORA_DEL_RESUMEN && new Date(ahora.getTime() - BOGOTA_MS).getUTCMinutes() >= MINUTO_DEL_RESUMEN;
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
      } else if (despues.estado === "HECHO") {
        // Terminada sin subir a producción (tareas que no llevan repo): también es "lista".
        resumen.subidas.push({ tarjetaId: fila.tarjetaId, titulo: fila.titulo, commit: null, linkCommit: null, cuando });
      } else if (despues.estado === "ERROR") {
        resumen.fallas.push({ tarjetaId: fila.tarjetaId, titulo: fila.titulo, motivo: texto(despues.motivo) ?? "sin motivo", cuando });
      }
    }
  }
  return resumen;
}

/** Las tres cifras del mensaje. */
export type CifrasDelDia = { listas: number; conProblema: number; esperando: number };

/**
 * Cuenta por tarjeta (no por evento): una que falló y después subió el mismo día cuenta una sola vez, como
 * lista. "Esperando tu sí" son las que hoy esperan al dueño (la lista de "Te toca a ti").
 */
export function cifrasDelDia(resumen: ResumenDelDia, esperando: number): CifrasDelDia {
  const listas = new Set(resumen.subidas.map((s) => s.tarjetaId));
  const conProblema = new Set(resumen.fallas.map((f) => f.tarjetaId).filter((id) => !listas.has(id)));
  return { listas: listas.size, conProblema: conProblema.size, esperando };
}

export const haySinMovimiento = (cifras: CifrasDelDia) => !cifras.listas && !cifras.conProblema && !cifras.esperando;

/**
 * El texto que se manda por WhatsApp y se ve en la caja "Resumen de hoy": 2 líneas fijas. Texto vacío si
 * las tres cifras son 0 (entonces no se manda nada).
 */
export function textoDelResumen(cifras: CifrasDelDia, link: string = linkDeHoy()): string {
  const partes = [
    cifras.listas ? `${cifras.listas} ${cifras.listas === 1 ? "lista" : "listas"} ✅` : null,
    cifras.conProblema ? `${cifras.conProblema} con problema ⚠️` : null,
    cifras.esperando ? `${cifras.esperando} esperando tu sí 👆` : null,
  ].filter((parte): parte is string => parte !== null);
  if (!partes.length) return "";
  return `Hoy: ${partes.join(", ")}\nVer: ${link}`;
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

/** Cuántas tarjetas esperan en este momento al dueño (la misma lista de "Te toca a ti"). */
async function cuantasEsperan(workspaceId: string): Promise<number> {
  return (await pendientesDelDueno(todoElNegocio(workspaceId))).length;
}

/** Una línea de la vista "Hoy": el título corto y el resumen de una línea que ya se usa en la ficha. */
export type LineaDeHoy = { tarjetaId: string; titulo: string; resumen: string | null };

export type VistaDeHoy = {
  dia: string;
  listas: LineaDeHoy[];
  conProblema: LineaDeHoy[];
  teToca: LineaDeHoy[];
};

const unaLinea = (valor: string | null) => (valor && valor.length > 140 ? `${valor.slice(0, 139).trimEnd()}…` : valor);

/** La vista "Hoy" del tablero: lo que terminó, falló o espera al dueño, una línea por tarjeta. */
export async function vistaDeHoy(workspaceId: string, ahora = new Date()): Promise<VistaDeHoy> {
  const dia = diaDeBogota(ahora);
  const [resumen, pendientes] = await Promise.all([resumenDelDia(workspaceId, dia), pendientesDelDueno(todoElNegocio(workspaceId))]);
  const idsListas = [...new Set(resumen.subidas.map((s) => s.tarjetaId))];
  const idsProblema = [...new Set(resumen.fallas.map((f) => f.tarjetaId))].filter((id) => !idsListas.includes(id));
  const ids = [...idsListas, ...idsProblema];
  const filas = ids.length
    ? await prisma.tarjetaTablero.findMany({
        where: { id: { in: ids }, borradoEn: null, tablero: { workspaceId } },
        select: { id: true, titulo: true, detalle: true, plan: true, resultado: true },
      })
    : [];
  const porId = new Map(filas.map((fila) => [fila.id, fila]));
  const linea = (id: string): LineaDeHoy | null => {
    const fila = porId.get(id);
    if (!fila) return null;
    const resultado = comoObjeto(fila.resultado);
    const corto = resumenCorto({ resultadoResumen: texto(resultado.resumen), plan: fila.plan, detalle: fila.detalle });
    return { tarjetaId: fila.id, titulo: tituloCorto(fila.titulo), resumen: unaLinea(corto?.texto ?? null) };
  };
  const lineas = (lista: string[]) => lista.map(linea).filter((l): l is LineaDeHoy => l !== null).slice(0, MAX_POR_GRUPO);
  return {
    dia,
    listas: lineas(idsListas),
    conProblema: lineas(idsProblema),
    teToca: pendientes.slice(0, MAX_POR_GRUPO).map((p) => ({
      tarjetaId: p.id,
      titulo: tituloCorto(p.titulo),
      resumen: unaLinea(resumenCorto({ resultadoResumen: p.resultado?.resumen, plan: p.plan, detalle: p.detalle })?.texto ?? null),
    })),
  };
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
    const cifras = cifrasDelDia(await resumenDelDia(workspaceId, dia), await cuantasEsperan(workspaceId));
    const mensaje = textoDelResumen(cifras);
    // Si el día no tuvo nada, no se manda nada (y se anota para no reintentarlo cada minuto).
    if (!mensaje) return await anotarYDevolver(workspaceId, { dia, enviado: false, motivo: "Sin movimiento hoy: no se mandó nada.", cuando: ahora.toISOString() });
    const config = await leerConfigGravedad(workspaceId);
    const salio = await whatsAppAAlexander({ workspaceId, config, texto: mensaje });
    envio = { dia, enviado: salio, motivo: salio ? null : await motivoDeNoEnvio(workspaceId), cuando: ahora.toISOString() };
  } catch (error) {
    envio = { dia, enviado: false, motivo: `Falló al armarlo o mandarlo: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300), cuando: ahora.toISOString() };
  }
  return anotarYDevolver(workspaceId, envio);
}

async function anotarYDevolver(workspaceId: string, envio: EnvioDelResumen): Promise<EnvioDelResumen> {
  await anotarEnvio(workspaceId, envio);
  return envio;
}

/**
 * La vuelta del reloj (cada minuto): entre las 8:55 y las 8:59 p. m. de Bogotá manda el resumen una vez
 * por negocio con tableros (si hubo algo que contar). Anota el día ANTES de armarlo, así dos vueltas seguidas no lo mandan dos veces.
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
    cuantasEsperan(workspaceId),
    leerUltimoEnvio(workspaceId),
    aprobacionAutomaticaPrendida(workspaceId),
  ]);
  const cifras = cifrasDelDia(resumen, esperando);
  return {
    dia,
    cifras,
    // El mismo texto corto que llega por WhatsApp; vacío si hoy no hay nada que contar.
    texto: textoDelResumen(cifras),
    envioDeHoy: ultimo && ultimo.dia === dia ? ultimo : null,
    ultimoEnvio: ultimo,
    aprobacionAutomatica: prendida,
  };
}
