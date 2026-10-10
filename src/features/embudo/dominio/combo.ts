/**
 * ¿ESTE LEAD ES DEL COMBO DE CAMILLA? (Embudo F1)
 *
 * Cuenta como Combo si entró por un anuncio del combo, si su primer mensaje lo nombra ("Hola,
 * QUIERO EL COMBO...") o si el primer producto que activó el agente V3 es el combo. Si después
 * cambia a otro producto, es "mezcla" y queda fuera del panel por defecto.
 *
 * La configuración vive en AppSetting `embudo:config:<workspaceId>` (JSON); sin ella se usan los
 * valores por defecto de abajo. Código puro: se prueba con `npm run test:embudo`.
 */

/** La clave con la que se guarda el combo en EmbudoLead.productoEntrada/productoActual. */
export const CLAVE_COMBO = "combo-camilla";

export type ConfigEmbudo = {
  /** Ids de productos (del V3 / Gestión) que son el combo, además de los que se reconocen por nombre. */
  comboProductoIds: string[];
  /** Ids de anuncios de Meta (sourceId) del combo. */
  comboAnuncioIds: string[];
  /** Si el título del anuncio contiene alguno de estos textos, es del combo. */
  comboTituloPatrones: string[];
};

export const CONFIG_EMBUDO_POR_DEFECTO: ConfigEmbudo = {
  comboProductoIds: [],
  comboAnuncioIds: [],
  comboTituloPatrones: ["combo", "camilla", "equipa tu espacio de estetica"],
};

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function listaDeTextos(valor: unknown): string[] | null {
  if (!Array.isArray(valor)) return null;
  return valor.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

/** Lee el JSON guardado; lo que falte o venga mal queda con el valor por defecto. */
export function leerConfigEmbudoDeTexto(valor: string | null | undefined): ConfigEmbudo {
  if (!valor) return CONFIG_EMBUDO_POR_DEFECTO;
  try {
    const guardado = JSON.parse(valor) as Record<string, unknown>;
    return {
      comboProductoIds: listaDeTextos(guardado.comboProductoIds) ?? CONFIG_EMBUDO_POR_DEFECTO.comboProductoIds,
      comboAnuncioIds: listaDeTextos(guardado.comboAnuncioIds) ?? CONFIG_EMBUDO_POR_DEFECTO.comboAnuncioIds,
      comboTituloPatrones: listaDeTextos(guardado.comboTituloPatrones) ?? CONFIG_EMBUDO_POR_DEFECTO.comboTituloPatrones,
    };
  } catch {
    return CONFIG_EMBUDO_POR_DEFECTO;
  }
}

export function esAnuncioDelCombo(
  anuncio: { titulo?: string | null; id?: string | null; cuerpo?: string | null } | null | undefined,
  config: ConfigEmbudo = CONFIG_EMBUDO_POR_DEFECTO,
): boolean {
  if (!anuncio) return false;
  if (anuncio.id && config.comboAnuncioIds.includes(anuncio.id)) return true;
  const titulo = normalizar(anuncio.titulo);
  if (!titulo) return false;
  return config.comboTituloPatrones.some((patron) => {
    const limpio = normalizar(patron);
    return limpio.length > 0 && titulo.includes(limpio);
  });
}

/** El primer mensaje lo nombra: "Hola Magilus, QUIERO EL COMBO...". */
export function primerMensajeEsDelCombo(texto: string | null | undefined): boolean {
  return /\bcombo\b/.test(normalizar(texto));
}

export function esProductoDelCombo(
  producto: { id?: string | null; nombre?: string | null } | null | undefined,
  config: ConfigEmbudo = CONFIG_EMBUDO_POR_DEFECTO,
): boolean {
  if (!producto) return false;
  if (producto.id && (producto.id === CLAVE_COMBO || config.comboProductoIds.includes(producto.id))) return true;
  const nombre = normalizar(producto.nombre);
  return nombre.includes("combo") && nombre.includes("camilla");
}

/** La clave de producto del embudo: el combo se guarda siempre igual; el resto, por su id. */
export function claveDeProducto(
  producto: { id?: string | null; nombre?: string | null } | null | undefined,
  config: ConfigEmbudo = CONFIG_EMBUDO_POR_DEFECTO,
): string | null {
  if (!producto?.id && !producto?.nombre) return null;
  if (esProductoDelCombo(producto, config)) return CLAVE_COMBO;
  return producto.id ?? null;
}

/** El producto con el que entra un lead nuevo: el combo si el anuncio o el primer mensaje lo dicen. */
export function productoDeEntrada(
  input: { anuncio?: { titulo?: string | null; id?: string | null } | null; primerMensaje?: string | null },
  config: ConfigEmbudo = CONFIG_EMBUDO_POR_DEFECTO,
): string | null {
  if (esAnuncioDelCombo(input.anuncio, config) || primerMensajeEsDelCombo(input.primerMensaje)) {
    return CLAVE_COMBO;
  }
  return null;
}

/** Hay mezcla si el lead terminó hablando de otro producto que el de entrada. Una vez mezcla, siempre mezcla. */
export function hayMezcla(input: {
  mezclaAntes?: boolean;
  productoEntrada: string | null;
  productoActual: string | null;
}): boolean {
  if (input.mezclaAntes) return true;
  return Boolean(input.productoEntrada && input.productoActual && input.productoEntrada !== input.productoActual);
}
