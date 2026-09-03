type ConversationLine = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
};

const AFFIRMATIVE_PATTERNS = [
  /^\s*si\s*[!.]?\s*$/i,
  /^\s*si,\s*$/i,
  /^\s*claro\s*[!.]?\s*$/i,
  /^\s*dale\s*[!.]?\s*$/i,
  /^\s*por favor\s*[!.]?\s*$/i,
  /^\s*ok\s*[!.]?\s*$/i,
];

const HUMAN_INTENT_PATTERNS = [
  /\bhabl(?:ar|ame|en|enme|arme)?\s+con\s+(?:un|una)?\s*(?:asesor|asesora|agente|persona|humano)\b/i,
  /\b(?:asesor|asesora|humano)\b/i,
  /\b(?:me\s+contacten|contactenme|me\s+llamen|llamenme|escribanme|me\s+pueden\s+llamar)\b/i,
  /\b(?:atencion|atención)\s+personalizada\b/i,
  /\b(?:ayuda|soporte)\s+humana?\b/i,
  /\b(?:quiero|necesito|deseo|quisiera|puedo)\s+.*\b(?:asesor|asesora|humano|persona)\b/i,
];

const FOLLOW_UP_HINT_PATTERNS = [
  /\basesor\b/i,
  /\basesora\b/i,
  /\bhumano\b/i,
  /\bcontact\w*\b/i,
  /\bayuda\b/i,
];

function normalizeText(value: string) {
  return value
    /*
      NFKD y no NFD: hay clientes que escriben con las fuentes raras de WhatsApp
      -"𝑩𝒖𝒆𝒏𝒂𝒔 𝒏𝒊𝒄𝒉𝒆𝒔"-, que son letras matematicas de Unicode, no la "b" comun. NFD no
      las toca, el filtro de abajo se las come, y el mensaje ENTERO quedaba en blanco: sus
      palabras eran invisibles para todos los buscadores. NFKD las devuelve a letras normales.
    */
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function hasRecentFollowUpHint(history: ConversationLine[]) {
  const recentOutbound = [...history]
    .reverse()
    .filter((line) => line.direction === "OUTBOUND")
    .slice(0, 4)
    .map((line) => normalizeText(line.content ?? ""))
    .filter(Boolean)
    .join(" ");

  return FOLLOW_UP_HINT_PATTERNS.some((pattern) => pattern.test(recentOutbound));
}

function isAffirmativeMessage(messageText: string) {
  const trimmed = messageText.trim();
  return AFFIRMATIVE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function detectNotifyHumanIntent(input: {
  latestUserMessage: string | null | undefined;
  history?: ConversationLine[];
}) {
  const latestText = input.latestUserMessage?.trim() || "";
  if (!latestText) {
    return false;
  }

  const normalizedLatest = normalizeText(latestText);
  if (HUMAN_INTENT_PATTERNS.some((pattern) => pattern.test(normalizedLatest))) {
    return true;
  }

  if (isAffirmativeMessage(latestText) && input.history?.length) {
    return hasRecentFollowUpHint(input.history);
  }

  return false;
}

/**
 * Se saco `detectUnknownProductIntent`.
 *
 * Marcaba "el cliente pregunta por algo que no tenemos" buscando las palabras "catalogo",
 * "producto", "modelo" o "referencia" en el mensaje — palabras que aparecen en cualquier
 * conversacion de venta normal. Con eso disparaba un aviso al asesor y cortaba la charla, sin
 * que la IA leyera nada.
 *
 * Ahora eso lo decide la IA llamando a Notificar_asesor, guiada por la instruccion que se
 * escribe en el nodo "Notificar asesor" del diagrama: un texto que se lee y se corrige, en vez
 * de una lista de palabras escondida en el codigo.
 */
