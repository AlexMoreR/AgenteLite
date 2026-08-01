"use client";

import * as React from "react";

/**
 * Deja el campo de escribir ARRIBA del teclado en el celular.
 *
 * El chat mide 100dvh, y en iPhone eso NO descuenta el teclado: cuando la asesora toca el campo
 * y sube el teclado, la pantalla sigue midiendo lo mismo y el campo queda tapado abajo. Escriben
 * a ciegas, sin ver lo que estan escribiendo.
 *
 * `visualViewport` es lo unico que sabe cuanto se ve DE VERDAD (ya con el teclado encima), asi
 * que su altura se publica como variable de CSS y el chat se mide con eso.
 *
 * Ademas, al abrirse el teclado iOS empuja la pagina hacia arriba y deja media conversacion
 * fuera de cuadro. Como en el chat el cuerpo no scrollea, se lo devuelve a su lugar y se
 * mantiene la conversacion pegada al ultimo mensaje, como WhatsApp.
 */
export function MobileKeyboardViewport() {
  React.useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const raiz = document.documentElement;
    let altoPrevio = viewport.height;

    const aplicar = () => {
      const alto = Math.round(viewport.height);
      raiz.style.setProperty("--app-viewport-height", `${alto}px`);

      // Solo en el chat: es la unica pantalla que no scrollea el cuerpo, asi que reacomodarla
      // es seguro. En el resto de la app mover el scroll seria pelearle a la asesora.
      const enChat = document.querySelector(".chat-inbox-grid");
      if (!enChat) {
        altoPrevio = alto;
        return;
      }

      if (window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }

      // Si acaba de subir el teclado, la conversacion se queda en el ultimo mensaje.
      if (alto < altoPrevio - 80) {
        const mensajes = document.querySelector(".chat-messages-scroll");
        if (mensajes) {
          window.requestAnimationFrame(() => {
            mensajes.scrollTop = mensajes.scrollHeight;
          });
        }
      }

      altoPrevio = alto;
    };

    aplicar();
    viewport.addEventListener("resize", aplicar);
    viewport.addEventListener("scroll", aplicar);

    return () => {
      viewport.removeEventListener("resize", aplicar);
      viewport.removeEventListener("scroll", aplicar);
      raiz.style.removeProperty("--app-viewport-height");
    };
  }, []);

  return null;
}
