import {
  buscarArchivosEnPayload,
  decodificarBase64,
  quitarArchivosDelPayload,
  type ArchivoGuardado,
} from "@/lib/payload-sin-archivos";
import {
  guardarBytesDeChat,
  tipoDeMedioPorMime,
  type PersistableMediaType,
} from "@/lib/guardar-archivo-de-chat";

/*
  La red de seguridad de `prisma.ts`: ningun Message se guarda con el archivo en base64 adentro.

  Hay ~40 lugares que escriben un `rawPayload` (webhook, mensaje editado, llamadas, historial,
  respuestas de envio...). Arreglarlos uno por uno era fragil; por eso se hace aca, una vez, antes de
  que la escritura llegue a la base. El archivo se guarda en disco con el nombre por hash de siempre
  (`/uploads/chat-media/<sha256>.<ext>`) y del payload se quita SOLO la clave `base64`; lo demas (ack,
  ids, tipo, nombre, mimetype, tamano, miniatura) queda igual. Ver payload-sin-archivos.ts.

  Es a prueba de fallas: si algo sale mal aca, la escritura sigue con los args originales, como hoy.
  Un mensaje nunca se pierde ni se frena por esto. Y si el disco falla (lleno, sin permiso, tarda
  demasiado), el base64 de ESA fila se conserva y se anota `[archivo-no-guardado]` en el log: tirar el
  unico respaldo del archivo de un cliente es peor que una fila pesada. La migracion lo recoge despues.

  No toca `mediaUrl`: eso lo sigue haciendo el webhook con el payload que tiene en memoria.
*/

const OPERACIONES_QUE_ESCRIBEN = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);

const TIPOS_CON_ARCHIVO = new Set<PersistableMediaType>(["IMAGE", "AUDIO", "VIDEO", "STICKER", "DOCUMENT"]);

/** Cuanto puede tardar guardar UN archivo antes de rendirse y dejar el base64 (el mensaje no espera mas). */
const PLAZO_POR_ARCHIVO_MS = 4000;

type Registro = Record<string, unknown>;

export type GuardarArchivo = (input: {
  bytes: Buffer;
  mimeType: string;
  mediaType: PersistableMediaType;
}) => Promise<{ enlace: string; bytes: number; sha256: string }>;

export type OpcionesDeLaRed = {
  guardar?: GuardarArchivo;
  avisar?: (texto: string, datos: Record<string, unknown>) => void;
  plazoPorArchivoMs?: number;
  ahora?: () => Date;
};

function esRegistro(valor: unknown): valor is Registro {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

/** true si la operacion de Prisma sobre Message puede traer un rawPayload. */
export function operacionQueEscribeMensaje(model: string | undefined, operation: string): boolean {
  return model === "Message" && OPERACIONES_QUE_ESCRIBEN.has(operation);
}

function conPlazo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const reloj = setTimeout(() => reject(new Error(`tardo mas de ${ms} ms`)), ms);
    promesa.then(
      (valor) => {
        clearTimeout(reloj);
        resolve(valor);
      },
      (error) => {
        clearTimeout(reloj);
        reject(error);
      },
    );
  });
}

function tipoDelMensaje(data: Registro, mimetype: string | null): PersistableMediaType {
  const tipo = typeof data.type === "string" ? (data.type as PersistableMediaType) : null;
  return tipo && TIPOS_CON_ARCHIVO.has(tipo) ? tipo : tipoDeMedioPorMime(mimetype);
}

/** Lo que identifica la fila en el log (sin datos del cliente). */
function quienEs(data: Registro, contexto: Registro | null) {
  const donde = esRegistro(contexto?.where) ? (contexto!.where as Registro) : null;
  const porCanal = esRegistro(donde?.channelId_externalId) ? (donde!.channelId_externalId as Registro) : null;
  return {
    messageId: data.externalId ?? porCanal?.externalId ?? donde?.id ?? null,
    channelId: data.channelId ?? porCanal?.channelId ?? null,
  };
}

/** Un `data` de Prisma (una fila) sin base64 en su rawPayload. Devuelve el MISMO objeto si no hay nada. */
async function filaSinArchivos(
  data: unknown,
  contexto: Registro | null,
  opciones: Required<OpcionesDeLaRed>,
): Promise<unknown> {
  if (!esRegistro(data) || !esRegistro(data.rawPayload)) return data;
  const archivos = buscarArchivosEnPayload(data.rawPayload);
  if (archivos.length === 0) return data;

  const guardados: Array<ArchivoGuardado & { rutaClaves: string[] }> = [];
  for (const archivo of archivos) {
    const ruta = archivo.ruta.join(".");
    const decodificado = decodificarBase64(archivo.texto);
    if (!decodificado) {
      // No parece base64 de verdad: no se adivina, queda como esta.
      opciones.avisar("[archivo-no-guardado] base64 que no se pudo leer; queda en la base", {
        ...quienEs(data, contexto),
        ruta,
        peso: archivo.texto.length,
      });
      continue;
    }
    const tipo = decodificado.mimetype ?? archivo.mimetype ?? "application/octet-stream";
    try {
      const guardado = await conPlazo(
        opciones.guardar({ bytes: decodificado.bytes, mimeType: tipo, mediaType: tipoDelMensaje(data, tipo) }),
        opciones.plazoPorArchivoMs,
      );
      guardados.push({
        ruta,
        rutaClaves: archivo.ruta,
        enlace: guardado.enlace,
        bytes: guardado.bytes,
        sha256: guardado.sha256,
        tipo,
        fecha: opciones.ahora().toISOString(),
      });
    } catch (error) {
      opciones.avisar("[archivo-no-guardado] no se pudo guardar en disco; el base64 queda en la base", {
        ...quienEs(data, contexto),
        ruta,
        peso: archivo.texto.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (guardados.length === 0) return data;
  return { ...data, rawPayload: quitarArchivosDelPayload(data.rawPayload, guardados) };
}

/**
 * Los args de una escritura de Message sin base64 en el rawPayload. Cubre `create`, `createMany`
 * (una o varias filas), `update`, `updateMany` y `upsert` (create y update). Si no hay nada que
 * sacar devuelve los MISMOS args; si algo falla, tambien (nunca lanza).
 */
export async function sinArchivosEnMensaje<T>(operation: string, args: T, opcionesPedidas: OpcionesDeLaRed = {}): Promise<T> {
  const opciones: Required<OpcionesDeLaRed> = {
    guardar: opcionesPedidas.guardar ?? ((input) => guardarBytesDeChat({ ...input, comprobar: "tamano" })),
    avisar: opcionesPedidas.avisar ?? ((texto, datos) => console.warn(texto, datos)),
    plazoPorArchivoMs: opcionesPedidas.plazoPorArchivoMs ?? PLAZO_POR_ARCHIVO_MS,
    ahora: opcionesPedidas.ahora ?? (() => new Date()),
  };

  try {
    if (!esRegistro(args)) return args;
    const contexto = args as Registro;

    if (operation === "upsert") {
      const [create, update] = await Promise.all([
        filaSinArchivos(contexto.create, contexto, opciones),
        filaSinArchivos(contexto.update, contexto, opciones),
      ]);
      if (create === contexto.create && update === contexto.update) return args;
      return { ...contexto, create, update } as T;
    }

    if (!OPERACIONES_QUE_ESCRIBEN.has(operation)) return args;

    if (Array.isArray(contexto.data)) {
      const filas = contexto.data as unknown[];
      const limpias: unknown[] = [];
      for (const fila of filas) limpias.push(await filaSinArchivos(fila, contexto, opciones));
      if (limpias.every((fila, i) => fila === filas[i])) return args;
      return { ...contexto, data: limpias } as T;
    }

    const data = await filaSinArchivos(contexto.data, contexto, opciones);
    if (data === contexto.data) return args;
    return { ...contexto, data } as T;
  } catch (error) {
    try {
      opciones.avisar("[archivo-no-guardado] la red de archivos fallo; el mensaje se guarda como siempre", {
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Avisar nunca rompe una escritura.
    }
    return args;
  }
}
