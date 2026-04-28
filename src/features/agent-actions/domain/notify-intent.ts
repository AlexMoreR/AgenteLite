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
    .normalize("NFD")
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
