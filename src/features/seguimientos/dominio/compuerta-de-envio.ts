/**
 * LA REVISIÓN FINAL ANTES DE ENVIAR UN SEGUIMIENTO AUTOMÁTICO (tarjeta yp8xzwvm, 4-nov-2026). Código puro.
 *
 * Reporte de María Camila (Ventas 1, 3-nov):
 *  - el mismo seguimiento salió DOS veces seguidas al mismo chat ("Así te confirmo el envío 🚚 ¿En qué
 *    ciudad lo recibirías?", "Como es fabricación sobre pedido… ¿Para cuándo lo necesitas?");
 *  - la clienta pidió un combo para UÑAS, la asesora le mandó el PDF "COMBO MESA Y SILLAS MANICURA" y una
 *    hora después el automático le escribió "Recuerda que el combo camillas tiene garantía de 1 año…".
 *
 * Aquí está lo que decide si un texto ya listo para salir se frena:
 *  - `texto_repetido`: ese chat ya recibió ese mismo texto de un seguimiento automático en los últimos 7 días;
 *  - `otro_producto`: el chat va de otro producto y el seguimiento habla del combo (o de las camillas).
 *
 * Y la función que dice de qué producto va el chat (`productoVigenteDelChat`): gana la señal más reciente,
 * y solo cuentan las EXPLÍCITAS (el nombre o el texto de un archivo que mandamos, o un pedido claro de la
 * clienta). "Uñas y pestañas", la respuesta a "¿qué servicios vas a ofrecer?", NO es un cambio de producto:
 * es la respuesta normal del embudo del combo.
 */

import { familiaDelTexto, nombreDeFamilia } from "../../seguimiento-inteligente/dominio/producto";

/** Días hacia atrás en los que un mismo texto automático no se repite. */
export const DIAS_SIN_REPETIR = 7;

export type MotivoDeCompuerta = "texto_repetido" | "otro_producto";
export type FrenoDeCompuerta = { motivo: MotivoDeCompuerta; detalle: string };

/** Minúsculas, sin tildes, sin emojis ni signos y con un solo espacio. */
export function normalizarParaComparar(texto: string | null | undefined): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** El texto que ya salió tal cual (sin contar tildes, emojis, signos ni mayúsculas). null = no salió. */
export function textoYaEnviado(texto: string, previos: Array<string | null | undefined>): string | null {
  const este = normalizarParaComparar(texto);
  if (!este) return null;
  return previos.find((previo) => normalizarParaComparar(previo) === este) ?? null;
}

/* ------------------------------------------------------------------------------------------------
   De qué producto va el chat
------------------------------------------------------------------------------------------------ */

/** Las familias del combo: hablar de la camilla o del combo es hablar del mismo embudo. */
const DEL_COMBO = new Set(["combo-camilla", "camillas"]);

/**
 * Familias que una sola palabra no alcanza para dar por cambio de producto: un butaco, un carrito, un espejo
 * o una recepción también salen en la charla del combo. Solo cuentan si el texto habla de manicure o uñas.
 */
const AMBIGUAS = new Set(["butacos-manicure", "auxiliares", "tocador", "sofa-recepcion"]);
const DE_MANICURE = /\b(manicur\w*|pedicur\w*|unas|mani ?pedi|mani y pedi)\b/;

/**
 * El pedido explícito de un producto de uñas que `familiaDelTexto` no reconoce: "combo para uñas",
 * "necesito uno para uñas", y la mala transcripción del audio del caso real ("necesito uno para una"):
 * "una" solo cuenta al final de la frase, para no leer "necesito uno para una amiga".
 */
const PIDE_UNAS = [
  /\bcombo (de |para )(las )?(unas|manicur\w*|pedicur\w*)\b/,
  /\b(necesito|quiero|busco|me interesa)( un| uno| el| la)?( combo| mesa)? (de |para )(las )?(unas|manicur\w*|pedicur\w*)\b/,
  /\b(necesito|quiero|busco)( un| uno| el)?( combo)? para una(?=\s*([.,!?]|$))/,
];

function normalizarParaBuscar(texto: string): string {
  return normalizarParaComparar(texto).replace(/\s+/g, " ");
}

/**
 * La familia que nombra una señal, o null si no es explícita. `deLaClienta` agrega los pedidos de uñas
 * que solo valen dichos por ella.
 */
export function familiaDeLaSenal(texto: string | null | undefined, deLaClienta: boolean): string | null {
  const limpio = (texto ?? "").trim();
  if (!limpio) return null;
  const normal = normalizarParaBuscar(limpio);
  if (deLaClienta && PIDE_UNAS.some((patron) => patron.test(normal))) return "mesa-manicure";
  const familia = familiaDelTexto(limpio.replace(/[_-]+/g, " "));
  if (!familia) return null;
  if (AMBIGUAS.has(familia) && !DE_MANICURE.test(normal)) return null;
  return familia;
}

export type MensajeParaElProducto = {
  direccion: "IN" | "OUT";
  /** `Message.type`: TEXT, AUDIO, DOCUMENT, IMAGE, VIDEO… */
  tipo: string;
  /** El texto, la transcripción del audio o el pie del archivo. */
  texto: string | null;
  /** El nombre del archivo, si es un documento. */
  nombreDeArchivo?: string | null;
  en: Date;
};

export type ProductoVigente = {
  /** Clave de la familia (`seguimiento-inteligente/dominio/producto.ts`). */
  familia: string;
  nombre: string;
  /** true = el combo o las camillas (el embudo de siempre). */
  esElCombo: boolean;
  /** Qué señal lo decidió, para el registro. */
  senal: string;
};

const ARCHIVOS = new Set(["DOCUMENT", "IMAGE", "VIDEO"]);

/**
 * De qué producto va el chat: la señal explícita MÁS RECIENTE. Señales:
 *  - un archivo que mandamos (documento, foto o video) cuyo nombre o pie nombra una familia;
 *  - un mensaje de la clienta (texto o audio transcrito) que pide un producto con claridad.
 * Los textos nuestros no cuentan (el bot habla del combo en cada paso del embudo). null = no hay señal.
 */
export function productoVigenteDelChat(mensajes: MensajeParaElProducto[]): ProductoVigente | null {
  const ordenados = [...mensajes].sort((a, b) => b.en.getTime() - a.en.getTime());
  for (const mensaje of ordenados) {
    let familia: string | null = null;
    let senal = "";
    if (mensaje.direccion === "OUT") {
      if (!ARCHIVOS.has(mensaje.tipo)) continue;
      for (const texto of [mensaje.nombreDeArchivo, mensaje.texto]) {
        familia = familiaDeLaSenal(texto, false);
        if (familia) {
          senal = `archivo «${(texto ?? "").trim().slice(0, 80)}»`;
          break;
        }
      }
    } else {
      familia = familiaDeLaSenal(mensaje.texto, true);
      if (familia) senal = `la clienta dijo «${(mensaje.texto ?? "").trim().slice(0, 80)}»`;
    }
    if (familia) {
      return { familia, nombre: nombreDeFamilia(familia) ?? familia, esElCombo: DEL_COMBO.has(familia), senal };
    }
  }
  return null;
}

/**
 * ¿El texto habla del combo de camillas? Nombra la camilla, o dice "combo" sin nombrar otro producto
 * ("el combo de mesa y sillas" es otro producto y sí puede salir en ese chat).
 */
export function hablaDelCombo(texto: string | null | undefined): boolean {
  const normal = normalizarParaBuscar(texto ?? "");
  if (!normal) return false;
  if (/\bcamill/.test(normal)) return true;
  if (!/\bcombo\b/.test(normal)) return false;
  const familia = familiaDelTexto(texto ?? "");
  return !familia || DEL_COMBO.has(familia);
}

/**
 * La revisión final de los textos de UN seguimiento, ya listos para salir. null = puede salir.
 *  - `previosAutomaticos`: lo que ya le salió a este chat de seguimientos automáticos en los últimos 7 días.
 *  - `producto`: el producto vigente del chat (de `productoVigenteDelChat`).
 */
export function decidirCompuerta(input: {
  textos: string[];
  previosAutomaticos: Array<string | null | undefined>;
  producto: ProductoVigente | null;
}): FrenoDeCompuerta | null {
  const textos = input.textos.map((texto) => texto.trim()).filter(Boolean);
  for (const texto of textos) {
    const repetido = textoYaEnviado(texto, input.previosAutomaticos);
    if (repetido) {
      return { motivo: "texto_repetido", detalle: `ya le salió este mismo texto: «${texto.slice(0, 80)}»` };
    }
  }
  if (input.producto && !input.producto.esElCombo) {
    const delCombo = textos.find((texto) => hablaDelCombo(texto));
    if (delCombo) {
      return {
        motivo: "otro_producto",
        detalle: `el chat es de ${input.producto.nombre} (${input.producto.senal}) y el seguimiento habla del combo: «${delCombo.slice(0, 80)}»`,
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
   Medir (herramienta del MCP `seguimientos_repetidos`)
------------------------------------------------------------------------------------------------ */

export type MensajeMedido = MensajeParaElProducto & {
  /** Salió solo (un seguimiento automático: `ORIGENES_AUTOMATICOS`). */
  automatico: boolean;
};

export type HallazgoDeRepetido = { texto: string; en: Date; anteriorEn: Date };
export type HallazgoDeCombo = { texto: string; en: Date; producto: string; senal: string };

export type MedicionDelChat = {
  /** El mismo texto automático otra vez, sin que la clienta escribiera entre los dos. */
  seguidos: HallazgoDeRepetido[];
  /** El mismo texto automático otra vez, con respuesta de la clienta de por medio. */
  conRespuesta: HallazgoDeRepetido[];
  /** Un automático que habla del combo en un chat que ya iba de otro producto. */
  comboEnOtroProducto: HallazgoDeCombo[];
};

/**
 * Mide UN chat. Solo cuentan los automáticos desde `desde`; los anteriores sirven para comparar (un texto
 * que ya salió en los 7 días antes) y para saber el producto.
 */
export function medirChat(mensajes: MensajeMedido[], desde: Date): MedicionDelChat {
  const ordenados = [...mensajes].sort((a, b) => a.en.getTime() - b.en.getTime());
  const medicion: MedicionDelChat = { seguidos: [], conRespuesta: [], comboEnOtroProducto: [] };
  const vistos = new Map<string, { en: Date; huboRespuesta: boolean }>();
  for (const [indice, mensaje] of ordenados.entries()) {
    if (mensaje.direccion === "IN") {
      for (const visto of vistos.values()) visto.huboRespuesta = true;
      continue;
    }
    const texto = (mensaje.texto ?? "").trim();
    if (!mensaje.automatico || !texto) continue;
    const clave = normalizarParaComparar(texto);
    const anterior = clave ? vistos.get(clave) : undefined;
    const cuenta = mensaje.en.getTime() >= desde.getTime();
    if (cuenta && anterior && mensaje.en.getTime() - anterior.en.getTime() <= DIAS_SIN_REPETIR * 24 * 3_600_000) {
      const hallazgo = { texto, en: mensaje.en, anteriorEn: anterior.en };
      (anterior.huboRespuesta ? medicion.conRespuesta : medicion.seguidos).push(hallazgo);
    }
    if (clave) vistos.set(clave, { en: mensaje.en, huboRespuesta: false });
    if (cuenta && hablaDelCombo(texto)) {
      const producto = productoVigenteDelChat(ordenados.slice(0, indice));
      if (producto && !producto.esElCombo) {
        medicion.comboEnOtroProducto.push({ texto, en: mensaje.en, producto: producto.nombre, senal: producto.senal });
      }
    }
  }
  return medicion;
}
