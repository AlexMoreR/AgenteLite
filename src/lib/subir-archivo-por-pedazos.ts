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
 */

// 512 KB: con 15 KB/s un trozo tarda ~35 segundos. Mas grande empieza a parecerse al problema que
// vino a resolver; mas chico multiplica las idas y vueltas, que con mala latencia tambien cuesta.
const TAMANO_TROZO = 512 * 1024;
const REINTENTOS_POR_TROZO = 3;

function generarId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function mandarTrozo(input: {
  endpoint: string;
  uploadId: string;
  file: File;
  indice: number;
  total: number;
}): Promise<Response> {
  const desde = input.indice * TAMANO_TROZO;
  const trozo = input.file.slice(desde, desde + TAMANO_TROZO);

  const formData = new FormData();
  formData.append("chunk", trozo);
  formData.append("uploadId", input.uploadId);
  formData.append("index", String(input.indice));
  formData.append("total", String(input.total));
  formData.append("fileName", input.file.name);
  formData.append("mimeType", input.file.type);

  return fetch(input.endpoint, { method: "POST", body: formData });
}

export async function subirArchivoPorPedazos(input: {
  file: File;
  endpoint: string;
  /** Avance de 0 a 1, para poder mostrarlo mientras dura. */
  onAvance?: (avance: number) => void;
}): Promise<{ archivo?: ArchivoSubido; error?: string }> {
  const uploadId = generarId();
  const total = Math.max(1, Math.ceil(input.file.size / TAMANO_TROZO));

  for (let indice = 0; indice < total; indice += 1) {
    let ultimoError = "";
    let entregado = false;

    for (let intento = 1; intento <= REINTENTOS_POR_TROZO; intento += 1) {
      try {
        const respuesta = await mandarTrozo({
          endpoint: input.endpoint,
          uploadId,
          file: input.file,
          indice,
          total,
        });

        const datos = (await respuesta.json().catch(() => null)) as
          | { ok?: boolean; completo?: boolean; error?: string; url?: string; fileName?: string; mimeType?: string; mediaType?: string }
          | null;

        // Un rechazo del servidor (formato, tamaño) no se reintenta: reintentarlo solo hace
        // esperar de gusto para volver a recibir el mismo no.
        if (respuesta.status === 400 || respuesta.status === 401 || respuesta.status === 403) {
          return { error: datos?.error || "El servidor rechazó el archivo." };
        }

        if (!respuesta.ok || !datos?.ok) {
          ultimoError = datos?.error || "Se cortó la subida.";
          continue;
        }

        if (datos.completo) {
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

        entregado = true;
        break;
      } catch (error) {
        // Cortes de red: es justamente el caso para el que existe el reintento.
        ultimoError = error instanceof Error ? error.message : "Se cortó la subida.";
      }
    }

    if (!entregado) {
      return {
        error: ultimoError
          ? `Se cortó la subida (${Math.round(((indice + 1) / total) * 100)}% enviado).`
          : "Se cortó la subida.",
      };
    }

    input.onAvance?.((indice + 1) / total);
  }

  return { error: "La subida no llegó a completarse." };
}
