"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { getPendingConversationSelection } from "@/components/chats/chat-selection-store";
import { guardarEstadoEnLineaCliente, type EstadoEnLineaCliente } from "@/components/en-linea-store";

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
 *
 * El mismo latido mantiene a la asesora "Recibiendo clientes" (ver src/lib/en-linea-reglas.ts):
 * abrir la app la pone en línea y, sin latido en 7 min, sale sola del reparto. Por eso late una
 * vez más al ESCONDER la app (si el último fue hace más de 2 min): así el margen para mirar una
 * foto o contestar una llamada es de al menos 5 min, y no depende de cuándo cayó el último.
 */

const CADA_CUANTO_MS = 4 * 60_000;
/** Al esconder la app solo se late si el último latido fue hace más que esto. */
const LATIDO_AL_SALIR_SI_PASARON_MS = 2 * 60_000;

let ultimoLatidoEn = 0;

export function LatidoDeActividad() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/cliente")) {
      return;
    }

    let vivo = true;

    const enviar = () => {
      /*
        Dentro de Chats se manda además a quién se está atendiendo.

        Sale del mismo store que sabe qué chat está abierto, así que dice lo que la persona ve en
        pantalla. Si no hay ninguno abierto va sin etiqueta y queda "Chats" a secas.
      */
      const abierto = pathname.startsWith("/cliente/chats") ? getPendingConversationSelection() : null;
      const etiqueta = abierto?.label?.trim() || null;
      ultimoLatidoEn = Date.now();

      void fetch("/api/cliente/actividad/latido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruta: pathname, etiqueta }),
        cache: "no-store",
        // Si la persona cierra la pestaña justo ahora, el latido igual sale.
        keepalive: true,
      })
        .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
        .then((datos: { enLinea?: EstadoEnLineaCliente | null } | null) => {
          guardarEstadoEnLineaCliente(datos?.enLinea);
        })
        .catch(() => undefined);
    };

    const latir = () => {
      if (!vivo || document.visibilityState !== "visible") {
        return;
      }
      enviar();
    };

    latir();
    const reloj = window.setInterval(latir, CADA_CUANTO_MS);
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") {
        latir();
      } else if (vivo && Date.now() - ultimoLatidoEn > LATIDO_AL_SALIR_SI_PASARON_MS) {
        enviar();
      }
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    return () => {
      vivo = false;
      window.clearInterval(reloj);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [pathname]);

  return null;
}
