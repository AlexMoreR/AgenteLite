/**
 * Dónde queda el cuadro de la llamada minimizada y en qué forma (tarjeta o burbuja).
 *
 * Son funciones puras, sin React ni `window`, para poder probarlas con Node
 * (scripts/check-llamada-global.mjs). El panel las usa al arrastrar, al soltar, al cambiar de
 * forma y cuando cambia el tamaño de la ventana.
 *
 * La preferencia se guarda por equipo, en el localStorage del navegador: si la asesora cambia de
 * computador, el cuadro vuelve a la esquina de arriba a la derecha.
 */

export type FormaDelCuadro = "tarjeta" | "burbuja";

export type Posicion = { x: number; y: number };

export type PreferenciaDelCuadro = Posicion & { forma: FormaDelCuadro };

export type TamanoDelCuadro = { ancho: number; alto: number };

export type Ventana = { anchoVentana: number; altoVentana: number };

/** Clave de localStorage donde queda la posición y la forma del cuadro. */
export const CLAVE_DEL_CUADRO = "llamada:cuadro";

/** Lo que el cuadro deja libre contra los bordes de la pantalla, en píxeles. */
export const MARGEN_DEL_CUADRO = 12;

/** Medidas de cada forma. El panel las usa para dibujar y para ajustar la posición. */
export const ANCHO_TARJETA = 320;
export const ALTO_TARJETA = 64;
export const LADO_BURBUJA = 64;

export function tamanoDeLaForma(forma: FormaDelCuadro, ventana: Ventana): TamanoDelCuadro {
  if (forma === "burbuja") {
    return { ancho: LADO_BURBUJA, alto: LADO_BURBUJA };
  }
  // En un celular angosto la tarjeta se encoge para no pasarse del ancho de la pantalla.
  const anchoDisponible = numeroValido(ventana.anchoVentana, ANCHO_TARJETA) - MARGEN_DEL_CUADRO * 2;
  return { ancho: Math.max(0, Math.min(ANCHO_TARJETA, anchoDisponible)), alto: ALTO_TARJETA };
}

function numeroValido(valor: unknown, porDefecto: number) {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : porDefecto;
}

/**
 * Devuelve una posición que deja el cuadro entero dentro de la pantalla, con un margen. Si la
 * pantalla es más chica que el cuadro, lo pega al margen de arriba a la izquierda para que al
 * menos se vea el comienzo (el nombre y el botón de agarrar).
 */
export function ajustarDentroDePantalla(
  posicion: Posicion,
  tamano: TamanoDelCuadro,
  ventana: Ventana,
): Posicion {
  const ancho = Math.max(0, numeroValido(tamano.ancho, 0));
  const alto = Math.max(0, numeroValido(tamano.alto, 0));
  const anchoVentana = Math.max(0, numeroValido(ventana.anchoVentana, 0));
  const altoVentana = Math.max(0, numeroValido(ventana.altoVentana, 0));

  const maxX = Math.max(MARGEN_DEL_CUADRO, anchoVentana - ancho - MARGEN_DEL_CUADRO);
  const maxY = Math.max(MARGEN_DEL_CUADRO, altoVentana - alto - MARGEN_DEL_CUADRO);

  const x = numeroValido(posicion.x, maxX);
  const y = numeroValido(posicion.y, MARGEN_DEL_CUADRO);

  return {
    x: Math.round(Math.min(Math.max(x, MARGEN_DEL_CUADRO), maxX)),
    y: Math.round(Math.min(Math.max(y, MARGEN_DEL_CUADRO), maxY)),
  };
}

/** Arriba a la derecha: no tapa la caja de escribir, que está abajo. */
export function posicionPorDefecto(ventana: Ventana, forma: FormaDelCuadro = "tarjeta"): PreferenciaDelCuadro {
  const tamano = tamanoDeLaForma(forma, ventana);
  const posicion = ajustarDentroDePantalla(
    { x: numeroValido(ventana.anchoVentana, 0) - tamano.ancho - MARGEN_DEL_CUADRO, y: MARGEN_DEL_CUADRO },
    tamano,
    ventana,
  );
  return { ...posicion, forma };
}

/**
 * Lee lo guardado en localStorage. Nunca lanza error: ante nada guardado, JSON roto, números raros
 * o una forma que no existe, devuelve `null` y quien llama usa la posición por defecto.
 */
export function leerPreferenciaGuardada(texto: string | null | undefined): PreferenciaDelCuadro | null {
  if (typeof texto !== "string" || !texto) {
    return null;
  }
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!datos || typeof datos !== "object") {
    return null;
  }
  const { x, y, forma } = datos as Record<string, unknown>;
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) {
    return null;
  }
  if (forma !== "tarjeta" && forma !== "burbuja") {
    return null;
  }
  return { x, y, forma };
}

/**
 * Lo guardado, ya ajustado a la pantalla de ahora; o la posición por defecto si no hay nada
 * guardado o está dañado.
 */
export function leerPreferencia(texto: string | null | undefined, ventana: Ventana): PreferenciaDelCuadro {
  const guardada = leerPreferenciaGuardada(texto);
  if (!guardada) {
    return posicionPorDefecto(ventana);
  }
  const posicion = ajustarDentroDePantalla(guardada, tamanoDeLaForma(guardada.forma, ventana), ventana);
  return { ...posicion, forma: guardada.forma };
}

/** El texto que se guarda en localStorage. */
export function escribirPreferencia(preferencia: PreferenciaDelCuadro): string {
  return JSON.stringify({ x: preferencia.x, y: preferencia.y, forma: preferencia.forma });
}
