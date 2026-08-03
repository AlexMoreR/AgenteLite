/**
 * WhatsApp dejo de mandarnos el telefono del cliente.
 *
 * Ahora muchos mensajes llegan identificados solo con un LID ("70849948319908@lid"), que es un
 * id interno de WhatsApp, no un numero. Los campos donde antes venia el numero real (SenderAlt,
 * RecipientAlt) llegan VACIOS, y ningun endpoint del gateway traduce LID a telefono.
 *
 * Chatear sigue funcionando: se responde contra el LID y WhatsApp entrega (hay acuses de
 * "delivered" y "read"). Lo que se rompe es el CRM: ese LID se guardaba como si fuera el
 * telefono, asi que la asesora veia "175775932239983" en la ficha e intentaba llamar a un numero
 * que no existe.
 *
 * Aca vive todo lo que distingue un LID de un telefono de verdad, y como recuperar el numero
 * cuando el cliente lo escribe en la conversacion.
 */

const CONTACT_METADATA_LID_KEY = "whatsappLid";
const CONTACT_METADATA_DISCOVERED_PHONE_KEY = "discoveredPhoneNumber";
const CONTACT_METADATA_LID_ID_KEY = "whatsappLidId";

/** Los digitos de un JID: "70849948319908@lid" -> "70849948319908". */
export function lidDigits(jid: string | null | undefined): string | null {
  if (!isLidJid(jid)) return null;
  const digits = (jid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits || null;
}

/** El JID lo dice sin ambiguedad: dominio "lid" = no es un telefono. */
export function isLidJid(jid: string | null | undefined): boolean {
  if (!jid) return false;
  return (jid.split("@")[1] ?? "").trim().toLowerCase() === "lid";
}

/**
 * Para los contactos que YA quedaron guardados, el JID original no esta a mano. Se los reconoce
 * por el largo: un LID trae 14 o 15 digitos, y un telefono de verdad como mucho 13 con el
 * indicativo (Colombia 573001234567 son 12, Argentina 5491138236299 son 13).
 *
 * Es una regla por aproximacion y solo decide como se MUESTRA el dato, nunca borra nada: lo peor
 * que puede pasar es que un numero larguisimo aparezca como "no se puede llamar".
 */
export function looksLikeLidNumber(phoneNumber: string | null | undefined): boolean {
  const digits = (phoneNumber ?? "").replace(/\D/g, "");
  return digits.length >= 14;
}

function readMetadataRecord(metadata: unknown): Record<string, unknown> | null {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

/** El telefono que se le pesco al cliente en la conversacion, si aparecio alguna vez. */
export function readDiscoveredPhone(metadata: unknown): string | null {
  const record = readMetadataRecord(metadata);
  const value = record?.[CONTACT_METADATA_DISCOVERED_PHONE_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isMarkedAsLid(metadata: unknown): boolean {
  return readMetadataRecord(metadata)?.[CONTACT_METADATA_LID_KEY] === true;
}

export function buildLidContactMetadata(): Record<string, unknown> {
  return { [CONTACT_METADATA_LID_KEY]: true };
}

/** El LID guardado en la ficha, que es lo que permite reconocer a la persona mas adelante. */
export function readLinkedLid(metadata: unknown): string | null {
  const value = readMetadataRecord(metadata)?.[CONTACT_METADATA_LID_ID_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildLinkedLidMetadata(metadata: unknown, lid: string): Record<string, unknown> {
  return {
    ...(readMetadataRecord(metadata) ?? {}),
    [CONTACT_METADATA_LID_ID_KEY]: lid,
  };
}

export const CONTACT_LID_ID_METADATA_PATH = [CONTACT_METADATA_LID_ID_KEY];

export function buildDiscoveredPhoneMetadata(
  metadata: unknown,
  phoneNumber: string,
): Record<string, unknown> {
  return {
    ...(readMetadataRecord(metadata) ?? {}),
    [CONTACT_METADATA_DISCOVERED_PHONE_KEY]: phoneNumber,
  };
}

/**
 * Que numero puede marcar la asesora. Devuelve null cuando no hay ninguno: es la diferencia
 * entre "no tiene numero" y "tiene este numero" — mostrar el LID era mentirle.
 */
export function resolveCallablePhone(contact: {
  phoneNumber: string | null;
  metadata?: unknown;
}): string | null {
  const descubierto = readDiscoveredPhone(contact.metadata);
  if (descubierto) {
    return descubierto;
  }

  const phoneNumber = contact.phoneNumber?.trim() || "";
  if (!phoneNumber) {
    return null;
  }

  if (isMarkedAsLid(contact.metadata) || looksLikeLidNumber(phoneNumber)) {
    return null;
  }

  return phoneNumber;
}

/**
 * Busca un telefono dentro de lo que escribio el cliente ("mi numero es 3001234567").
 *
 * Es deliberadamente estricto porque en estas conversaciones vuelan numeros que NO son
 * telefonos: precios ("1500000"), medidas ("150 o 180 de largo"), cantidades. Solo se acepta
 * algo que no pueda confundirse con eso:
 *
 *  - escrito con indicativo explicito (+57 300 123 4567),
 *  - un celular colombiano de 10 digitos que arranca en 3,
 *  - o ese mismo numero ya con el 57 adelante.
 *
 * Ante la duda, no devuelve nada: un telefono equivocado en la ficha es peor que ninguno,
 * porque la asesora pierde la llamada Y no se entera de que el dato estaba mal.
 */
export function extractPhoneFromText(text: string | null | undefined): string | null {
  const contenido = text?.trim();
  if (!contenido) {
    return null;
  }

  // Con indicativo explicito: el "+" es una senal clara de que es un telefono.
  const conIndicativo = contenido.match(/\+\s*(\d[\d\s().-]{8,17}\d)/);
  if (conIndicativo) {
    const digits = conIndicativo[1].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      return digits;
    }
  }

  // Sin indicativo: solo celulares colombianos, que son inconfundibles (10 digitos, arrancan
  // en 3). Se permiten espacios y guiones en el medio, como los escribe la gente.
  for (const match of contenido.matchAll(/(?<!\d)(3[\d\s.-]{9,13})(?!\d)/g)) {
    const digits = match[1].replace(/\D/g, "");
    if (digits.length === 10) {
      return `57${digits}`;
    }
  }

  // Ya viene con el 57 adelante.
  for (const match of contenido.matchAll(/(?<!\d)(57\s?3[\d\s.-]{9,13})(?!\d)/g)) {
    const digits = match[1].replace(/\D/g, "");
    if (digits.length === 12) {
      return digits;
    }
  }

  return null;
}
