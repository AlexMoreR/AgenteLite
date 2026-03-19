type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickString(source: UnknownRecord | null, keys: string[]): string | null {
  if (!source) return null;

  for (const key of keys) {
    const value = readString(source[key]);
    if (value) return value;
  }

  return null;
}

export function extractEvolutionInstanceName(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const instance = asRecord(root?.instance);
  const sender = asRecord(data?.sender);
  const key = asRecord(data?.key);

  return (
    pickString(root, ["instanceName", "instance", "instance_name"]) ||
    pickString(instance, ["instanceName", "instance", "instance_name", "name"]) ||
    pickString(data, ["instanceName", "instance", "instance_name"]) ||
    pickString(sender, ["instanceName"]) ||
    pickString(key, ["remoteJid"])
  );
}

export function extractEvolutionEventName(payload: unknown): string | null {
  const root = asRecord(payload);
  return pickString(root, ["event", "type"]);
}

export function extractEvolutionMessageText(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = asRecord(data?.message);
  const extendedText = asRecord(message?.extendedTextMessage);
  const conversation = readString(message?.conversation);
  const extendedConversation = readString(extendedText?.text);

  return conversation || extendedConversation || pickString(data, ["text", "body"]);
}

export function extractEvolutionRemoteJid(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const key = asRecord(data?.key);
  const sender = asRecord(data?.sender);

  return (
    pickString(key, ["remoteJid", "participant"]) ||
    pickString(sender, ["id", "jid"]) ||
    pickString(data, ["remoteJid"])
  );
}

export function normalizePhoneFromJid(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.split("@")[0]?.replace(/\D/g, "") ?? "";
  return normalized || null;
}

export function isInboundMessageEvent(eventName: string | null): boolean {
  return eventName === "MESSAGES_UPSERT";
}

