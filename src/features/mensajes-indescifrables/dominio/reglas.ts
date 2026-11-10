import { z } from "zod";

import { ENLACE_DE_ALERTAS } from "@/features/alertas/dominio/reglas";

/**
 * RED DE SEGURIDAD PARA LOS MENSAJES QUE WAHA NO PUEDE DESCIFRAR (reglas puras, sin base ni red).
 *
 * WAHA (GOWS) escribe `Undecryptable message ...` en su log. Casi siempre el teléfono del cliente lo
 * reenvía y entra por el webhook en 1-2 s; cerca del 9% no llega nunca y nadie se enteraba. Un
 * vigilante fuera del CRM (docker/vigilante-indescifrables) lee ese log y lo manda acá; a los 2 minutos
 * se mira si llegó y, si no, se deja el chat con una nota "Mensaje perdido, escríbele" (regla de Alexander).
 *
 * Nace APAGADO: sin la fila `mensajes-indescifrables:modo:<negocio>` no se guarda nada.
 *  - SOMBRA: se guarda y se revisa, pero no se toca ningún chat ni se avisa a nadie (para medir).
 *  - PRUEBA: actúa solo con los LID de `mensajes-indescifrables:lids-prueba:<negocio>`; los demás, como SOMBRA.
 *  - ACTIVO: actúa con todos.
 */

export const MODOS = ["APAGADO", "SOMBRA", "PRUEBA", "ACTIVO"] as const;
export type Modo = (typeof MODOS)[number];

export const claveDelModo = (workspaceId: string) => `mensajes-indescifrables:modo:${workspaceId}`;
export const claveDeLidsDePrueba = (workspaceId: string) => `mensajes-indescifrables:lids-prueba:${workspaceId}`;
export const claveDelUltimoAviso = (workspaceId: string) => `mensajes-indescifrables:ultimo-aviso:${workspaceId}`;
/** Uno solo para todo el servidor: el vigilante es uno. */
export const CLAVE_DEL_LATIDO = "mensajes-indescifrables:latido";

export const ESPERA_MS = 2 * 60_000;
export const RECLAMO_MS = 10 * 60_000;
export const ENTRE_AVISOS_MS = 15 * 60_000;
export const ANTIGUEDAD_MAXIMA_MS = 24 * 60 * 60_000;
/** Un reloj del servidor de WAHA adelantado no puede meter eventos del futuro. */
export const ADELANTO_MAXIMO_MS = 5 * 60_000;
/** Lo que el Message pudo haberse guardado ANTES de lo que dice el log (relojes distintos). */
export const HOLGURA_DE_BUSQUEDA_MS = 5 * 60_000;
export const MAXIMO_DE_EVENTOS = 100;
export const MAXIMO_DE_INTENTOS = 5;
export const LARGO_MINIMO_DEL_ID = 8;

export const ESTADOS = ["PENDIENTE", "REVISANDO", "LLEGO", "PERDIDO", "SOMBRA", "IGNORADO", "DESCARTADO", "ERROR"] as const;
export type Estado = (typeof ESTADOS)[number];

/** Texto de la nota del chat. Es una nota interna: nunca sale al cliente. */
export const TEXTO_DE_LA_NOTA =
  "Mensaje perdido, escríbele: el cliente escribió y WhatsApp no dejó leer el mensaje (no llegó en 2 minutos).";

/** El origen de la nota, por mensaje: con él se mira si ya se escribió antes de volver a escribirla. */
export const origenDeLaNota = (idCrudo: string) => `mensaje-perdido:${idCrudo}`;

/** La clave de la alerta: una por chat, así varios perdidos del mismo cliente suben `veces` y no llenan la página. */
export const claveDeLaAlerta = (conversationId: string) => `mensaje-perdido:${conversationId}`;

/** Texto → modo. Lo que no se reconoce (o no hay fila) es APAGADO. */
export function leerModo(valor: string | null | undefined): Modo {
  const texto = String(valor ?? "").trim().toUpperCase();
  return (MODOS as readonly string[]).includes(texto) ? (texto as Modo) : "APAGADO";
}

/** "123, 456@lid\n789" → los LID en dígitos. */
export function leerLidsDePrueba(valor: string | null | undefined): Set<string> {
  return new Set(
    String(valor ?? "")
      .split(/[\s,;]+/)
      .map((parte) => parte.split("@")[0].replace(/\D/g, ""))
      .filter(Boolean),
  );
}

/** ¿Se acepta un evento ocurrido a esta hora? Ni de hace más de 24 h ni del futuro. */
export function fechaAceptable(ocurridoEn: Date, ahora: Date): boolean {
  const t = ocurridoEn.getTime();
  return Number.isFinite(t) && t >= ahora.getTime() - ANTIGUEDAD_MAXIMA_MS && t <= ahora.getTime() + ADELANTO_MAXIMO_MS;
}

export const revisarEnDe = (ocurridoEn: Date) => new Date(ocurridoEn.getTime() + ESPERA_MS);

/** Lo que manda el vigilante. `latido` sin eventos = "sigo vivo". */
export const esquemaDelLote = z.object({
  latido: z.boolean().optional(),
  eventos: z
    .array(
      z.object({
        /** La sesión de WAHA = `WhatsAppChannel.evolutionInstanceName`. */
        sesion: z.string().trim().min(1).max(120),
        // Solo letras y números: además de validar, impide comodines de LIKE en la búsqueda del Message.
        idCrudo: z.string().trim().regex(/^[A-Za-z0-9]{8,128}$/),
        lid: z.string().trim().regex(/^\d{5,20}$/),
        ocurridoEn: z.string().refine((valor) => Number.isFinite(Date.parse(valor)), "fecha inválida"),
      }),
    )
    .max(MAXIMO_DE_EVENTOS)
    .default([]),
});
export type LoteDeIndescifrables = z.infer<typeof esquemaDelLote>;

export type Decision = "DESCARTAR" | "LLEGO" | "IGNORAR" | "SOMBRA" | "ACTUAR";

/** Qué se hace con un mensaje a los 2 minutos. */
export function decidirRevision(entrada: {
  modo: Modo;
  lid: string;
  lidsDePrueba: ReadonlySet<string>;
  llego: boolean;
  esLaPropiaLinea: boolean;
}): Decision {
  if (entrada.modo === "APAGADO") return "DESCARTAR";
  if (entrada.llego) return "LLEGO";
  if (entrada.esLaPropiaLinea) return "IGNORAR";
  if (entrada.modo === "ACTIVO") return "ACTUAR";
  if (entrada.modo === "PRUEBA" && entrada.lidsDePrueba.has(entrada.lid)) return "ACTUAR";
  return "SOMBRA";
}

/** El mismo número, con o sin indicativo (los últimos 10 dígitos). */
export function mismoNumero(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? "").replace(/\D/g, "");
  const y = String(b ?? "").replace(/\D/g, "");
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
}

/** Solo las líneas de ventas reparten a una asesora; la ADMIN deja el chat, la alerta y el WhatsApp a Alexander. */
export const repartePorLinea = (purpose: string | null | undefined) => purpose === "SALES";

/** ¿Ya pasaron 15 minutos desde el último WhatsApp agrupado? */
export function tocaAvisar(ultimoAviso: string | null | undefined, ahora: Date): boolean {
  const t = Date.parse(String(ultimoAviso ?? ""));
  return !Number.isFinite(t) || ahora.getTime() - t >= ENTRE_AVISOS_MS;
}

const MAXIMO_EN_EL_AVISO = 8;

/** El WhatsApp agrupado a Alexander: cuántos, quiénes (hasta 8) y el link a las alertas. */
export function textoDelAviso(resumenes: readonly string[]): string {
  const lista = resumenes.map((resumen) => resumen.replace(/\s+/g, " ").trim().slice(0, 80) || "Cliente");
  const titulo =
    lista.length === 1
      ? "⚠️ Mensaje perdido: WhatsApp no dejó leer lo que escribió un cliente"
      : `⚠️ ${lista.length} mensajes perdidos: WhatsApp no dejó leer lo que escribieron`;
  const filas = lista.slice(0, MAXIMO_EN_EL_AVISO).map((resumen) => `• ${resumen}`);
  if (lista.length > MAXIMO_EN_EL_AVISO) filas.push(`• y ${lista.length - MAXIMO_EN_EL_AVISO} más`);
  return [titulo, ...filas, "Ya quedaron en la bandeja con la nota «Mensaje perdido, escríbele».", `Ver: ${ENLACE_DE_ALERTAS}`].join("\n");
}
