/**
 * EL EMBUDO SEMANAL POR FAMILIA (pantalla /cliente/crm/embudo, Alex 12-10-2026), en código puro.
 *
 * Se calcula desde los MENSAJES REALES (Message + Conversation + Contact, y EmbudoLead/EmbudoEvento
 * cuando existen), no solo desde EmbudoEvento: el registro del embudo empezó el 10-oct y tiene poca
 * cobertura. Aquí no hay base ni Next: la consulta (servicios/leer-embudo-semanal.ts) trae los
 * leads con sus mensajes y estas funciones arman los pasos. Se prueba con
 * `npm run test:embudo-semanal` (scripts/check-embudo-semanal.mjs).
 *
 * QUIÉN ES UN LEAD DE LA SEMANA ("Llegó"): un chat de una línea de VENTAS (no la Admin) cuyo PRIMER
 * mensaje del cliente (entrante, no de sistema) cae entre el lunes 00:00 y el domingo 23:59 hora
 * Bogotá. Fuera: contactos excluidos del CRM y teléfonos del exterior marcados en EmbudoLead.
 *
 * VENTANA: para los pasos 2 a 4 se miran los mensajes de sus primeros 14 días (así dos semanas se
 * comparan con la misma vara). Cotización y venta salen del CRM, sin ventana.
 *
 * LOS SEIS PASOS (de 3 en adelante son acumulativos: quien llegó a un paso cuenta en los de antes):
 *  1. Llegó.
 *  2. Vio precio o fotos: el bot, un flujo o un seguimiento automático le mandó un texto con precio
 *     ("$" + cifra, o cifra de miles hablando de plata) o una foto, video o documento
 *     (`esPrecioOFotosDelBot` de src/lib/turno-con-contenido.ts, el mismo criterio del reparto).
 *     No es acumulativo: mide lo que hizo el bot (en Marketplace a veces responde solo la asesora).
 *  3. Conversó: escribió al menos 2 mensajes y al menos uno DESPUÉS de nuestra primera respuesta
 *     (la bienvenida del bot o, si no hubo bot, la de la asesora).
 *  4. Mostró intención: en algo que escribió (o en la transcripción de su audio) hay una señal de
 *     compra fuerte o media del detector del embudo (`detectarSenales`): separar/apartar,
 *     anticipo/pago, aceptó el precio, pidió cotización, dio dirección o fecha, comprobante,
 *     decide pronto, envío/ciudad, tiempo de fabricación, color/medidas, garantía, forma de pago.
 *     No cuentan "¿sirve para…?" ni "fotos de tal producto" (son preguntas de información), ni el
 *     PRIMER mensaje (es el texto que pone el anuncio, p. ej. "Camillas Contra entrega Cali").
 *     Mandar una ubicación también cuenta.
 *  5. Cotización o anticipo: EmbudoLead.cotizacionEn/cotizacionRef/anticipoEn, un evento
 *     COTIZACION o ANTICIPO del embudo, la cotización de Gestión guardada al marcar Ganado
 *     (Contact.wonQuoteRef), o la asesora le mandó el formulario "Datos de Cotización" /
 *     "cotización formal" (mensaje manual o desde el celular).
 *  6. Venta: el contacto está en Ganado en el CRM (Contact.crmStage = GANADO) o EmbudoLead.ventaEn.
 *
 * EN CURSO: los que entraron hace menos de 72 h. Se muestran aparte y no entran en los números ni
 * en los %.
 */

import { esPrecioOFotosDelBot } from "../../../lib/turno-con-contenido";
import { detectarSenales, type TipoDeSenal } from "./senales";

/* ------------------------------------------------------------------------------------ familias */

export const FAMILIAS = [
  { clave: "combo", nombre: "Combo camilla" },
  { clave: "marketplace", nombre: "Marketplace" },
  { clave: "camillas", nombre: "Camillas" },
  { clave: "manicura", nombre: "Mesas manicura" },
  { clave: "sillas", nombre: "Sillas peluquería" },
  { clave: "lavacabezas", nombre: "Lavacabezas" },
  { clave: "otros", nombre: "Otros" },
] as const;

export type ClaveDeFamilia = (typeof FAMILIAS)[number]["clave"];

export function esFamilia(valor: string): valor is ClaveDeFamilia {
  return FAMILIAS.some((familia) => familia.clave === valor);
}

export function nombreDeFamilia(clave: ClaveDeFamilia): string {
  return FAMILIAS.find((familia) => familia.clave === clave)?.nombre ?? clave;
}

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/**
 * La familia que nombra un texto (clave de producto, nombre del producto del V3, título del
 * anuncio o primer mensaje). El combo va primero: su anuncio nombra "camilla, escalera, silla y
 * auxiliar". null = el texto no nombra ninguna familia.
 */
export function familiaDeTexto(texto: string | null | undefined): Exclude<ClaveDeFamilia, "marketplace" | "otros"> | null {
  const limpio = normalizar(texto);
  if (!limpio) return null;
  if (/\bcombos?\b/.test(limpio)) return "combo";
  if (/\blava ?cabezas?\b|\blavacabeza/.test(limpio)) return "lavacabezas";
  if (/manicur|pedicur|\bbutacos?\b|\bunas\b/.test(limpio)) return "manicura";
  if (/\bcamillas?\b/.test(limpio)) return "camillas";
  if (/\bsillas?\b|peluquer|barber/.test(limpio)) return "sillas";
  return null;
}

/** Lo que se sabe del lead para decidir su familia. */
export type DatosDeFamilia = {
  esMarketplace: boolean;
  productoInteres?: string | null;
  productoActual?: string | null;
  /** Nombre (o slug) del producto activo del agente V3 en el chat. */
  productoV3?: string | null;
  anuncioTitulo?: string | null;
  primerMensaje?: string | null;
};

/**
 * LA REGLA DE FAMILIA ("lo que el cliente terminó pidiendo"), en este orden:
 *  1. Línea Ventas 2 (Marketplace) -> Marketplace, pida lo que pida.
 *  2. EmbudoLead.productoInteres (lo que calcula el seguimiento inteligente). Si es una clave que
 *     no es de ninguna familia ("auxiliares", "poltronas"...) -> Otros.
 *  3. EmbudoLead.productoActual, si nombra una familia.
 *  4. El producto activo del agente V3, si nombra una familia.
 *  5. El primer mensaje del cliente (el texto del anuncio: "me interesa el COMBO de estética") y
 *     después el título del anuncio.
 *  6. Si nada lo dice -> Otros.
 */
export function familiaDelLead(datos: DatosDeFamilia): ClaveDeFamilia {
  if (datos.esMarketplace) return "marketplace";
  const interes = (datos.productoInteres ?? "").trim();
  if (interes) return familiaDeTexto(interes) ?? "otros";
  for (const texto of [datos.productoActual, datos.productoV3, datos.primerMensaje, datos.anuncioTitulo]) {
    const familia = familiaDeTexto(texto);
    if (familia) return familia;
  }
  return "otros";
}

/* --------------------------------------------------------------------------------------- pasos */

export const PASOS_SEMANALES = [
  { n: 1, clave: "llego", nombre: "Llegó", plural: "llegaron", singular: "llegó" },
  { n: 2, clave: "vioPrecio", nombre: "Vio precio o fotos", plural: "vieron precio o fotos", singular: "vio precio o fotos" },
  { n: 3, clave: "converso", nombre: "Conversó", plural: "conversaron", singular: "conversó" },
  { n: 4, clave: "intencion", nombre: "Mostró intención", plural: "mostraron intención de compra", singular: "mostró intención de compra" },
  {
    n: 5,
    clave: "cotizacion",
    nombre: "Cotización o anticipo",
    plural: "recibieron cotización o dieron anticipo",
    singular: "recibió cotización o dio anticipo",
  },
  { n: 6, clave: "venta", nombre: "Venta", plural: "compraron", singular: "compró" },
] as const;

export type ClaveDePaso = (typeof PASOS_SEMANALES)[number]["clave"];

/** Qué revisar cuando la fuga más grande sale de ese paso. Fijo por paso: no inventa causas. */
export const QUE_REVISAR: Record<Exclude<ClaveDePaso, "venta">, string> = {
  llego: "Revisa si el bot responde a todos y manda precio o fotos en los primeros mensajes.",
  vioPrecio: "Revisa si el mensaje con el precio o las fotos termina con una pregunta fácil de contestar.",
  converso: "Revisa si después del precio se les pregunta ciudad, color o forma de pago.",
  intencion: "Revisa si a quien dio ciudad, color o forma de pago se le envía el formulario de datos o la cotización el mismo día.",
  cotizacion: "Revisa el seguimiento a 24 h y 72 h de las cotizaciones y que la venta se marque Ganado en el CRM.",
};

export type MensajeDelLead = {
  direccion: "INBOUND" | "OUTBOUND" | string;
  tipo?: string | null;
  /** rawPayload.source: quién lo mandó (null = el bot o un flujo). */
  origen?: string | null;
  /** content, o la transcripción si es un audio. */
  texto?: string | null;
  en: Date | string;
};

export type LeadSemanal = DatosDeFamilia & {
  conversationId: string;
  entradaEn: Date | string;
  /** Mensajes del chat, del más viejo al más nuevo (puede venir desordenado: se ordena). */
  mensajes: MensajeDelLead[];
  /** Cotización o anticipo según el CRM/EmbudoLead/EmbudoEvento (ver arriba). */
  cotizacionCrm?: boolean;
  /** Ganado en el CRM o EmbudoLead.ventaEn. */
  ventaCrm?: boolean;
  /** Para la lista "Ver esos chats". */
  telefono4?: string | null;
  asesora?: string | null;
};

export const VENTANA_DE_MENSAJES_MS = 14 * 86_400_000;
export const MADURACION_MS = 72 * 3_600_000;

const SENALES_DE_INTENCION = new Set<TipoDeSenal>([
  "separar",
  "anticipo_pago",
  "acepta_precio",
  "pide_cotizacion",
  "direccion_fecha",
  "comprobante",
  "decision_proxima",
  "envio_ciudad",
  "tiempo_fabricacion",
  "color_medidas",
  "garantia",
  "forma_pago",
]);

/** Salientes que escribe una persona del equipo (CRM o celular). */
const ORIGENES_DE_ASESORA = new Set(["manual", "instance"]);
/** Salientes que no son una respuesta al cliente: notas de actividad, historial importado. */
const ORIGENES_QUE_NO_RESPONDEN = new Set(["activity", "evogo-history-sync", "evolution-sync", "llamada"]);

const FORMULARIO_DE_DATOS = /datos de cotizaci[oó]n|cotizaci[oó]n formal/i;

const ms = (valor: Date | string) => (valor instanceof Date ? valor.getTime() : new Date(valor).getTime());
const tipoDe = (mensaje: MensajeDelLead) => (mensaje.tipo ?? "TEXT").toUpperCase();

/** ¿El mensaje de la clienta trae una señal de compra fuerte o media? */
export function tieneIntencion(mensaje: Pick<MensajeDelLead, "tipo" | "texto">): boolean {
  if ((mensaje.tipo ?? "TEXT").toUpperCase() === "LOCATION") return true;
  return detectarSenales(mensaje.texto).some((senal) => SENALES_DE_INTENCION.has(senal.tipo));
}

/** ¿La asesora le mandó el formulario de datos para la cotización? */
export function esFormularioDeDatos(mensaje: MensajeDelLead): boolean {
  return (
    mensaje.direccion === "OUTBOUND" &&
    ORIGENES_DE_ASESORA.has(mensaje.origen ?? "") &&
    FORMULARIO_DE_DATOS.test(mensaje.texto ?? "")
  );
}

export type PasosDelLead = Record<ClaveDePaso, boolean>;

/** A qué pasos llegó un lead. Ver las definiciones arriba. */
export function pasosDelLead(lead: LeadSemanal): PasosDelLead {
  const entrada = ms(lead.entradaEn);
  const hasta = entrada + VENTANA_DE_MENSAJES_MS;
  const mensajes = [...lead.mensajes]
    .filter((mensaje) => tipoDe(mensaje) !== "SYSTEM")
    .sort((a, b) => ms(a.en) - ms(b.en));

  let vioPrecio = false;
  let primeraRespuesta: number | null = null;
  let entrantes = 0;
  let entrantesTrasRespuesta = 0;
  let intencion = false;
  let formulario = false;
  let primerEntranteVisto = false;

  for (const mensaje of mensajes) {
    const cuando = ms(mensaje.en);
    if (cuando < entrada - 60_000) continue;
    if (esFormularioDeDatos(mensaje)) formulario = true;
    if (cuando >= hasta) continue;

    if (mensaje.direccion === "OUTBOUND") {
      if (ORIGENES_QUE_NO_RESPONDEN.has(mensaje.origen ?? "")) continue;
      if (primeraRespuesta === null) primeraRespuesta = cuando;
      if (!vioPrecio && esPrecioOFotosDelBot({ direction: "OUTBOUND", type: mensaje.tipo, content: mensaje.texto, origen: mensaje.origen })) {
        vioPrecio = true;
      }
      continue;
    }
    if (mensaje.direccion !== "INBOUND") continue;
    entrantes += 1;
    if (primeraRespuesta !== null) entrantesTrasRespuesta += 1;
    // El primer mensaje es el texto del anuncio: no dice intención.
    if (primerEntranteVisto && !intencion && tieneIntencion(mensaje)) intencion = true;
    primerEntranteVisto = true;
  }

  const venta = Boolean(lead.ventaCrm);
  const cotizacion = venta || Boolean(lead.cotizacionCrm) || formulario;
  const intencionFinal = cotizacion || intencion;
  const converso = intencionFinal || (entrantes >= 2 && entrantesTrasRespuesta >= 1);
  return { llego: true, vioPrecio, converso, intencion: intencionFinal, cotizacion, venta };
}

/* ------------------------------------------------------------------------------------- embudo */

export type PasoDelEmbudo = {
  n: number;
  clave: ClaveDePaso;
  nombre: string;
  leads: number;
  /** % de los que llegaron (maduros). null = no hay base. */
  pct: number | null;
};

export type EmbudoSemanal = {
  /** Leads maduros (más de 72 h) de la semana: la base del 100 %. */
  llegaron: number;
  /** Leads de la semana con menos de 72 h: aparte. */
  enCurso: number;
  pasos: PasoDelEmbudo[];
  /** Por paso, los chats que llegaron a él pero no al siguiente (para "Ver esos chats"). */
  quedaron: Record<ClaveDePaso, string[]>;
};

export function porcentaje(parte: number, base: number): number | null {
  if (!base) return null;
  return Math.round((parte / base) * 1000) / 10;
}

/** Arma el embudo de un grupo de leads (ya filtrados por familia). */
export function armarEmbudo(leads: ReadonlyArray<LeadSemanal>, ahora: Date): EmbudoSemanal {
  const corte = ahora.getTime() - MADURACION_MS;
  const maduros = leads.filter((lead) => ms(lead.entradaEn) < corte);
  const conPasos = maduros.map((lead) => ({ id: lead.conversationId, pasos: pasosDelLead(lead) }));
  const llegaron = conPasos.length;
  const pasos = PASOS_SEMANALES.map((paso) => {
    const cuantos = conPasos.filter((fila) => fila.pasos[paso.clave]).length;
    return { n: paso.n, clave: paso.clave, nombre: paso.nombre, leads: cuantos, pct: porcentaje(cuantos, llegaron) };
  });
  const quedaron = Object.fromEntries(
    PASOS_SEMANALES.map((paso, indice) => {
      const siguiente = PASOS_SEMANALES[indice + 1];
      const ids = siguiente
        ? conPasos.filter((fila) => fila.pasos[paso.clave] && !fila.pasos[siguiente.clave]).map((fila) => fila.id)
        : [];
      return [paso.clave, ids];
    }),
  ) as Record<ClaveDePaso, string[]>;
  return { llegaron, enCurso: leads.length - maduros.length, pasos, quedaron };
}

export type Delta = { texto: string; tono: "sube" | "baja" | "igual" | "nada" };

const coma = (valor: number) => valor.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/** "88 %", "5 %", "0,2 %". */
export function textoPct(valor: number | null): string {
  if (valor === null) return "—";
  return `${coma(valor >= 1 ? Math.round(valor) : Math.round(valor * 10) / 10)} %`;
}

/**
 * Lo que cambió frente a la semana anterior. En "Llegó", la diferencia de leads ("↑ 88 más que la
 * semana pasada"); en los demás, puntos porcentuales del "% de los que llegaron".
 */
export function deltaDelPaso(actual: PasoDelEmbudo, anterior: PasoDelEmbudo | null | undefined): Delta {
  if (!anterior) return { texto: "", tono: "nada" };
  if (actual.clave === "llego") {
    const diferencia = actual.leads - anterior.leads;
    if (diferencia === 0) return { texto: "= igual que la semana pasada", tono: "igual" };
    return diferencia > 0
      ? { texto: `↑ ${diferencia} más que la semana pasada`, tono: "sube" }
      : { texto: `↓ ${-diferencia} menos que la semana pasada`, tono: "baja" };
  }
  if (actual.pct === null || anterior.pct === null) return { texto: "", tono: "nada" };
  const bruto = actual.pct - anterior.pct;
  const redondo = Math.abs(bruto) >= 1 ? Math.round(bruto) : Math.round(bruto * 10) / 10;
  if (redondo === 0) return { texto: "= igual", tono: "igual" };
  const valor = coma(Math.abs(redondo));
  const unidad = Math.abs(redondo) === 1 ? "punto" : "puntos";
  return redondo > 0 ? { texto: `↑ ${valor} ${unidad}`, tono: "sube" } : { texto: `↓ ${valor} ${unidad}`, tono: "baja" };
}

export type MayorFuga = {
  desde: ClaveDePaso;
  hacia: ClaveDePaso;
  /** Cuántos llegaron al paso de origen y cuántos al siguiente. */
  base: number;
  siguen: number;
  /** Cuántos chats se quedaron (llegaron al paso pero no al siguiente). */
  quedaron: number;
  /** % de la base que se quedó. */
  pctQuedaron: number;
  titulo: string;
  detalle: string;
  queRevisar: string;
  ids: string[];
};

/** Con menos de esta base, la última transición (cotización -> venta) no compite por la mayor fuga. */
export const BASE_MINIMA_ULTIMO_PASO = 20;

/**
 * El paso donde se pierden más: la mayor caída ABSOLUTA (los chats que llegaron a un paso y no al
 * siguiente) entre pasos consecutivos. La última transición solo cuenta si su base es de 20 o más.
 * Empate: gana la transición más temprana.
 */
export function mayorFuga(embudo: EmbudoSemanal): MayorFuga | null {
  let mejor: MayorFuga | null = null;
  for (let indice = 0; indice < PASOS_SEMANALES.length - 1; indice += 1) {
    const desde = PASOS_SEMANALES[indice];
    const hacia = PASOS_SEMANALES[indice + 1];
    const base = embudo.pasos[indice].leads;
    const siguen = embudo.pasos[indice + 1].leads;
    const esUltima = indice === PASOS_SEMANALES.length - 2;
    if (esUltima && base < BASE_MINIMA_ULTIMO_PASO) continue;
    const ids = embudo.quedaron[desde.clave];
    if (!ids.length) continue;
    if (mejor && ids.length <= mejor.quedaron) continue;
    const pctQuedaron = Math.round((ids.length / Math.max(base, 1)) * 100);
    mejor = {
      desde: desde.clave,
      hacia: hacia.clave,
      base,
      siguen,
      quedaron: ids.length,
      pctQuedaron,
      titulo: `De ${base} que ${base === 1 ? desde.singular : desde.plural}, solo ${siguen} ${siguen === 1 ? hacia.singular : hacia.plural}`,
      detalle: `${ids.length} ${ids.length === 1 ? "cliente se quedó" : "clientes se quedaron"} entre «${desde.nombre}» y «${hacia.nombre}» (${pctQuedaron} %).`,
      queRevisar: QUE_REVISAR[desde.clave as Exclude<ClaveDePaso, "venta">],
      ids,
    };
  }
  return mejor;
}

/* ------------------------------------------------------------------------- semanas (Bogotá) */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function diaUtc(dia: string) {
  return new Date(`${dia}T12:00:00.000Z`);
}

export function sumarDias(dia: string, dias: number): string {
  const fecha = diaUtc(dia);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** El lunes de la semana (lunes a domingo) que contiene ese día. */
export function lunesDe(dia: string): string {
  const semana = diaUtc(dia).getUTCDay(); // 0 = domingo
  return sumarDias(dia, -((semana + 6) % 7));
}

/** Por defecto: la semana pasada completa (lunes a domingo, hora Bogotá). */
export function semanaPorDefecto(ahora: Date): string {
  const hoyBogota = new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  return sumarDias(lunesDe(hoyBogota), -7);
}

/** Lo que llega en ?semana=: un lunes válido que no sea posterior a la semana por defecto. */
export function semanaPedida(valor: string | null | undefined, ahora: Date): string {
  const tope = semanaPorDefecto(ahora);
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || !Number.isFinite(diaUtc(valor).getTime())) return tope;
  const lunes = lunesDe(valor);
  return lunes > tope ? tope : lunes;
}

/** [lunes 00:00, lunes siguiente 00:00) de Bogotá, en instantes UTC. */
export function rangoDeSemana(lunes: string): { inicio: Date; fin: Date } {
  return {
    inicio: new Date(`${lunes}T00:00:00.000-05:00`),
    fin: new Date(`${sumarDias(lunes, 7)}T00:00:00.000-05:00`),
  };
}

/** "5–11 oct" o "28 sep – 4 oct". */
export function etiquetaDeSemana(lunes: string): string {
  const domingo = sumarDias(lunes, 6);
  const [, m1, d1] = lunes.split("-").map(Number);
  const [, m2, d2] = domingo.split("-").map(Number);
  return m1 === m2 ? `${d1}–${d2} ${MESES[m2 - 1]}` : `${d1} ${MESES[m1 - 1]} – ${d2} ${MESES[m2 - 1]}`;
}

/** "•••• 0204". Nunca más de 4 dígitos. */
export function telefonoEnmascarado(ultimos: string | null | undefined): string {
  const digitos = (ultimos ?? "").replace(/\D/g, "").slice(-4);
  return digitos.length === 4 ? `•••• ${digitos}` : "••••";
}

export function hrefDelChat(conversationId: string): string {
  return `/cliente/chats?chatKey=${encodeURIComponent(`agent:${conversationId}`)}&assigned=all`;
}
