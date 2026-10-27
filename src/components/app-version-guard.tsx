"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import {
  EVENTO_REVISAR_VERSION,
  decidirRecarga,
  estaOcupada,
  leerRecargas,
  olvidarRecargas,
  pedirGuardadoDeBorrador,
  registrarRecarga,
} from "@/lib/actualizacion-automatica";

/**
 * Avisa cuando la pagina abierta quedo vieja despues de un despliegue.
 *
 * Las asesoras dejan la app abierta todo el dia en el celular y nosotros desplegamos varias
 * veces al dia. Cuando desplegamos, el codigo que ellas tienen cargado deja de coincidir con el
 * del servidor y TODO boton que le habla al servidor se rompe: mandar un catalogo, responder un
 * chat, registrar una llamada. En pantalla no se ve un error entendible, se ve
 * "No se pudo enviar SILLAS DE BARBERIA.pdf" — y no hay nada malo con el PDF ni con el chat.
 *
 * Se comprueba al volver a la app Y cada pocos minutos mientras este abierta. Lo segundo faltaba,
 * y es el caso de quien trabaja sin soltar la pantalla: Alex tuvo la pestaña abierta y activa una
 * noche entera mientras se desplegaba seis veces, nunca perdio el foco, nunca se entero, y lo que
 * vio fue un panel que no cargaba y un "cambiar asesor" que no hacia nada (24-sep-2026). En el
 * servidor eso se lee como "Failed to find Server Action".
 *
 * Desde el 27-oct-2026 ya no pide tocar nada: al detectar la version nueva la app se recarga SOLA
 * en un momento seguro (la asesora quieta, sin envio ni audio ni archivo en curso), con el
 * borrador guardado. La pastilla "Actualizamos la app" queda solo de respaldo, si tras 2
 * recargas seguidas la app sigue vieja. Reglas en src/lib/actualizacion-automatica.ts.
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
    let hayNueva = false;
    let esperando: number | null = null;

    const dejarDeEsperar = () => {
      if (esperando !== null) {
        window.clearInterval(esperando);
        esperando = null;
      }
    };

    /**
     * Recarga sola cuando es seguro (ver decidirRecarga). Si la asesora esta haciendo algo, se
     * reintenta cada segundo hasta que quede quieta. El borrador se guarda justo antes.
     */
    const intentarRecargar = (ignorar: string[] = []) => {
      if (cancelado || !hayNueva) {
        return;
      }
      const decision = decidirRecarga({
        ahora: Date.now(),
        ocupada: estaOcupada(Date.now(), ignorar),
        recargas: leerRecargas(),
      });
      if (decision === "pastilla") {
        dejarDeEsperar();
        setVieja(true);
        return;
      }
      if (decision === "esperar") {
        if (esperando === null) {
          esperando = window.setInterval(() => intentarRecargar(), 1000);
        }
        return;
      }
      dejarDeEsperar();
      pedirGuardadoDeBorrador();
      registrarRecarga();
      window.location.reload();
    };

    const comprobar = async (ignorar: string[] = []) => {
      if (cancelado || document.visibilityState !== "visible") {
        return;
      }
      if (await hayVersionNueva()) {
        if (cancelado) return;
        hayNueva = true;
        intentarRecargar(ignorar);
      } else if (!cancelado) {
        // Al dia: se olvidan los intentos y se quita la pastilla si estaba.
        hayNueva = false;
        dejarDeEsperar();
        olvidarRecargas();
        setVieja(false);
      }
    };

    const alVolver = () => void comprobar();
    const alPedirRevision = (evento: Event) => {
      const ignorar = (evento as CustomEvent<{ ignorar?: string[] }>).detail?.ignorar ?? [];
      void comprobar(ignorar);
    };

    void comprobar();
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    window.addEventListener(EVENTO_REVISAR_VERSION, alPedirRevision);
    // Cada minuto: es una respuesta de dos lineas, y solo corre con la pestaña a la vista.
    const reloj = window.setInterval(alVolver, 60 * 1000);

    return () => {
      cancelado = true;
      dejarDeEsperar();
      window.clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener(EVENTO_REVISAR_VERSION, alPedirRevision);
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
