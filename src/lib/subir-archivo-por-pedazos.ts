export type ArchivoSubido = {
  url: string;
  fileName: string;
  mimeType: string;
  mediaType: "IMAGE" | "VIDEO" | "DOCUMENT";
};

/**
 * Sube un archivo partido en trozos, reintentando trozo por trozo.
 *
 * Medido el 14-ago-2026: con la señal de un celular en la calle (14-32 KB/s) un catalogo de 15 MB
 * tarda entre 8 y 18 minutos si va en una sola peticion, y una peticion tan larga no termina —se
 * cortaba sin dejar rastro y el chat solo sabia decir "No se pudo enviar"—.
 *
 * En trozos de 512 KB cada peticion dura segundos: ninguna vive lo suficiente como para que la
 * corten, y si la señal se cae se reintenta SOLO ese trozo en vez del archivo entero.
 *
 * Los trozos viajan de a PEDAZOS_A_LA_VEZ y el ultimo sale solo cuando los demas entraron: el
 * servidor guarda cada uno aparte y arma el archivo en orden recien con el ultimo
 * (src/lib/chat-upload-pedazos.ts).
 */

// 512 KB: con 15 KB/s un trozo tarda ~35 segundos. Mas grande empieza a parecerse al problema que
// vino a resolver; mas chico multiplica las idas y vueltas, que con mala latencia tambien cuesta.
const TAMANO_TROZO = 512 * 1024;

/*
  Seis intentos por trozo, esperando cada vez un poco mas.

  Eran tres seguidos, sin pausa: con la señal yendose y viniendo, los tres caian dentro del mismo
  bache y la subida entera se perdia. Esperando 1s, 2s, 4s... el ultimo intento ocurre casi medio
  minuto despues del primero, que alcanza para que el telefono recupere señal al doblar la esquina.
*/
const REINTENTOS_POR_TROZO = 6;
const ESPERA_BASE_MS = 1000;

/**
 * Le avisa al servidor que una subida se corto.
 *
 * Va sin await y tragandose el error: es telemetria, no puede demorar ni romper el aviso que de
 * verdad le importa a quien esta esperando.
 */
function avisarQueSeCorto(input: {
  endpoint: string;
  file: File;
  trozo: number;
  total: number;
  motivo: string;
}) {
  void fetch(`${input.endpoint}/fallo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: input.file.name,
      size: input.file.size,
      mimeType: input.file.type,
      trozo: input.trozo,
      total: input.total,
      motivo: input.motivo.slice(0, 200),
    }),
    keepalive: true,
  }).catch(() => null);
}

function generarId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/*
  Hasta 3 pedazos viajan a la vez. Con buena señal la subida dura casi un tercio; con mala, tres
  pedazos de 512 KB siguen siendo peticiones cortas. Mas de 3 ya no gana nada en un celular y
  multiplica los pedidos que el servidor tiene que atender por cada asesora.
*/
export const PEDAZOS_A_LA_VEZ = 3;

type RespuestaDelServidor = {
  ok?: boolean;
  completo?: boolean;
  error?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  mediaType?: string;
};

type ResultadoDelTrozo =
  | { tipo: "entregado"; datos: RespuestaDelServidor }
  /** El servidor dijo que no (400/401/403/409): reintentar solo hace esperar el mismo no. */
  | { tipo: "rechazado"; error: string; status: number }
  /** Se gastaron los reintentos. */
  | { tipo: "agotado"; error: string }
  /** Otro pedazo fallo y este se dejo de mandar. */
  | { tipo: "cancelado" };

async function mandarTrozo(input: {
  endpoint: string;
  uploadId: string;
  file: File;
  indice: number;
  total: number;
  tamanoTrozo: number;
  senal: AbortSignal;
}): Promise<Response> {
  const desde = input.indice * input.tamanoTrozo;
  const trozo = input.file.slice(desde, desde + input.tamanoTrozo);

  const formData = new FormData();
  formData.append("chunk", trozo);
  formData.append("uploadId", input.uploadId);
  formData.append("index", String(input.indice));
  formData.append("total", String(input.total));
  formData.append("fileName", input.file.name);
  formData.append("mimeType", input.file.type);

  return fetch(input.endpoint, { method: "POST", body: formData, signal: input.senal });
}

const esperarDeVerdad = (ms: number) => new Promise<void>((listo) => setTimeout(listo, ms));

/** Manda UN trozo con sus propios reintentos, cada vez esperando un poco mas. */
async function mandarTrozoConReintentos(input: {
  endpoint: string;
  uploadId: string;
  file: File;
  indice: number;
  total: number;
  tamanoTrozo: number;
  senal: AbortSignal;
  esperar: (ms: number) => Promise<void>;
}): Promise<ResultadoDelTrozo> {
  let ultimoError = "";

  for (let intento = 1; intento <= REINTENTOS_POR_TROZO; intento += 1) {
    if (input.senal.aborted) {
      return { tipo: "cancelado" };
    }

    try {
      const respuesta = await mandarTrozo(input);
      const datos = (await respuesta.json().catch(() => null)) as RespuestaDelServidor | null;

      if (input.senal.aborted) {
        return { tipo: "cancelado" };
      }

      // Un rechazo del servidor (formato, tamaño, permisos) no se reintenta: reintentarlo solo
      // hace esperar de gusto para volver a recibir el mismo no. El 409 (faltan pedazos) tampoco:
      // los que faltan ya no van a aparecer.
      if ([400, 401, 403, 409].includes(respuesta.status)) {
        return {
          tipo: "rechazado",
          status: respuesta.status,
          error: datos?.error || "El servidor rechazó el archivo.",
        };
      }

      if (respuesta.ok && datos?.ok) {
        return { tipo: "entregado", datos };
      }

      ultimoError = datos?.error || "Se cortó la subida.";
    } catch (error) {
      if (input.senal.aborted) {
        return { tipo: "cancelado" };
      }
      // Cortes de red: es justamente el caso para el que existe el reintento.
      ultimoError = error instanceof Error ? error.message : "Se cortó la subida.";
    }

    // Se espera antes del proximo intento, cada vez un poco mas.
    if (intento < REINTENTOS_POR_TROZO) {
      await input.esperar(ESPERA_BASE_MS * 2 ** (intento - 1));
    }
  }

  return { tipo: "agotado", error: ultimoError };
}

export async function subirArchivoPorPedazos(input: {
  file: File;
  endpoint: string;
  /** Avance de 0 a 1, para poder mostrarlo mientras dura. Nunca retrocede. */
  onAvance?: (avance: number) => void;
  /** Solo para las pruebas: reemplaza la espera entre reintentos. */
  esperar?: (ms: number) => Promise<void>;
  /**
   * Tamaño de cada trozo (por defecto 512 KB). El compositor sube la foto ya achicada en un solo
   * trozo de hasta 1 MB (chat-conversation-panel.tsx); todo lo demas sigue con 512 KB.
   */
  tamanoTrozo?: number;
}): Promise<{ archivo?: ArchivoSubido; error?: string }> {
  /*
    Antes de empezar, se comprueba que el archivo se pueda LEER.

    En Android, un archivo que llega compartido desde otra app (o que se movio despues de elegirlo)
    deja un File que ya no apunta a nada. Al mandarlo, fetch falla con "Failed to fetch" ANTES de
    salir a la red: los seis reintentos caen instantaneos y no llega ni un pedido al servidor. Visto
    el 3-sep-2026 con un video de 85 MB, tres veces seguidas, sin una sola linea en el servidor.

    El aviso decia "revisa la señal", que manda a buscar donde no es. Se lee el ultimo byte -que
    obliga al navegador a tocar el archivo de verdad- y si falla se dice lo que pasa.
  */
  if (input.file.size > 0) {
    try {
      await input.file.slice(input.file.size - 1, input.file.size).arrayBuffer();
    } catch (error) {
      // Tambien se avisa al servidor: si no, este fallo es invisible del lado de aca y volvemos
      // a quedarnos sin saber si pasa una vez al dia o veinte.
      avisarQueSeCorto({
        endpoint: input.endpoint,
        file: input.file,
        trozo: 0,
        total: 1,
        motivo: `no se pudo leer el archivo: ${error instanceof Error ? error.message : String(error)}`,
      });
      return {
        error: "No se pudo leer el archivo desde el telefono. Vuelve a elegirlo desde la galeria.",
      };
    }
  }

  const uploadId = generarId();
  const tamanoTrozo = input.tamanoTrozo && input.tamanoTrozo > 0 ? input.tamanoTrozo : TAMANO_TROZO;
  const total = Math.max(1, Math.ceil(input.file.size / tamanoTrozo));
  const esperar = input.esperar ?? esperarDeVerdad;
  const cancelar = new AbortController();

  let terminados = 0;
  let fallo: { indice: number; resultado: Extract<ResultadoDelTrozo, { tipo: "rechazado" | "agotado" }> } | null =
    null;

  const mandar = (indice: number) =>
    mandarTrozoConReintentos({
      endpoint: input.endpoint,
      uploadId,
      file: input.file,
      indice,
      total,
      tamanoTrozo,
      senal: cancelar.signal,
      esperar,
    });

  /*
    Todos menos el ultimo, hasta PEDAZOS_A_LA_VEZ en camino. Cada "carril" toma el siguiente
    pedazo libre apenas termina el suyo. Si uno se agota o es rechazado, no sale ninguno mas y se
    cancelan los que iban en camino: seguir subiendo un archivo que ya no se va a armar solo gasta
    los datos de la asesora.
  */
  let siguiente = 0;
  const carril = async () => {
    while (fallo === null && siguiente < total - 1) {
      const indice = siguiente;
      siguiente += 1;
      const resultado = await mandar(indice);
      if (resultado.tipo === "cancelado") return;
      if (resultado.tipo !== "entregado") {
        if (fallo === null) {
          fallo = { indice, resultado };
          cancelar.abort();
        }
        return;
      }
      terminados += 1;
      input.onAvance?.(terminados / total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PEDAZOS_A_LA_VEZ, total - 1) }, carril));

  /*
    El ultimo va solo y al final, cuando todos los demas ya entraron: es el que le pide al
    servidor que arme el archivo, y el servidor lo arma solo si estan todos.
  */
  if (fallo === null) {
    const resultado = await mandar(total - 1);

    if (resultado.tipo === "entregado") {
      const datos = resultado.datos;
      if (!datos.completo) {
        return { error: "La subida no llegó a completarse." };
      }
      if (!datos.url || !datos.mediaType) {
        return { error: "La subida terminó pero el servidor no devolvió el archivo." };
      }
      input.onAvance?.(1);
      return {
        archivo: {
          url: datos.url,
          fileName: datos.fileName || input.file.name,
          mimeType: datos.mimeType || input.file.type,
          mediaType: datos.mediaType as ArchivoSubido["mediaType"],
        },
      };
    }

    if (resultado.tipo !== "cancelado") {
      fallo = { indice: total - 1, resultado };
    }
  }

  // TypeScript no sigue las asignaciones hechas dentro de los carriles: se lee de nuevo aca.
  const fallido = fallo as typeof fallo;
  if (!fallido) {
    return { error: "La subida no llegó a completarse." };
  }

  if (fallido.resultado.tipo === "rechazado") {
    // 400/401/403 son un no del servidor por el archivo o la sesion: como antes, sin aviso. El
    // 409 si es una subida que se corto en el medio, y conviene que quede registrada.
    if (fallido.resultado.status === 409) {
      avisarQueSeCorto({
        endpoint: input.endpoint,
        file: input.file,
        trozo: fallido.indice,
        total,
        motivo: fallido.resultado.error,
      });
    }
    return { error: fallido.resultado.error };
  }

  const enviado = Math.round((terminados / total) * 100);
  /*
    Se avisa al servidor que la subida se corto (una sola vez, aunque hubiera otros en camino).

    Sin esto el fallo era invisible del lado de aca: la asesora veia un aviso que se desvanecia
    y en el servidor no quedaba NADA. Reportaron "a veces manda fotos y a veces no" y no habia
    forma de saber si pasaba una vez al dia o veinte, ni en que trozo se cortaba.

    Va sin await y tragandose el error: es telemetria, no puede demorar ni romper el aviso que
    de verdad le importa a quien esta esperando.
  */
  avisarQueSeCorto({
    endpoint: input.endpoint,
    file: input.file,
    trozo: fallido.indice,
    total,
    motivo: fallido.resultado.error,
  });

  return {
    error: fallido.resultado.error
      ? `Se cortó la subida (${enviado}% enviado). Revisa la señal y reintenta.`
      : "Se cortó la subida.",
  };
}
