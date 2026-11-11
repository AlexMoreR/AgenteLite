"use client";

import { useSyncExternalStore } from "react";
import type { ArchivoSubido } from "@/lib/subir-archivo-por-pedazos";
import { ESPERAS_REINTENTO_MS } from "@/lib/chat-envio-reintento";
import { enviarArchivoPorRuta, enviarAudioPorRuta } from "@/lib/chats/enviar-por-ruta";
import { borrarEnvio, guardarArchivo, guardarEnvio, leerEnviosGuardados, type EnvioGuardado } from "./envios-guardados";
import type { SharedInboxMessageItem, SharedInboxProps } from "./chat-inbox-types";

/*
  Archivos en envio (fotos, videos, documentos y notas de voz): la burbuja que aparece AL TOCAR
  ENVIAR con el archivo local, como si ya hubiera salido. El envio va por debajo, en una cola por
  chat (encolarEnvio): si se corta, se reintenta solo; solo si sigue fallando la burbuja queda en
  rojo con "No se envió · Reintentar".

  Viven aca, fuera del panel del chat, porque el panel se vuelve a crear cada vez que se cambia de
  chat (shared-inbox, `key` del ConversationPanel) y al hacerlo borraba lo que tenia guardado. Mismo
  patron que chat-selection-store.ts.

  Cada envio guarda su chat y su DESTINO (la configuracion del chat donde se toco Enviar): se
  muestra solo en ese chat y el reintento va siempre ahi, aunque la asesora haya cambiado de chat.

  Ademas se guardan en el navegador (envios-guardados.ts, IndexedDB) con su archivo y su numero
  unico: si se cierra la pestaña o se recarga a mitad del envio, al volver se retoma
  (reanudarEnviosGuardados). El numero unico (clave = clientMessageId) es el mismo en cada intento:
  el servidor lo reconoce y no lo manda dos veces a WhatsApp.

  El nombre del archivo y de los tipos quedo de cuando solo eran fotos.
*/

export type DestinoDeFoto = NonNullable<NonNullable<SharedInboxProps["composer"]>["media"]>;
export type DestinoDeAudio = NonNullable<NonNullable<SharedInboxProps["composer"]>["audio"]>;

export type EstadoDeFoto = "subiendo" | "enviando" | "enviada" | "fallida";

export type TipoDeEnvio = "IMAGE" | "VIDEO" | "DOCUMENT" | "AUDIO";

/** Lo que devolvio la subida. En la nota de voz solo importa la URL. */
export type SubidaDeEnvio = Omit<ArchivoSubido, "mediaType"> & { mediaType: TipoDeEnvio };

export type FotoEnEnvio = {
  /** `optimistic-media:local-<aleatorio>`: el prefijo lo reconoce la burbuja como "en envio". */
  id: string;
  conversationId: string;
  tipo: TipoDeEnvio;
  /** Numero unico del mensaje (clientMessageId): el mismo en cada intento, para no duplicar. */
  clave: string;
  /** Destino de fotos, videos y documentos. En una nota de voz es null. */
  destino: DestinoDeFoto | null;
  /** Destino de la nota de voz. En los demas es null. */
  destinoDeAudio: DestinoDeAudio | null;
  /** El archivo a subir. Al comprimirse se reemplaza por el comprimido, para no repetirlo al reintentar. */
  archivo: File;
  comprimida: boolean;
  /** `URL.createObjectURL` del archivo elegido: se libera cuando la burbuja desaparece. */
  vistaPrevia: string;
  caption: string;
  /** Duracion de la nota de voz, para que la burbuja la muestre sin bajar el audio. */
  duracionMs: number | null;
  /** Lo que devolvio la subida. Con esto, el reintento solo repite el envio y no vuelve a subir. */
  subida: SubidaDeEnvio | null;
  /** Avance real de la subida, de 0 a 1 (ya no se dibuja; queda para medir). */
  avance: number;
  estado: EstadoDeFoto;
  motivo: string | null;
  creadaEn: Date;
  enviadaEn: number | null;
};

/** Tarjeta de lo que no se pudo enviar y no tiene burbuja (rechazado antes de subir: formato o peso). */
export type ArchivosFallidos = {
  id: string;
  conversationId: string;
  destino: DestinoDeFoto;
  files: File[];
  caption?: string;
  motivo?: string;
};

export const PREFIJO_FOTO_EN_ENVIO = "optimistic-media:local-";

/*
  El servidor puede mandar el archivo y no lograr guardarlo en el chat (agent-actions.ts): el
  mensaje real nunca llega. La burbuja de un envio ya hecho se retira sola pasado este tiempo.
*/
export const VIDA_DE_FOTO_ENVIADA_MS = 5 * 60_000;

/** Esperas de los reintentos automaticos (2 reintentos: 1,5 s y 4 s), las mismas del texto. */
export const ESPERAS_AUTOMATICAS_MS = ESPERAS_REINTENTO_MS;

/*
  Al volver a abrir la pagina, un envio guardado se retoma solo si es reciente: mandarle a un
  cliente una foto media hora despues, sin que la asesora lo vea, puede no tener sentido. Uno mas
  viejo vuelve en rojo con Reintentar. Pasado un dia se descarta.
*/
export const REANUDAR_SOLO_HASTA_MS = 30 * 60_000;
export const VIDA_DEL_GUARDADO_MS = 24 * 60 * 60_000;

function aleatorio(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nuevoIdDeFoto(): string {
  return `${PREFIJO_FOTO_EN_ENVIO}${aleatorio()}`;
}

/** Numero unico del envio. Cumple el formato de idDeMensajeValido (letras, numeros y guiones). */
export function nuevaClaveDeEnvio(): string {
  return aleatorio().replace(/[^A-Za-z0-9_-]/g, "");
}

export function esFotoEnEnvio(id: string): boolean {
  return id.startsWith(PREFIJO_FOTO_EN_ENVIO);
}

/** El tipo que le va a dar el servidor (resolveMediaType en chat-upload.ts). */
export function tipoDeArchivo(mime: string): Exclude<TipoDeEnvio, "AUDIO"> {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}

/* ------------------------------------------------------------------ reglas puras */

/** Solo las del chat abierto. Sin chat abierto, ninguna. */
export function fotosDelChat<T extends { conversationId: string }>(
  fotos: readonly T[],
  conversationId: string | null | undefined,
): T[] {
  if (!conversationId) {
    return [];
  }
  return fotos.filter((foto) => foto.conversationId === conversationId);
}

/*
  Los envios cuyo mensaje real ya llego al chat: hay que retirarlos.

  Se cruza de dos maneras; basta con una:
  - Por el numero unico del envio (clave = clientMessageId): el servidor lo guarda en
    `rawPayload.clientMessageId` del mensaje real (agent-actions.ts). Sirve aunque el servidor haya
    guardado OTRA direccion (otro tamaño de la foto, la del gateway, el eco del webhook), que era lo
    que dejaba la burbuja encima de la real hasta VIDA_DE_FOTO_ENVIADA_MS. Una clave vacia nunca cuenta.
  - Por la direccion del SERVIDOR, que es la que se guarda en el mensaje real; la vista previa local
    (`blob:`) nunca coincidiria. Uno que todavia no termino de subir no tiene esa direccion. Se
    mantiene para los envios sin clave (la API oficial no la guarda en las fotos).
  Los mensajes son del chat `conversationId`: una coincidencia ahi no retira uno de otro chat.
*/
export function fotosQueYaLlegaron(
  fotos: readonly Pick<FotoEnEnvio, "id" | "conversationId" | "subida" | "clave">[],
  conversationId: string | null | undefined,
  mensajesReales: readonly Pick<SharedInboxMessageItem, "mediaUrl" | "rawPayload">[],
): string[] {
  if (!conversationId || fotos.length === 0 || mensajesReales.length === 0) {
    return [];
  }
  const direcciones = new Set<string>();
  const claves = new Set<string>();
  for (const mensaje of mensajesReales) {
    if (mensaje.mediaUrl) {
      direcciones.add(mensaje.mediaUrl);
    }
    const clave = claveDelMensaje(mensaje.rawPayload);
    if (clave) {
      claves.add(clave);
    }
  }
  return fotos
    .filter((foto) => {
      if (foto.conversationId !== conversationId) {
        return false;
      }
      if (foto.clave && claves.has(foto.clave)) {
        return true;
      }
      return Boolean(foto.subida?.url) && direcciones.has(foto.subida!.url);
    })
    .map((foto) => foto.id);
}

/** El `clientMessageId` que el servidor guardo en el crudo del mensaje real, si lo tiene. */
function claveDelMensaje(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== "object") {
    return null;
  }
  const clave = (rawPayload as { clientMessageId?: unknown }).clientMessageId;
  return typeof clave === "string" && clave.length > 0 ? clave : null;
}

export type DecisionDeReintento = "solo-enviar" | "subir-y-enviar" | "nada";

/*
  Que hace Reintentar. Solo uno FALLIDO se reintenta: uno que esta subiendo o enviando no (un doble
  toque cuenta como uno, porque el primero ya lo saca de "fallida"). Si la subida habia terminado,
  solo se repite el envio con la direccion guardada. Siempre con la misma clave.
*/
export function decidirReintento(foto: Pick<FotoEnEnvio, "estado" | "subida"> | null | undefined): DecisionDeReintento {
  if (!foto || foto.estado !== "fallida") {
    return "nada";
  }
  return foto.subida?.url ? "solo-enviar" : "subir-y-enviar";
}

/** Uno enviado cuyo mensaje real no llego en VIDA_DE_FOTO_ENVIADA_MS se retira solo. */
export function fotoEnviadaVencida(foto: Pick<FotoEnEnvio, "estado" | "enviadaEn">, ahora: number): boolean {
  return foto.estado === "enviada" && foto.enviadaEn !== null && ahora - foto.enviadaEn >= VIDA_DE_FOTO_ENVIADA_MS;
}

/** Lo que paso en un paso (subir o enviar): si salio, o el motivo y si vale reintentarlo solo. */
export type PasoDeEnvio<T> = { ok: true; valor: T } | { ok: false; motivo: string; reintentable: boolean };

/*
  Corre un paso y, si fallo de forma reintentable, lo repite despues de cada espera de
  ESPERAS_AUTOMATICAS_MS (3 intentos en total), sin mostrar nada. Una falla no reintentable se
  devuelve en el momento.
*/
export async function conReintentosAutomaticos<T>(
  paso: () => Promise<PasoDeEnvio<T>>,
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  esperas: readonly number[] = ESPERAS_AUTOMATICAS_MS,
): Promise<PasoDeEnvio<T> & { intentos: number }> {
  let intentos = 1;
  let resultado = await paso();
  for (const espera of esperas) {
    if (resultado.ok || !resultado.reintentable) {
      break;
    }
    await esperar(espera);
    intentos += 1;
    resultado = await paso();
  }
  return { ...resultado, intentos };
}

/*
  Lo que contesto la ruta de envio.

  Solo se reintenta solo si NO hubo respuesta (sin señal, la app no contesto, se vencio el tiempo):
  con la misma clave el servidor reconoce el envio y no lo repite. Si el servidor contesto
  `{ error }`, ya decidio -WhatsApp lo rechazo, sin permiso, monitoreo- y repetir da lo mismo; en
  un rechazo del gateway por tiempo, ademas, el archivo pudo haber salido. Va directo a rojo.
*/
export function clasificarRespuestaDeEnvio(input: { resultado?: unknown; excepcion?: boolean }): PasoDeEnvio<true> {
  if (input.excepcion) {
    return { ok: false, motivo: "No hubo respuesta del servidor. Revisa la señal.", reintentable: true };
  }
  const resultado = input.resultado as { ok?: unknown; error?: unknown } | null | undefined;
  if (resultado && resultado.ok === true) {
    return { ok: true, valor: true };
  }
  if (resultado && typeof resultado.error === "string" && resultado.error.trim()) {
    return { ok: false, motivo: resultado.error.trim(), reintentable: false };
  }
  return { ok: false, motivo: "No hubo respuesta del servidor. Revisa la señal.", reintentable: true };
}

/** La burbuja que se dibuja en el chat: el archivo local, como si ya hubiera salido, sin acciones. */
export function fotoComoMensaje(foto: FotoEnEnvio): SharedInboxMessageItem {
  return {
    id: foto.id,
    content: foto.tipo === "AUDIO" ? null : foto.caption || null,
    direction: "OUTBOUND",
    createdAt: foto.creadaEn,
    authorType: "bot",
    outboundStatusLabel: null,
    type: foto.tipo,
    mediaUrl: foto.vistaPrevia,
    rawPayload: {
      source: "manual",
      fileName: foto.archivo.name,
      mimeType: foto.archivo.type,
      fileSize: foto.archivo.size,
      ...(foto.tipo === "AUDIO" && foto.duracionMs ? { seconds: Math.max(1, Math.round(foto.duracionMs / 1000)) } : {}),
    },
  };
}

/* ------------------------------------------------------------------ almacen */

type Listener = () => void;

let fotos: FotoEnEnvio[] = [];
let archivosFallidos: ArchivosFallidos[] = [];
const listeners = new Set<Listener>();
const temporizadores = new Map<string, ReturnType<typeof setTimeout>>();
const SIN_FOTOS: FotoEnEnvio[] = [];
const SIN_FALLIDOS: ArchivosFallidos[] = [];

function avisar() {
  for (const listener of listeners) {
    listener();
  }
}

function suscribir(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function liberarVistaPrevia(foto: FotoEnEnvio) {
  try {
    if (foto.vistaPrevia.startsWith("blob:")) {
      URL.revokeObjectURL(foto.vistaPrevia);
    }
  } catch {
    // Sin URL.revokeObjectURL (no deberia pasar en un navegador): solo se pierde memoria.
  }
}

/* ---------------------------------------------- guardado en el navegador y candados */

function sinFuncion(destino: object | null): Record<string, unknown> | null {
  if (!destino) return null;
  const resto: Record<string, unknown> = { ...destino };
  delete resto.sendAction;
  return resto;
}

function comoGuardado(foto: FotoEnEnvio): EnvioGuardado {
  return {
    id: foto.id,
    conversationId: foto.conversationId,
    tipo: foto.tipo,
    clave: foto.clave,
    caption: foto.caption,
    comprimida: foto.comprimida,
    duracionMs: foto.duracionMs,
    subida: foto.subida,
    destino: sinFuncion(foto.destino),
    destinoDeAudio: sinFuncion(foto.destinoDeAudio),
    estado: foto.estado === "fallida" ? "fallida" : "pendiente",
    motivo: foto.motivo,
    creadaEn: foto.creadaEn.getTime(),
  };
}

/*
  Candado por envio entre pestañas (Web Locks): la pestaña que lo esta mandando lo tiene tomado, y
  otra pestaña que se abre en ese momento no lo retoma. Se suelta solo al cerrar la pestaña.
*/
const candados = new Map<string, () => void>();
const nombreDelCandado = (id: string) => `envio-medio:${id}`;

function cerraduras(): LockManager | null {
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
}

function tomarCandado(id: string) {
  const locks = cerraduras();
  if (!locks || candados.has(id)) return;
  let soltar: () => void = () => undefined;
  const hastaSoltar = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  candados.set(id, soltar);
  locks.request(nombreDelCandado(id), () => hastaSoltar).catch(() => undefined);
}

function soltarCandado(id: string) {
  candados.get(id)?.();
  candados.delete(id);
}

async function candadosDeOtrasPestanas(): Promise<Set<string>> {
  const locks = cerraduras();
  if (!locks) return new Set();
  try {
    const estado = await locks.query();
    return new Set([...(estado.held ?? []), ...(estado.pending ?? [])].map((lock) => lock.name ?? ""));
  } catch {
    return new Set();
  }
}

const enCurso = (estado: EstadoDeFoto) => estado === "subiendo" || estado === "enviando";

export function hayEnviosEnCurso(): boolean {
  return fotos.some((foto) => enCurso(foto.estado));
}

/*
  Cerrar la pestaña con un envio en curso pregunta antes, como en WhatsApp Web. Igual no se
  perderia (queda guardado), pero hasta volver a abrir no sale.
*/
let avisoDeCierreListo = false;
function prepararAvisoDeCierre() {
  if (avisoDeCierreListo || typeof window === "undefined") return;
  avisoDeCierreListo = true;
  window.addEventListener("beforeunload", (evento) => {
    if (!hayEnviosEnCurso()) return;
    evento.preventDefault();
    evento.returnValue = "";
  });
}

/* ------------------------------------------------------------------ lectura y cambios */

export function leerFotos(): FotoEnEnvio[] {
  return fotos;
}

export function leerFoto(id: string): FotoEnEnvio | null {
  return fotos.find((foto) => foto.id === id) ?? null;
}

function agregarSinGuardar(nuevas: FotoEnEnvio[]) {
  if (nuevas.length === 0) {
    return;
  }
  prepararAvisoDeCierre();
  for (const nueva of nuevas) {
    if (enCurso(nueva.estado)) tomarCandado(nueva.id);
  }
  fotos = [...fotos, ...nuevas];
  avisar();
}

export function agregarFotos(nuevas: FotoEnEnvio[]) {
  agregarSinGuardar(nuevas);
  for (const nueva of nuevas) {
    void guardarArchivo(nueva.id, nueva.archivo);
    void guardarEnvio(comoGuardado(nueva));
  }
}

/** Cambia un envio. Si ya no esta (llego el mensaje real o se descarto), no hace nada. */
export function actualizarFoto(id: string, cambios: Partial<Omit<FotoEnEnvio, "id">>) {
  let actualizada: FotoEnEnvio | null = null;
  fotos = fotos.map((foto) => {
    if (foto.id !== id) {
      return foto;
    }
    actualizada = { ...foto, ...cambios };
    return actualizada;
  });
  const foto = actualizada as FotoEnEnvio | null;
  if (!foto) {
    return;
  }
  avisar();
  if (cambios.estado) {
    if (enCurso(cambios.estado)) tomarCandado(id);
    else soltarCandado(id);
  }
  // Lo que importa para retomarlo: el archivo comprimido, lo que devolvio la subida y si fallo.
  if (cambios.archivo) {
    void guardarArchivo(id, cambios.archivo);
  }
  if (foto.estado !== "enviada" && ("subida" in cambios || "estado" in cambios || "archivo" in cambios || "comprimida" in cambios)) {
    void guardarEnvio(comoGuardado(foto));
  }
}

/** Retira las burbujas, libera sus vistas previas y las borra del navegador. */
export function quitarFotos(ids: readonly string[]) {
  if (ids.length === 0) {
    return;
  }
  const quitar = new Set(ids);
  const quedan: FotoEnEnvio[] = [];
  for (const foto of fotos) {
    if (quitar.has(foto.id)) {
      liberarVistaPrevia(foto);
      soltarCandado(foto.id);
      void borrarEnvio(foto.id);
      const temporizador = temporizadores.get(foto.id);
      if (temporizador) {
        clearTimeout(temporizador);
        temporizadores.delete(foto.id);
      }
    } else {
      quedan.push(foto);
    }
  }
  if (quedan.length !== fotos.length) {
    fotos = quedan;
    avisar();
  }
}

/** Salio bien: queda la burbuja hasta que llegue el mensaje real, o se retira sola a los 5 minutos. */
export function marcarFotoEnviada(id: string, ahora = Date.now()) {
  actualizarFoto(id, { estado: "enviada", motivo: null, avance: 1, enviadaEn: ahora });
  if (!leerFoto(id)) {
    return;
  }
  // Ya salio: no hay nada que retomar si se cierra la pestaña.
  void borrarEnvio(id);
  const anterior = temporizadores.get(id);
  if (anterior) {
    clearTimeout(anterior);
  }
  temporizadores.set(
    id,
    setTimeout(() => {
      temporizadores.delete(id);
      const foto = leerFoto(id);
      if (foto && fotoEnviadaVencida(foto, Date.now())) {
        quitarFotos([id]);
      }
    }, VIDA_DE_FOTO_ENVIADA_MS),
  );
}

/* ------------------------------------------------------------------ cola */

/*
  Una cola por chat: los archivos de un chat salen en el orden en que se tocaron (WhatsApp los
  muestra en el orden en que llegan), y un video grande en un chat no frena una foto en otro.
*/
const colas = new Map<string, Promise<unknown>>();

export function encolarEnvio(conversationId: string, tarea: () => Promise<unknown>): Promise<unknown> {
  const anterior = colas.get(conversationId) ?? Promise.resolve();
  const siguiente = anterior.catch(() => undefined).then(tarea);
  colas.set(conversationId, siguiente);
  const limpiar = () => {
    if (colas.get(conversationId) === siguiente) {
      colas.delete(conversationId);
    }
  };
  // Con los dos caminos: un `finally` sobre una tarea que fallo dejaria un rechazo sin atender.
  siguiente.then(limpiar, limpiar);
  return siguiente;
}

/*
  Manda un envio a la cola de su chat. Si `enviar` lanza algo inesperado, la burbuja queda en rojo
  con Reintentar, no "enviandose" para siempre. Nunca rechaza.
*/
export function encolarFoto(id: string, conversationId: string, enviar: (id: string) => Promise<unknown>): Promise<void> {
  return encolarEnvio(conversationId, async () => {
    try {
      await enviar(id);
    } catch {
      const foto = leerFoto(id);
      if (foto && enCurso(foto.estado)) {
        actualizarFoto(id, { estado: "fallida", motivo: "No se pudo enviar." });
      }
    }
  }).then(() => undefined);
}

/* ------------------------------------------------------------------ retomar al volver */

let reanudacionHecha = false;

/*
  Vuelve a poner en el chat lo que quedo guardado de una pestaña anterior (se cerro o se recargo a
  mitad del envio). Los recientes y pendientes se retoman (alRetomar los manda a la cola); los
  viejos o fallidos vuelven en rojo con Reintentar; los de mas de un dia se descartan. Corre una
  vez por pagina. Lo que otra pestaña abierta esta mandando no se toca.
*/
export async function reanudarEnviosGuardados(alRetomar: (foto: FotoEnEnvio) => void): Promise<void> {
  if (reanudacionHecha || typeof window === "undefined") {
    return;
  }
  reanudacionHecha = true;
  const [guardados, ocupados] = await Promise.all([leerEnviosGuardados(), candadosDeOtrasPestanas()]);
  const ahora = Date.now();
  for (const guardado of guardados) {
    if (leerFoto(guardado.id) || ocupados.has(nombreDelCandado(guardado.id))) {
      continue;
    }
    const edad = ahora - guardado.creadaEn;
    const destino = guardado.destino ? ({ ...guardado.destino, sendAction: enviarArchivoPorRuta } as DestinoDeFoto) : null;
    const destinoDeAudio = guardado.destinoDeAudio
      ? ({ ...guardado.destinoDeAudio, sendAction: enviarAudioPorRuta } as DestinoDeAudio)
      : null;
    if (edad > VIDA_DEL_GUARDADO_MS || (guardado.tipo === "AUDIO" ? !destinoDeAudio : !destino)) {
      void borrarEnvio(guardado.id);
      continue;
    }
    const retomar = guardado.estado === "pendiente" && edad <= REANUDAR_SOLO_HASTA_MS;
    let vistaPrevia = "";
    try {
      vistaPrevia = URL.createObjectURL(guardado.archivo);
    } catch {
      continue;
    }
    const foto: FotoEnEnvio = {
      id: guardado.id,
      conversationId: guardado.conversationId,
      tipo: guardado.tipo,
      clave: guardado.clave,
      destino,
      destinoDeAudio,
      archivo: guardado.archivo,
      comprimida: guardado.comprimida,
      vistaPrevia,
      caption: guardado.caption,
      duracionMs: guardado.duracionMs,
      subida: guardado.subida,
      avance: 0,
      estado: retomar ? (guardado.subida ? "enviando" : "subiendo") : "fallida",
      motivo: retomar ? null : guardado.motivo || "Quedó sin enviar al cerrar la pestaña.",
      creadaEn: new Date(guardado.creadaEn),
      enviadaEn: null,
    };
    agregarSinGuardar([foto]);
    if (retomar) {
      alRetomar(foto);
    } else if (guardado.estado !== "fallida") {
      void guardarEnvio(comoGuardado(foto));
    }
  }
}

/* ------------------------------------------------------------------ tarjeta de rechazados */

export function leerArchivosFallidos(): ArchivosFallidos[] {
  return archivosFallidos;
}

export function agregarArchivosFallidos(tarjeta: ArchivosFallidos) {
  archivosFallidos = [...archivosFallidos, tarjeta];
  avisar();
}

export function quitarArchivosFallidos(id: string) {
  const quedan = archivosFallidos.filter((tarjeta) => tarjeta.id !== id);
  if (quedan.length !== archivosFallidos.length) {
    archivosFallidos = quedan;
    avisar();
  }
}

/** Solo para las pruebas: vuelve el almacen a cero. */
export function vaciarFotosEnEnvio() {
  for (const temporizador of temporizadores.values()) {
    clearTimeout(temporizador);
  }
  temporizadores.clear();
  for (const id of [...candados.keys()]) {
    soltarCandado(id);
  }
  colas.clear();
  fotos = [];
  archivosFallidos = [];
  avisar();
}

export function useFotosEnEnvio(): FotoEnEnvio[] {
  return useSyncExternalStore(suscribir, leerFotos, () => SIN_FOTOS);
}

export function useArchivosFallidos(): ArchivosFallidos[] {
  return useSyncExternalStore(suscribir, leerArchivosFallidos, () => SIN_FALLIDOS);
}
