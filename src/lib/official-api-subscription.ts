import {
  getMetaGraphErrorMessage,
  isMetaGraphAuthError,
  type MetaGraphErrorPayload,
} from "@/lib/official-api-graph";

type MetaGraphSuccess<T> = {
  data?: T;
  success?: boolean;
};

export type OfficialApiSubscriptionStatus = {
  ok: boolean;
  subscribed: boolean;
  appId: string | null;
  error: string | null;
  authError: boolean;
};

function buildGraphUrl(pathname: string, accessToken: string) {
  const url = new URL(`https://graph.facebook.com/v25.0/${pathname}`);
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

export async function getOfficialApiSubscribedAppStatus(input: {
  wabaId: string;
  accessToken: string;
}): Promise<OfficialApiSubscriptionStatus> {
  const response = await fetch(buildGraphUrl(`${input.wabaId}/subscribed_apps`, input.accessToken), {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | (MetaGraphSuccess<Array<{ whatsapp_business_api_data?: { id?: string } }>> & MetaGraphErrorPayload)
    | null;

  if (!response.ok) {
    return {
      ok: false,
      subscribed: false,
      appId: null,
      error: getMetaGraphErrorMessage(payload, "No se pudo consultar la suscripcion de la app al WABA."),
      authError: isMetaGraphAuthError(payload),
    };
  }

  const appId = payload?.data?.[0]?.whatsapp_business_api_data?.id?.trim() || null;

  return {
    ok: true,
    subscribed: Boolean(appId),
    appId,
    error: null,
    authError: false,
  };
}

export async function subscribeOfficialApiAppToWaba(input: {
  wabaId: string;
  accessToken: string;
}): Promise<OfficialApiSubscriptionStatus> {
  const response = await fetch(buildGraphUrl(`${input.wabaId}/subscribed_apps`, input.accessToken), {
    method: "POST",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | (MetaGraphSuccess<Array<{ whatsapp_business_api_data?: { id?: string } }>> & MetaGraphErrorPayload)
    | null;

  if (!response.ok) {
    return {
      ok: false,
      subscribed: false,
      appId: null,
      error: getMetaGraphErrorMessage(payload, "No se pudo suscribir la app al WABA."),
      authError: isMetaGraphAuthError(payload),
    };
  }

  const appId = payload?.data?.[0]?.whatsapp_business_api_data?.id?.trim() || null;

  return {
    ok: true,
    subscribed: true,
    appId,
    error: null,
    authError: false,
  };
}
