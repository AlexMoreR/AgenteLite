/*
  Reglas puras del envio de texto desde Chats (tarjeta whovymqk, queja de las asesoras 27-oct-2026:
  "a cada rato al enviar sale error y toca recargar").

  Viven aca, sin React ni base de datos, para probarlas con `npm run test:chat-envio-reintento`.

  1. Numero unico por mensaje (clientMessageId): lo pone el navegador al tocar enviar y viaja en
     cada intento del MISMO mensaje. Si el servidor ya lo tiene (guardado o en curso), no lo vuelve
     a mandar a WhatsApp: contesta "ya enviado".
  2. Que se reintenta solo: unicamente cuando es seguro que el mensaje NO salio (no llego al
     servidor, el gateway no estaba o lo rechazo). Si el gateway tardo demasiado no se sabe si salio:
     no se reintenta solo, queda "No se envió · Reintentar".
  3. Mensajes que no salieron: se guardan en el navegador de la asesora, asi recargar no los borra.
  4. Fallos que no llegaron al servidor: se anotan en el navegador y se mandan a medir al volver la red.
*/

/**
 * Lo emite el navegador cuando un socket de Chats vuelve despues de caerse: quien lo escucha
 * (ChatsAutoRefresh) trae al momento lo que llego mientras estuvo caido, sin recargar.
 */
export const EVENTO_CHATS_RECONECTADO = "chats-reconectado";

/** Por que no salio un mensaje. Es el `motivo` de la tabla ChatSendError. */
export type MotivoDeFallo =
  | "version_vieja"
  | "sin_red"
  | "timeout_gateway"
  | "gateway_rechazo"
  | "conexion_cerrada"
  | "guardado_fallo"
  | "otro";

export const MOTIVOS_DE_FALLO: readonly MotivoDeFallo[] = [
  "version_vieja",
  "sin_red",
  "timeout_gateway",
  "gateway_rechazo",
  "conexion_cerrada",
  "guardado_fallo",
  "otro",
];

export function esMotivoDeFallo(valor: unknown): valor is MotivoDeFallo {
  return typeof valor === "string" && (MOTIVOS_DE_FALLO as readonly string[]).includes(valor);
}

/** Esperas entre intentos automaticos: 2 reintentos como mucho (1,5 s y 4 s). */
export const ESPERAS_REINTENTO_MS: readonly number[] = [1500, 4000];

/** Tiempo limite con el gateway para un texto (Evolution GO, Evolution API y API oficial; WAHA ya tenia). */
export const LIMITE_GATEWAY_TEXTO_MS = 25_000;

/* ------------------------------ Numero unico ------------------------------ */

const ID_DE_MENSAJE = /^[A-Za-z0-9_-]{8,80}$/;

/** El numero unico si es valido; si no, null (se envia igual, sin la proteccion por numero). */
export function idDeMensajeValido(valor: unknown): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const limpio = valor.trim();
  return ID_DE_MENSAJE.test(limpio) ? limpio : null;
}

export function nuevoIdDeMensaje(): string {
  const cripto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cripto?.randomUUID) {
    return cripto.randomUUID();
  }
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/* ------------------------- Que paso con el gateway ------------------------- */

function textoDelError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error ?? "");
  }
  const causa = (error as Error & { cause?: unknown }).cause;
  const codigoCausa =
    causa && typeof causa === "object" && "code" in causa ? String((causa as { code?: unknown }).code ?? "") : "";
  return [error.name, error.message, codigoCausa].filter(Boolean).join(" ");
}

/**
 * Clasifica un error al hablar con el gateway (Evolution, WAHA o Meta).
 *
 * - timeout_gateway: el gateway no contesto a tiempo, o la conexion se corto con el pedido ya
 *   adentro (ECONNRESET). Pudo haber salido: NO se reintenta solo.
 * - conexion_cerrada: no se pudo ni conectar (ECONNREFUSED, DNS) o WhatsApp tenia la sesion cerrada
 *   ("connection closed" de evogo). No salio.
 * - gateway_rechazo: el gateway contesto con un error. No salio.
 */
export function clasificarFalloDelGateway(error: unknown): MotivoDeFallo {
  const texto = textoDelError(error);
  if (/no respondio a tiempo|tardó en responder|timeout|timed out|aborted|ETIMEDOUT|ECONNRESET|socket hang up|UND_ERR_SOCKET/i.test(texto)) {
    return "timeout_gateway";
  }
  if (/connection closed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|fetch failed/i.test(texto)) {
    return "conexion_cerrada";
  }
  return "gateway_rechazo";
}

/** Solo estos se reintentan solos: es seguro que el mensaje no salio. */
export function motivoSeReintentaSolo(motivo: MotivoDeFallo): boolean {
  return motivo === "sin_red" || motivo === "version_vieja" || motivo === "conexion_cerrada" || motivo === "gateway_rechazo";
}

/* -------------------------- Respuesta de la ruta -------------------------- */

export type RespuestaDelEnvio =
  | { ok: true; repetido?: boolean; suppressOptimistic?: boolean }
  | { ok: false; error: string; motivo: MotivoDeFallo; reintentable: boolean };

export const MENSAJE_SIN_RED = "Sin conexión: no se pudo enviar el mensaje.";
/** Cuando el gateway tardo: pudo haber salido, por eso se pide mirar el chat antes de reintentar. */
export const MENSAJE_GATEWAY_TARDO = "WhatsApp tardó en responder. Revisa el chat y toca Reintentar si no salió.";
export const MENSAJE_SERVIDOR_NO_RESPONDE = "El servidor no respondió. Toca Reintentar.";

/** El envio ni llego al servidor (sin internet, la app reiniciando). Seguro que no salio. */
export function falloDeRed(): RespuestaDelEnvio {
  return { ok: false, error: MENSAJE_SIN_RED, motivo: "sin_red", reintentable: true };
}

/** Lee lo que contesto POST /api/cliente/chats/enviar (o lo que haya contestado en su lugar). */
export function leerRespuestaDelEnvio(status: number, cuerpo: unknown): RespuestaDelEnvio {
  if (cuerpo && typeof cuerpo === "object" && typeof (cuerpo as { ok?: unknown }).ok === "boolean") {
    const datos = cuerpo as {
      ok: boolean;
      error?: unknown;
      motivo?: unknown;
      reintentable?: unknown;
      repetido?: unknown;
      suppressOptimistic?: unknown;
    };
    if (datos.ok) {
      return {
        ok: true,
        ...(datos.repetido === true ? { repetido: true } : {}),
        ...(datos.suppressOptimistic === true ? { suppressOptimistic: true } : {}),
      };
    }
    const motivo = esMotivoDeFallo(datos.motivo) ? datos.motivo : "otro";
    return {
      ok: false,
      error: typeof datos.error === "string" && datos.error.trim() ? datos.error.trim() : "No se pudo enviar el mensaje",
      motivo,
      reintentable: datos.reintentable === true && motivoSeReintentaSolo(motivo),
    };
  }
  // Sin respuesta de la app: el proxy contesto por ella. 502/503 = la app no estaba (reiniciando
  // por una subida): no llego, se reintenta. 504 = la app no contesto a tiempo: pudo haber salido.
  if (status === 502 || status === 503) {
    return { ok: false, error: MENSAJE_SERVIDOR_NO_RESPONDE, motivo: "sin_red", reintentable: true };
  }
  if (status === 504) {
    return { ok: false, error: MENSAJE_SERVIDOR_NO_RESPONDE, motivo: "timeout_gateway", reintentable: false };
  }
  return { ok: false, error: "No se pudo enviar el mensaje", motivo: "otro", reintentable: false };
}

/* --------------------------- Reintento automatico --------------------------- */

export type FalloDeIntento = { intento: number; motivo: MotivoDeFallo; detalle: string };

/**
 * Manda el mismo mensaje (mismo numero unico) hasta 1 + ESPERAS_REINTENTO_MS.length veces, y solo
 * repite si la respuesta dice que es seguro. Devuelve el ultimo resultado y los fallos que no
 * llegaron al servidor (esos el servidor no los pudo anotar: los anota el navegador despues).
 */
export async function enviarConReintentos(input: {
  enviar: (intento: number) => Promise<RespuestaDelEnvio>;
  esperar?: (ms: number) => Promise<void>;
  esperas?: readonly number[];
}): Promise<{ resultado: RespuestaDelEnvio; intentos: number; sinLlegar: FalloDeIntento[] }> {
  const esperas = input.esperas ?? ESPERAS_REINTENTO_MS;
  const esperar = input.esperar ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const sinLlegar: FalloDeIntento[] = [];
  let intento = 1;
  for (;;) {
    const resultado = await input.enviar(intento);
    if (resultado.ok) {
      return { resultado, intentos: intento, sinLlegar };
    }
    if (resultado.motivo === "sin_red") {
      sinLlegar.push({ intento, motivo: resultado.motivo, detalle: resultado.error });
    }
    const espera = esperas[intento - 1];
    if (!resultado.reintentable || espera === undefined) {
      return { resultado, intentos: intento, sinLlegar };
    }
    await esperar(espera);
    intento += 1;
  }
}

/* ------------------- Mensajes que no salieron (navegador) ------------------- */

export const CLAVE_NO_ENVIADOS = "chats:no-enviados:v1";
export const MAX_NO_ENVIADOS = 30;
/** Pasado este tiempo un "No se envió" ya no se muestra al recargar: el cliente ya no lo espera. */
export const VIDA_NO_ENVIADO_MS = 24 * 60 * 60_000;

export type NoEnviadoGuardado = {
  id: string;
  conversationId: string;
  chatKey: string;
  content: string;
  matchContent: string;
  campos: Array<[string, string]>;
  createdAt: number;
  errorDetail: string;
  replyTo?: { content: string; direction: string; type?: string } | null;
};

function esParDeTexto(valor: unknown): valor is [string, string] {
  return Array.isArray(valor) && valor.length === 2 && typeof valor[0] === "string" && typeof valor[1] === "string";
}

/** Lee lo guardado; descarta lo roto, lo viejo y lo que pase del tope. Nunca lanza. */
export function leerNoEnviados(texto: string | null | undefined, ahora: number): NoEnviadoGuardado[] {
  if (!texto) {
    return [];
  }
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return [];
  }
  if (!Array.isArray(datos)) {
    return [];
  }
  const lista = datos.filter((item): item is NoEnviadoGuardado => {
    if (!item || typeof item !== "object") return false;
    const fila = item as Record<string, unknown>;
    return (
      typeof fila.id === "string" &&
      typeof fila.conversationId === "string" &&
      typeof fila.chatKey === "string" &&
      typeof fila.content === "string" &&
      typeof fila.matchContent === "string" &&
      typeof fila.createdAt === "number" &&
      typeof fila.errorDetail === "string" &&
      Array.isArray(fila.campos) &&
      fila.campos.every(esParDeTexto) &&
      ahora - fila.createdAt < VIDA_NO_ENVIADO_MS
    );
  });
  return lista.slice(-MAX_NO_ENVIADOS);
}

export function guardarNoEnviados(lista: readonly NoEnviadoGuardado[]): string {
  return JSON.stringify(lista.slice(-MAX_NO_ENVIADOS));
}

/* -------------------- Fallos por anotar (no llegaron) -------------------- */

export const CLAVE_FALLOS_POR_ANOTAR = "chats:fallos-por-anotar:v1";
export const MAX_FALLOS_POR_ANOTAR = 50;

export type FalloPorAnotar = {
  conversationId: string;
  source: "agent" | "official";
  motivo: MotivoDeFallo;
  detalle: string;
  clientMessageId: string | null;
  intento: number;
  ocurrioEn: number;
};

export function leerFallosPorAnotar(texto: string | null | undefined): FalloPorAnotar[] {
  if (!texto) {
    return [];
  }
  try {
    const datos = JSON.parse(texto) as unknown;
    if (!Array.isArray(datos)) {
      return [];
    }
    return datos
      .filter(
        (item): item is FalloPorAnotar =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as FalloPorAnotar).conversationId === "string" &&
          ((item as FalloPorAnotar).source === "agent" || (item as FalloPorAnotar).source === "official") &&
          esMotivoDeFallo((item as FalloPorAnotar).motivo) &&
          typeof (item as FalloPorAnotar).ocurrioEn === "number",
      )
      .slice(-MAX_FALLOS_POR_ANOTAR);
  } catch {
    return [];
  }
}

export function agregarFallosPorAnotar(lista: readonly FalloPorAnotar[], nuevos: readonly FalloPorAnotar[]): FalloPorAnotar[] {
  return [...lista, ...nuevos].slice(-MAX_FALLOS_POR_ANOTAR);
}

/* ------------------------------- Medir ------------------------------- */

/** Dia de Colombia (UTC-5, sin horario de verano) de una fecha, como AAAA-MM-DD. */
export function diaDeColombia(fecha: Date): string {
  return new Date(fecha.getTime() - 5 * 60 * 60_000).toISOString().slice(0, 10);
}

export type FilaDeErrorDeEnvio = {
  createdAt: Date;
  lineaId: string | null;
  lineaNombre: string | null;
  gateway: string | null;
  motivo: string;
  origen: string;
};

function contarPor<T>(filas: readonly T[], clave: (fila: T) => string) {
  const cuenta = new Map<string, number>();
  for (const fila of filas) {
    const k = clave(fila);
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  return cuenta;
}

/**
 * Errores de envio por dia (todos los dias del rango, tambien los de cero), por linea y por motivo.
 * Es lo que devuelve la herramienta del MCP errores_de_envio_de_chats.
 */
export function resumirErroresDeEnvio(filas: readonly FilaDeErrorDeEnvio[], desde: string, hasta: string) {
  const porDia = contarPor(filas, (fila) => diaDeColombia(fila.createdAt));
  const dias: Array<{ dia: string; errores: number }> = [];
  for (let dia = desde; dia <= hasta && dias.length < 400; ) {
    dias.push({ dia, errores: porDia.get(dia) ?? 0 });
    dia = new Date(Date.parse(`${dia}T12:00:00Z`) + 24 * 60 * 60_000).toISOString().slice(0, 10);
  }
  const nombres = new Map<string, { linea: string; gateway: string | null }>();
  for (const fila of filas) {
    const id = fila.lineaId ?? "sin_linea";
    if (!nombres.has(id)) {
      nombres.set(id, { linea: fila.lineaNombre ?? (fila.lineaId ? fila.lineaId : "Sin línea"), gateway: fila.gateway });
    }
  }
  const porLinea = [...contarPor(filas, (fila) => fila.lineaId ?? "sin_linea")]
    .map(([id, errores]) => ({ ...(nombres.get(id) ?? { linea: id, gateway: null }), errores }))
    .sort((a, b) => b.errores - a.errores);
  const porMotivo = [...contarPor(filas, (fila) => fila.motivo)]
    .map(([motivo, errores]) => ({ motivo, errores }))
    .sort((a, b) => b.errores - a.errores);
  const totalDias = Math.max(dias.length, 1);
  return {
    total: filas.length,
    promedio_por_dia: Math.round((filas.length / totalDias) * 10) / 10,
    por_dia: dias,
    por_linea: porLinea,
    por_motivo: porMotivo,
    sin_llegar_al_servidor: filas.filter((fila) => fila.origen === "navegador").length,
  };
}
