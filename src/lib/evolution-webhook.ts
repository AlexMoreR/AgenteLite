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

function pickNestedString(source: UnknownRecord | null, nestedKeys: string[][]): string | null {
  if (!source) return null;

  for (const path of nestedKeys) {
    let current: unknown = source;

    for (const key of path) {
      const record = asRecord(current);
      current = record?.[key];
    }

    const value = readString(current);
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
  const rawEvent = pickString(root, ["event", "type"]);
  if (!rawEvent) return null;

  return rawEvent.trim().replace(/\./g, "_").replace(/\s+/g, "_").toUpperCase();
}

export function extractEvolutionQrCode(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);

  return (
    pickString(data, ["base64", "qrcode", "qr", "code"]) ||
    pickNestedString(data, [
      ["qrcode", "base64"],
      ["qrcode", "code"],
      ["qrCode", "base64"],
      ["qrCode", "code"],
    ]) ||
    pickString(root, ["base64", "qrcode", "qr", "code"]) ||
    pickNestedString(root, [
      ["qrcode", "base64"],
      ["qrcode", "code"],
      ["qrCode", "base64"],
      ["qrCode", "code"],
    ])
  );
}

export function extractEvolutionPairingCode(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);

  return (
    pickString(data, ["pairingCode", "pairing_code"]) ||
    pickNestedString(data, [["qrcode", "pairingCode"], ["qrCode", "pairingCode"]]) ||
    pickString(root, ["pairingCode", "pairing_code"])
  );
}

export function extractEvolutionConnectionState(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const instance = asRecord(root?.instance);

  return (
    pickString(data, ["state", "status", "connection", "connectionStatus"]) ||
    pickString(instance, ["state", "status", "connection", "connectionStatus"]) ||
    pickString(root, ["state", "status", "connection", "connectionStatus"])
  );
}

export function extractEvolutionPhoneNumber(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const instance = asRecord(root?.instance);

  return (
    pickString(data, ["number", "phone", "phoneNumber", "owner"]) ||
    pickString(instance, ["number", "phone", "phoneNumber", "owner"]) ||
    pickString(root, ["number", "phone", "phoneNumber", "owner"])
  );
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

export function extractEvolutionMessageId(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const key = asRecord(data?.key);

  return (
    pickString(key, ["id"]) ||
    pickString(data, ["messageId", "message_id", "id"])
  );
}

export function extractEvolutionFromMe(payload: unknown): boolean {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const key = asRecord(data?.key);

  return key?.fromMe === true || data?.fromMe === true;
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
  return eventName === "MESSAGES_UPSERT" || eventName === "MESSAGE_UPSERT";
}
