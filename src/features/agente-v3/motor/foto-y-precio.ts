import { normalizar, type Accion, type ReglaV3 } from "../domain/reglas";

/**
 * FOTO + PRECIO: la clienta manda la foto de un producto y pregunta "¿qué valor tiene así?".
 *
 * Caso real (08-10-2026): una clienta entró por el anuncio del combo, mandó la captura de una silla
 * rosada de Instagram y preguntó "Qué valor tiene así". Ganó la regla de frase genérica del precio
 * del combo y le contestamos $989.000 por una silla. La regla de intención que cubría el caso
 * existía, pero nunca ganaba: las frases pesan menos, y el motor no sabía que el mensaje anterior
 * de la clienta había sido una FOTO.
 *
 * Esto es un desvío acotado y explícito, no un reordenamiento del libro: SOLO cuando hay una foto
 * reciente de la clienta y el mensaje pregunta precio o señala la foto, las reglas genéricas de
 * precio no se aplican.
 */

/** Un mensaje reciente del chat, como lo ve el motor: quién, de qué tipo y cuándo. */
export type MensajeReciente = {
  de: "cliente" | "negocio";
  /** Tipo del mensaje en la base: "TEXT", "IMAGE", "AUDIO"... */
  tipo: string;
  texto?: string | null;
  cuando: Date | string;
};

/** La foto que mandó la clienta hace poco, con lo que escribió junto a ella (si escribió algo). */
export type FotoDelCliente = {
  pie: string | null;
  /** Lo que muestra la foto, descrito por la IA, si se tiene. Solo para la IA que reconoce intenciones. */
  descripcion?: string | null;
};

/** Se miran los últimos 2 mensajes de la clienta, y la foto tiene que ser de los últimos 10 minutos. */
export const MENSAJES_DE_LA_CLIENTA_A_MIRAR = 2;
export const VENTANA_DE_LA_FOTO_MIN = 10;

export const TEXTO_FOTO_Y_PRECIO =
  "Déjame confirmarte el *valor de esa referencia* con exactitud. 👨🏻‍💻 Una asesora te escribe en un momento. Mientras tanto, ¿en qué *ciudad* estás?";
export const MOTIVO_FOTO_Y_PRECIO = "Mandó foto de un producto y pregunta el precio";

/**
 * Lo que hace el motor si el libro no tiene su propia regla de "foto + precio": avisar, pausar y
 * no dar ningún precio. Es una regla de mentira, sin guardar en el libro, para que la traza diga
 * igual quién contestó.
 */
export const REGLA_FOTO_Y_PRECIO_POR_DEFECTO: ReglaV3 = {
  id: "motor-foto-y-precio",
  nombre: "Foto de un producto + pregunta el precio (comportamiento del motor)",
  cuando: { tipo: "intencion", descripcion: "Manda foto o captura de un producto y pregunta el precio" },
  entonces: [
    { tipo: "mensaje", texto: TEXTO_FOTO_Y_PRECIO },
    { tipo: "avisar_asesor", motivo: MOTIVO_FOTO_Y_PRECIO },
    { tipo: "pausar_ia" },
  ] satisfies Accion[],
  activa: true,
};

/**
 * ¿Entre los últimos 2 mensajes de la CLIENTA hay una foto de los últimos 10 minutos?
 *
 * Solo cuentan las fotos que mandó ella: las fotos del combo que enviamos nosotros no son una
 * pregunta por otra referencia. `recientes` va del más viejo al más nuevo e incluye el mensaje que
 * se está contestando.
 */
export function fotoDelClienteReciente(
  recientes: MensajeReciente[] | undefined,
  ahora: Date = new Date(),
): FotoDelCliente | null {
  if (!recientes?.length) return null;
  const deLaClienta = recientes.filter((mensaje) => mensaje.de === "cliente").slice(-MENSAJES_DE_LA_CLIENTA_A_MIRAR);
  for (const mensaje of [...deLaClienta].reverse()) {
    if (mensaje.tipo !== "IMAGE") continue;
    const cuando = new Date(mensaje.cuando).getTime();
    if (!Number.isFinite(cuando)) continue;
    const minutos = (ahora.getTime() - cuando) / 60_000;
    if (minutos > VENTANA_DE_LA_FOTO_MIN) continue;
    return { pie: mensaje.texto?.trim() || null };
  }
  return null;
}

/*
  Lo que dice la clienta cuando pregunta por la foto: el precio ("valor", "cuánto") o la señala
  con una frase COMPLETA ("y esta", "la tienen"). "esta", "este" o "así" sueltas NO cuentan:
  "¿cómo está?" o "hola, está disponible?" no preguntan por la foto. Se compara por palabra
  entera, sin tildes, para que "vale" no enganche dentro de "equivale".
*/
const PALABRAS_DE_PRECIO = ["valor", "precio", "cuanto", "vale", "cuesta", "costo"];
const FRASES_QUE_SENALAN_LA_FOTO = [
  "y esta",
  "y este",
  "esta silla",
  "este modelo",
  "esta referencia",
  "la tienen",
  "lo tienen",
  "la tienen asi",
  "asi la tienen",
  "de esta",
  "de este",
];

export function preguntaPorLaFoto(mensaje: string): boolean {
  const texto = ` ${normalizar(mensaje)} `;
  if (!texto.trim()) return false;
  return [...PALABRAS_DE_PRECIO, ...FRASES_QUE_SENALAN_LA_FOTO].some((frase) => texto.includes(` ${frase} `));
}

/**
 * ¿Es ésta la regla de intención del libro para "manda foto de un producto y pregunta el precio"?
 * Se reconoce por su descripción: habla de foto/captura/imagen y de precio/valor.
 */
export function esReglaDeFotoYPrecio(regla: ReglaV3): boolean {
  if (regla.cuando.tipo !== "intencion") return false;
  const descripcion = ` ${normalizar(regla.cuando.descripcion)} `;
  const hablaDeFoto = /\s(foto|fotos|captura|capturas|imagen|imagenes|pantallazo)\s/.test(descripcion);
  const hablaDePrecio = /\s(precio|precios|valor|cuanto|vale|cuesta)\s/.test(descripcion);
  return hablaDeFoto && hablaDePrecio;
}
