import { causaCorta } from "@/lib/etapa-automatica-crm-texto";

/**
 * La línea `[envio-medio]` del registro del servidor: una por envío de archivo, con cuánto tardó cada
 * tramo. Sin teléfonos ni contenido.
 *
 * 15-nov-2026: una asesora mandó un PDF de 14 MB por Evolution, la pasarela cortó la conexión
 * (`fetch failed`) y el servidor lo anotó dos veces como error (esta línea con `console.error` y otra
 * de varias líneas). La vigilancia de 30 minutos lo tomó como falla nueva y deshizo una subida que no
 * tenía nada que ver. Igual que `causaCorta` (30-oct-2026): un corte pasajero de red o de tiempo va en
 * UNA línea informativa con la causa corta, sin palabras de error. Las demás fallas siguen como error.
 */
export function lineaDeEnvioDeMedio(datos: Record<string, unknown>): string {
  return `[envio-medio] ${JSON.stringify({ paso: "servidor", ...datos })}`;
}

/** ¿La falla es un corte pasajero de la red o del tiempo de espera (no un error de la pasarela ni del archivo)? */
export function esCortePasajeroDeRed(falla: unknown): boolean {
  const causa = causaCorta(falla);
  return causa === "sin-conexion" || causa === "tardo-demasiado";
}

/**
 * Arma la línea de un envío que falló. Si fue un corte de red o de tiempo, la línea lleva `causa` y no
 * el mensaje (que trae palabras como `ECONNREFUSED`) y `esError` es falso. Si no, lleva el `error`.
 */
export function lineaDeFalloDeEnvioDeMedio(
  datos: Record<string, unknown>,
  falla: unknown,
): { linea: string; esError: boolean } {
  if (esCortePasajeroDeRed(falla)) {
    return { linea: lineaDeEnvioDeMedio({ ...datos, causa: causaCorta(falla) }), esError: false };
  }
  const detalle = falla instanceof Error ? falla.message : "";
  return { linea: lineaDeEnvioDeMedio({ ...datos, error: detalle || "sin detalle" }), esError: true };
}

/** Escribe la línea `[envio-medio]`: como error solo si `fallo` es verdadero. */
export function registrarEnvioDeMedio(datos: Record<string, unknown>, fallo = false) {
  const linea = lineaDeEnvioDeMedio(datos);
  if (fallo) {
    console.error(linea);
  } else {
    console.info(linea);
  }
}

/** Escribe la línea de un envío que falló; devuelve si se anotó como error. */
export function registrarFalloDeEnvioDeMedio(datos: Record<string, unknown>, falla: unknown): boolean {
  const { linea, esError } = lineaDeFalloDeEnvioDeMedio(datos, falla);
  if (esError) {
    console.error(linea);
  } else {
    console.info(linea);
  }
  return esError;
}
