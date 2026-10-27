/**
 * ALERTAS INTERNAS (reglas puras, sin base ni red). La página /cliente/alertas guarda TODA alerta; por WhatsApp
 * solo salen las URGENTES, con un mensaje de dos líneas y el link a la página (decisión del dueño, 29-oct-2026).
 *
 * La prioridad de cada fuente se decide AQUÍ (un solo archivo, fácil de ajustar): si una alerta importante queda
 * muy baja, se cambia en este mapa y no en cada servicio.
 */

export const PRIORIDADES = ["URGENTE", "ALTA", "MEDIA", "BAJA"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

export const ESTADOS_DE_ALERTA = ["NUEVA", "VISTA", "RESUELTA"] as const;
export type EstadoDeAlerta = (typeof ESTADOS_DE_ALERTA)[number];

export const ETIQUETA_DE_PRIORIDAD: Record<Prioridad, string> = { URGENTE: "Urgente", ALTA: "Alta", MEDIA: "Media", BAJA: "Baja" };
export const ETIQUETA_DE_ESTADO: Record<EstadoDeAlerta, string> = { NUEVA: "Nueva", VISTA: "Vista", RESUELTA: "Resuelta" };

/** 0 = lo más importante. */
export const ORDEN_DE_PRIORIDAD: Record<Prioridad, number> = { URGENTE: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };

export const ENLACE_DE_ALERTAS = "https://app.aizenbot.com/cliente/alertas";
export const MAXIMO_TITULO = 90;

/** Los sistemas que generan alertas (lo que se ve en la columna "Sistema"). */
export const ORIGEN_SUPERVISOR = "Supervisor";
export const ORIGEN_COORDINADOR = "Coordinador";
export const ORIGEN_LINEA = "Línea de WhatsApp";
export const ORIGEN_POR_AREA: Record<string, string> = {
  ventas: "Agente de Ventas",
  marketing: "Agente de Marketing",
  sistemas: "Agente de Sistemas",
};

export type AlertaOrdenable = { prioridad: string; creadoEn: Date | string };

/** Texto → prioridad. Lo que no se reconoce es null (quien llama decide el valor por defecto). */
export function leerPrioridad(valor: unknown): Prioridad | null {
  const texto = String(valor ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return (PRIORIDADES as readonly string[]).includes(texto) ? (texto as Prioridad) : null;
}

/** Por WhatsApp solo salen las URGENTES. */
export const salePorWhatsApp = (prioridad: Prioridad | string): boolean => prioridad === "URGENTE";

/** Por prioridad (Urgente primero) y, dentro de cada una, de la más nueva a la más vieja. No cambia la lista original. */
export function ordenarAlertas<T extends AlertaOrdenable>(alertas: readonly T[]): T[] {
  const peso = (alerta: T) => ORDEN_DE_PRIORIDAD[alerta.prioridad as Prioridad] ?? PRIORIDADES.length;
  return [...alertas].sort((a, b) => peso(a) - peso(b) || new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime());
}

/** Un título en una sola línea y de largo acotado. */
export function tituloCorto(valor: string, maximo = MAXIMO_TITULO): string {
  const limpio = String(valor ?? "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio;
}

/** El título sale de la primera línea con contenido del texto. */
export function tituloDelTexto(texto: string, maximo = MAXIMO_TITULO): string {
  const primera = String(texto ?? "")
    .split("\n")
    .find((linea) => linea.trim());
  // Sin el emoji o los símbolos del inicio: el aviso urgente ya trae el suyo.
  return tituloCorto((primera ?? "").replace(/^[^\p{L}\p{N}"¿¡(]+/u, ""), maximo) || "Alerta sin título";
}

/** El WhatsApp de una urgente: DOS líneas, el título corto y el link. Nada de texto largo. */
export function textoDeUrgente(titulo: string): string {
  return `🚨 Urgente: ${tituloCorto(titulo)}\nVer: ${ENLACE_DE_ALERTAS}`;
}

/** Varias urgentes juntas en un solo mensaje (también de dos líneas). */
export function textoDeVariasUrgentes(titulos: readonly string[]): string {
  if (titulos.length <= 1) return textoDeUrgente(titulos[0] ?? "Alerta urgente");
  return `🚨 Urgente: ${titulos.length} alertas (${tituloCorto(titulos[0], 60)} y otras)\nVer: ${ENLACE_DE_ALERTAS}`;
}

/** Gravedad del Supervisor (avisos por gravedad) → prioridad: CRÍTICO = Urgente, IMPORTANTE = Alta, OBSERVACIÓN = Baja. */
export function prioridadDeGravedad(gravedad: string): Prioridad {
  if (gravedad === "CRITICO") return "URGENTE";
  if (gravedad === "OBSERVACION") return "BAJA";
  return "ALTA";
}

/** ¿El motivo habla de dinero, Meta Ads o una clave/permiso? Solo eso hace urgente un "necesita tu decisión". */
export function esDeDineroMetaOClave(texto: string): boolean {
  return /\b(meta ads?|dinero|presupuesto|gasto|pago|pagos|cobro|plata|clave|claves|token|tokens|credencial\w*|contrase\w+|api ?key|secret\w*|acceso|permiso\w*)\b/i.test(String(texto ?? ""));
}

/** La clave de una alerta sin clave propia: el sistema y el título (hash corto, para no guardar textos largos). */
export function claveDeAlerta(origen: string, titulo: string): string {
  const base = `${origen}|${tituloCorto(titulo, 200).toLowerCase()}`;
  let hash = 5381;
  for (let i = 0; i < base.length; i += 1) hash = ((hash << 5) + hash + base.charCodeAt(i)) | 0;
  return `${origen.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${(hash >>> 0).toString(36)}`;
}
