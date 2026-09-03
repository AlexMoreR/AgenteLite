function normalizeReplyText(value: string) {
  return value
    /*
      NFKD y no NFD: hay clientes que escriben con las fuentes raras de WhatsApp
      -"𝑩𝒖𝒆𝒏𝒂𝒔 𝒏𝒊𝒄𝒉𝒆𝒔"-, que son letras matematicas de Unicode, no la "b" comun. NFD no
      las toca, el filtro de abajo se las come, y el mensaje ENTERO quedaba en blanco: sus
      palabras eran invisibles para todos los buscadores. NFKD las devuelve a letras normales.
    */
    .normalize("NFKD")
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
