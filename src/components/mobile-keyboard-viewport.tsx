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
 *
 * Lista cortada en iPhone (Alex, 12-10-2026): la bandeja mostraba 5 chats y debajo un gris.
 * La variable se quedaba pegada en la altura "con teclado": iOS hace zoom al tocar un campo y no
 * lo quita (visualViewport.height baja con el zoom) y en la app instalada a veces no avisa
 * cuando se cierra el teclado. Por eso ahora:
 * - se mide sin zoom (height * scale);
 * - la variable SOLO existe mientras hay un campo de texto enfocado (teclado posible); sin
 *   campo enfocado se quita y todo vuelve a 100dvh;
 * - se re-mide al salir del campo, al volver a la app y al cambiar de tamaño.
 */

function hayCampoDeTextoEnfocado(): boolean {
  const activo = document.activeElement;
  if (!(activo instanceof HTMLElement)) {
    return false;
  }
  if (activo.isContentEditable) {
    return true;
  }
  if (activo instanceof HTMLTextAreaElement) {
    return !activo.readOnly && !activo.disabled;
  }
  if (activo instanceof HTMLInputElement) {
    const sinTeclado = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
    return !sinTeclado.includes(activo.type) && !activo.readOnly && !activo.disabled;
  }
  return false;
}

export function MobileKeyboardViewport() {
  React.useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const raiz = document.documentElement;
    const altoSinZoom = () => Math.round(viewport.height * (viewport.scale || 1));
    let altoPrevio = altoSinZoom();
    let temporizador: number | null = null;

    const aplicar = () => {
      const alto = altoSinZoom();

      if (!hayCampoDeTextoEnfocado()) {
        // Sin campo enfocado no hay teclado: nunca dejar una altura vieja pegada.
        raiz.style.removeProperty("--app-viewport-height");
        altoPrevio = alto;
        return;
      }

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

    // El teclado tarda en abrir/cerrar: se mide de nuevo cuando termino la animacion.
    const aplicarEnUnRato = () => {
      if (temporizador !== null) {
        window.clearTimeout(temporizador);
      }
      temporizador = window.setTimeout(() => {
        temporizador = null;
        aplicar();
      }, 300);
    };

    const alCambiarFoco = () => {
      aplicar();
      aplicarEnUnRato();
    };

    const alVolverALaApp = () => {
      if (document.visibilityState === "visible") {
        alCambiarFoco();
      }
    };

    aplicar();
    viewport.addEventListener("resize", aplicar);
    viewport.addEventListener("scroll", aplicar);
    window.addEventListener("resize", aplicarEnUnRato);
    document.addEventListener("focusin", alCambiarFoco);
    document.addEventListener("focusout", alCambiarFoco);
    window.addEventListener("pageshow", alCambiarFoco);
    document.addEventListener("visibilitychange", alVolverALaApp);

    return () => {
      if (temporizador !== null) {
        window.clearTimeout(temporizador);
      }
      viewport.removeEventListener("resize", aplicar);
      viewport.removeEventListener("scroll", aplicar);
      window.removeEventListener("resize", aplicarEnUnRato);
      document.removeEventListener("focusin", alCambiarFoco);
      document.removeEventListener("focusout", alCambiarFoco);
      window.removeEventListener("pageshow", alCambiarFoco);
      document.removeEventListener("visibilitychange", alVolverALaApp);
      raiz.style.removeProperty("--app-viewport-height");
    };
  }, []);

  return null;
}
