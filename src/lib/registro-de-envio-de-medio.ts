import { causaCorta } from "@/lib/etapa-automatica-crm";

/*
  REGISTRO DEL ENVIO DE UN ARCHIVO (foto, video, documento, nota de voz) en el servidor.

  15-nov-2026: una asesora mando un PDF de 14 MB por Evolution, la pasarela corto la conexion
  (`fetch failed`) y el servidor lo anoto como error dos veces (la linea [envio-medio] con
  console.error y otra de varias lineas). La vigilancia de 30 minutos lo conto como falla nueva y
  deshizo una subida que no tenia nada que ver (solo tocaba la pantalla del chat).

  Un corte pasajero de la red o de tiempo con la pasarela no es una falla del CRM: la asesora ve
  "No se pudo enviar el archivo" y lo vuelve a mandar. Basta UNA linea informativa con la causa
  corta (`sin-conexion` / `tardo-demasiado`), sin palabras de error. Las demas fallas (respuesta
  4xx/5xx de la pasarela, archivo invalido) se siguen anotando como error, con el detalle. Mismo
  criterio que causaCorta (30-oct-2026, etapa automatica del CRM).
*/

/** Causas que son un corte pasajero con la pasarela y no una falla del CRM. */
const CAUSAS_PASAJERAS = new Set(["sin-conexion", "tardo-demasiado"]);

export type LineaDeEnvioDeMedio = {
  linea: string;
  /** "error" solo para las fallas que no son un corte pasajero de red o de tiempo. */
  nivel: "info" | "error";
  /** true cuando el envio fallo por red o por tiempo (la linea va como informativa). */
  pasajera: boolean;
};

/** El texto de la falla para el registro: el mensaje del Error o el texto tal cual. */
function detalleDeLaFalla(falla: unknown): string {
  if (falla instanceof Error) return falla.message || falla.name;
  return typeof falla === "string" ? falla : "";
}

/**
 * Arma la linea [envio-medio] (paso "servidor") de un envio. Sin `fallo`, es un envio que salio (o
 * un repetido) y va como informativa. Con `fallo`, se mira la causa: si es de red o de tiempo va
 * informativa con `causa` y sin el mensaje; si no, va como error con `causa` y `error`.
 * Sin telefonos ni contenido: eso lo cuida quien arma `datos`.
 */
export function lineaDeEnvioDeMedio(
  datos: Record<string, unknown>,
  fallo?: { falla: unknown },
): LineaDeEnvioDeMedio {
  if (!fallo) {
    return { linea: `[envio-medio] ${JSON.stringify({ paso: "servidor", ...datos })}`, nivel: "info", pasajera: false };
  }
  const causa = causaCorta(fallo.falla);
  if (CAUSAS_PASAJERAS.has(causa)) {
    return {
      linea: `[envio-medio] ${JSON.stringify({ paso: "servidor", ...datos, causa })}`,
      nivel: "info",
      pasajera: true,
    };
  }
  return {
    linea: `[envio-medio] ${JSON.stringify({
      paso: "servidor",
      ...datos,
      causa,
      error: detalleDeLaFalla(fallo.falla) || "sin detalle",
    })}`,
    nivel: "error",
    pasajera: false,
  };
}

/**
 * Deja la linea [envio-medio] en el registro del servidor (console.info o console.error segun
 * lineaDeEnvioDeMedio) y devuelve si la falla fue pasajera, para que quien llama no anote ademas
 * otro error por lo mismo.
 */
export function registrarEnvioDeMedio(datos: Record<string, unknown>, fallo?: { falla: unknown }): { pasajera: boolean } {
  const { linea, nivel, pasajera } = lineaDeEnvioDeMedio(datos, fallo);
  if (nivel === "error") {
    console.error(linea);
  } else {
    console.info(linea);
  }
  return { pasajera };
}
