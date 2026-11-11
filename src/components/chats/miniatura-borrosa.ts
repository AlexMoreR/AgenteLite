"use client";

import { alCambiarElDueno } from "./guardado-local/dueno";

/*
  LA MINIATURA BORROSA DE LAS FOTOS (Alex, 11-11-2026: "las fotos salen como un cuadro gris vacio y
  despues cargan; muestra de una vez una miniatura borrosa guardada, como WhatsApp").

  La caja de la foto ya tenia su tamaño final (no brincaba); lo que faltaba era algo que ver mientras
  baja la foto. De donde sale, en este orden:
    1. La miniatura que trae el mensaje de WhatsApp (jpegThumbnail): adentro del mensaje o como
       direccion aparte (lib/miniaturas-aparte.ts, que el navegador guarda un año).
    2. Una copia chiquita (MAXIMO_LADO px) que se guarda en el celular la primera vez que la foto se
       ve: la proxima vez sale al instante. Se guarda por la direccion de la foto, asi la foto del
       catalogo que mandan los flujos a cien clientas se guarda una vez y sirve en todos los chats.
  Encima carga la foto nitida, del mismo tamaño, y aparece sin mover nada.

  Vive bajo el prefijo "aglite:chat-history-cache" (dueno.ts lo borra al cambiar de usuario o de
  negocio) y solo se lee con dueño. Cualquier error se traga: sin miniatura queda el gris de antes.
*/

const CLAVE = "aglite:chat-history-cache:borrosas:v1";
const CLAVE_DEL_DUENO = "aglite:dueno-del-guardado";
/** Lado mayor de la copia guardada: borrosa no necesita mas (pesa ~0,5-1 kB). */
const MAXIMO_LADO = 24;
/** Cuantas fotos se recuerdan (las mas recientes). ~300 kB como mucho. */
const MAXIMO_DE_FOTOS = 300;
const ESPERA_PARA_ESCRIBIR_MS = 1500;

type Guardadas = Record<string, { d: string; t: number }>;

let enMemoria: Guardadas | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;

// Otro usuario u otro negocio: lo del navegador ya lo borro dueno.ts; lo de memoria tambien se olvida.
alCambiarElDueno(() => {
  enMemoria = null;
  if (temporizador !== null) clearTimeout(temporizador);
  temporizador = null;
});

function hayDueno(): boolean {
  try {
    return Boolean(window.localStorage.getItem(CLAVE_DEL_DUENO));
  } catch {
    return false;
  }
}

function leerTodas(): Guardadas {
  if (enMemoria) return enMemoria;
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    const datos = crudo ? (JSON.parse(crudo) as unknown) : null;
    enMemoria = datos && typeof datos === "object" && !Array.isArray(datos) ? (datos as Guardadas) : {};
  } catch {
    enMemoria = {};
  }
  return enMemoria;
}

const FIRMAS = ["oh", "oe", "_nc_sid", "_nc_ohc", "_nc_oc", "ccb", "_nc_zt", "_nc_ht", "_nc_gid", "_nc_cat"];

/**
 * La llave de una foto: su direccion sin lo que cambia entre pedidos. Las de WhatsApp traen una firma
 * que vence (oh, oe...) y suelen ir ADENTRO de la del proxy (/api/media/proxy?url=...): la misma foto
 * llegaba con otra firma en la copia guardada y en /live, y la borrosa no se encontraba.
 */
export function llaveDeLaFoto(url: string): string {
  try {
    const base = typeof window === "undefined" ? "https://x" : window.location.origin;
    let direccion = new URL(url, base);
    const adentro = direccion.pathname.startsWith("/api/media/proxy") ? direccion.searchParams.get("url") : null;
    if (adentro) direccion = new URL(adentro, base);
    for (const firma of FIRMAS) {
      direccion.searchParams.delete(firma);
    }
    return `${direccion.host}${direccion.pathname}?${direccion.searchParams.toString()}`.slice(0, 300);
  } catch {
    return url.slice(0, 300);
  }
}

/** La copia borrosa guardada de esta foto, o null. */
export function leerBorrosa(url: string | null | undefined): string | null {
  if (!url || typeof window === "undefined" || !hayDueno()) return null;
  const guardada = leerTodas()[llaveDeLaFoto(url)];
  return guardada && typeof guardada.d === "string" ? guardada.d : null;
}

function escribir() {
  temporizador = null;
  try {
    if (!enMemoria || !hayDueno()) return;
    const recientes = Object.entries(enMemoria)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, MAXIMO_DE_FOTOS);
    enMemoria = Object.fromEntries(recientes);
    window.localStorage.setItem(CLAVE, JSON.stringify(enMemoria));
  } catch {
    // Sin espacio: la proxima vez se ve el gris.
  }
}

/**
 * Guarda la copia borrosa de una foto que ya se dibujo. Solo si la foto es de nuestro dominio (si
 * no, el navegador no deja leer sus pixeles) y si no estaba guardada.
 */
export function guardarBorrosa(url: string | null | undefined, foto: HTMLImageElement) {
  try {
    if (!url || url.startsWith("data:") || !hayDueno()) return;
    const llave = llaveDeLaFoto(url);
    const todas = leerTodas();
    if (todas[llave]) return;
    const ancho = foto.naturalWidth;
    const alto = foto.naturalHeight;
    if (!ancho || !alto) return;
    const escala = MAXIMO_LADO / Math.max(ancho, alto);
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(ancho * escala));
    lienzo.height = Math.max(1, Math.round(alto * escala));
    const contexto = lienzo.getContext("2d");
    if (!contexto) return;
    contexto.drawImage(foto, 0, 0, lienzo.width, lienzo.height);
    // Lanza si la foto es de otro dominio sin permiso: se traga y no se guarda.
    const datos = lienzo.toDataURL("image/jpeg", 0.6);
    if (!datos.startsWith("data:image/jpeg")) return;
    todas[llave] = { d: datos, t: Date.now() };
    if (temporizador === null) {
      temporizador = setTimeout(escribir, ESPERA_PARA_ESCRIBIR_MS);
    }
  } catch {
    // Prescindible.
  }
}
