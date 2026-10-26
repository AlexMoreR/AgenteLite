import type { Area } from "./reglas";

/*
  EL CEREBRO PARA LOS AGENTES DE ÁREA (reglas puras, sin base ni Drive).

  Cada agente lee SOLO su parte del cerebro para no gastar tokens, y escribe SOLO en su carpeta
  "Aprendizajes de <área>". Las decisiones del negocio las escriben el dueño y Claude, nunca los agentes.
*/

/** La carpeta (o documento) que leen los tres agentes. Los agentes NUNCA escriben aquí. */
export const CARPETA_DE_DECISIONES = "Decisiones de Magilus";

/** Qué carpetas del cerebro lee cada área (además de las decisiones y de su carpeta de aprendizajes). */
export const CARPETAS_QUE_LEE: Record<Area, readonly string[]> = {
  ventas: ["Ventas", "Precios", "Equipo"],
  marketing: ["Marketing", "Precios"],
  sistemas: ["Tecnología"],
};

export const ETIQUETA_DE_AGENTE: Record<Area, string> = {
  ventas: "Agente de Ventas",
  marketing: "Agente de Marketing",
  sistemas: "Agente de Sistemas",
};

/** Lo que queda en CerebroCambio.origen cuando escribe un agente. */
export const ORIGEN_DE_ESCRITURA: Record<Area, string> = {
  ventas: "AGENTE_VENTAS",
  marketing: "AGENTE_MARKETING",
  sistemas: "AGENTE_SISTEMAS",
};

const ETIQUETA_PARA_CARPETA: Record<Area, string> = { ventas: "Ventas", marketing: "Marketing", sistemas: "Sistemas" };

export const carpetaDeAprendizajes = (area: Area) => `Aprendizajes de ${ETIQUETA_PARA_CARPETA[area]}`;

/** Topes para no gastar tokens ni llenar el Drive. */
export const MAXIMO_DOCUMENTOS_LISTADOS = 60;
export const MAXIMO_RESULTADOS_DE_BUSQUEDA = 5;
export const MAXIMO_TEXTO_POR_DOCUMENTO_LEIDO = 12_000;
export const MAXIMO_TEXTO_DE_DECISIONES = 8_000;
export const MAXIMO_APRENDIZAJE = 1_500;
export const MAXIMO_ARCHIVO_DE_APRENDIZAJES = 60_000;

/** Minúsculas, sin tildes y sin espacios de más: "Tecnología" y "tecnologia" son la misma carpeta. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** El primer tramo de la ruta, sin la extensión si es un documento suelto: "Precios/lista.md" → "precios". */
function primerTramo(ruta: string): string {
  const partes = ruta.split("/").filter(Boolean);
  if (!partes.length) return "";
  const primero = partes[0];
  return normalizar(partes.length === 1 ? primero.replace(/\.(md|txt)$/i, "") : primero);
}

/** ¿Este documento (por su ruta) es de una de estas carpetas del primer nivel? */
export function estaEnCarpeta(ruta: string, carpeta: string): boolean {
  return primerTramo(ruta) === normalizar(carpeta);
}

/** Las carpetas que un área puede LEER. */
export function carpetasDeLectura(area: Area): string[] {
  return [...CARPETAS_QUE_LEE[area], CARPETA_DE_DECISIONES, carpetaDeAprendizajes(area)];
}

/** ¿Esta área puede leer este documento? Lo de otras carpetas se rechaza. */
export function puedeLeerElArea(area: Area, ruta: string): boolean {
  return carpetasDeLectura(area).some((carpeta) => estaEnCarpeta(ruta, carpeta));
}

export const esDocumentoDeDecisiones = (ruta: string) => estaEnCarpeta(ruta, CARPETA_DE_DECISIONES);

/** El nombre del archivo del mes donde se anota: aprendizajes-2026-10.md */
export function archivoDeAprendizajes(fecha: string): string {
  return `aprendizajes-${fecha.slice(0, 7)}.md`;
}

export const esArchivoDeAprendizajes = (nombre: string) => /^aprendizajes-\d{4}-\d{2}\.md$/.test(nombre);

/** El bloque que se agrega al final: fecha y nombre del agente, y el texto (recortado y sin encabezados que rompan el archivo). */
export function bloqueDeAprendizaje(datos: { fecha: string; area: Area; texto: string }): string {
  const limpio = datos.texto
    .replace(/\r/g, "")
    .split("\n")
    .map((linea) => linea.replace(/^\s*#{1,6}\s+/, "").trimEnd())
    .join("\n")
    .trim();
  return `## ${datos.fecha} — ${ETIQUETA_DE_AGENTE[datos.area]}\n\n${limpio}`;
}

/** Valida el texto de un aprendizaje: devuelve el motivo de rechazo o null. */
export function problemaDelAprendizaje(texto: unknown): string | null {
  if (typeof texto !== "string" || texto.trim().length < 10) return "Falta el texto del aprendizaje (mínimo 10 letras).";
  if (texto.length > MAXIMO_APRENDIZAJE) {
    return `El aprendizaje es muy largo (${texto.length} letras): el máximo es ${MAXIMO_APRENDIZAJE}. Anota solo lo esencial, unas pocas líneas.`;
  }
  return null;
}

/* ── Alertas de "posible dato viejo" ── */

export const FAMILIA_DE_LA_ALERTA = "CEREBRO";
export const SEVERIDAD_DE_LA_ALERTA = "OBSERVACION";
export const FUENTES_DEL_CHOQUE = ["crm", "gestion"] as const;
export type FuenteDelChoque = (typeof FUENTES_DEL_CHOQUE)[number];

export const ETIQUETA_DE_FUENTE: Record<FuenteDelChoque, string> = { crm: "el CRM", gestion: "Gestión" };

export const esFuenteDelChoque = (valor: unknown): valor is FuenteDelChoque => FUENTES_DEL_CHOQUE.includes(valor as FuenteDelChoque);

/** Un hash corto y estable (no es seguridad: solo para que la misma clave dé siempre lo mismo). */
function hashCorto(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i += 1) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** La clave de la alerta: una sola abierta por documento y dato, sea quien sea el agente que la marque. */
export function claveDeLaAlerta(documento: string, dato: string): string {
  const doc = normalizar(documento).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `CEREBRO:${doc}:${hashCorto(normalizar(dato))}`;
}

export type PedidoDeDatoViejo = {
  area: Area;
  documento: string;
  dato: string;
  loDiceElCerebro: string;
  loDiceLaFuente: string;
  fuente: FuenteDelChoque;
};

const recorte = (texto: unknown, largo: number) => (typeof texto === "string" ? texto.replace(/\s+/g, " ").trim().slice(0, largo) : "");

/** Lee y valida lo que manda el agente. */
export function leerPedidoDeDatoViejo(area: Area, args: Record<string, unknown>): { ok: true; pedido: PedidoDeDatoViejo } | { ok: false; error: string } {
  const documento = recorte(args.documento, 300);
  const loDiceElCerebro = recorte(args.lo_que_dice_el_cerebro, 600);
  const loDiceLaFuente = recorte(args.lo_que_dice_el_sistema, 600);
  if (!documento) return { ok: false, error: "Falta el documento del cerebro (su ruta, por ejemplo 'Precios/Lista de precios.md')." };
  if (!puedeLeerElArea(area, documento)) {
    return { ok: false, error: `Ese documento no es de las carpetas de ${ETIQUETA_DE_AGENTE[area]}. Solo se marcan documentos que ya leíste con cerebro_del_area.` };
  }
  if (!loDiceElCerebro) return { ok: false, error: "Falta lo que dice el cerebro." };
  if (!loDiceLaFuente) return { ok: false, error: "Falta lo que dice el CRM o Gestión." };
  if (!esFuenteDelChoque(args.fuente)) return { ok: false, error: 'La fuente tiene que ser "crm" o "gestion".' };
  const dato = recorte(args.dato, 120) || loDiceElCerebro.slice(0, 120);
  return { ok: true, pedido: { area, documento, dato, loDiceElCerebro, loDiceLaFuente, fuente: args.fuente } };
}

export const tituloDeLaAlerta = (pedido: PedidoDeDatoViejo) => `Posible dato viejo: ${pedido.dato}`.slice(0, 300);

export function textoDeLaAlertaDeDatoViejo(datos: { pedido: PedidoDeDatoViejo; fecha: string; veces: number }): string {
  const { pedido } = datos;
  return [
    `[OBSERVACIÓN] ${tituloDeLaAlerta(pedido)}`,
    `Marcado por: ${ETIQUETA_DE_AGENTE[pedido.area]} · última vez ${datos.fecha} · visto ${datos.veces} vez/veces`,
    "",
    `Documento del cerebro: ${pedido.documento}`,
    `Lo que dice el cerebro: ${pedido.loDiceElCerebro}`,
    `Lo que dice ${ETIQUETA_DE_FUENTE[pedido.fuente]}: ${pedido.loDiceLaFuente}`,
    "",
    "No se cambió ningún dato. Es una duda: el dueño decide cuál está al día y lo corrige en el cerebro o en el sistema; esta alerta la cierra el dueño.",
  ].join("\n");
}

/**
 * ¿Un agente puede ESCRIBIR en esta ruta? Solo en aprendizajes-AAAA-MM.md, dentro de la carpeta
 * "Aprendizajes de <su área>". Nunca en Decisiones de Magilus ni en otra carpeta.
 */
export function puedeAnotarEn(area: Area, ruta: string): boolean {
  const partes = ruta.split("/").filter(Boolean);
  return partes.length === 2 && normalizar(partes[0]) === normalizar(carpetaDeAprendizajes(area)) && esArchivoDeAprendizajes(partes[1]);
}
