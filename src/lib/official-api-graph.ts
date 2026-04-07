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
