"use client";

import { useEffect, useState, type RefObject } from "react";

import { formatDateDivider } from "./chat-inbox-format";

/** Cuanto tarda en irse la pastilla despues de que se deja de hacer scroll (como WhatsApp). */
const OCULTAR_TRAS_MS = 1500;
/** Ventana para atribuir un scroll a la persona y no a un salto automatico del chat. */
const VENTANA_GESTO_MS = 1000;
/** La linea que se mira queda un poco por debajo del borde, donde flota la pastilla. */
const MARGEN_SUPERIOR_PX = 12;

/**
 * La fecha flotante del chat, como en WhatsApp.
 *
 * Al subir por una conversacion larga se pierde de vista el separador del dia y no hay forma de
 * saber cuando escribio la persona sin ir hasta arriba. Mientras se hace scroll aparece arriba y
 * centrada una pastilla con el dia del primer mensaje visible ("Hoy", "Ayer", "viernes" o la
 * fecha), con el mismo formato y estilo de los separadores, y se desvanece al soltar.
 *
 * Rendimiento: el evento de scroll solo agenda un requestAnimationFrame (uno por cuadro como
 * maximo). En ese cuadro se busca el primer mensaje visible con busqueda binaria sobre las
 * burbujas (`data-chat-ts`), unas 9 lecturas de posicion para 500 mensajes. La lista de
 * burbujas se guarda y solo se vuelve a pedir cuando el DOM cambia (llegan mensajes, se cargan
 * los viejos de arriba). El estado solo cambia cuando cambia el texto o la visibilidad, asi que
 * el resto del panel no se vuelve a pintar.
 *
 * Solo aparece si el scroll lo hizo la persona (rueda, dedo, teclado, barra): al abrir un chat
 * o al llegar un mensaje el panel baja solo, y que salte la pastilla ahi seria ruido.
 */
export function ChatFloatingDateBadge({
  scrollRef,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [etiqueta, setEtiqueta] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const contenedor = scrollRef.current;
    if (!contenedor) return;

    let burbujas: HTMLElement[] | null = null;
    let cuadro = 0;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let ultimoGesto = 0;
    let tocando = false;
    let mostrando = false;

    // Llegan mensajes o se cargan los viejos: la lista guardada ya no sirve.
    const observador = new MutationObserver(() => {
      burbujas = null;
    });
    observador.observe(contenedor, { childList: true, subtree: true });

    const calcular = () => {
      cuadro = 0;
      if (!burbujas) {
        burbujas = Array.from(contenedor.querySelectorAll<HTMLElement>("[data-chat-ts]"));
      }
      if (burbujas.length === 0) return;

      const linea = contenedor.getBoundingClientRect().top + MARGEN_SUPERIOR_PX;
      // Primera burbuja cuyo borde de abajo pasa la linea: es la que se ve arriba.
      let bajo = 0;
      let alto = burbujas.length - 1;
      while (bajo < alto) {
        const medio = (bajo + alto) >> 1;
        if (burbujas[medio].getBoundingClientRect().bottom <= linea) {
          bajo = medio + 1;
        } else {
          alto = medio;
        }
      }

      const ts = Number(burbujas[bajo].dataset.chatTs);
      if (Number.isFinite(ts)) {
        setEtiqueta(formatDateDivider(new Date(ts)));
      }
    };

    const marcarGesto = () => {
      ultimoGesto = Date.now();
    };
    const alTocar = () => {
      tocando = true;
      marcarGesto();
    };
    const alSoltar = () => {
      tocando = false;
      marcarGesto();
    };

    const alHacerScroll = () => {
      // Una vez visible, cualquier scroll la mantiene (la inercia del celular sigue sola).
      const esDeLaPersona = mostrando || tocando || Date.now() - ultimoGesto < VENTANA_GESTO_MS;
      if (!esDeLaPersona) return;

      if (!mostrando) {
        // Al aparecer se calcula ya mismo: si no, por un cuadro saldria el dia del chat anterior.
        cancelAnimationFrame(cuadro);
        calcular();
      } else if (!cuadro) {
        cuadro = requestAnimationFrame(calcular);
      }
      if (!mostrando) {
        mostrando = true;
        setVisible(true);
      }
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        mostrando = false;
        setVisible(false);
      }, OCULTAR_TRAS_MS);
    };

    contenedor.addEventListener("scroll", alHacerScroll, { passive: true });
    contenedor.addEventListener("wheel", marcarGesto, { passive: true });
    contenedor.addEventListener("touchstart", alTocar, { passive: true });
    contenedor.addEventListener("touchend", alSoltar, { passive: true });
    contenedor.addEventListener("touchcancel", alSoltar, { passive: true });
    // Arrastrar la barra de scroll o moverse con el teclado (flechas, RePag/AvPag).
    contenedor.addEventListener("pointerdown", marcarGesto, { passive: true });
    contenedor.addEventListener("keydown", marcarGesto);

    return () => {
      observador.disconnect();
      cancelAnimationFrame(cuadro);
      clearTimeout(temporizador);
      contenedor.removeEventListener("scroll", alHacerScroll);
      contenedor.removeEventListener("wheel", marcarGesto);
      contenedor.removeEventListener("touchstart", alTocar);
      contenedor.removeEventListener("touchend", alSoltar);
      contenedor.removeEventListener("touchcancel", alSoltar);
      contenedor.removeEventListener("pointerdown", marcarGesto);
      contenedor.removeEventListener("keydown", marcarGesto);
    };
  }, [scrollRef]);

  if (!etiqueta) return null;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center transition-opacity duration-300 md:top-3 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Mismo estilo que el separador de dia de la burbuja: se lee igual en tema claro y oscuro. */}
      <span className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur">
        {etiqueta}
      </span>
    </div>
  );
}
