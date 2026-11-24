import { causaCorta } from "@/lib/causa-corta";

/*
  RESUMEN DE UN ERROR PARA EL REGISTRO, EN UNA SOLA LINEA (24-nov-2026).

  La vigilancia de 30 minutos deshizo dos subidas sanas por lineas `prisma:error` y `error: '\n' +`:
  el cliente de Prisma imprimia el mensaje entero (varias lineas) de CADA consulta que fallaba,
  aunque el codigo la atrapara y la reintentara, y las rutas de envio del chat anotaban
  `error.message` tal cual, con sus saltos de linea. Un corte pasajero de la base o de la red no es
  una falla del CRM: se reintenta solo o la asesora vuelve a enviar.

  Mismo criterio que src/lib/registro-de-envio-de-medio.ts: una linea con JSON; si es pasajera va
  como informativa (sin la palabra error), si no, como error con su codigo y un texto corto.

  No usa la base ni Next (se prueba solo con src/lib/resumen-de-error.test.ts) y NO puede importar
  @/lib/prisma: prisma.ts lo usa para sus eventos.
*/

export type ResumenDeError = {
  /** La causa en una palabra (causaCorta): sin-conexion, tardo-demasiado, base-P2002, otra... */
  causa: string;
  /** El codigo Pxxxx de Prisma, si lo hay (del campo `code` o, si no, del texto). */
  codigo: string | null;
  /** La primera linea del mensaje que no este vacia, sin saltos y con 200 letras como maximo. */
  texto: string;
};

const LARGO_MAXIMO_DEL_TEXTO = 200;

/** Causas de causaCorta que son un corte pasajero (red o tiempo), no una falla del CRM. */
const CAUSAS_PASAJERAS = new Set(["sin-conexion", "tardo-demasiado"]);

/** Codigos de Prisma de conexion: no llega a la base, se corto, o no hubo conexion libre a tiempo. */
const CODIGOS_PRISMA_PASAJEROS = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

/** Codigos de Postgres de "ahora no puedo" (los mismos que reintenta withTransientRetry en prisma.ts). */
const CODIGOS_POSTGRES_PASAJEROS = ["57P01", "57P02", "57P03", "08001", "08004", "08006"];

/** Textos de conexion caida, para cuando el error no trae el codigo. */
const TEXTO_DE_CONEXION_CAIDA =
  /Can't reach database server|Connection terminated unexpectedly|in recovery mode|Timed out fetching a new connection/i;

/** El mensaje completo del error: un Error, un texto suelto o un objeto con `message` (evento de Prisma). */
function mensajeCompleto(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "";
  if (typeof error === "string") return error;
  const mensaje = (error as { message?: unknown } | null)?.message;
  if (typeof mensaje === "string") return mensaje;
  return error == null ? "" : String(error);
}

/** El `code` del error si es un texto. */
function codigoDelCampo(error: unknown): string | null {
  const codigo = (error as { code?: unknown } | null)?.code;
  return typeof codigo === "string" && codigo ? codigo : null;
}

/** El codigo Pxxxx: el `code` del error o, si no lo trae, el primero que aparezca en el mensaje. */
function codigoDePrisma(error: unknown, mensaje: string): string | null {
  const delCampo = codigoDelCampo(error);
  if (delCampo && /^P\d{4}$/.test(delCampo)) return delCampo;
  return mensaje.match(/\bP\d{4}\b/)?.[0] ?? null;
}

/** La primera linea con algo, sin espacios de mas y cortada a 200 letras. */
function primeraLinea(mensaje: string): string {
  const linea = mensaje
    .split(/\r?\n|\r/)
    .map((parte) => parte.replace(/\s+/g, " ").trim())
    .find((parte) => parte.length > 0);
  return (linea ?? "").slice(0, LARGO_MAXIMO_DEL_TEXTO);
}

/**
 * Lo que causaCorta necesita ver: si llega un objeto que no es Error (el evento de Prisma solo trae
 * texto), se arma un Error con su mensaje y el codigo encontrado, para que la causa salga igual.
 */
function paraCausaCorta(error: unknown, mensaje: string, codigo: string | null): unknown {
  if (error instanceof Error) {
    return codigo && !codigoDelCampo(error) ? Object.assign(new Error(error.message), { name: error.name, code: codigo }) : error;
  }
  const comoError = new Error(mensaje);
  const nombre = (error as { name?: unknown } | null)?.name;
  if (typeof nombre === "string" && nombre) comoError.name = nombre;
  const delCampo = codigoDelCampo(error);
  if (delCampo || codigo) Object.assign(comoError, { code: delCampo ?? codigo });
  return comoError;
}

/** Causa, codigo y texto corto (una linea) de cualquier error, para anotarlo en el registro. */
export function resumenDeError(error: unknown): ResumenDeError {
  const mensaje = mensajeCompleto(error);
  const codigo = codigoDePrisma(error, mensaje);
  return {
    causa: causaCorta(paraCausaCorta(error, mensaje, codigo)),
    codigo,
    texto: primeraLinea(mensaje) || "sin detalle",
  };
}

/**
 * ¿Es un corte pasajero de la base o de la red? (va al registro como informativo, no como error).
 * La lista es corta a proposito: un error de verdad tomado por pasajero no lo veria la vigilancia.
 */
export function esPasajera(error: unknown): boolean {
  const mensaje = mensajeCompleto(error);
  const { causa, codigo } = resumenDeError(error);
  if (CAUSAS_PASAJERAS.has(causa)) return true;
  if (codigo && CODIGOS_PRISMA_PASAJEROS.has(codigo)) return true;
  const delCampo = codigoDelCampo(error);
  if (delCampo && CODIGOS_POSTGRES_PASAJEROS.includes(delCampo)) return true;
  if (CODIGOS_POSTGRES_PASAJEROS.some((codigoPg) => new RegExp(`\\b${codigoPg}\\b`).test(mensaje))) return true;
  return TEXTO_DE_CONEXION_CAIDA.test(mensaje);
}

export type LineaDeRegistro = {
  /** Una sola linea, sin saltos: `[prisma] {json}`. */
  linea: string;
  /** Con que console sale: info (pasajera), warn (aviso de verdad) o error (error de verdad). */
  nivel: "info" | "warn" | "error";
};

/**
 * La linea `[prisma]` de un evento `error` o `warn` del cliente de Prisma (src/lib/prisma.ts).
 * Pasajera: informativa con nivel, causa y codigo, sin el texto ni la palabra error. Si no: error
 * (o aviso) con causa, codigo y el texto corto.
 */
export function lineaDeEventoDePrisma(nivelDelEvento: "error" | "warn", evento: unknown): LineaDeRegistro {
  const { causa, codigo, texto } = resumenDeError(evento);
  if (esPasajera(evento)) {
    // "nivel" lleva "warn" o "corte" en vez de "error": la vigilancia busca esa palabra.
    const nivel = nivelDelEvento === "error" ? "corte" : "aviso";
    return { linea: `[prisma] ${JSON.stringify({ nivel, causa, codigo })}`, nivel: "info" };
  }
  if (nivelDelEvento === "warn") {
    return { linea: `[prisma] ${JSON.stringify({ causa, codigo, aviso: texto })}`, nivel: "warn" };
  }
  return { linea: `[prisma] ${JSON.stringify({ causa, codigo, error: texto })}`, nivel: "error" };
}
