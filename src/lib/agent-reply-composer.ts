function normalizeReplyText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripRepeatedWelcome(reply: string, welcomeMessage: string) {
  const normalizedWelcome = normalizeReplyText(welcomeMessage);
  const trimmedReply = reply.trimStart();

  if (!normalizedWelcome || !trimmedReply) {
    return reply;
  }

  const paragraphs = trimmedReply.split(/\n\s*\n/);
  const firstParagraph = paragraphs[0]?.trim() || "";
  const normalizedFirstParagraph = normalizeReplyText(firstParagraph);
  const normalizedReply = normalizeReplyText(trimmedReply);

  const matchesWelcome =
    normalizedFirstParagraph === normalizedWelcome ||
    normalizedReply.startsWith(normalizedWelcome);

  if (!matchesWelcome) {
    return reply;
  }

  return paragraphs.slice(1).join("\n\n").trimStart();
}

function stripBusinessNameFromIntro(reply: string) {
  // Strips "de NombreEmpresa" from self-introduction patterns like "Soy Magi de Magilus"
  // so the business name isn't repeated when the welcome message already shows it.
  return reply.replace(
    /\b(soy\s+\*?\w+(?:\s+\w+)?\*?)\s+de\s+\*?[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ]*(?:\s+[A-Za-záéíóúñ]+)?\*?/gi,
    "$1",
  );
}

export function composeAgentWelcomeReply(input: {
  welcomeMessage?: string | null;
  reply?: string | null;
  hasConversationHistory?: boolean;
}) {
  const welcomeMessage = input.welcomeMessage?.trim() || "";
  let reply = input.reply?.trim() || "";

  if (welcomeMessage && !input.hasConversationHistory) {
    reply = stripBusinessNameFromIntro(reply);
  }

  if (!welcomeMessage) {
    return reply;
  }

  if (input.hasConversationHistory) {
    return reply ? stripRepeatedWelcome(reply, welcomeMessage) : reply;
  }

  if (!reply) {
    return welcomeMessage;
  }

  const normalizedWelcome = normalizeReplyText(welcomeMessage);
  const normalizedReply = normalizeReplyText(reply);
  const welcomeSnippet = normalizedWelcome.split(" ").slice(0, 10).join(" ");

  if (
    normalizedWelcome &&
    (normalizedReply.startsWith(normalizedWelcome) ||
      normalizedReply.includes(normalizedWelcome) ||
      (welcomeSnippet.length >= 24 && normalizedReply.includes(welcomeSnippet)))
  ) {
    return reply;
  }

  return `${welcomeMessage}\n\n${reply}`;
}
