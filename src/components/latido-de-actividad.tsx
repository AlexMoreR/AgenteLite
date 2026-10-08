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
 * abrir la app la pone en línea y sigue así aunque esconda la app o bloquee el celular; solo sale
 * sola si pasan 2 h sin ningún latido. Por eso al esconder la app no se manda nada: no hacen
 * falta pedidos en segundo plano.
 */

const CADA_CUANTO_MS = 4 * 60_000;

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
