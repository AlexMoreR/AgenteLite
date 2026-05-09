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

function getMessageRecord(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const update = asRecord(root?.update);

  return asRecord(data?.message) ?? asRecord(update?.message) ?? asRecord(root?.message);
}

export function hasEvolutionEditedMessagePayload(payload: unknown) {
  const message = getMessageRecord(payload);
  const payloadRoot = asRecord(payload);
  const update = asRecord(payloadRoot?.update);
  const updateMessage = asRecord(update?.message);
  const messageEdited = asRecord(message?.editedMessage);
  const updateEditedMessage = asRecord(updateMessage?.editedMessage);

  return Boolean(messageEdited || updateEditedMessage || asRecord(payloadRoot?.editedMessage));
}

function getDeletedMessageRecord(payload: unknown) {
  const message = getMessageRecord(payload);
  const payloadRoot = asRecord(payload);
  const update = asRecord(payloadRoot?.update);
  const updateMessage = asRecord(update?.message);
  const payloadDeletedMessage = asRecord(payloadRoot?.deletedMessage);
  const messageDeleted = asRecord(message?.deletedMessage);
  const updateDeletedMessage = asRecord(updateMessage?.deletedMessage);
  const protocolMessage = asRecord(message?.protocolMessage) ?? asRecord(updateMessage?.protocolMessage) ?? asRecord(payloadRoot?.protocolMessage);

  if (protocolMessage && readString(protocolMessage.type)?.toUpperCase() === "REVOKE") {
    return protocolMessage;
  }

  return (
    asRecord(messageDeleted?.message) ||
    messageDeleted ||
    asRecord(updateDeletedMessage?.message) ||
    updateDeletedMessage ||
    asRecord(payloadDeletedMessage?.message) ||
    payloadDeletedMessage
  );
}

export function hasEvolutionDeletedMessagePayload(payload: unknown) {
  const deletedMessage = getDeletedMessageRecord(payload);
  const payloadRoot = asRecord(payload);
  const update = asRecord(payloadRoot?.update);
  const updateMessage = asRecord(update?.message);
  const protocolMessage = asRecord(getMessageRecord(payload)?.protocolMessage);
  const updateProtocolMessage = asRecord(updateMessage?.protocolMessage);
  const normalizedEvent = readString(payloadRoot?.event)?.toUpperCase() ?? "";
  const normalizedType = readString(payloadRoot?.type)?.toUpperCase() ?? "";

  return Boolean(
    deletedMessage ||
      (protocolMessage && readString(protocolMessage.type)?.toUpperCase() === "REVOKE") ||
      (updateProtocolMessage && readString(updateProtocolMessage.type)?.toUpperCase() === "REVOKE") ||
      normalizedEvent.includes("DELETE") ||
      normalizedType.includes("DELETE"),
  );
}

function extractMessageTextFromRecord(message: UnknownRecord | null): string | null {
  const extendedText = asRecord(message?.extendedTextMessage);
  const buttonsResponseMessage = asRecord(message?.buttonsResponseMessage);
  const listResponseMessage = asRecord(message?.listResponseMessage);
  const templateButtonReplyMessage = asRecord(message?.templateButtonReplyMessage);
  const imageMessage = asRecord(message?.imageMessage);
  const stickerMessage = asRecord(message?.stickerMessage);
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
  const stickerCaption = readString(stickerMessage?.caption);
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
    stickerCaption ||
    videoCaption ||
    documentCaption ||
    documentFileName
  );
}

function getEditedMessageRecord(payload: unknown) {
  const message = getMessageRecord(payload);
  const payloadRoot = asRecord(payload);
  const update = asRecord(payloadRoot?.update);
  const updateMessage = asRecord(update?.message);
  const messageEdited = asRecord(message?.editedMessage);
  const updateEditedMessage = asRecord(updateMessage?.editedMessage);
  const payloadEditedMessage = asRecord(payloadRoot?.editedMessage);

  return (
    asRecord(messageEdited?.message) ||
    messageEdited ||
    asRecord(updateEditedMessage?.message) ||
    updateEditedMessage ||
    asRecord(payloadEditedMessage?.message) ||
    payloadEditedMessage
  );
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
    pickString(data, ["remoteJid", "participant", "from"]) ||
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
  const message = getMessageRecord(payload);
  const editedMessage = getEditedMessageRecord(payload);

  return (
    extractMessageTextFromRecord(editedMessage) ||
    extractMessageTextFromRecord(message) ||
    pickString(asRecord(asRecord(payload)?.data), ["text", "body"])
  );
}

export function extractEvolutionMessageType(payload: unknown) {
  const message = getMessageRecord(payload);
  const editedMessage = getEditedMessageRecord(payload);
  const target = editedMessage ?? message;

  if (asRecord(target?.imageMessage)) {
    return "IMAGE" as const;
  }

  if (asRecord(target?.audioMessage)) {
    return "AUDIO" as const;
  }

  if (asRecord(target?.stickerMessage)) {
    return "STICKER" as const;
  }

  if (asRecord(target?.videoMessage)) {
    return "VIDEO" as const;
  }

  if (asRecord(target?.documentMessage)) {
    return "DOCUMENT" as const;
  }

  return "TEXT" as const;
}

export function extractEvolutionMediaUrl(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const message = getMessageRecord(payload);
  const editedMessage = getEditedMessageRecord(payload);
  const target = editedMessage ?? message;

  return (
    pickNestedString(target, [
      ["imageMessage", "url"],
      ["audioMessage", "url"],
      ["stickerMessage", "url"],
      ["videoMessage", "url"],
      ["documentMessage", "url"],
      ["imageMessage", "directPath"],
      ["audioMessage", "directPath"],
      ["stickerMessage", "directPath"],
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
  const rootKey = asRecord(root?.key);
  const message = getMessageRecord(payload);
  const deletedMessage = getDeletedMessageRecord(payload);
  const protocolMessage = asRecord(message?.protocolMessage) ?? asRecord(deletedMessage?.protocolMessage);
  const protocolKey = asRecord(protocolMessage?.key);
  const deletedKey = asRecord(deletedMessage?.key);

  return (
    pickString(data, ["keyId", "messageId", "message_id", "id"]) ||
    pickString(root, ["keyId", "messageId", "message_id", "id"]) ||
    pickString(key, ["id"]) ||
    pickString(rootKey, ["id"]) ||
    pickString(protocolKey, ["id"]) ||
    pickString(deletedKey, ["id"])
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
    pickString(data, ["remoteJid", "participant", "from"]) ||
    pickString(key, ["remoteJid", "participant"]) ||
    pickString(rootKey, ["remoteJid", "participant"]) ||
    pickString(sender, ["id", "jid"]) ||
    pickString(rootSender, ["id", "jid"]) ||
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

export function isMessageUpdateEvent(eventName: string | null): boolean {
  if (!eventName) {
    return false;
  }

  return (
    eventName === "MESSAGES_UPDATE" ||
    eventName === "MESSAGE_UPDATE" ||
    eventName === "MESSAGES_EDITED" ||
    eventName === "MESSAGE_EDITED" ||
    eventName === "MESSAGES_DELETE" ||
    eventName === "MESSAGE_DELETE" ||
    eventName.includes("UPDATE") ||
    eventName.includes("EDIT")
  );
}
