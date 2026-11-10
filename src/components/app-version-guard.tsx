"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ESPERA_GUARDAR_BORRADOR_MS,
  EVENTO_REVISAR_VERSION,
  hayVersionNuevaAntesDeEnviar,
  type RevisionDeVersion,
  pedirGuardadoDeBorrador,
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
 * Del 27-oct al 10-nov-2026 se recargaba SOLA al detectar la version nueva. Con varios despliegues
 * al dia eso le recargaba la bandeja a las asesoras a cada rato (T-722). Desde el 10-nov-2026 NUNCA
 * recarga sola: sale un aviso discreto "Hay una versión nueva del CRM. Actualiza cuando termines" con
 * el boton Actualizar, que guarda el borrador y recarga. La asesora decide cuando.
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

let ultimaRevision: RevisionDeVersion | null = null;

/**
 * Para el momento de enviar: reusa la revision de hace menos de 15 s o pregunta (1,5 s como
 * maximo). Si /api/version no contesta, responde `false` y el mensaje se envia normal.
 */
export function hayVersionNuevaParaEnviar(): Promise<boolean> {
  return hayVersionNuevaAntesDeEnviar({
    ahora: Date.now(),
    ultima: ultimaRevision,
    consultar: hayVersionNueva,
    guardar: (revision) => {
      ultimaRevision = revision;
    },
  });
}

export function AppVersionGuard() {
  const [hayNueva, setHayNueva] = React.useState(false);
  const [actualizando, setActualizando] = React.useState(false);

  React.useEffect(() => {
    // Sin version compilada (desarrollo) no hay nada que comparar.
    if (!VERSION_CARGADA) {
      return;
    }

    let cancelado = false;

    // Solo avisa: NUNCA recarga sola (T-722). La asesora actualiza cuando termine lo que esta haciendo.
    const comprobar = async () => {
      if (cancelado || document.visibilityState !== "visible") {
        return;
      }
      const nueva = await hayVersionNueva();
      if (!cancelado) {
        setHayNueva(nueva);
      }
    };

    const alVolver = () => void comprobar();

    void comprobar();
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    window.addEventListener(EVENTO_REVISAR_VERSION, alVolver);
    // Cada minuto: es una respuesta de dos lineas, y solo corre con la pestaña a la vista.
    const reloj = window.setInterval(alVolver, 60 * 1000);

    return () => {
      cancelado = true;
      window.clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener(EVENTO_REVISAR_VERSION, alVolver);
    };
  }, []);

  if (!hayNueva) {
    return null;
  }

  // Al tocar Actualizar: primero se guarda el borrador del chat abierto y despues se recarga.
  const actualizar = () => {
    setActualizando(true);
    pedirGuardadoDeBorrador();
    window.setTimeout(() => window.location.reload(), ESPERA_GUARDAR_BORRADOR_MS);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex justify-center px-3">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-3 pr-1 text-[13px] text-foreground shadow-md"
      >
        <span>Hay una versión nueva del CRM. Actualiza cuando termines</span>
        <Button type="button" size="sm" className="rounded-full" onClick={actualizar} disabled={actualizando}>
          <RefreshCw className={actualizando ? "size-3.5 animate-spin" : "size-3.5"} />
          Actualizar
        </Button>
      </div>
    </div>
  );
}
