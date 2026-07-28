import {
  getMetaGraphErrorMessage,
  type MetaGraphErrorPayload,
} from "@/lib/official-api-graph";

type EmbeddedSignupData = {
  phoneNumberId: string;
  wabaId: string;
  businessId: string | null;
};

type EmbeddedSignupSessionEnvelope = {
  data?: {
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
  };
  type?: string;
  event?: string;
};

function getTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmbeddedSignupData(value: unknown): EmbeddedSignupData | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const phoneNumberId = getTrimmedString(record.phone_number_id);
  const wabaId = getTrimmedString(record.waba_id);
  const businessId = getTrimmedString(record.business_id) || null;

  if (!phoneNumberId || !wabaId) {
    return null;
  }

  return {
    phoneNumberId,
    wabaId,
    businessId,
  };
}

function findEmbeddedSignupData(value: unknown): EmbeddedSignupData | null {
  const directData = normalizeEmbeddedSignupData(value);
  if (directData) {
    return directData;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = findEmbeddedSignupData(entry);
      if (result) {
        return result;
      }
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if ("data" in record) {
    const nestedData = normalizeEmbeddedSignupData(record.data);
    if (nestedData) {
      return nestedData;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const result = findEmbeddedSignupData(nestedValue);
    if (result) {
      return result;
    }
  }

  return null;
}

export function parseEmbeddedSignupSessionResponse(rawValue: string): EmbeddedSignupData {
  const normalizedRawValue = rawValue.trim();
  if (!normalizedRawValue) {
    throw new Error("Pega la respuesta de registro de la sesion para continuar.");
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(normalizedRawValue) as EmbeddedSignupSessionEnvelope | EmbeddedSignupSessionEnvelope[];
  } catch {
    throw new Error("La respuesta de registro de la sesion no tiene un JSON valido.");
  }

  const result = findEmbeddedSignupData(parsedValue);
  if (!result) {
    throw new Error("No se encontraron phone_number_id y waba_id dentro de la respuesta de Meta.");
  }

  return result;
}

// --- Coexistencia -----------------------------------------------------------------------
// El onboarding de la app de WhatsApp Business (coexistencia) trae SOLO waba_id en su evento
// FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING; NO incluye phone_number_id (a diferencia del
// onboarding normal). Por eso necesitamos un parser tolerante + resolver el numero aparte.

export type EmbeddedSignupIds = {
  phoneNumberId: string | null;
  wabaId: string;
  businessId: string | null;
};

function normalizeEmbeddedSignupIds(value: unknown): EmbeddedSignupIds | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const wabaId = getTrimmedString(record.waba_id);
  if (!wabaId) {
    return null;
  }

  return {
    phoneNumberId: getTrimmedString(record.phone_number_id) || null,
    wabaId,
    businessId: getTrimmedString(record.business_id) || null,
  };
}

function findEmbeddedSignupIds(value: unknown): EmbeddedSignupIds | null {
  const direct = normalizeEmbeddedSignupIds(value);
  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = findEmbeddedSignupIds(entry);
      if (result) {
        return result;
      }
    }
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if ("data" in record) {
    const nested = normalizeEmbeddedSignupIds(record.data);
    if (nested) {
      return nested;
    }
  }

  for (const nested of Object.values(record)) {
    const result = findEmbeddedSignupIds(nested);
    if (result) {
      return result;
    }
  }

  return null;
}

// Tolerante: exige waba_id, pero phone_number_id es opcional (para coexistencia).
export function parseEmbeddedSignupIds(rawValue: string): EmbeddedSignupIds {
  const normalizedRawValue = rawValue.trim();
  if (!normalizedRawValue) {
    throw new Error("Falta la respuesta de registro de la sesion para continuar.");
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(normalizedRawValue);
  } catch {
    throw new Error("La respuesta de registro de la sesion no tiene un JSON valido.");
  }

  const result = findEmbeddedSignupIds(parsedValue);
  if (!result) {
    throw new Error("No se encontro waba_id dentro de la respuesta de Meta.");
  }

  return result;
}

// Trae el primer numero registrado de una WABA. En coexistencia el evento no da el
// phone_number_id, asi que lo pedimos a Meta con el token recien intercambiado.
export async function fetchWabaFirstPhoneNumberId(input: {
  wabaId: string;
  accessToken: string;
}): Promise<string | null> {
  const url = new URL(`https://graph.facebook.com/v25.0/${encodeURIComponent(input.wabaId)}/phone_numbers`);
  url.searchParams.set("access_token", input.accessToken);

  const response = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | { data?: Array<{ id?: string }> }
    | null;

  if (!response.ok) {
    return null;
  }

  return payload?.data?.[0]?.id?.trim() || null;
}

export async function exchangeEmbeddedSignupCodeForAccessToken(input: {
  code: string;
  appId: string;
  appSecret: string;
}) {
  const url = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("code", input.code);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | ({
        access_token?: string;
        token_type?: string;
      } & MetaGraphErrorPayload)
    | null;

  if (!response.ok) {
    throw new Error(
      getMetaGraphErrorMessage(
        payload,
        "No se pudo cambiar el code de Embedded Signup por un access token.",
      ),
    );
  }

  const accessToken = payload?.access_token?.trim() || "";
  if (!accessToken) {
    throw new Error("Meta no devolvio un access token valido para este code.");
  }

  return {
    accessToken,
    tokenType: payload?.token_type?.trim() || null,
  };
}
