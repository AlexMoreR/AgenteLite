"use client";

/*
  Los archivos en envio guardados en el navegador (IndexedDB), para que no se pierdan si la asesora
  cierra la pestaña o la pagina se recarga a mitad del envio.

  Dos almacenes: "archivos" guarda el archivo (se escribe al crear el envio y, en las fotos, una vez
  mas al comprimir) y "envios" guarda lo demas, que es chico y cambia con cada paso. Asi un video de
  80 MB no se vuelve a copiar cada vez que cambia el estado.

  Todo es "lo mejor posible": sin IndexedDB (ventana privada, Node en las pruebas, cuota llena) no
  se guarda nada y el envio sigue igual, solo que una recarga lo pierde, como antes.
*/

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

export async function guardarArchivo(id: string, archivo: Blob): Promise<void> {
  try {
    const base = await abrir();
    if (!base) return;
    const transaccion = base.transaction(ARCHIVOS, "readwrite");
    transaccion.objectStore(ARCHIVOS).put(archivo, id);
    await terminar(transaccion);
  } catch {
    // Cuota llena (un video grande): no se guarda, el envio sigue.
  }
}

export async function borrarEnvio(id: string): Promise<void> {
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

/** Todos los envios guardados con su archivo. Los que perdieron el archivo se borran. */
export async function leerEnviosGuardados(): Promise<Array<EnvioGuardado & { archivo: File }>> {
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
      leer<Blob[]>(transaccion.objectStore(ARCHIVOS).getAll(), []),
    ]);
    const archivoDe = new Map<string, Blob>();
    claves.forEach((clave, indice) => {
      if (typeof clave === "string" && archivos[indice]) archivoDe.set(clave, archivos[indice]);
    });
    const conArchivo: Array<EnvioGuardado & { archivo: File }> = [];
    const sinArchivo: string[] = [];
    for (const envio of envios) {
      const archivo = archivoDe.get(envio.id) ?? null;
      if (!archivo) {
        sinArchivo.push(envio.id);
        continue;
      }
      conArchivo.push({
        ...envio,
        archivo:
          archivo instanceof File
            ? archivo
            : new File([archivo], envio.subida?.fileName || "archivo", { type: archivo.type }),
      });
    }
    for (const id of sinArchivo) {
      void borrarEnvio(id);
    }
    return conArchivo;
  } catch {
    return [];
  }
}
