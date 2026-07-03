"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Loader2, MessageCirclePlus, X } from "lucide-react";
import { createConnectionChannelAction } from "@/app/actions/connection-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ConnectionProvider = "EVOLUTION" | "OFFICIAL_API" | "OFFICIAL_API_COEXISTENCE";

declare global {
  interface Window {
    FB?: {
      init: (params: Record<string, unknown>) => void;
      login: (
        callback: (response: {
          status?: string;
          authResponse?: {
            code?: string;
          };
        }) => void,
        options?: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type EmbeddedSignupFinishPayload = {
  data?: {
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
  };
  type?: string;
  event?: string;
};

type NewConnectionChannelModalProps = {
  canSeeOfficialApiModule: boolean;
  officialApiEmbeddedSignupReady: boolean;
  officialApiProviderAppId: string;
  officialApiProviderConfigId: string;
  targetAgent?: {
    id: string;
    name: string;
  } | null;
};

export function NewConnectionChannelModal({
  canSeeOfficialApiModule,
  officialApiEmbeddedSignupReady,
  officialApiProviderAppId,
  officialApiProviderConfigId,
  targetAgent,
}: NewConnectionChannelModalProps) {
  const [open, setOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ConnectionProvider | null>(null);
  const [channelName, setChannelName] = useState("");
  const [officialApiForm, setOfficialApiForm] = useState({
    embeddedCode: "",
    sessionResponse: "",
    appId: "",
    appSecret: "",
    accessToken: "",
    phoneNumberId: "",
    wabaId: "",
  });
  const [coexistenceResult, setCoexistenceResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [officialApiResult, setOfficialApiResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [isLaunchingCoexistence, setIsLaunchingCoexistence] = useState(false);
  const [isSavingOfficialApi, setIsSavingOfficialApi] = useState(false);
  const [isImportingOfficialApi, setIsImportingOfficialApi] = useState(false);
  const metaCodeRef = useRef<string>("");
  const sessionResponseRef = useRef<string>("");
  const sdkReadyRef = useRef(false);

  const closeModal = () => {
    setOpen(false);
    setSelectedProvider(null);
    setChannelName("");
    setCoexistenceResult(null);
    setOfficialApiResult(null);
    setIsLaunchingCoexistence(false);
    setIsSavingOfficialApi(false);
    setIsImportingOfficialApi(false);
    setOfficialApiForm({
      embeddedCode: "",
      sessionResponse: "",
      appId: "",
      appSecret: "",
      accessToken: "",
      phoneNumberId: "",
      wabaId: "",
    });
    metaCodeRef.current = "";
    sessionResponseRef.current = "";
  };

  useEffect(() => {
    if (!open || selectedProvider !== "OFFICIAL_API_COEXISTENCE" || !officialApiProviderAppId.trim()) {
      return;
    }

    if (sdkReadyRef.current && window.FB) {
      return;
    }

    let cancelled = false;
    const existingScript = document.getElementById("facebook-jssdk");

    window.fbAsyncInit = () => {
      if (cancelled || !window.FB) {
        return;
      }

      window.FB.init({
        appId: officialApiProviderAppId,
        autoLogAppEvents: true,
        xfbml: false,
        version: "v25.0",
      });

      sdkReadyRef.current = true;
    };

    if (!existingScript) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(script);
    } else if (window.FB && !sdkReadyRef.current) {
      window.fbAsyncInit?.();
    }

    return () => {
      cancelled = true;
    };
  }, [officialApiProviderAppId, open, selectedProvider]);

  useEffect(() => {
    if (!open || selectedProvider !== "OFFICIAL_API_COEXISTENCE") {
      return;
    }

    const onMessage = (event: MessageEvent) => {
      if (!event.origin.includes("facebook.com")) {
        return;
      }

      let payload: unknown = event.data;

      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload) as EmbeddedSignupFinishPayload;
        } catch {
          return;
        }
      }

      if (!payload || typeof payload !== "object") {
        return;
      }

      const message = payload as EmbeddedSignupFinishPayload;
      if (message.type !== "WA_EMBEDDED_SIGNUP" || message.event !== "FINISH") {
        return;
      }

      sessionResponseRef.current = JSON.stringify([message]);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, selectedProvider]);

  const updateOfficialApiField = (field: keyof typeof officialApiForm, value: string) => {
    setOfficialApiForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleImportOfficialApiFromMeta = async () => {
    if (!officialApiForm.sessionResponse.trim()) {
      setOfficialApiResult({
        ok: false,
        message: "Pega primero la respuesta de registro de la sesion de Meta.",
      });
      return;
    }

    setIsImportingOfficialApi(true);
    setOfficialApiResult(null);

    try {
      const response = await fetch("/api/cliente/conexion/official-api/import-embedded-signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: officialApiForm.embeddedCode,
          sessionResponse: officialApiForm.sessionResponse,
          accessToken: officialApiForm.accessToken,
          appId: officialApiForm.appId,
          appSecret: officialApiForm.appSecret,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            accessToken?: string;
            phoneNumberId?: string;
            wabaId?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "No se pudo importar la configuracion desde Meta.");
      }

      setOfficialApiForm((current) => ({
        ...current,
        accessToken: payload.accessToken || current.accessToken,
        phoneNumberId: payload.phoneNumberId || current.phoneNumberId,
        wabaId: payload.wabaId || current.wabaId,
      }));

      setOfficialApiResult({
        ok: true,
        message: "Importamos el token y los IDs de Meta. Ahora ya puedes guardar el canal oficial.",
      });
    } catch (error) {
      setOfficialApiResult({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo importar la configuracion de Meta.",
      });
    } finally {
      setIsImportingOfficialApi(false);
    }
  };

  const handleCreateOfficialApiChannel = async () => {
    if (!channelName.trim()) {
      setOfficialApiResult({
        ok: false,
        message: "Escribe primero el nombre del canal.",
      });
      return;
    }

    if (!officialApiForm.accessToken.trim() || !officialApiForm.phoneNumberId.trim() || !officialApiForm.wabaId.trim()) {
      setOfficialApiResult({
        ok: false,
        message: "Completa access token, phone number ID y WABA ID para continuar.",
      });
      return;
    }

    setIsSavingOfficialApi(true);
    setOfficialApiResult(null);

    try {
      const response = await fetch("/api/cliente/conexion/official-api/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: channelName,
          accessToken: officialApiForm.accessToken,
          phoneNumberId: officialApiForm.phoneNumberId,
          wabaId: officialApiForm.wabaId,
          agentId: targetAgent?.id,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            channelId?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.channelId) {
        throw new Error(payload?.error || "No se pudo guardar la API oficial.");
      }

      setOfficialApiResult({
        ok: true,
        message: "API oficial guardada y canal creado. Vamos a abrir Chats con el nuevo canal listo.",
      });

      window.setTimeout(() => {
        const params = new URLSearchParams();
        params.set("ok", targetAgent ? "Canal+oficial+creado+y+vinculado" : "Canal+oficial+creado");
        params.set("connection", `channel:${payload.channelId}`);
        window.location.href = `/cliente/chats?${params.toString()}`;
      }, 800);
    } catch (error) {
      setOfficialApiResult({
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo crear el canal oficial.",
      });
    } finally {
      setIsSavingOfficialApi(false);
    }
  };

  const handleLaunchCoexistence = async () => {
    if (!channelName.trim()) {
      setCoexistenceResult({
        ok: false,
        message: "Escribe primero el nombre del canal.",
      });
      return;
    }

    if (!officialApiProviderAppId.trim() || !officialApiProviderConfigId.trim()) {
      setCoexistenceResult({
        ok: false,
        message: "Falta configurar app_id o config_id del Embedded Signup en el servidor.",
      });
      return;
    }

    if (!window.FB || !sdkReadyRef.current) {
      setCoexistenceResult({
        ok: false,
        message: "El SDK de Meta todavia no esta listo. Espera unos segundos e intentalo otra vez.",
      });
      return;
    }

    setIsLaunchingCoexistence(true);
    setCoexistenceResult(null);
    metaCodeRef.current = "";
    sessionResponseRef.current = "";

    try {
      const code = await new Promise<string>((resolve, reject) => {
        window.FB?.login(
          (response) => {
            const embeddedSignupCode = response.authResponse?.code?.trim();

            if (!embeddedSignupCode) {
              reject(new Error("Meta no devolvio un code valido al finalizar el onboarding."));
              return;
            }

            resolve(embeddedSignupCode);
          },
          {
            config_id: officialApiProviderConfigId,
            response_type: "code",
            override_default_response_type: true,
            extras: {
              sessionInfoVersion: "3",
              featureType: "whatsapp_business_app_onboarding",
              version: "v4",
            },
          },
        );
      });

      metaCodeRef.current = code;

      const waitedSessionResponse = await new Promise<string>((resolve, reject) => {
        const startedAt = Date.now();
        const intervalId = window.setInterval(() => {
          if (sessionResponseRef.current.trim()) {
            window.clearInterval(intervalId);
            resolve(sessionResponseRef.current.trim());
            return;
          }

          if (Date.now() - startedAt > 15000) {
            window.clearInterval(intervalId);
            reject(new Error("Meta no envio la respuesta de sesion del onboarding. Intenta nuevamente."));
          }
        }, 250);
      });

      const response = await fetch("/api/cliente/conexion/official-api/coexistence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: channelName,
          code,
          sessionResponse: waitedSessionResponse,
          agentId: targetAgent?.id,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            channelId?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.channelId) {
        throw new Error(payload?.error || "No se pudo crear la conexion oficial en coexistencia.");
      }

      setCoexistenceResult({
        ok: true,
        message: "Coexistencia oficial creada. Vamos a abrir Chats con el nuevo canal listo.",
      });

      window.setTimeout(() => {
        const params = new URLSearchParams();
        params.set("ok", targetAgent ? "Canal+oficial+coexistente+creado+y+vinculado" : "Canal+oficial+coexistente+creado");
        params.set("connection", `channel:${payload.channelId}`);
        window.location.href = `/cliente/chats?${params.toString()}`;
      }, 800);
    } catch (error) {
      setCoexistenceResult({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo completar el onboarding de coexistencia.",
      });
    } finally {
      setIsLaunchingCoexistence(false);
    }
  };

  const footerActions = selectedProvider ? (
    selectedProvider === "OFFICIAL_API_COEXISTENCE" ? (
      <>
        <button
          type="button"
          onClick={() => setSelectedProvider(null)}
          className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          Volver
        </button>
        <button
          type="button"
          onClick={handleLaunchCoexistence}
          disabled={isLaunchingCoexistence || !channelName.trim()}
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isLaunchingCoexistence ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Conectando con Meta...
            </>
          ) : (
            "Continuar con Meta"
          )}
        </button>
      </>
    ) : selectedProvider === "OFFICIAL_API" ? (
      <>
        <button
          type="button"
          onClick={() => setSelectedProvider(null)}
          className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          Volver
        </button>
        <button
          type="button"
          onClick={handleCreateOfficialApiChannel}
          disabled={
            isSavingOfficialApi ||
            !channelName.trim() ||
            !officialApiForm.accessToken.trim() ||
            !officialApiForm.phoneNumberId.trim() ||
            !officialApiForm.wabaId.trim()
          }
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSavingOfficialApi ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando API oficial...
            </>
          ) : (
            "Guardar y crear canal"
          )}
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          onClick={() => setSelectedProvider(null)}
          className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          Volver
        </button>
        <button
          type="submit"
          form="new-connection-channel-form"
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
        >
          Crear canal
        </button>
      </>
    )
  ) : (
    <button
      type="button"
      onClick={closeModal}
      className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
    >
      Cerrar
    </button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeModal();
          return;
        }

        setOpen(true);
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white shadow-[0_16px_30px_-18px_rgba(37,99,235,0.45)] transition hover:translate-y-[-1px] hover:bg-[var(--primary-strong)]"
          />
        }
      >
        <MessageCirclePlus className="h-4 w-4" />
        Nuevo canal
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-[2rem] border border-[rgba(148,163,184,0.16)] bg-white p-0 text-left shadow-[0_32px_80px_-32px_rgba(15,23,42,0.45)] sm:max-w-2xl"
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b border-[rgba(148,163,184,0.14)] bg-white px-6 py-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Nuevo canal</p>
            <DialogTitle className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">
              {selectedProvider ? "Ponle un nombre a tu canal" : "Elige el tipo de conexion"}
            </DialogTitle>
            <DialogDescription className="max-w-2xl text-sm leading-6 text-slate-600">
              {selectedProvider === "EVOLUTION"
                ? "Escribe el nombre del canal. Al crear, se generara QR para conectar tu linea de whatsapp."
                : selectedProvider === "OFFICIAL_API_COEXISTENCE"
                  ? "Escribe el nombre del canal y continua con Meta para conectar una linea existente de WhatsApp Business App por coexistencia oficial."
                  : selectedProvider === "OFFICIAL_API"
                    ? "Configura el canal oficial en este mismo modal con los datos de Meta, sin pasar por administracion."
                    : "Selecciona el proveedor del canal que quieres crear."}
            </DialogDescription>
            {targetAgent ? (
              <p className="text-sm font-medium text-[var(--primary)]">Se vinculara a {targetAgent.name}.</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={closeModal}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] text-slate-500 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
            aria-label="Cerrar modal"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {selectedProvider ? (
              selectedProvider === "OFFICIAL_API_COEXISTENCE" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="coexistence-channel-name" className="text-sm font-medium text-slate-700">
                      Nombre del canal
                    </label>
                    <input
                      id="coexistence-channel-name"
                      name="name"
                      type="text"
                      required
                      autoFocus
                      value={channelName}
                      onChange={(event) => setChannelName(event.target.value)}
                      placeholder="Ej. WhatsApp administrativa coexistencia"
                      className="h-12 w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                    />
                  </div>

                  <div className="rounded-[24px] border border-[var(--line)] bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
                    Este flujo abrira el onboarding oficial de Meta para conectar una linea existente de WhatsApp Business App mediante coexistencia.
                  </div>

                  {coexistenceResult ? (
                    <div
                      className={`rounded-[24px] border px-4 py-4 text-sm ${
                        coexistenceResult.ok
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-rose-200 bg-rose-50 text-rose-800"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {coexistenceResult.ok ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <X className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <span>{coexistenceResult.message}</span>
                      </div>
                    </div>
                  ) : null}

                </div>
              ) : selectedProvider === "OFFICIAL_API" ? (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label htmlFor="official-api-channel-name" className="text-sm font-medium text-slate-700">
                      Nombre del canal
                    </label>
                    <input
                      id="official-api-channel-name"
                      name="name"
                      type="text"
                      required
                      autoFocus
                      value={channelName}
                      onChange={(event) => setChannelName(event.target.value)}
                      placeholder="Ej. WhatsApp oficial principal"
                      className="h-12 w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                    />
                  </div>

                  <div className="rounded-[24px] border border-[var(--line)] bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
                    Completa aqui mismo la configuracion de Meta para dejar activa la API oficial en el workspace y crear el canal sin pasar por administracion.
                  </div>

                  <div className="rounded-[24px] border border-[rgba(148,163,184,0.18)] bg-white p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-900">Importar desde Embedded Signup</h3>
                      <p className="text-sm leading-6 text-slate-600">
                        Si Meta ya te devolvio el code y la respuesta de sesion, pegalos aqui y llenamos el token y los IDs automaticamente.
                      </p>
                    </div>

                    <div className="mt-4 grid gap-4">
                      <div className="space-y-2">
                        <label htmlFor="official-api-embedded-code" className="text-sm font-medium text-slate-700">
                          Code de registro insertado
                        </label>
                        <textarea
                          id="official-api-embedded-code"
                          value={officialApiForm.embeddedCode}
                          onChange={(event) => updateOfficialApiField("embeddedCode", event.target.value)}
                          placeholder="AQJ..."
                          className="min-h-[92px] w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                        />
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="official-api-session-response" className="text-sm font-medium text-slate-700">
                          Respuesta de registro de la sesion
                        </label>
                        <textarea
                          id="official-api-session-response"
                          value={officialApiForm.sessionResponse}
                          onChange={(event) => updateOfficialApiField("sessionResponse", event.target.value)}
                          placeholder='[{"data":{"phone_number_id":"...","waba_id":"...","business_id":"..."},"type":"WA_EMBEDDED_SIGNUP","event":"FINISH"}]'
                          className="min-h-[120px] w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                        />
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label htmlFor="official-api-provider-app-id" className="text-sm font-medium text-slate-700">
                            App ID del proveedor (opcional)
                          </label>
                          <input
                            id="official-api-provider-app-id"
                            type="text"
                            value={officialApiForm.appId}
                            onChange={(event) => updateOfficialApiField("appId", event.target.value)}
                            placeholder="1096639035350984"
                            className="h-12 w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                          />
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="official-api-provider-app-secret" className="text-sm font-medium text-slate-700">
                            App Secret del proveedor (opcional)
                          </label>
                          <input
                            id="official-api-provider-app-secret"
                            type="password"
                            value={officialApiForm.appSecret}
                            onChange={(event) => updateOfficialApiField("appSecret", event.target.value)}
                            placeholder="Se usa solo si vas a cambiar el code por token"
                            className="h-12 w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleImportOfficialApiFromMeta}
                          disabled={isImportingOfficialApi || !officialApiForm.sessionResponse.trim()}
                          className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isImportingOfficialApi ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Importando...
                            </>
                          ) : (
                            "Importar desde Meta"
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <label htmlFor="official-api-access-token" className="text-sm font-medium text-slate-700">
                        Access token de Meta
                      </label>
                      <textarea
                        id="official-api-access-token"
                        value={officialApiForm.accessToken}
                        onChange={(event) => updateOfficialApiField("accessToken", event.target.value)}
                        placeholder="EAAP..."
                        className="min-h-[110px] w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                      />
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="official-api-phone-number-id" className="text-sm font-medium text-slate-700">
                        Phone Number ID
                      </label>
                      <input
                        id="official-api-phone-number-id"
                        type="text"
                        value={officialApiForm.phoneNumberId}
                        onChange={(event) => updateOfficialApiField("phoneNumberId", event.target.value)}
                        placeholder="1230794916781773"
                        className="h-12 w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                      />
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="official-api-waba-id" className="text-sm font-medium text-slate-700">
                        WABA ID
                      </label>
                      <input
                        id="official-api-waba-id"
                        type="text"
                        value={officialApiForm.wabaId}
                        onChange={(event) => updateOfficialApiField("wabaId", event.target.value)}
                        placeholder="1040209858511004"
                        className="h-12 w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                      />
                    </div>
                  </div>

                  {officialApiResult ? (
                    <div
                      className={`rounded-[24px] border px-4 py-4 text-sm ${
                        officialApiResult.ok
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-rose-200 bg-rose-50 text-rose-800"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {officialApiResult.ok ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <X className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <span>{officialApiResult.message}</span>
                      </div>
                    </div>
                  ) : null}

                </div>
              ) : (
              <form id="new-connection-channel-form" action={createConnectionChannelAction} className="space-y-4">
                <input type="hidden" name="provider" value={selectedProvider} />
                {targetAgent ? <input type="hidden" name="agentId" value={targetAgent.id} /> : null}

                <div className="space-y-2">
                  <label htmlFor="channel-name" className="text-sm font-medium text-slate-700">
                    Nombre del canal
                  </label>
                  <input
                    id="channel-name"
                    name="name"
                    type="text"
                    required
                    autoFocus
                    placeholder={selectedProvider === "EVOLUTION" ? "Ej. WhatsApp ventas principal" : "Ej. WhatsApp oficial tienda"}
                    className="h-12 w-full rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_12%,white)]"
                  />
                </div>
              </form>
              )
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <ChannelOptionCard
              title="WhatsApp QR Code"
              description=""
              cta="Empezar ahora"
              icon={<WhatsAppGlyph className="h-8 w-8" />}
              onSelect={() => setSelectedProvider("EVOLUTION")}
            />

            <ChannelOptionCard
              title="WhatsApp API (Meta)"
              description=""
              cta={canSeeOfficialApiModule ? "Configurar y crear" : "Desactivado"}
              icon={<WhatsAppGlyph className="h-8 w-8" />}
              disabled={!canSeeOfficialApiModule}
              onSelect={() => setSelectedProvider("OFFICIAL_API")}
            />

            <ChannelOptionCard
              title="API oficial coexistencia"
              description="Abre el onboarding oficial de Meta para conectar una linea existente de WhatsApp Business App."
              cta={canSeeOfficialApiModule && officialApiEmbeddedSignupReady ? "Continuar con Meta" : "Pendiente de configurar"}
              icon={<WhatsAppGlyph className="h-8 w-8" />}
              disabled={!canSeeOfficialApiModule || !officialApiEmbeddedSignupReady}
              onSelect={() => setSelectedProvider("OFFICIAL_API_COEXISTENCE")}
            />
          </div>
        )}
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-[rgba(148,163,184,0.14)] bg-white px-6 py-4">
          {footerActions}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChannelOptionCard({
  title,
  description,
  cta,
  icon,
  disabled = false,
  onSelect,
}: {
  title: string;
  description: string;
  cta: string;
  icon: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
        className={`group relative overflow-hidden rounded-[26px] border p-4 text-left transition ${
        disabled
          ? "cursor-not-allowed border-[rgba(148,163,184,0.16)] bg-slate-50/80 opacity-80"
          : "border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)] hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-42px_rgba(15,23,42,0.18)]"
      }`}
    >
      <ChannelOptionContent title={title} description={description} cta={cta} icon={icon} disabled={disabled} />
    </button>
  );
}

function ChannelOptionContent({
  title,
  description,
  cta,
  icon,
  disabled = false,
}: {
  title: string;
  description: string;
  cta: string;
  icon: ReactNode;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.06),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.05),transparent_28%)]" />

        <div className="relative flex h-full flex-col items-center gap-3 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,#22c55e_14%,white)] text-[#16a34a]">
            {icon}
          </div>

          <div className="space-y-1.5">
            <h3 className="text-[1.02rem] font-semibold tracking-[-0.04em] text-slate-950">{title}</h3>
            <p className="text-sm leading-5 text-slate-600">{description}</p>
          </div>

          <div className={`mt-auto text-sm font-medium ${disabled ? "text-slate-500" : "text-[var(--primary)]"}`}>{cta}</div>
        </div>
    </>
  );
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.05 4.94A9.9 9.9 0 0 0 12.02 2C6.51 2 2.02 6.48 2.02 12c0 1.76.46 3.48 1.33 5L2 22l5.15-1.34A9.95 9.95 0 0 0 12.02 22h.01c5.51 0 9.99-4.49 9.99-10 0-2.67-1.04-5.18-2.97-7.06Zm-7.03 15.38h-.01a8.3 8.3 0 0 1-4.23-1.16l-.3-.18-3.06.8.82-2.98-.2-.31a8.27 8.27 0 0 1-1.28-4.43c0-4.58 3.73-8.31 8.32-8.31 2.22 0 4.3.86 5.87 2.43a8.23 8.23 0 0 1 2.43 5.88c0 4.58-3.73 8.31-8.36 8.31Zm4.56-6.2c-.25-.12-1.47-.72-1.7-.8-.23-.08-.4-.12-.57.12-.17.25-.65.8-.8.96-.15.17-.3.19-.55.07-.25-.12-1.05-.39-2-1.24-.74-.66-1.24-1.47-1.39-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.24-.42.08-.17.04-.32-.02-.44-.06-.12-.57-1.37-.78-1.87-.2-.49-.4-.42-.57-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.23.9 2.43 1.02 2.59.12.17 1.77 2.7 4.29 3.78.6.26 1.08.42 1.44.53.61.19 1.17.16 1.61.1.49-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}
