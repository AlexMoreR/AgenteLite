"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { getPendingConversationSelection } from "@/components/chats/chat-selection-store";

/**
 * Avisa al servidor "sigo acá, y estoy en esto".
 *
 * Es lo que alimenta la columna "Última vez" de la pantalla de Actividad: cuándo fue el último
 * movimiento de cada persona, en qué pantalla estaba y desde qué aparato.
 *
 * Late al cambiar de pantalla y cada pocos minutos mientras la pestaña se esté MIRANDO. Con la
 * pestaña escondida no late: una pestaña olvidada toda la noche diría que la persona estuvo
 * trabajando hasta las tres de la mañana, que es exactamente lo contrario de lo que se quiere
 * saber. Al volver a mirarla late de una.
 */

const CADA_CUANTO_MS = 4 * 60_000;

export function LatidoDeActividad() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/cliente")) {
      return;
    }

    let vivo = true;

    const latir = () => {
      if (!vivo || document.visibilityState !== "visible") {
        return;
      }
      /*
        Dentro de Chats se manda además a quién se está atendiendo.

        Sale del mismo store que sabe qué chat está abierto, así que dice lo que la persona ve en
        pantalla. Si no hay ninguno abierto va sin etiqueta y queda "Chats" a secas.
      */
      const abierto = pathname.startsWith("/cliente/chats") ? getPendingConversationSelection() : null;
      const etiqueta = abierto?.label?.trim() || null;

      void fetch("/api/cliente/actividad/latido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruta: pathname, etiqueta }),
        cache: "no-store",
        // Si la persona cierra la pestaña justo ahora, el latido igual sale.
        keepalive: true,
      }).catch(() => undefined);
    };

    latir();
    const reloj = window.setInterval(latir, CADA_CUANTO_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") {
        latir();
      }
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      vivo = false;
      window.clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [pathname]);

  return null;
}
