"use client";

/*
  Los archivos en envio guardados en el navegador (IndexedDB), para que no se pierdan si la asesora
  cierra la pestaña o la pagina se recarga a mitad del envio.

  Dos almacenes: "archivos" guarda el archivo (se escribe al crear el envio y, en las fotos, una vez
  mas al comprimir) y "envios" guarda lo demas, que es chico y cambia con cada paso. Asi un video de
  80 MB no se vuelve a copiar cada vez que cambia el estado.

  Todo es "lo mejor posible": sin IndexedDB (ventana privada, Node en las pruebas, cuota llena) no
  se guarda nada y el envio sigue igual, solo que una recarga lo pierde, como antes.

  El archivo se guarda como BYTES (ArrayBuffer + tipo + nombre, archivo-legible.ts) y no como Blob:
  Safari en el iPhone devolvia, tras una recarga, un Blob que no se podia leer y la nota de voz
  subia vacia ("No se recibió ningún archivo", 11-nov-2026). Despues de escribirlo se lee de vuelta;
  si no volvio entero, se borra. Los guardados de antes (Blob) se siguen leyendo.
*/

import {
  archivoDesdeGuardado,
  comoArchivoGuardado,
  esArchivoGuardado,
  leerArchivoEntero,
} from "./archivo-legible";

const BASE = "envios-de-medios";
const VERSION = 1;
const ENVIOS = "envios";
const ARCHIVOS = "archivos";

export type EnvioGuardado = {
  id: string;
  conversationId: string;
  tipo: "IMAGE" | "VIDEO" | "DOCUMENT" | "AUDIO";
  /** El numero unico del mensaje (clientMessageId): el mismo en cada intento. */
  clave: string;
  caption: string;
  comprimida: boolean;
  duracionMs: number | null;
  subida: { url: string; fileName: string; mimeType: string; mediaType: "IMAGE" | "VIDEO" | "DOCUMENT" | "AUDIO" } | null;
  /** El destino SIN la funcion de envio (no se puede guardar): se vuelve a poner al leerlo. */
  destino: Record<string, unknown> | null;
  destinoDeAudio: Record<string, unknown> | null;
  estado: "pendiente" | "fallida";
  motivo: string | null;
  creadaEn: number;
  /**
   * Cuando salio el ultimo pedido de envio al servidor (ms), para el tope de 1 hora
   * (plazo-de-envio.ts). Falta en los guardados de antes del 11-nov-2026: se lee como null.
   */
  intentoDeEnvioEn?: number | null;
};

let abierta: Promise<IDBDatabase | null> | null = null;

function abrir(): Promise<IDBDatabase | null> {
  if (abierta) {
    return abierta;
  }
  abierta = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const pedido = indexedDB.open(BASE, VERSION);
      pedido.onupgradeneeded = () => {
        const base = pedido.result;
        if (!base.objectStoreNames.contains(ENVIOS)) base.createObjectStore(ENVIOS);
        if (!base.objectStoreNames.contains(ARCHIVOS)) base.createObjectStore(ARCHIVOS);
      };
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => resolve(null);
      pedido.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return abierta;
}

function terminar(transaccion: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve) => {
    transaccion.oncomplete = () => resolve();
    transaccion.onerror = () => resolve();
    transaccion.onabort = () => resolve();
  });
}

/** Guarda (o reemplaza) los datos del envio. El archivo va aparte, con guardarArchivo. */
export async function guardarEnvio(envio: EnvioGuardado): Promise<void> {
  try {
    const base = await abrir();
    if (!base) return;
    const transaccion = base.transaction(ENVIOS, "readwrite");
    transaccion.objectStore(ENVIOS).put(envio, envio.id);
    await terminar(transaccion);
  } catch {
    // Sin guardar: el envio sigue, solo que una recarga lo pierde.
  }
}

/*
  Cada guardado de un archivo lleva un numero: leer los bytes tarda, y la foto original (grande)
  podria terminar despues que la comprimida y pisarla. Solo escribe el ultimo pedido; borrarEnvio
  tambien cuenta, para que un guardado lento no vuelva a poner un archivo ya borrado.
*/
let ultimoGuardado = 0;
const guardadoVigente = new Map<string, number>();

function leerUno(base: IDBDatabase, id: string): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    try {
      const pedido = base.transaction(ARCHIVOS, "readonly").objectStore(ARCHIVOS).get(id);
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Guarda los bytes del archivo y los lee de vuelta. Devuelve si quedo bien guardado. */
export async function guardarArchivo(id: string, archivo: Blob): Promise<boolean> {
  const numero = ++ultimoGuardado;
  guardadoVigente.set(id, numero);
  try {
    const base = await abrir();
    if (!base) return false;
    const lectura = await leerArchivoEntero(archivo);
    if (!lectura.ok) {
      console.warn(
        `[envio-medio] ${JSON.stringify({ paso: "guardar-en-navegador", resultado: lectura.motivo, bytes: archivo?.size ?? null, mime: archivo?.type ?? null })}`,
      );
      return false;
    }
    if (guardadoVigente.get(id) !== numero) return false;
    const comoFile = archivo instanceof File ? archivo : null;
    const guardado = comoArchivoGuardado(lectura.bytes, {
      tipo: archivo.type,
      nombre: comoFile?.name ?? "",
      modificadoEn: comoFile?.lastModified,
    });
    const transaccion = base.transaction(ARCHIVOS, "readwrite");
    transaccion.objectStore(ARCHIVOS).put(guardado, id);
    await terminar(transaccion);
    const releido = await leerUno(base, id);
    if (esArchivoGuardado(releido) && releido.bytes.byteLength === lectura.bytes.byteLength) {
      return true;
    }
    // No volvio entero: mejor sin archivo (al volver dice "se perdió") que uno que sube vacio.
    if (guardadoVigente.get(id) === numero) {
      const borrado = base.transaction(ARCHIVOS, "readwrite");
      borrado.objectStore(ARCHIVOS).delete(id);
      await terminar(borrado);
    }
    console.warn(
      `[envio-medio] ${JSON.stringify({ paso: "guardar-en-navegador", resultado: "no-se-pudo-releer", bytes: archivo.size, mime: archivo.type })}`,
    );
    return false;
  } catch {
    // Cuota llena (un video grande): no se guarda, el envio sigue.
    return false;
  }
}

export async function borrarEnvio(id: string): Promise<void> {
  guardadoVigente.set(id, ++ultimoGuardado);
  try {
    const base = await abrir();
    if (!base) return;
    const transaccion = base.transaction([ENVIOS, ARCHIVOS], "readwrite");
    transaccion.objectStore(ENVIOS).delete(id);
    transaccion.objectStore(ARCHIVOS).delete(id);
    await terminar(transaccion);
  } catch {
    // Queda guardado: al volver se descarta por viejo.
  }
}

/*
  Todos los envios guardados con su archivo. Uno que perdio el archivo vuelve con `archivo: null`
  (antes se borraba callado y la nota desaparecia sin aviso): reanudarEnviosGuardados decide si
  igual se puede mandar (ya habia subido) o si queda en rojo con "se perdió".
*/
export async function leerEnviosGuardados(): Promise<Array<EnvioGuardado & { archivo: File | null }>> {
  try {
    const base = await abrir();
    if (!base) return [];
    const transaccion = base.transaction([ENVIOS, ARCHIVOS], "readonly");
    // Los tres pedidos salen juntos: esperar uno antes de pedir el otro puede cerrar la transaccion.
    const leer = <T,>(pedido: IDBRequest, vacio: T) =>
      new Promise<T>((resolve) => {
        pedido.onsuccess = () => resolve((pedido.result as T) ?? vacio);
        pedido.onerror = () => resolve(vacio);
      });
    const [envios, claves, archivos] = await Promise.all([
      leer<EnvioGuardado[]>(transaccion.objectStore(ENVIOS).getAll(), []),
      leer<IDBValidKey[]>(transaccion.objectStore(ARCHIVOS).getAllKeys(), []),
      leer<unknown[]>(transaccion.objectStore(ARCHIVOS).getAll(), []),
    ]);
    const archivoDe = new Map<string, unknown>();
    claves.forEach((clave, indice) => {
      if (typeof clave === "string" && archivos[indice]) archivoDe.set(clave, archivos[indice]);
    });
    return envios.map((envio) => {
      const valor = archivoDe.get(envio.id);
      const nombre = envio.subida?.fileName || "archivo";
      let archivo: File | null = null;
      try {
        if (esArchivoGuardado(valor)) {
          archivo = archivoDesdeGuardado(valor, nombre);
        } else if (valor instanceof Blob) {
          // Guardado de antes (el Blob tal cual): puede no leerse en Safari, lo mira quien lo use.
          archivo = valor instanceof File ? valor : new File([valor], nombre, { type: valor.type });
        }
      } catch {
        archivo = null;
      }
      return { ...envio, archivo };
    });
  } catch {
    return [];
  }
}
