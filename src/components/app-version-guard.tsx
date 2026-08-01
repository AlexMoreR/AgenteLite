"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";

/**
 * Avisa cuando la pagina abierta quedo vieja despues de un despliegue.
 *
 * Las asesoras dejan la app abierta todo el dia en el celular y nosotros desplegamos varias
 * veces al dia. Cuando desplegamos, el codigo que ellas tienen cargado deja de coincidir con el
 * del servidor y TODO boton que le habla al servidor se rompe: mandar un catalogo, responder un
 * chat, registrar una llamada. En pantalla no se ve un error entendible, se ve
 * "No se pudo enviar SILLAS DE BARBERIA.pdf" — y no hay nada malo con el PDF ni con el chat.
 *
 * La comprobacion es al volver a la app (no hay poll): es justo el momento en que una asesora
 * retoma el celular despues de un rato, que es cuando el problema aparece.
 */

const VERSION_CARGADA = process.env.NEXT_PUBLIC_DEPLOYMENT_ID?.trim() || "";

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

/**
 * ¿La pagina quedo vieja? Lo usa el chat para explicar un envio fallido en vez de dejar el
 * mensaje generico. Ante la duda responde `false`: nunca hay que empujar a recargar por las
 * dudas, se perderia lo que la asesora tenga escrito.
 */
export async function hayVersionNueva(): Promise<boolean> {
  if (!VERSION_CARGADA) {
    return false;
  }
  const delServidor = await leerVersionDelServidor();
  return Boolean(delServidor) && delServidor !== VERSION_CARGADA;
}

export function AppVersionGuard() {
  const [vieja, setVieja] = React.useState(false);

  React.useEffect(() => {
    // Sin version compilada (desarrollo) no hay nada que comparar.
    if (!VERSION_CARGADA) {
      return;
    }

    let cancelado = false;

    const comprobar = async () => {
      if (cancelado || document.visibilityState !== "visible") {
        return;
      }
      if (await hayVersionNueva()) {
        if (!cancelado) setVieja(true);
      }
    };

    void comprobar();
    document.addEventListener("visibilitychange", comprobar);
    window.addEventListener("focus", comprobar);

    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", comprobar);
      window.removeEventListener("focus", comprobar);
    };
  }, []);

  if (!vieja) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex justify-center px-3">
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)] px-4 py-2 text-[13px] font-medium text-white shadow-lg transition hover:brightness-110"
      >
        <RefreshCw className="size-4" />
        Actualizamos la app · tocá para recargar
      </button>
    </div>
  );
}
