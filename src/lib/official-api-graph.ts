type MetaGraphErrorDetails = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
};

export type MetaGraphErrorPayload = {
  error?: MetaGraphErrorDetails;
};

export function getMetaGraphErrorMessage(
  payload: MetaGraphErrorPayload | null,
  fallback: string,
) {
  return payload?.error?.message?.trim() || fallback;
}

// El App Secret de Meta es un hash de 32 caracteres hex. Validamos el formato para no
// activar la verificacion de firma HMAC del webhook con un secret invalido (un placeholder
// haria que se rechacen TODOS los mensajes entrantes con 401).
export function isValidMetaAppSecret(value: string | null | undefined): boolean {
  return /^[a-f0-9]{32}$/i.test(value?.trim() ?? "");
}

export function normalizeMetaAppSecret(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return isValidMetaAppSecret(trimmed) ? trimmed : "";
}

export function isMetaGraphAuthError(payload: MetaGraphErrorPayload | null) {
  const code = payload?.error?.code;
  const message = payload?.error?.message?.toLowerCase() ?? "";

  return (
    code === 190 ||
    message.includes("invalid access token") ||
    message.includes("session is invalid") ||
    message.includes("user logged out")
  );
}
