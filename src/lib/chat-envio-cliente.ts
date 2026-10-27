"use client";

import {
  TIEMPO_LIMITE_NAVEGADOR_MS,
  enviarConReintento,
  idDeMensajeValido,
  nuevoIdDeMensaje,
  type MotivoDeFalla,
  type ResultadoDeEnvio,
} from "@/lib/chat-envio-reintento";

/*
  Envio de texto del chat desde el navegador, por la ruta /api/cliente/chats/enviar (ver esa ruta
  para el porque). Reintenta 1 o 2 veces SOLO cuando es seguro que no salio, siempre con el mismo
  numero unico (clientMessageId), y anota en el servidor los fallos que ni llegaron a el.
*/

const RUTA_ENVIAR = "/api/cliente/chats/enviar";
const RUTA_FALLO = "/api/cliente/chats/enviar/fallo";
const CLAVE_PENDIENTES = "chats:errores-de-envio-pendientes:v1";

type ErrorPendiente = {
  conversationId: string;
  motivo: MotivoDeFalla;
  detalle: string;
  clientMessageId: string | null;
  intento: number;
};

function leerPendientes(): ErrorPendiente[] {
  try {
    const datos: unknown = JSON.parse(window.localStorage.getItem(CLAVE_PENDIENTES) ?? "[]");
    return Array.isArray(datos) ? (datos as ErrorPendiente[]).slice(-20) : [];
  } catch {
    return [];
  }
}

function guardarPendientes(lista: ErrorPendiente[]) {
  try {
    if (lista.length === 0) {
      window.localStorage.removeItem(CLAVE_PENDIENTES);
    } else {
      window.localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(lista.slice(-20)));
    }
  } catch {
    // Sin almacenamiento: el fallo simplemente no se anota.
  }
}

/** Manda al servidor los errores que no pudieron anotarse (no habia señal). Nunca lanza. */
export async function enviarErroresPendientes() {
  const pendientes = leerPendientes();
  if (pendientes.length === 0) {
    return;
  }
  try {
    const respuesta = await fetch(RUTA_FALLO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ errores: pendientes }),
      cache: "no-store",
    });
    if (respuesta.ok) {
      guardarPendientes([]);
    }
  } catch {
    // Sigue sin señal: se intenta de nuevo cuando vuelva.
  }
}

function anotarFalloDelNavegador(error: ErrorPendiente) {
  guardarPendientes([...leerPendientes(), error]);
  void enviarErroresPendientes();
}

/** Prepara el formulario: le pone el numero unico si no lo tenia (el reintento lo conserva). */
export function asegurarIdDeMensaje(formData: FormData): string {
  const actual = idDeMensajeValido(String(formData.get("clientMessageId") ?? ""));
  if (actual) {
    return actual;
  }
  const nuevo = nuevoIdDeMensaje();
  formData.set("clientMessageId", nuevo);
  return nuevo;
}

/**
 * Envia el texto del formulario. Devuelve siempre un resultado (nunca lanza): `ok: false` lleva el
 * motivo y el texto para mostrar en "No se envió · Reintentar".
 */
export async function enviarTextoPorRuta(formData: FormData): Promise<ResultadoDeEnvio> {
  const clientMessageId = asegurarIdDeMensaje(formData);
  const cuerpo: Record<string, string> = {};
  formData.forEach((valor, nombre) => {
    if (typeof valor === "string") {
      cuerpo[nombre] = valor;
    }
  });
  const conversationId = cuerpo.conversationId ?? "";

  return enviarConReintento({
    enviar: async (intento) => {
      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), TIEMPO_LIMITE_NAVEGADOR_MS);
      try {
        const respuesta = await fetch(RUTA_ENVIAR, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...cuerpo, intento }),
          cache: "no-store",
          credentials: "same-origin",
          signal: control.signal,
        });
        const datos = (await respuesta.json().catch(() => null)) as ResultadoDeEnvio | null;
        if (!datos) {
          // 502/503 de la app caida un momento, o una pagina de error: no llego a enviarse.
          throw new Error(`La app no respondio (${respuesta.status})`);
        }
        return datos;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // No se sabe si salio: no se reintenta solo (ver esReintentable).
          return {
            ok: false,
            error: "El envío tardó demasiado. Revisa el chat antes de reenviar.",
            motivo: "timeout_gateway" as const,
          };
        }
        throw error;
      } finally {
        clearTimeout(reloj);
      }
    },
    alFallar: ({ intento, motivo, error, llegoAlServidor }) => {
      if (!llegoAlServidor) {
        anotarFalloDelNavegador({ conversationId, motivo, detalle: error, clientMessageId, intento });
      }
    },
  });
}
