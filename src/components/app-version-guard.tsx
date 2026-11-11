"use client";

import * as React from "react";
import {
  hayEnviosEnMemoria,
  hayTextoEscrito,
  hayVersionNuevaConEspera,
  type RevisionDeVersion,
} from "@/lib/actualizacion-automatica";
import { debeRecargarEnSilencio, tiempoEnSegundoPlano } from "@/lib/recarga-silenciosa";

/**
 * Pone la version nueva SIN que la asesora lo note (orden de Alexander, 11-nov-2026).
 *
 * Historia: las asesoras dejan la app abierta todo el dia y subimos varios cambios al dia. Del
 * 27-oct al 10-nov-2026 se recargaba sola al ver la version nueva (le recargaba la bandeja a cada
 * rato, T-722); del 10 al 11-nov salia un aviso con un boton Actualizar.
 *
 * Ahora no se dibuja nada. La version nueva entra al abrir o recargar la app (eso lo hace el
 * navegador) o, en silencio, cuando la pestaña lleva MAS de 10 minutos seguidos en segundo plano sin
 * nada escrito ni nada por salir (regla en src/lib/recarga-silenciosa.ts). Con la pestaña a la vista
 * nunca se recarga. Tampoco se frena ningun envio por la version: los textos y archivos van por rutas
 * normales (enviar-por-ruta.ts), que no se rompen con un despliegue.
 */

const VERSION_CARGADA = process.env.NEXT_PUBLIC_DEPLOYMENT_ID?.trim() || "";
/** Cada cuanto se mira, solo con la pestaña oculta (los navegadores igual lo frenan a ~1 por minuto). */
const VUELTA_MS = 60_000;
/** Version del servidor por la que ya se recargo una vez en esta pestaña (para no recargar en bucle). */
const CLAVE_RECARGADA_POR = "aizen:recarga-silenciosa";

async function leerVersionDelServidor(): Promise<string | null> {
  try {
    const respuesta = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
    const datos = (await respuesta.json().catch(() => null)) as { version?: string } | null;
    const version = datos?.version?.trim();
    return version || null;
  } catch {
    return null;
  }
}

/** ¿La pagina quedo vieja? Ante la duda responde `false`. */
export async function hayVersionNueva(): Promise<boolean> {
  if (!VERSION_CARGADA) {
    return false;
  }
  const delServidor = await leerVersionDelServidor();
  return Boolean(delServidor) && delServidor !== VERSION_CARGADA;
}

let ultimaRevision: RevisionDeVersion | null = null;

/**
 * Para los refrescos automaticos de la bandeja: reusa la revision de hace menos de 15 s o pregunta
 * (1,5 s como maximo). Si /api/version no contesta, responde `false`. Nunca frena un envio.
 */
export function hayVersionNuevaReciente(): Promise<boolean> {
  return hayVersionNuevaConEspera({
    ahora: Date.now(),
    ultima: ultimaRevision,
    consultar: hayVersionNueva,
    guardar: (revision) => {
      ultimaRevision = revision;
    },
  });
}

/** Archivos en la cola del navegador (IndexedDB). Se carga solo al necesitarlo. Ante un error, `true`. */
async function hayEnviosEnLaColaDelNavegador(): Promise<boolean> {
  try {
    const { leerEnviosGuardados } = await import("@/components/chats/envios-guardados");
    return (await leerEnviosGuardados()).length > 0;
  } catch {
    return true;
  }
}

function yaSeRecargoPor(version: string): boolean {
  try {
    return window.sessionStorage.getItem(CLAVE_RECARGADA_POR) === version;
  } catch {
    // Sin almacenamiento no se puede evitar el bucle: mejor no recargar.
    return true;
  }
}

function anotarRecargaPor(version: string) {
  try {
    window.sessionStorage.setItem(CLAVE_RECARGADA_POR, version);
  } catch {
    // nada: yaSeRecargoPor ya respondio que se podia anotar
  }
}

export function AppVersionGuard() {
  React.useEffect(() => {
    // Sin version compilada (desarrollo) no hay nada que comparar.
    if (!VERSION_CARGADA) {
      return;
    }

    let cancelado = false;
    let revisando = false;
    let ocultaDesde: number | null = document.visibilityState === "hidden" ? Date.now() : null;

    const estadoAhora = (extra: { hayVersionNueva: boolean; enCola: boolean; version: string | null }) => ({
      visible: document.visibilityState !== "hidden",
      msEnSegundoPlano: tiempoEnSegundoPlano(ocultaDesde, Date.now()),
      hayTextoEscrito: hayTextoEscrito(),
      hayEnviosPendientes: extra.enCola || hayEnviosEnMemoria(),
      hayVersionNueva: extra.hayVersionNueva,
      yaSeRecargoPorEstaVersion: extra.version ? yaSeRecargoPor(extra.version) : false,
    });

    const revisar = async () => {
      if (cancelado || revisando) {
        return;
      }
      // Primero lo que no cuesta nada: si ya asi no se recargaria, ni se le pregunta al servidor.
      if (!debeRecargarEnSilencio(estadoAhora({ hayVersionNueva: true, enCola: false, version: null }))) {
        return;
      }
      revisando = true;
      try {
        const version = await leerVersionDelServidor();
        if (cancelado || !version || version === VERSION_CARGADA) {
          return;
        }
        const enCola = await hayEnviosEnLaColaDelNavegador();
        // Se vuelve a mirar TODO justo antes: pudo volver a la pestaña o escribir mientras tanto.
        if (cancelado || !debeRecargarEnSilencio(estadoAhora({ hayVersionNueva: true, enCola, version }))) {
          return;
        }
        anotarRecargaPor(version);
        window.location.reload();
      } finally {
        revisando = false;
      }
    };

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "hidden") {
        ocultaDesde ??= Date.now();
        return;
      }
      // Volvio a primer plano: el reloj vuelve a cero y no se recarga.
      ocultaDesde = null;
    };

    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    const reloj = window.setInterval(() => void revisar(), VUELTA_MS);

    return () => {
      cancelado = true;
      window.clearInterval(reloj);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, []);

  return null;
}
