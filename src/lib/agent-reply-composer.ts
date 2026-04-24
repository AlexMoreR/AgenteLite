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

export function composeAgentWelcomeReply(input: {
  welcomeMessage?: string | null;
  reply?: string | null;
  hasConversationHistory?: boolean;
}) {
  const welcomeMessage = input.welcomeMessage?.trim() || "";
  const reply = input.reply?.trim() || "";

  if (!welcomeMessage) {
    return reply;
  }

  if (!reply) {
    return welcomeMessage;
  }

  if (input.hasConversationHistory) {
    return stripRepeatedWelcome(reply, welcomeMessage);
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
