/**
 * ¿El cliente ya confirmó la compra o el pago, o el chat está en etapa de venta/cierre? (código puro, sin
 * dependencias). Lo usan la regla de apagado de los seguimientos (dominio/apagado.ts) y "Tras asesora"
 * (seguimiento-inteligente/dominio/tras-asesora.ts). Regla CONSERVADORA: mejor un falso negativo que apagarle
 * los seguimientos a quien no confirmó.
 */

/** Una confirmación de compra más vieja que esto ya no cuenta (el chat pudo reabrirse por otra cosa). */
export const DIAS_CONFIRMACION_VIGENTE = 14;
const MENSAJES_A_REVISAR = 40;

/** Etapas del CRM de venta o cierre (Negociación, Ganado). Perdido ya lo cubre el anti-bloqueo. */
export const ETAPAS_DE_VENTA: Record<string, string> = { NEGOCIACION: "Negociación", GANADO: "Ganado" };

export type MensajeDelChat = {
  direccion: "IN" | "OUT";
  tipo: string;
  texto: string | null;
  en: Date;
  /** `rawPayload.source` del mensaje: "manual" (CRM) o "instance" (celular) = una persona. */
  origen: string | null;
};

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cualquier negación en el mensaje lo deja pasar: "no te consigno", "todavía no voy a ir". */
const NEGACION = /\b(no|nunca|tampoco|nada)\b/;

const CONFIRMA_COMPRA = [
  /\bte (consigno|transfiero|pago|giro)\b/,
  /\b(te )?(consigne|pague|transferi|gire)\b/,
  /\bhice (la |el )?(consignacion|transferencia|pago|deposito)\b/,
  /\bvoy a (ir|pasar|consignar|transferir|pagar|comprar|recoger)\b/,
  /\bvoy a (llevar|comprar)(lo|la|los|las)\b/,
  /\b(voy|vamos|viajo|llego) (para|a) (cali|alla)\b/,
  /\b(me lo llevo|me la llevo|lo compro|la compro|quiero comprarlo|quiero comprarla)\b/,
  /\bcomprobante\b/,
];

const SI_SUELTO = /^(si+|claro( que si)?|dale|de una|listo|vale|perfecto)( (senora|senor|por favor|claro|quiero|dale|listo))?[.! ]*$/;

/** Lo último del negocio fue una pregunta de cierre o de pago ("¿Te lo separo?", "¿Hacemos el pago?"). */
const PREGUNTA_DE_CIERRE =
  /(separ|apart|reserv|\bpago\b|pagar|consign|transfer|\bcuenta\b|nequi|daviplata|llave|cerr(amos|emos|ar)|proced|confirm\w* (el |la )?(pedido|compra|orden)|lo llevas|la llevas|lo quieres|la quieres|te lo (envio|mando|despacho)|despach|hacemos (el |la )?(pedido|envio|compra)|quieres (comprar|pagar)|link de pago)/;

const TEXTO_DE_PAGO = /(\bpago\b|pagar|consign|transfer|\bcuenta\b|nequi|daviplata|llave|bancolombia|comprobante)/;

/**
 * ¿El cliente confirmó la compra o el pago? Mira sus últimos mensajes (de los últimos 14 días) y, para un
 * "sí" suelto o una imagen, el último mensaje del negocio que lo precede.
 */
export function clienteConfirmoCompra(mensajes: MensajeDelChat[], ahora: Date): boolean {
  const desde = ahora.getTime() - DIAS_CONFIRMACION_VIGENTE * 86_400_000;
  const lista = mensajes.filter((m) => m.tipo !== "SYSTEM" && m.en.getTime() <= ahora.getTime()).slice(-MENSAJES_A_REVISAR);
  let ultimoDelNegocio: string | null = null;
  for (const m of lista) {
    if (m.direccion === "OUT") {
      ultimoDelNegocio = normalizar(m.texto);
      continue;
    }
    if (m.en.getTime() < desde) continue;
    // Comprobante: una imagen o un documento justo después de hablar del pago.
    if ((m.tipo === "IMAGE" || m.tipo === "DOCUMENT") && ultimoDelNegocio && TEXTO_DE_PAGO.test(ultimoDelNegocio)) return true;
    const texto = normalizar(m.texto);
    if (!texto || texto.includes("?") || NEGACION.test(texto)) continue;
    if (CONFIRMA_COMPRA.some((patron) => patron.test(texto))) return true;
    if (SI_SUELTO.test(texto) && ultimoDelNegocio && ultimoDelNegocio.includes("?") && PREGUNTA_DE_CIERRE.test(ultimoDelNegocio)) return true;
  }
  return false;
}

