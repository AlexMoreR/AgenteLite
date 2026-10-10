/*
  Reglas puras del envio desde "Chat abierto" (fallas que afectan a las asesoras, 10-10-2026).

  Viven aca, sin React ni base de datos, para poder probarlas con `npm run test:fallas-crm`.

  1. Destino del envio: un texto sale SOLO al chat que esta abierto y CARGADO. Mientras el chat es
     la vista previa de la lista (isPreview), los campos ocultos del formulario siguen apuntando al
     chat con el que cargo la pagina, y el mensaje podia salir AL CLIENTE EQUIVOCADO.
  2. Mensajes que no salieron: se guardan aparte (no en el unico espacio optimista), asi el
     siguiente mensaje no borra el que fallo ni su "Reintentar".
  3. Interruptor de la IA: fija el estado elegido (pausar / reanudar), no invierte lo que hay en la
     base. Pedir dos veces lo mismo no cambia nada (idempotente).
*/

/** Mismo criterio que extractConversationIdFromKey: "agent:cmxxx" -> "cmxxx". */
export function idPeladoDelChat(chatKey: string | null | undefined): string {
  const normalizado = (chatKey ?? "").trim();
  if (!normalizado) {
    return "";
  }
  const separador = normalizado.indexOf(":");
  return separador >= 0 ? normalizado.slice(separador + 1) : normalizado;
}

export const MENSAJE_ESPERA_CARGA = "Espera a que cargue el chat para enviar.";
export const MENSAJE_CHAT_CAMBIADO =
  "No se envió: el mensaje iba para otro chat. Revisa que estés en el chat correcto y envíalo de nuevo.";

export type DestinoDelEnvio =
  | { ok: true; conversationId: string; chatEsperado: string }
  | { ok: false; motivo: "sin-chat" | "cargando" | "otro-chat"; mensaje: string };

/**
 * A que chat va el texto. Solo hay destino si el chat abierto (la seleccion) y el chat cargado en
 * pantalla son el MISMO y el cargado ya no es la vista previa. En cualquier otro caso no se envia
 * y el texto se queda en el cuadro.
 */
export function resolverDestinoDelEnvio(input: {
  chatAbiertoKey: string | null | undefined;
  chatCargado: { id: string; isPreview?: boolean | null } | null | undefined;
}): DestinoDelEnvio {
  const abierto = idPeladoDelChat(input.chatAbiertoKey);
  if (!abierto || !input.chatCargado) {
    return { ok: false, motivo: "sin-chat", mensaje: MENSAJE_ESPERA_CARGA };
  }
  if (input.chatCargado.isPreview) {
    return { ok: false, motivo: "cargando", mensaje: MENSAJE_ESPERA_CARGA };
  }
  const cargado = idPeladoDelChat(input.chatCargado.id);
  if (cargado !== abierto) {
    return { ok: false, motivo: "otro-chat", mensaje: MENSAJE_ESPERA_CARGA };
  }
  return { ok: true, conversationId: cargado, chatEsperado: abierto };
}

/**
 * Chequeo del SERVIDOR: el navegador manda el chat que la asesora tiene a la vista
 * (`chatEsperado`) ademas del `conversationId` del formulario. Si no coinciden, no se envia.
 * Sin `chatEsperado` (pantalla vieja en cache, antes de publicar) se acepta como antes.
 */
export function verificarDestinoDelEnvio(input: {
  conversationId: string;
  chatEsperado: string | null | undefined;
}): { ok: true } | { ok: false; error: string } {
  const esperado = (input.chatEsperado ?? "").trim();
  if (!esperado) {
    return { ok: true };
  }
  if (idPeladoDelChat(esperado) !== idPeladoDelChat(input.conversationId)) {
    return { ok: false, error: MENSAJE_CHAT_CAMBIADO };
  }
  return { ok: true };
}

/* ---------------------------- Mensajes que no salieron ---------------------------- */

export const MAX_FALLIDOS_GUARDADOS = 30;

type Fallido = { id: string; conversationId: string; createdAt: Date };

/** Agrega (o reemplaza por id) un mensaje fallido. Nunca borra los de otros chats. */
export function agregarFallido<T extends Fallido>(lista: readonly T[], fallido: T): T[] {
  const sinEste = lista.filter((item) => item.id !== fallido.id);
  const siguiente = [...sinEste, fallido];
  return siguiente.length > MAX_FALLIDOS_GUARDADOS
    ? siguiente.slice(siguiente.length - MAX_FALLIDOS_GUARDADOS)
    : siguiente;
}

export function quitarFallido<T extends Fallido>(lista: readonly T[], id: string): T[] {
  return lista.some((item) => item.id === id) ? lista.filter((item) => item.id !== id) : (lista as T[]);
}

/** Los fallidos del chat abierto, en orden de hora. */
export function fallidosDelChat<T extends Fallido>(lista: readonly T[], conversationId: string): T[] {
  const id = idPeladoDelChat(conversationId);
  return lista
    .filter((item) => idPeladoDelChat(item.conversationId) === id)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Normaliza para comparar con el guardado (la firma puede ir arriba): mismo criterio del inbox. */
export function textoCoincideConGuardado(guardado: string | null | undefined, texto: string | null | undefined) {
  const normalizar = (valor: string) => valor.replace(/\s+/g, " ").trim();
  const buscado = normalizar(texto ?? "");
  if (!buscado) {
    return false;
  }
  const valor = normalizar(guardado ?? "");
  return valor === buscado || valor.endsWith(buscado);
}

/* ------------------------------- Carga del chat ------------------------------- */

/** Tiempo maximo con la ruedita antes de decir "No se pudo abrir el chat" (con Reintentar). */
export const LIMITE_CARGA_CHAT_MS = 10_000;

export type EstadoCargaDelChat = "listo" | "cargando" | "error";

export function estadoCargaDelChat(input: {
  esVistaPrevia: boolean;
  fallo: boolean;
  msDesdeQueAbrio: number;
  limiteMs?: number;
}): EstadoCargaDelChat {
  if (!input.esVistaPrevia) {
    return "listo";
  }
  if (input.fallo || input.msDesdeQueAbrio >= (input.limiteMs ?? LIMITE_CARGA_CHAT_MS)) {
    return "error";
  }
  return "cargando";
}

/* ------------------------------- Archivos del chat ------------------------------- */

/**
 * Formatos que se pueden mandar por el chat. UNA sola lista para el navegador y el servidor
 * (chat-upload.ts la usa). Antes el selector de documentos dejaba elegir Excel y Word y el
 * servidor los rechazaba con "Formato no permitido (application/vnd.openxmlformats-…)".
 * Son los documentos que WhatsApp acepta; .zip y .rar no.
 */
export const TIPOS_PERMITIDOS_CHAT: readonly string[] = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
];

/** Para el `accept` del selector de documentos: lo mismo que se puede enviar. */
export const ACCEPT_DOCUMENTOS_CHAT = "application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt";

const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  heic: "image/heic",
  heif: "image/heif",
};

/** Tope del servidor (igual que MAX_FILE_SIZE_MB de chat-upload). */
export const TOPE_ARCHIVO_MB = 100;
/** Por encima de esto un video tarda mucho en subir con la señal de la calle y WhatsApp puede rechazarlo. */
export const AVISO_VIDEO_MB = 16;

export type RevisionDeArchivo =
  | { ok: true; mime: string; aviso: string | null }
  | { ok: false; motivo: string };

/**
 * Se revisa ANTES de subir: formato y peso. Asi la asesora sabe al instante que pasa, en vez de
 * esperar minutos de subida para ver un error tecnico. Si el telefono no dice el tipo (pasa en
 * Android con .xlsx o .csv), se deduce de la extension.
 */
export function revisarArchivoAntesDeSubir(archivo: { name: string; type: string; size: number }): RevisionDeArchivo {
  const extension = (archivo.name.split(".").pop() ?? "").toLowerCase();
  const tipoDeclarado = (archivo.type || "").split(";")[0].trim().toLowerCase();
  const mime =
    !tipoDeclarado || tipoDeclarado === "application/octet-stream"
      ? MIME_POR_EXTENSION[extension] ?? tipoDeclarado
      : tipoDeclarado;
  const mb = archivo.size / (1024 * 1024);
  const pesoTexto = `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;

  if (mime === "image/heic" || mime === "image/heif" || extension === "heic" || extension === "heif") {
    return {
      ok: false,
      motivo: `"${archivo.name}" es una foto HEIC del iPhone y WhatsApp no la abre. Mándala desde la galería del celular, como captura de pantalla, o cámbiala a JPG.`,
    };
  }
  if (!mime || !TIPOS_PERMITIDOS_CHAT.includes(mime)) {
    return {
      ok: false,
      motivo: `"${archivo.name}" no se puede enviar por aquí. Se pueden fotos, videos, PDF, Word, Excel, PowerPoint y texto.`,
    };
  }
  if (mb > TOPE_ARCHIVO_MB) {
    return {
      ok: false,
      motivo: `"${archivo.name}" pesa ${pesoTexto}. El máximo es ${TOPE_ARCHIVO_MB} MB.`,
    };
  }
  const aviso =
    mime.startsWith("video/") && mb > AVISO_VIDEO_MB
      ? `El video "${archivo.name}" pesa ${pesoTexto}: puede tardar en subir y WhatsApp podría rechazarlo. Si falla, mándalo más corto.`
      : null;
  return { ok: true, mime, aviso };
}

/* ------------------------------- Interruptor de la IA ------------------------------- */

/** "1"/"true" = pausar, "0"/"false" = reanudar, otra cosa = no se dijo (null). */
export function leerPausaPedida(valor: unknown): boolean | null {
  if (typeof valor !== "string") {
    return null;
  }
  const normalizado = valor.trim().toLowerCase();
  if (normalizado === "1" || normalizado === "true") {
    return true;
  }
  if (normalizado === "0" || normalizado === "false") {
    return false;
  }
  return null;
}

/**
 * Que hacer con la pausa de la IA. Se FIJA lo pedido; no se invierte lo que haya en la base.
 * `reactivar` = paso de pausada a activa: solo ahi sale el mensaje de reactivacion y el agente
 * retoma (igual que antes al prenderla). Pedir lo que ya esta no hace nada.
 */
export function decidirCambioDePausa(actualPausada: boolean, pedidoPausada: boolean) {
  const cambio = actualPausada !== pedidoPausada;
  return {
    pausada: pedidoPausada,
    cambio,
    reactivar: cambio && !pedidoPausada,
  };
}

export type RespuestaInterruptorIA = { ok: true; pausada: boolean } | { ok: false; error: string };

/**
 * Lo que muestra el interruptor despues de responder el servidor: el estado REAL que devolvio, o
 * el de antes si fallo (con aviso).
 */
export function estadoTrasRespuestaIA(
  pausadaAntes: boolean,
  pedidoPausada: boolean,
  respuesta: RespuestaInterruptorIA | null | undefined,
): { pausada: boolean; aviso: string | null } {
  if (respuesta && respuesta.ok) {
    return {
      pausada: respuesta.pausada,
      aviso:
        respuesta.pausada === pedidoPausada
          ? null
          : `La IA quedó ${respuesta.pausada ? "PAUSADA" : "ACTIVA"} en este chat. Vuelve a intentarlo.`,
    };
  }
  const motivo = respuesta && !respuesta.ok && respuesta.error ? ` (${respuesta.error})` : "";
  return {
    pausada: pausadaAntes,
    aviso: `No se pudo cambiar la IA${motivo}. Sigue ${pausadaAntes ? "PAUSADA" : "ACTIVA"} en este chat.`,
  };
}
