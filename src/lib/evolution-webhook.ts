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
  const key = asRecord(root?.key);
  const sender = asRecord(root?.sender);
  const message = asRecord(root?.message);
  const contextInfo = asRecord(asRecord(message?.extendedTextMessage)?.contextInfo);

  return (
    pickString(data, ["number", "phone", "phoneNumber", "owner", "ownerJid", "wuid"]) ||
    pickNestedString(data, [["me", "id"], ["instance", "owner"], ["instance", "ownerJid"], ["instance", "wuid"]]) ||
    pickString(instance, ["number", "phone", "phoneNumber", "owner", "ownerJid", "wuid"]) ||
    pickNestedString(instance, [["me", "id"]]) ||
    pickString(key, ["remoteJid", "participant"]) ||
    pickString(sender, ["id", "jid"]) ||
    pickString(contextInfo, ["participant", "remoteJid"]) ||
    pickString(root, ["number", "phone", "phoneNumber", "owner", "ownerJid", "wuid"]) ||
    pickNestedString(root, [["me", "id"]])
  );
}

export function extractEvolutionMessageText(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = asRecord(data?.message);
  const extendedText = asRecord(message?.extendedTextMessage);
  const buttonsResponseMessage = asRecord(message?.buttonsResponseMessage);
  const listResponseMessage = asRecord(message?.listResponseMessage);
  const templateButtonReplyMessage = asRecord(message?.templateButtonReplyMessage);
  const imageMessage = asRecord(message?.imageMessage);
  const videoMessage = asRecord(message?.videoMessage);
  const documentMessage = asRecord(message?.documentMessage);
  const conversation = readString(message?.conversation);
  const extendedConversation = readString(extendedText?.text);
  const buttonText =
    readString(buttonsResponseMessage?.selectedDisplayText) ||
    readString(buttonsResponseMessage?.selectedButtonId);
  const listText =
    readString(listResponseMessage?.title) ||
    readString(listResponseMessage?.singleSelectReply && asRecord(listResponseMessage.singleSelectReply)?.selectedRowId);
  const templateReplyText =
    readString(templateButtonReplyMessage?.selectedDisplayText) ||
    readString(templateButtonReplyMessage?.selectedId);
  const imageCaption = readString(imageMessage?.caption);
  const videoCaption = readString(videoMessage?.caption);
  const documentCaption = readString(documentMessage?.caption);
  const documentFileName = readString(documentMessage?.fileName);

  return (
    conversation ||
    extendedConversation ||
    buttonText ||
    listText ||
    templateReplyText ||
    imageCaption ||
    videoCaption ||
    documentCaption ||
    documentFileName ||
    pickString(data, ["text", "body"])
  );
}

export function extractEvolutionMessageType(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = asRecord(data?.message);

  if (asRecord(message?.imageMessage)) {
    return "IMAGE" as const;
  }

  if (asRecord(message?.audioMessage)) {
    return "AUDIO" as const;
  }

  if (asRecord(message?.videoMessage)) {
    return "VIDEO" as const;
  }

  if (asRecord(message?.documentMessage)) {
    return "DOCUMENT" as const;
  }

  return "TEXT" as const;
}

export function extractEvolutionMediaUrl(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = asRecord(data?.message);

  return (
    pickNestedString(message, [
      ["imageMessage", "url"],
      ["audioMessage", "url"],
      ["videoMessage", "url"],
      ["documentMessage", "url"],
      ["imageMessage", "directPath"],
      ["audioMessage", "directPath"],
      ["videoMessage", "directPath"],
      ["documentMessage", "directPath"],
    ]) ||
    pickString(data, ["mediaUrl", "media", "url"])
  );
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

  return key?.fromMe === true || data?.fromMe === true || root?.fromMe === true;
}

export function extractEvolutionRemoteJid(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const key = asRecord(data?.key);
  const rootKey = asRecord(root?.key);
  const sender = asRecord(data?.sender);
  const rootSender = asRecord(root?.sender);
  const message = asRecord(data?.message);
  const rootMessage = asRecord(root?.message);
  const contextInfo = asRecord(asRecord(message?.extendedTextMessage)?.contextInfo);
  const rootContextInfo = asRecord(asRecord(rootMessage?.extendedTextMessage)?.contextInfo);

  return (
    pickString(key, ["remoteJid", "participant"]) ||
    pickString(rootKey, ["remoteJid", "participant"]) ||
    pickString(sender, ["id", "jid"]) ||
    pickString(rootSender, ["id", "jid"]) ||
    pickString(data, ["remoteJid", "participant", "from"]) ||
    pickString(root, ["remoteJid", "participant", "from"]) ||
    pickString(contextInfo, ["participant", "remoteJid"]) ||
    pickString(rootContextInfo, ["participant", "remoteJid"]) ||
    pickString(root, ["remoteJid"])
  );
}

export function normalizePhoneFromJid(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.split("@")[0]?.replace(/\D/g, "") ?? "";
  if (!normalized || normalized.length < 7 || normalized.length > 15) return null;
  return normalized;
}

export function isInboundMessageEvent(eventName: string | null): boolean {
  if (!eventName) {
    return false;
  }

  return (
    eventName === "MESSAGES_UPSERT" ||
    eventName === "MESSAGE_UPSERT" ||
    eventName === "MESSAGES_UPSERT_NOTIFY" ||
    eventName === "MESSAGES_UPSERT_APPEND" ||
    (eventName.includes("MESSAGE") && eventName.includes("UPSERT"))
  );
}
