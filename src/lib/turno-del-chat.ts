/**
 * ¿DE QUIÉN ES EL TURNO EN EL CHAT? Una sola definición para el Supervisor, el Supervisor
 * accionable y el seguimiento inteligente (pedido de Alexander, 12-10-2026).
 *
 * Código puro, sin base: la misma función corre en el reloj, en el webhook y en la simulación con
 * los chats reales, así que lo que se simuló es lo que hace.
 *
 *   MAGILUS  le toca a una persona o al bot de Magilus: el Supervisor y las tareas humanas actúan.
 *   CLIENTE  Magilus ya respondió y quedó esperando al cliente: NO hay avisos del Supervisor ni
 *            tareas humanas; solo la cadencia automática de seguimiento y, al final, el descarte.
 *   NADIE    el cliente nunca escribió.
 *
 * Es turno de MAGILUS cuando:
 *  1. el cliente escribió algo (que no sea una despedida, un "gracias", emojis o una auto-respuesta)
 *     y nadie de Magilus (ni el bot ni una persona) le contestó después;           "cliente_escribio"
 *  2. el bot pasó el chat a una persona ("El agente pide un asesor…", "una asesora te escribe…") y
 *     ninguna persona escribió después;                                             "bot_paso_a_asesora"
 *  3. el cliente mostró intención FUERTE de compra (separar, anticipo, "ya pagué", acepta el precio,
 *     pide cotización, da dirección o fecha, decide comprar, elige un color) y ninguna persona le
 *     escribió después, aunque el bot le haya contestado: el bot no cierra ventas.  "intencion_fuerte"
 *  4. el bot contestó pero NO entendió (cayó en la "Red del paso…: no se entendió"): no respondió
 *     correctamente lo que el cliente dijo.                                         "bot_no_entendio"
 *  5. lo último de Magilus es una promesa de volver ("espera pregunto", "ya te confirmo", "déjame
 *     verificar") y nadie volvió.                                                    "promesa_pendiente"
 *
 * Si no, es turno del CLIENTE: el bot contestó bien o una persona contestó, y lo que vino después
 * del cliente (si algo) es un cierre. "Sin asesora" no cambia nada: un chat sin dueña en turno del
 * cliente no es un problema.
 */

import { detectarSenales, esSenalDeCompra } from "../features/embudo/dominio/senales";
import { colorElegido } from "../features/seguimiento-inteligente/dominio/temperatura";

const MIN = 60_000;

/** Los `rawPayload.source` de lo que sale solo (igual que lib/freno-de-automaticos). */
export const ORIGENES_AUTOMATICOS = ["agente-v3-seguimiento", "agente-v3-seguimiento-ia", "follow", "automation_reactivation"];

/** Un mensaje del chat, con lo mínimo que hace falta para decidir el turno. */
export type MensajeDelTurno = {
  direccion: "IN" | "OUT";
  /** TEXT, AUDIO, IMAGE…; SYSTEM para las notas del chat. */
  tipo: string;
  /** Para un audio, lo transcrito si lo hay. */
  texto: string | null;
  en: Date;
  /** rawPayload.source: manual / instance = persona; follow / agente-v3-seguimiento = automático; sin origen = bot. */
  origen: string | null;
};

export type DeQuien = "MAGILUS" | "CLIENTE" | "NADIE";

export type MotivoDelTurno =
  | "cliente_escribio"
  | "bot_paso_a_asesora"
  | "intencion_fuerte"
  | "bot_no_entendio"
  | "promesa_pendiente"
  | "bot_respondio"
  | "persona_respondio"
  | "solo_cierre"
  | "nunca_escribio";

export type TurnoDelChat = {
  de: DeQuien;
  motivo: MotivoDelTurno;
  /**
   * Desde cuándo es el turno: si es de MAGILUS, desde cuándo espera el cliente (su primer mensaje
   * sin respuesta, la hora del pase a una persona o la de la señal fuerte); si es del CLIENTE, el
   * último mensaje de Magilus que no fue un seguimiento automático (desde ahí corre la cadencia).
   */
  desde: Date | null;
  /** Última respuesta de una persona (CRM o celular), si hubo. */
  ultimaPersonaEn: Date | null;
  /** La frase del cliente que dio la intención fuerte, si fue por eso. */
  frase: string | null;
};

/* ------------------------------------------------------------------------------------------------
   QUIÉN ES CADA MENSAJE
------------------------------------------------------------------------------------------------ */

/** El saludo automático del celular en el primer minuto de la charla no es una persona (anti-bloqueo). */
const PRIMER_MINUTO_MS = MIN;

export function esDePersona(m: MensajeDelTurno, inicioDeLaCharla: Date | null): boolean {
  if (m.direccion !== "OUT" || m.tipo === "SYSTEM") return false;
  if (m.origen === "manual") return true;
  if (m.origen !== "instance") return false;
  if (!inicioDeLaCharla) return true;
  return m.en.getTime() - inicioDeLaCharla.getTime() >= PRIMER_MINUTO_MS;
}

export function esAutomatico(m: MensajeDelTurno): boolean {
  return m.direccion === "OUT" && m.tipo !== "SYSTEM" && Boolean(m.origen && ORIGENES_AUTOMATICOS.includes(m.origen));
}

/** Cualquier cosa que salió de Magilus hacia el cliente (bot, persona o automático). */
export function esDeMagilus(m: MensajeDelTurno): boolean {
  return m.direccion === "OUT" && m.tipo !== "SYSTEM";
}

export function esDelCliente(m: MensajeDelTurno): boolean {
  return m.direccion === "IN" && m.tipo !== "SYSTEM";
}

/** La nota que deja el bot cuando pide una persona (webhook y retomar.ts). */
const RE_NOTA_PIDE_ASESOR = /^El agente pide un asesor\b/i;

/**
 * Lo que dice el bot al pasar el chat: "una asesora te escribe", "una de nuestras asesoras te
 * contacta", "te comunico con un asesor"… (sobre el texto normalizado, sin tildes ni signos).
 */
const RE_BOT_PASA_A_PERSONA =
  /\b(una|un|nuestra|nuestro|nuestras|nuestros|la|el|una de nuestras|uno de nuestros) (asesora|asesor|asesoras|asesores|persona|vendedora|vendedor)( de ventas| comercial)? (te|le|les) (escribe|escribira|va a escribir|contacta|contactara|va a contactar|atiende|atendera|va a atender|responde|respondera|confirma|confirmara|llama|llamara|comunica)\b|\b(te|le) (comunico|paso|transfiero) con (una|un|nuestra|nuestro) (asesora|asesor)\b/;

/** La nota del V3 cuando ganó la "red" de un paso porque no entendió lo que dijo el cliente. */
const RE_NOTA_NO_ENTENDIO = /^Agente V3: Gan[oó] .*no se entendi/i;

/** Una promesa de volver ("espera pregunto", "ya te confirmo", "déjame verificar"), sin tildes. */
const RE_PROMESA =
  /\b(espera(me)? (pregunto|consulto|verifico|reviso|averiguo|confirmo)|dame un momento|dejame (preguntar|verificar|consultar|confirmar|averiguar|revisar)|(ya|ahorita|luego) te (confirmo|averiguo|consulto|cuento|aviso)|voy a (preguntar|verificar|consultar|averiguar|revisar)|(pregunto|consulto|verifico|averiguo) (y|al|a la|con) )/;

export function esPromesaDeVolver(texto: string | null | undefined): boolean {
  return RE_PROMESA.test(normalizarTexto(texto ?? ""));
}

export function esPaseAPersona(m: MensajeDelTurno): boolean {
  if (m.tipo === "SYSTEM") return RE_NOTA_PIDE_ASESOR.test((m.texto ?? "").trim());
  if (m.direccion !== "OUT" || m.origen === "manual" || m.origen === "instance") return false;
  return RE_BOT_PASA_A_PERSONA.test(normalizarTexto(m.texto ?? ""));
}

/* ------------------------------------------------------------------------------------------------
   CIERRES Y AUTO-RESPUESTAS (pedido de Alexander, 11-10-2026): a las 4:32 p. m. había 8 "calientes
   esperando" y 5 eran un "feliz noche", un "muchas gracias", solo emojis o la auto-respuesta del
   negocio del cliente. Un mensaje así NO le pasa el turno a Magilus.

   Es cierre si (tras quitar tildes, mayúsculas y signos):
   1. Está vacío o es solo emojis / signos / números sueltos ("👍🙏", "!!", "", un sticker).
      Un "?" / "??" suelto NO (11-10-2026): es el cliente insistiendo.
   2. Es una auto-respuesta: "gracias por tu/su mensaje", "en este momento no podemos/estamos",
      "te/le responderemos", "responderemos lo antes posible / a la brevedad", "mensaje automático",
      "fuera de (nuestro) horario", "no estamos disponibles", "pronto te/le atenderemos".
   3. Es una despedida / agradecimiento CORTO (≤ 12 palabras): todas sus palabras son de cierre
      (gracias, feliz noche, bendiciones, chao, igualmente, saludos, hasta mañana, que esté bien…)
      más relleno (muchas, mil, muy, ok, listo, vale, dale, perfecto, de, para, usted…) y trae AL
      MENOS una palabra de cierre. "Muchas gracias, ¿y el envío?" NO es cierre (trae "envio");
      "listo", "ok", "está bien" o "sí" solos tampoco (pueden ser un sí a la compra); "buenas
      noches" solo tampoco (es un saludo de alguien que recién escribe; "feliz noche" sí es cierre).
   4. Es un agradecimiento o despedida de CUALQUIER largo sin pregunta ni señal de compra (falla real
      del domingo 11-10-2026: «Ah, bueno, visto, muy bien, muchas gracias.»).
------------------------------------------------------------------------------------------------ */

const AUTO_RESPUESTA: RegExp[] = [
  /\bgracias por (tu|su|comunicarte|comunicarse|escribirnos|contactarnos)\b/,
  /\ben (este|estos) momentos? no (podemos|estamos|nos encontramos|es posible)\b/,
  /\b(te|le|les) (responderemos|contestaremos|atenderemos)\b/,
  /\bresponderemos (lo (antes|mas pronto) posible|a la brevedad|pronto|en breve)\b/,
  /\bmensaje automatico\b/,
  /\bfuera (de|del) (nuestro )?horario\b/,
  /\bno estamos disponibles\b/,
];

/** Palabras que por sí solas cierran la conversación. */
const PALABRAS_DE_CIERRE = new Set([
  "gracias", "graciass", "grax", "feliz", "chao", "chau", "adios", "bendiciones", "bendecida", "bendecido",
  "bendiga", "igualmente", "saludos", "amable", "amables", "descanse", "descansa", "descansen",
]);

/** Relleno que acompaña a un cierre (no cambia que sea un cierre). Sin "si": un "sí" puede ser un sí a la compra. */
const RELLENO_DE_CIERRE = new Set([
  "muchas", "muchisimas", "mil", "muy", "ok", "okey", "okay", "oki", "okis", "vale", "listo", "dale", "perfecto", "bueno", "buenas",
  "buena", "buen", "hola", "noche", "noches", "tarde", "tardes", "dia", "dias", "hasta", "luego", "pronto", "manana", "que", "este", "esten", "estes", "bien",
  "tenga", "tengan", "tengas", "linda", "lindo", "excelente", "super", "de", "a", "ti", "usted", "ustedes", "ud", "uds", "para",
  "por", "todo", "y", "el", "la", "lo", "le", "les", "dios", "con", "gusto", "nada", "senora", "senor", "senorita", "amiga", "amigo",
  "mi", "reina", "querida", "estamos", "hablando", "hablamos", "quedo", "atenta", "atento", "pendiente", "entendido", "claro",
]);

export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Agradecimiento / despedida que, sin pregunta ni señal de compra, cierra aunque el mensaje sea largo. */
const AGRADECE_O_CIERRA = /\b(gracias|graciass|grax|bendiciones|bendiga|chao|chau|adios|igualmente|feliz (noche|dia|tarde|fin de semana)|hay que saber)\b/;

/** Pregunta: signos o palabras interrogativas (sin tildes). "hay que" no cuenta como "¿hay…?". */
const PREGUNTA =
  /\b(cuanto|cuanta|cuantos|cuantas|cuando|donde|como|cual|cuales|que (precio|valor|costo|color|colores|medida|medidas|tiempo|dias)|tienen|tiene|tendra|tendran|hay(?! que)|manejan|venden|me (regala|regalas|regalan|pasa|pasas|pasan|manda|mandas|mandan|envia|envias|envian)|informacion|info)\b/;

/** Señal de compra por palabras (además del detector del embudo). */
const SENAL_DE_COMPRA =
  /\b(quiero|quisiera|me interesa|separ\w*|apart\w*|pag\w*|consign\w*|transfer\w*|abon\w*|datos|cuenta|nequi|daviplata|envi\w* a|mand\w* a|negr[oa]s?|blanc[oa]s?|rosad[oa]s?|rosa|beige|gris|dorad[oa]s?|nude|azul|roj[oa]|vinotinto|cafe|marfil|crema|platead[oa]|verde|morado|lila|fucsia)\b/;

/** ¿Es un agradecimiento / cierre de cualquier largo, sin pregunta ni señal de compra? (regla 4) */
export function esAgradecimientoSinPendiente(texto: string | null | undefined): boolean {
  const original = texto ?? "";
  if (/[?¿]/.test(original)) return false;
  const limpio = normalizarTexto(original);
  if (!AGRADECE_O_CIERRA.test(limpio)) return false;
  if (PREGUNTA.test(limpio) || SENAL_DE_COMPRA.test(limpio)) return false;
  return !detectarSenales(original).some(esSenalDeCompra);
}

/** ¿Este texto del cliente cierra la conversación (despedida, gracias, emojis, auto-respuesta, sin texto)? */
export function esCierreOAutoRespuesta(texto: string | null | undefined): boolean {
  const limpio = normalizarTexto(texto ?? "");
  // Un "?" o "??" suelto es el cliente insistiendo: espera respuesta (11-10-2026).
  if (!/\p{L}/u.test(limpio)) return !/[?¿]/.test(texto ?? "");
  if (AUTO_RESPUESTA.some((re) => re.test(limpio))) return true;
  if (esAgradecimientoSinPendiente(texto)) return true;
  const palabras = limpio.split(" ").filter(Boolean);
  if (palabras.length > 12) return false;
  const conCierre = palabras.some((p) => PALABRAS_DE_CIERRE.has(p));
  return conCierre && palabras.every((p) => PALABRAS_DE_CIERRE.has(p) || RELLENO_DE_CIERRE.has(p) || /^j[aej]+$/.test(p));
}

/** Tipos que traen contenido aunque no tengan texto: una foto (puede ser el comprobante), un documento… */
const TIPOS_CON_CONTENIDO = new Set(["IMAGE", "VIDEO", "DOCUMENT", "LOCATION", "CONTACTS"]);

/** ¿Este mensaje del cliente le pasa el turno a Magilus? (no es un cierre) */
export function pasaElTurno(m: MensajeDelTurno): boolean {
  if (!esDelCliente(m)) return false;
  const texto = (m.texto ?? "").trim();
  const tipo = m.tipo.toUpperCase();
  if (!texto && (TIPOS_CON_CONTENIDO.has(tipo) || tipo === "AUDIO")) return true;
  return !esCierreOAutoRespuesta(texto);
}

/** La primera señal FUERTE de compra en un texto del cliente (o un color elegido), o null. */
export function senalFuerteDe(texto: string | null | undefined): string | null {
  const fuerte = detectarSenales(texto ?? "").find((s) => s.grupo === "fuerte");
  if (fuerte) return fuerte.fragmento || (texto ?? "").slice(0, 80);
  // Eligió color: el libro del V3 lo pasa a la asesora ("Vio las fotos y eligió color: Caliente").
  const color = texto ? colorElegido(texto) : null;
  return color ? `eligió ${color}` : null;
}

/* ------------------------------------------------------------------------------------------------
   EL TURNO
------------------------------------------------------------------------------------------------ */

/**
 * De quién es el turno a la hora `ahora` (los mensajes posteriores se ignoran). `mensajes` del más
 * viejo al más nuevo; pueden traer las notas del sistema (se usan solo para ver el pase a persona).
 */
export function turnoDelChat(
  mensajesCrudos: readonly MensajeDelTurno[],
  opciones: { ahora?: Date; inicioDeLaCharla?: Date | null } = {},
): TurnoDelChat {
  const mensajes = opciones.ahora ? mensajesCrudos.filter((m) => m.en.getTime() <= (opciones.ahora as Date).getTime()) : [...mensajesCrudos];
  const primeroDelCliente = mensajes.find(esDelCliente) ?? null;
  const inicio = opciones.inicioDeLaCharla ?? primeroDelCliente?.en ?? mensajes[0]?.en ?? null;

  let ultimaPersona: MensajeDelTurno | null = null;
  for (const m of mensajes) if (esDePersona(m, inicio)) ultimaPersona = m;
  const ultimaPersonaEn = ultimaPersona?.en ?? null;
  const despuesDeLaPersona = (m: MensajeDelTurno) => !ultimaPersonaEn || m.en.getTime() > ultimaPersonaEn.getTime();

  if (!primeroDelCliente) {
    return { de: "NADIE", motivo: "nunca_escribio", desde: null, ultimaPersonaEn, frase: null };
  }

  // 1. El cliente escribió (con contenido) y nadie de Magilus le contestó después.
  let ultimoDeMagilus: MensajeDelTurno | null = null;
  for (const m of mensajes) if (esDeMagilus(m)) ultimoDeMagilus = m;
  const sinRespuesta = mensajes.filter(
    (m) => pasaElTurno(m) && (!ultimoDeMagilus || m.en.getTime() > (ultimoDeMagilus as MensajeDelTurno).en.getTime()),
  );
  if (sinRespuesta.length) {
    return { de: "MAGILUS", motivo: "cliente_escribio", desde: sinRespuesta[0].en, ultimaPersonaEn, frase: null };
  }

  // 2. El bot pasó el chat a una persona y ninguna persona escribió después.
  const pase = mensajes.find((m) => esPaseAPersona(m) && despuesDeLaPersona(m)) ?? null;
  if (pase) {
    return { de: "MAGILUS", motivo: "bot_paso_a_asesora", desde: pase.en, ultimaPersonaEn, frase: null };
  }

  // 3. Intención fuerte de compra sin ninguna persona después (aunque el bot haya contestado).
  for (const m of mensajes) {
    if (!esDelCliente(m) || !despuesDeLaPersona(m)) continue;
    const frase = senalFuerteDe(m.texto);
    if (frase) return { de: "MAGILUS", motivo: "intencion_fuerte", desde: m.en, ultimaPersonaEn, frase };
  }

  let ultimoQuePasa: MensajeDelTurno | null = null;
  for (const m of mensajes) if (pasaElTurno(m)) ultimoQuePasa = m;
  const desdeElCliente = ultimoQuePasa?.en.getTime() ?? 0;
  const respondio = [...mensajes].reverse().find((m) => esDeMagilus(m) && !esAutomatico(m) && m.en.getTime() >= desdeElCliente) ?? null;

  // 4. El bot contestó lo último que dijo el cliente, pero no lo entendió (red del paso).
  if (ultimoQuePasa && despuesDeLaPersona(ultimoQuePasa)) {
    const noEntendio = mensajes.find(
      (m) => m.tipo === "SYSTEM" && m.en.getTime() >= desdeElCliente && RE_NOTA_NO_ENTENDIO.test((m.texto ?? "").trim()),
    );
    if (noEntendio) return { de: "MAGILUS", motivo: "bot_no_entendio", desde: ultimoQuePasa.en, ultimaPersonaEn, frase: null };
  }

  // 5. Lo último de Magilus (no automático) es una promesa de volver y nadie volvió.
  if (respondio && esPromesaDeVolver(respondio.texto)) {
    return { de: "MAGILUS", motivo: "promesa_pendiente", desde: respondio.en, ultimaPersonaEn, frase: null };
  }

  // Turno del cliente: desde el último mensaje de Magilus que no fue un seguimiento automático
  // posterior al último mensaje con contenido del cliente.
  const motivo: MotivoDelTurno = !ultimoQuePasa ? "solo_cierre" : respondio && esDePersona(respondio, inicio) ? "persona_respondio" : "bot_respondio";
  return { de: "CLIENTE", motivo, desde: respondio?.en ?? ultimoDeMagilus?.en ?? null, ultimaPersonaEn, frase: null };
}

/** ¿Le toca a Magilus? (atajo para los detectores) */
export function esTurnoDeMagilus(turno: Pick<TurnoDelChat, "de"> | null | undefined): boolean {
  return turno?.de === "MAGILUS";
}
