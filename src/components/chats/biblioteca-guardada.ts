"use client";

/*
  LA BIBLIOTECA GUARDADA EN EL CELULAR (Alex, 11-11-2026: "se queda en Abriendo... con Todos 0 y
  tarda en mostrar los 20 catalogos; que abra al instante desde una copia guardada, igual que la
  bandeja"; "los catalogos salen sin miniatura, solo un cuadro gris").

  - La LISTA: lo ultimo que se vio, para pintarla al abrir; la ruta GET la actualiza por debajo.
  - Las TAPAS CHICAS: una copia de 240 px de cada portada (~8-12 kB), hecha en el navegador la
    primera vez que se ve. Asi la tapa sale de una, sin bajar nada, y encima carga la de verdad.

  Medido antes: las portadas estaban guardadas con la direccion de app.aizenbot.com (el servidor
  viejo): cada una tardaba ~1 s contra 0,1 s la misma en crm.magilus.com, y sin permiso de guardarse
  en el navegador. Por eso tambien se muestran desde la direccion propia (rutaParaMostrar).

  Todo bajo el prefijo "aglite:lista-guardada", con dueño: dueno.ts lo borra al cambiar de usuario o
  de negocio. Cualquier error se traga: sin copia se abre como antes.
*/
import type { MediaLibraryItemDto } from "@/lib/biblioteca";

import { alCambiarElDueno } from "./guardado-local/dueno";

const CLAVE_DEL_DUENO = "aglite:dueno-del-guardado";
const PREFIJO_LISTA = "aglite:lista-guardada:biblioteca:";
const PREFIJO_TAPAS = "aglite:lista-guardada:tapas:";
const MAXIMO_DE_TAPAS = 60;
const ANCHO_DE_LA_TAPA = 240;
/** Las de nuestro propio servidor, con su direccion vieja o nueva. */
const DOMINIOS_PROPIOS = new Set(["app.aizenbot.com", "crm.magilus.com"]);

let tapasEnMemoria: Record<string, { d: string; t: number }> | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;

alCambiarElDueno(() => {
  tapasEnMemoria = null;
  if (temporizador !== null) clearTimeout(temporizador);
  temporizador = null;
});

function dueno(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(CLAVE_DEL_DUENO);
  } catch {
    return null;
  }
}

/**
 * La direccion para MOSTRAR un archivo propio: la ruta /uploads/... en este mismo dominio. Solo para
 * mostrar: el archivo que se le manda a WhatsApp sigue con su direccion completa.
 */
export function rutaParaMostrar(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const direccion = new URL(url);
    const propio =
      DOMINIOS_PROPIOS.has(direccion.hostname.toLowerCase()) ||
      (typeof window !== "undefined" && direccion.host === window.location.host);
    return propio && direccion.pathname.startsWith("/uploads/") ? `${direccion.pathname}${direccion.search}` : url;
  } catch {
    return url;
  }
}

export function leerBibliotecaGuardada(): MediaLibraryItemDto[] | null {
  const quien = dueno();
  if (!quien) return null;
  try {
    const crudo = window.localStorage.getItem(`${PREFIJO_LISTA}${quien}`);
    const datos = crudo ? (JSON.parse(crudo) as { guardadoEn?: number; items?: unknown }) : null;
    if (!datos || !Array.isArray(datos.items) || typeof datos.guardadoEn !== "number") return null;
    // Una copia de mas de 7 dias no se muestra: la biblioteca cambia poco, pero cambia.
    if (Date.now() - datos.guardadoEn > 7 * 24 * 3_600_000) return null;
    return datos.items.filter(
      (item): item is MediaLibraryItemDto =>
        Boolean(item) && typeof (item as MediaLibraryItemDto).id === "string" && typeof (item as MediaLibraryItemDto).title === "string",
    );
  } catch {
    return null;
  }
}

export function guardarBiblioteca(items: readonly MediaLibraryItemDto[]) {
  const quien = dueno();
  if (!quien) return;
  try {
    window.localStorage.setItem(`${PREFIJO_LISTA}${quien}`, JSON.stringify({ guardadoEn: Date.now(), items }));
  } catch {
    // Sin espacio: la proxima vez se abre como antes.
  }
}

function leerTapas(): Record<string, { d: string; t: number }> {
  if (tapasEnMemoria) return tapasEnMemoria;
  const quien = dueno();
  try {
    const crudo = quien ? window.localStorage.getItem(`${PREFIJO_TAPAS}${quien}`) : null;
    const datos = crudo ? (JSON.parse(crudo) as unknown) : null;
    tapasEnMemoria = datos && typeof datos === "object" && !Array.isArray(datos) ? (datos as Record<string, { d: string; t: number }>) : {};
  } catch {
    tapasEnMemoria = {};
  }
  return tapasEnMemoria;
}

/** La tapa chica guardada de este archivo, o null. */
export function leerTapaChica(itemId: string): string | null {
  if (!dueno()) return null;
  const tapa = leerTapas()[itemId];
  return tapa && typeof tapa.d === "string" ? tapa.d : null;
}

function escribirTapas() {
  temporizador = null;
  const quien = dueno();
  if (!quien || !tapasEnMemoria) return;
  try {
    const recientes = Object.entries(tapasEnMemoria)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, MAXIMO_DE_TAPAS);
    tapasEnMemoria = Object.fromEntries(recientes);
    window.localStorage.setItem(`${PREFIJO_TAPAS}${quien}`, JSON.stringify(tapasEnMemoria));
  } catch {
    // Sin espacio: la tapa se baja como antes.
  }
}

/** Guarda la tapa chica de una portada que ya se dibujo (solo si es de este dominio). Nunca lanza. */
export function guardarTapaChica(itemId: string, imagen: HTMLImageElement) {
  try {
    if (!dueno() || leerTapas()[itemId]) return;
    const ancho = imagen.naturalWidth;
    const alto = imagen.naturalHeight;
    if (!ancho || !alto) return;
    const escala = Math.min(1, ANCHO_DE_LA_TAPA / ancho);
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(ancho * escala));
    // La tapa se ve recortada por arriba (object-top) en una caja 4:3: se guarda solo esa parte.
    lienzo.height = Math.max(1, Math.min(Math.round(alto * escala), Math.round(lienzo.width * 0.75)));
    const contexto = lienzo.getContext("2d");
    if (!contexto) return;
    contexto.drawImage(imagen, 0, 0, Math.round(ancho * escala), Math.round(alto * escala));
    // Lanza si la imagen es de otro dominio sin permiso: no se guarda.
    const datos = lienzo.toDataURL("image/jpeg", 0.72);
    if (!datos.startsWith("data:image/jpeg")) return;
    leerTapas()[itemId] = { d: datos, t: Date.now() };
    if (temporizador === null) temporizador = setTimeout(escribirTapas, 1500);
  } catch {
    // Prescindible.
  }
}
