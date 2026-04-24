function normalizeReplyText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function composeAgentWelcomeReply(input: {
  welcomeMessage?: string | null;
  reply?: string | null;
}) {
  const welcomeMessage = input.welcomeMessage?.trim() || "";
  const reply = input.reply?.trim() || "";

  if (!welcomeMessage) {
    return reply;
  }

  if (!reply) {
    return welcomeMessage;
  }

  const normalizedWelcome = normalizeReplyText(welcomeMessage);
  const normalizedReply = normalizeReplyText(reply);

  if (normalizedWelcome && normalizedReply.startsWith(normalizedWelcome)) {
    return reply;
  }

  return `${welcomeMessage}\n\n${reply}`;
}
