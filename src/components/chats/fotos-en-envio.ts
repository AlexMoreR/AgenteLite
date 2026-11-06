"use client";

import { useSyncExternalStore } from "react";
import type { ArchivoSubido } from "@/lib/subir-archivo-por-pedazos";
import type { SharedInboxMessageItem, SharedInboxProps } from "./chat-inbox-types";

/*
  Fotos en envio: la burbuja que aparece AL TOCAR ENVIAR, con la vista previa local, la barra de
  subida y, si falla, el motivo con Reintentar.

  Viven aca, fuera del panel del chat, porque el panel se vuelve a crear cada vez que se cambia de
  chat (shared-inbox, `key` del ConversationPanel) y al hacerlo borraba lo que tenia guardado: la
  foto seguia saliendo, pero la burbuja y la tarjeta de error se perdian. Mismo patron que
  chat-selection-store.ts.

  Cada foto guarda su chat y su DESTINO de envio (la configuracion del chat donde se toco Enviar):
  se muestra solo en ese chat y el reintento va siempre ahi, aunque la asesora haya cambiado de chat.

  Limite: es memoria del navegador. Si se recarga la pagina durante la subida, se pierden la
  burbuja y esa subida.
*/

export type DestinoDeFoto = NonNullable<NonNullable<SharedInboxProps["composer"]>["media"]>;

export type EstadoDeFoto = "subiendo" | "enviando" | "enviada" | "fallida";

export type FotoEnEnvio = {
  /** `optimistic-media:local-<aleatorio>`: el prefijo lo reconoce la burbuja como "en envio". */
  id: string;
  conversationId: string;
  destino: DestinoDeFoto;
  /** La foto a subir. Al comprimirse se reemplaza por la comprimida, para no repetirlo al reintentar. */
  archivo: File;
  comprimida: boolean;
  /** `URL.createObjectURL` de la foto elegida: se libera cuando la burbuja desaparece. */
  vistaPrevia: string;
  caption: string;
  /** Lo que devolvio la subida. Con esto, el reintento solo repite el envio y no vuelve a subir. */
  subida: ArchivoSubido | null;
  /** Avance real de la subida, de 0 a 1. */
  avance: number;
  estado: EstadoDeFoto;
  motivo: string | null;
  creadaEn: Date;
  enviadaEn: number | null;
};

/** Tarjeta de lo que no se pudo enviar y no es una foto en burbuja (videos, documentos, rechazados). */
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
  El servidor puede mandar la foto y no lograr guardarla en el chat (agent-actions.ts): el mensaje
  real nunca llega. La burbuja de una foto ya enviada se retira sola pasado este tiempo.
*/
export const VIDA_DE_FOTO_ENVIADA_MS = 5 * 60_000;

export function nuevoIdDeFoto(): string {
  const aleatorio =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${PREFIJO_FOTO_EN_ENVIO}${aleatorio}`;
}

export function esFotoEnEnvio(id: string): boolean {
  return id.startsWith(PREFIJO_FOTO_EN_ENVIO);
}

/* ------------------------------------------------------------------ reglas puras */

/** Solo las fotos del chat abierto. Sin chat abierto, ninguna. */
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
  Las fotos cuyo mensaje real ya llego al chat: hay que retirarlas.

  Se compara contra la direccion del SERVIDOR, que es la que se guarda en el mensaje real; la vista
  previa local (`blob:`) nunca coincidiria. Una foto que todavia no termino de subir no tiene esa
  direccion y no se retira. Los mensajes son del chat `conversationId`: una coincidencia ahi no
  retira una foto de otro chat.
*/
export function fotosQueYaLlegaron(
  fotos: readonly Pick<FotoEnEnvio, "id" | "conversationId" | "subida">[],
  conversationId: string | null | undefined,
  mensajesReales: readonly Pick<SharedInboxMessageItem, "mediaUrl">[],
): string[] {
  if (!conversationId || fotos.length === 0 || mensajesReales.length === 0) {
    return [];
  }
  const direcciones = new Set<string>();
  for (const mensaje of mensajesReales) {
    if (mensaje.mediaUrl) {
      direcciones.add(mensaje.mediaUrl);
    }
  }
  return fotos
    .filter(
      (foto) =>
        foto.conversationId === conversationId && Boolean(foto.subida?.url) && direcciones.has(foto.subida!.url),
    )
    .map((foto) => foto.id);
}

export type DecisionDeReintento = "solo-enviar" | "subir-y-enviar" | "nada";

/*
  Que hace Reintentar. Solo una foto FALLIDA se reintenta: una que esta subiendo o enviando no (un
  doble toque cuenta como uno, porque el primero ya la saca de "fallida"). Si la subida habia
  terminado, solo se repite el envio con la direccion guardada.
*/
export function decidirReintento(foto: Pick<FotoEnEnvio, "estado" | "subida"> | null | undefined): DecisionDeReintento {
  if (!foto || foto.estado !== "fallida") {
    return "nada";
  }
  return foto.subida?.url ? "solo-enviar" : "subir-y-enviar";
}

/** Una foto enviada cuyo mensaje real no llego en VIDA_DE_FOTO_ENVIADA_MS se retira sola. */
export function fotoEnviadaVencida(foto: Pick<FotoEnEnvio, "estado" | "enviadaEn">, ahora: number): boolean {
  return foto.estado === "enviada" && foto.enviadaEn !== null && ahora - foto.enviadaEn >= VIDA_DE_FOTO_ENVIADA_MS;
}

/** La burbuja que se dibuja en el chat: la vista previa local como foto, sin acciones. */
export function fotoComoMensaje(foto: FotoEnEnvio): SharedInboxMessageItem {
  return {
    id: foto.id,
    content: foto.caption || null,
    direction: "OUTBOUND",
    createdAt: foto.creadaEn,
    authorType: "bot",
    outboundStatusLabel: null,
    type: "IMAGE",
    mediaUrl: foto.vistaPrevia,
    rawPayload: {
      source: "manual",
      fileName: foto.archivo.name,
      mimeType: foto.archivo.type,
      fileSize: foto.archivo.size,
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

export function leerFotos(): FotoEnEnvio[] {
  return fotos;
}

export function leerFoto(id: string): FotoEnEnvio | null {
  return fotos.find((foto) => foto.id === id) ?? null;
}

export function agregarFotos(nuevas: FotoEnEnvio[]) {
  if (nuevas.length === 0) {
    return;
  }
  fotos = [...fotos, ...nuevas];
  avisar();
}

/** Cambia una foto. Si ya no esta (llego el mensaje real o se descarto), no hace nada. */
export function actualizarFoto(id: string, cambios: Partial<Omit<FotoEnEnvio, "id">>) {
  let cambio = false;
  fotos = fotos.map((foto) => {
    if (foto.id !== id) {
      return foto;
    }
    cambio = true;
    return { ...foto, ...cambios };
  });
  if (cambio) {
    avisar();
  }
}

/** Retira las burbujas y libera sus vistas previas. */
export function quitarFotos(ids: readonly string[]) {
  if (ids.length === 0) {
    return;
  }
  const quitar = new Set(ids);
  const quedan: FotoEnEnvio[] = [];
  for (const foto of fotos) {
    if (quitar.has(foto.id)) {
      liberarVistaPrevia(foto);
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
