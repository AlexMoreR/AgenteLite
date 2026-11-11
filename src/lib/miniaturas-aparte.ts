/**
 * LAS MINIATURAS DEL MENSAJE, APARTE (velocidad del chat, 10-nov-2026).
 *
 * WhatsApp mete adentro de cada mensaje una miniatura en base64: la vista previa de un enlace
 * (`extendedTextMessage.jpegThumbnail`), el póster de un video, la miniatura de una foto o la de un
 * anuncio (`externalAdReply.thumbnail`). Medido en producción: en una tanda de 30 mensajes viejos
 * eran 138 de los 179 KB que bajaba el navegador -casi todo el tiempo de "cargar mensajes viejos"-.
 *
 * Ahora el servidor cambia cada miniatura grande por una dirección corta
 * (/api/cliente/chats/miniatura?m=<mensaje>&r=<ruta>) que el navegador baja SOLO si la muestra, una
 * vez, y la guarda (no cambia nunca). Las chicas (menos de LARGO_EN_LINEA) se quedan adentro.
 *
 * Solo funciones puras (sin base ni Buffer): las usa el cargador de mensajes, la ruta de la miniatura
 * y el navegador (chat-inbox-media.ts, para reconocer la dirección).
 */

export const PREFIJO_MINIATURA_APARTE = "/api/cliente/chats/miniatura?";

/** Una miniatura de menos de esto (en caracteres de base64, o bytes) viaja adentro como antes. */
export const LARGO_EN_LINEA = 1024;

const CLAVES_DE_MINIATURA = new Set(["jpegThumbnail", "JPEGThumbnail", "thumbnail"]);
const PROFUNDIDAD_MAXIMA = 10;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

/** El largo de una miniatura en cualquiera de las formas en que llega; 0 si no es una miniatura. */
export function largoDeLaMiniatura(valor: unknown): number {
  if (typeof valor === "string") return valor.length;
  if (Array.isArray(valor)) return valor.length;
  if (esObjeto(valor)) {
    // Un Buffer de Node pasado a JSON: { type: "Buffer", data: [...] }.
    if (Array.isArray(valor.data)) return valor.data.length;
    // Bytes como objeto { "0": 255, "1": 216, ... } (Baileys).
    const numericas = Object.keys(valor).filter((clave) => /^\d+$/.test(clave)).length;
    return numericas;
  }
  return 0;
}

export function urlDeMiniatura(messageId: string, ruta: readonly string[]): string {
  return `${PREFIJO_MINIATURA_APARTE}m=${encodeURIComponent(messageId)}&r=${encodeURIComponent(ruta.join("."))}`;
}

export function esMiniaturaAparte(valor: unknown): valor is string {
  return typeof valor === "string" && valor.startsWith(PREFIJO_MINIATURA_APARTE);
}

/**
 * El crudo con cada miniatura grande cambiada por su dirección. Copia solo las ramas que cambian:
 * el resto del objeto es el mismo. Sin miniaturas grandes devuelve el MISMO valor.
 */
export function sacarMiniaturasPesadas(crudo: unknown, messageId: string): unknown {
  if (!messageId) return crudo;
  const visitar = (valor: unknown, ruta: string[], profundidad: number): unknown => {
    if (profundidad > PROFUNDIDAD_MAXIMA || !valor || typeof valor !== "object") return valor;
    if (Array.isArray(valor)) {
      let cambio = false;
      const salida = valor.map((item, indice) => {
        const nuevo = visitar(item, [...ruta, String(indice)], profundidad + 1);
        if (nuevo !== item) cambio = true;
        return nuevo;
      });
      return cambio ? salida : valor;
    }
    let salida: Record<string, unknown> | null = null;
    for (const [clave, hijo] of Object.entries(valor)) {
      let nuevo: unknown;
      if (CLAVES_DE_MINIATURA.has(clave) && largoDeLaMiniatura(hijo) >= LARGO_EN_LINEA) {
        nuevo = urlDeMiniatura(messageId, [...ruta, clave]);
      } else {
        nuevo = visitar(hijo, [...ruta, clave], profundidad + 1);
      }
      if (nuevo !== hijo) {
        salida ??= { ...(valor as Record<string, unknown>) };
        salida[clave] = nuevo;
      }
    }
    return salida ?? valor;
  };
  return visitar(crudo, [], 0);
}

/** Lo que hay en `ruta` (la que armó urlDeMiniatura), solo si es una clave de miniatura. */
export function miniaturaEnLaRuta(crudo: unknown, rutaEnTexto: string): unknown {
  const ruta = rutaEnTexto.split(".").filter(Boolean);
  if (ruta.length === 0 || ruta.length > PROFUNDIDAD_MAXIMA + 1) return null;
  if (!CLAVES_DE_MINIATURA.has(ruta[ruta.length - 1])) return null;
  let actual: unknown = crudo;
  for (const paso of ruta) {
    if (Array.isArray(actual) && /^\d+$/.test(paso)) {
      actual = actual[Number(paso)];
    } else if (esObjeto(actual) && Object.prototype.hasOwnProperty.call(actual, paso)) {
      actual = actual[paso];
    } else {
      return null;
    }
  }
  return actual ?? null;
}

/** Los bytes de la miniatura (base64, arreglo, Buffer en JSON u objeto numérico), o null. */
export function bytesDeLaMiniatura(valor: unknown): Uint8Array | number[] | string | null {
  if (typeof valor === "string") {
    const limpio = valor.trim();
    return /^[A-Za-z0-9+/]+={0,2}$/.test(limpio) ? limpio : null;
  }
  if (Array.isArray(valor)) {
    return valor.every((byte) => typeof byte === "number") ? (valor as number[]) : null;
  }
  if (esObjeto(valor)) {
    if (Array.isArray(valor.data)) return bytesDeLaMiniatura(valor.data);
    const numericas = Object.entries(valor)
      .filter(([clave, byte]) => /^\d+$/.test(clave) && typeof byte === "number")
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, byte]) => byte as number);
    return numericas.length > 0 ? numericas : null;
  }
  return null;
}
