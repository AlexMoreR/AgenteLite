/*
  Actualizacion de la app sin molestar (orden de Alexander, 11-nov-2026; antes tarjeta maqn9g47 y T-722).

  Ya no hay aviso de "version nueva", ni recarga forzada, ni envios frenados por la version. La app
  se actualiza al abrirla o recargarla y, en silencio, tras mas de 10 minutos en segundo plano con
  la barra vacia (la regla esta en src/lib/recarga-silenciosa.ts; la aplica app-version-guard.tsx).

  Aca viven, sin React, las piezas que eso necesita (pruebas: `npm run test:actualizacion-automatica`):
  - los avisos de "hay algo escrito / algo por salir" que dan el chat y la bandeja,
  - el borrador por chat (guardado en la pestaña: sobrevive a una recarga),
  - la revision de version con espera corta, para no pedir la pantalla entera con una version nueva.
*/

/** Espera tras la ultima tecla antes de guardar el borrador. */
export const ESPERA_GUARDAR_BORRADOR_MS = 400;

const PREFIJO_BORRADOR = "aizen:borrador:";

/** Lo minimo que se usa de sessionStorage (asi las pruebas pasan uno falso). */
export type AlmacenSimple = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Para recorrer los borradores hace falta tambien contar y leer claves. */
export type AlmacenRecorrible = AlmacenSimple & Pick<Storage, "key" | "length">;

function almacenDelNavegador(): AlmacenRecorrible | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/* --------------------------- Algo escrito o algo por salir --------------------------- */

/*
  Dos clases de motivo, porque la regla los nombra por separado:
  - "escrito": texto en la caja, adjunto elegido, menu de adjuntar abierto, nota de voz grabandose.
  - "envio": un texto o archivo en camino, o uno que fallo y espera Reintentar (se perderia al recargar).
*/
export type ClaseDeMotivo = "escrito" | "envio";

const motivos = new Map<string, ClaseDeMotivo>();
const lectores = new Map<string, () => boolean>();

/** Prende o apaga un motivo para no recargar. */
export function marcarOcupada(motivo: string, activa: boolean, clase: ClaseDeMotivo = "escrito") {
  if (activa) {
    motivos.set(motivo, clase);
  } else {
    motivos.delete(motivo);
  }
}

/**
 * Registra una funcion que dice si hay texto en una caja no controlada (se lee en el momento, asi
 * cuenta tambien el texto que se puso sin teclear: borrador, sugerencia, respuesta rapida).
 * Devuelve la funcion para quitarla.
 */
export function registrarLectorDeTexto(nombre: string, hayTexto: () => boolean): () => void {
  lectores.set(nombre, hayTexto);
  return () => {
    if (lectores.get(nombre) === hayTexto) {
      lectores.delete(nombre);
    }
  };
}

function hayMotivoDe(clase: ClaseDeMotivo): boolean {
  for (const valor of motivos.values()) {
    if (valor === clase) {
      return true;
    }
  }
  return false;
}

/** Texto en la caja, borradores guardados, adjuntos o nota de voz. Ante un error, `true`. */
export function hayTextoEscrito(almacen: AlmacenRecorrible | null = almacenDelNavegador()): boolean {
  if (hayMotivoDe("escrito")) {
    return true;
  }
  for (const hayTexto of lectores.values()) {
    try {
      if (hayTexto()) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return hayBorradoresGuardados(almacen);
}

/** Envios en camino o fallidos que viven en memoria (la cola del navegador se mira aparte). */
export function hayEnviosEnMemoria(): boolean {
  return hayMotivoDe("envio");
}

/* ------------------------------ Borrador por chat ------------------------------ */

export function guardarBorrador(
  chatKey: string,
  texto: string,
  almacen: AlmacenSimple | null = almacenDelNavegador(),
) {
  if (!chatKey) {
    return;
  }
  try {
    if (texto.trim()) {
      almacen?.setItem(PREFIJO_BORRADOR + chatKey, texto);
    } else {
      almacen?.removeItem(PREFIJO_BORRADOR + chatKey);
    }
  } catch {
    // Sin almacenamiento (modo privado): el borrador no se guarda y ya.
  }
}

export function leerBorrador(chatKey: string, almacen: AlmacenSimple | null = almacenDelNavegador()): string {
  if (!chatKey) {
    return "";
  }
  try {
    return almacen?.getItem(PREFIJO_BORRADOR + chatKey) ?? "";
  } catch {
    return "";
  }
}

export function borrarBorrador(chatKey: string, almacen: AlmacenSimple | null = almacenDelNavegador()) {
  try {
    almacen?.removeItem(PREFIJO_BORRADOR + chatKey);
  } catch {
    // nada
  }
}

/** ¿Queda algun borrador con texto, de cualquier chat? Si no se puede leer, `true` (no recargar). */
export function hayBorradoresGuardados(almacen: AlmacenRecorrible | null = almacenDelNavegador()): boolean {
  if (!almacen) {
    return false;
  }
  try {
    for (let indice = 0; indice < almacen.length; indice += 1) {
      const clave = almacen.key(indice);
      if (clave?.startsWith(PREFIJO_BORRADOR) && (almacen.getItem(clave) ?? "").trim()) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

/* ------------------------- Revision de version con espera corta ------------------------- */

/** Si la ultima revision de version es mas reciente que esto, se usa su resultado. */
export const VIDA_REVISION_MS = 15_000;
/** Cuanto se espera como maximo la respuesta de /api/version. */
export const ESPERA_REVISION_MS = 1_500;

export type RevisionDeVersion = { vieja: boolean; en: number };

/**
 * ¿Hay version nueva? Usa la ultima revision si tiene menos de 15 s; si no, pregunta y espera como
 * mucho 1,5 s. Si no contesta a tiempo o falla, responde `false`. `guardar` recibe el resultado fresco.
 * Solo sirve para decidir en silencio (por ejemplo, no pedir la pantalla entera): nunca frena un envio.
 */
export async function hayVersionNuevaConEspera(input: {
  ahora: number;
  ultima: RevisionDeVersion | null;
  consultar: () => Promise<boolean>;
  guardar: (revision: RevisionDeVersion) => void;
}): Promise<boolean> {
  const { ahora, ultima, consultar, guardar } = input;
  if (ultima && ahora - ultima.en >= 0 && ahora - ultima.en < VIDA_REVISION_MS) {
    return ultima.vieja;
  }
  const respuesta = await new Promise<boolean | null>((resolver) => {
    const reloj = setTimeout(() => resolver(null), ESPERA_REVISION_MS);
    consultar().then(
      (vieja) => {
        clearTimeout(reloj);
        resolver(vieja);
      },
      () => {
        clearTimeout(reloj);
        resolver(null);
      },
    );
  });
  if (respuesta === null) {
    return false;
  }
  guardar({ vieja: respuesta, en: ahora });
  return respuesta;
}
