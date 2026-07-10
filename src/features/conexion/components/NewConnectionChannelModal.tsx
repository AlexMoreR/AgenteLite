"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CheckCircle2, Loader2, MessageCirclePlus, X } from "lucide-react";
import { createConnectionChannelAction } from "@/app/actions/connection-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
  const [coexistenceResult, setCoexistenceResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [isLaunchingCoexistence, setIsLaunchingCoexistence] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const metaCodeRef = useRef<string>("");
  const sessionResponseRef = useRef<string>("");
  const sdkReadyRef = useRef(false);
  const isSubmittingChannelRef = useRef(false);

  const closeModal = () => {
    setOpen(false);
    setSelectedProvider(null);
    setChannelName("");
    setCoexistenceResult(null);
    setIsLaunchingCoexistence(false);
    setIsCreatingChannel(false);
    metaCodeRef.current = "";
    sessionResponseRef.current = "";
    isSubmittingChannelRef.current = false;
  };

  const handleCreateChannelSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmittingChannelRef.current) {
      event.preventDefault();
      return;
    }

    isSubmittingChannelRef.current = true;
    setIsCreatingChannel(true);
  };

  const isBusy = isCreatingChannel || isLaunchingCoexistence;

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
        <Button type="button" variant="outline" onClick={() => setSelectedProvider(null)} disabled={isBusy}>
          Volver
        </Button>
        <Button
          type="button"
          onClick={handleLaunchCoexistence}
          disabled={isLaunchingCoexistence || !channelName.trim()}
        >
          {isLaunchingCoexistence ? (
            <>
              <Loader2 className="animate-spin" />
              Conectando con Meta...
            </>
          ) : (
            "Continuar con Meta"
          )}
        </Button>
      </>
    ) : (
      <>
        <Button type="button" variant="outline" onClick={() => setSelectedProvider(null)} disabled={isCreatingChannel}>
          Volver
        </Button>
        <Button type="submit" form="new-connection-channel-form" disabled={isCreatingChannel}>
          {isCreatingChannel ? (
            <>
              <Loader2 className="animate-spin" />
              Creando canal...
            </>
          ) : (
            "Crear canal"
          )}
        </Button>
      </>
    )
  ) : (
    <Button type="button" variant="outline" onClick={closeModal} disabled={isBusy}>
      Cerrar
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          if (isBusy) {
            return;
          }

          closeModal();
          return;
        }

        setOpen(true);
      }}
    >
      <DialogTrigger
        render={
          <Button type="button">
            <MessageCirclePlus />
            Nuevo canal
          </Button>
        }
      />

      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={!isBusy}
      >
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{selectedProvider ? "Ponle un nombre a tu canal" : "Nuevo canal"}</DialogTitle>
          <DialogDescription className="sr-only">
            {selectedProvider ? "Ponle un nombre a tu canal" : "Elige el tipo de conexion"}
          </DialogDescription>
          {targetAgent ? (
            <p className="text-sm font-medium text-primary">Se vinculara a {targetAgent.name}.</p>
          ) : null}
        </DialogHeader>

        <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {selectedProvider ? (
          selectedProvider === "OFFICIAL_API_COEXISTENCE" ? (
            <div className="min-w-0 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="coexistence-channel-name">Nombre del canal</Label>
                <Input
                  id="coexistence-channel-name"
                  name="name"
                  type="text"
                  required
                  autoFocus
                  value={channelName}
                  onChange={(event) => setChannelName(event.target.value)}
                  placeholder="Ej. WhatsApp administrativa coexistencia"
                />
              </div>

              <p className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
                Este flujo abrira el onboarding oficial de Meta para conectar una linea existente de WhatsApp Business App mediante coexistencia.
              </p>

              {coexistenceResult ? <ResultBanner result={coexistenceResult} /> : null}
            </div>
          ) : (
            <form
              id="new-connection-channel-form"
              action={createConnectionChannelAction}
              className="min-w-0 space-y-4"
              onSubmit={handleCreateChannelSubmit}
            >
              <input type="hidden" name="provider" value={selectedProvider} />
              {targetAgent ? <input type="hidden" name="agentId" value={targetAgent.id} /> : null}

              <div className="space-y-2">
                <Label htmlFor="channel-name">Nombre del canal</Label>
                <Input
                  id="channel-name"
                  name="name"
                  type="text"
                  required
                  autoFocus
                  disabled={isCreatingChannel}
                  placeholder={selectedProvider === "EVOLUTION" ? "Ej. WhatsApp ventas principal" : "Ej. WhatsApp oficial tienda"}
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
              icon={<WhatsAppGlyph className="size-8" />}
              onSelect={() => setSelectedProvider("EVOLUTION")}
            />

            <ChannelOptionCard
              title="WhatsApp API (Meta)"
              description=""
              cta={canSeeOfficialApiModule ? "Crear y configurar" : "Desactivado"}
              icon={<MetaGlyph className="size-8" />}
              disabled={!canSeeOfficialApiModule}
              onSelect={() => setSelectedProvider("OFFICIAL_API")}
            />

            <ChannelOptionCard
              title="API oficial coexistencia"
              description=""
              cta={canSeeOfficialApiModule && officialApiEmbeddedSignupReady ? "Continuar con Meta" : "Pendiente de configurar"}
              icon={<MetaGlyph className="size-8" />}
              disabled={!canSeeOfficialApiModule || !officialApiEmbeddedSignupReady}
              onSelect={() => setSelectedProvider("OFFICIAL_API_COEXISTENCE")}
            />
          </div>
        )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-muted/50 px-6 py-4">
          {footerActions}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultBanner({ result }: { result: { ok: boolean; message: string } }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 text-sm",
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {result.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <X className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{result.message}</span>
    </div>
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
    <Card
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "transition-colors",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/50",
      )}
    >
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <div className="text-[#16a34a]">{icon}</div>
        <div className="space-y-1">
          <h3 className="font-heading text-base font-medium">{title}</h3>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <span className={cn("text-sm font-medium", disabled ? "text-muted-foreground" : "text-primary")}>
          {cta}
        </span>
      </CardContent>
    </Card>
  );
}

function MetaGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="meta-glyph-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0064E0" />
          <stop offset="100%" stopColor="#0082FB" />
        </linearGradient>
      </defs>
      <path
        fill="url(#meta-glyph-gradient)"
        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.157-2.602zm-10.201.553c1.038 0 1.986.451 2.983 1.408.369.355.741.788 1.113 1.288a44.203 44.203 0 0 0-1.297 2.048l-.782 1.384c-1.203 2.132-1.463 2.606-1.907 3.19-.879 1.156-1.532 1.421-2.383 1.421-.916 0-1.463-.826-1.463-2.512 0-2.402.79-4.996 1.995-6.671.582-.813 1.245-1.354 1.732-1.354z"
      />
    </svg>
  );
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.05 4.94A9.9 9.9 0 0 0 12.02 2C6.51 2 2.02 6.48 2.02 12c0 1.76.46 3.48 1.33 5L2 22l5.15-1.34A9.95 9.95 0 0 0 12.02 22h.01c5.51 0 9.99-4.49 9.99-10 0-2.67-1.04-5.18-2.97-7.06Zm-7.03 15.38h-.01a8.3 8.3 0 0 1-4.23-1.16l-.3-.18-3.06.8.82-2.98-.2-.31a8.27 8.27 0 0 1-1.28-4.43c0-4.58 3.73-8.31 8.32-8.31 2.22 0 4.3.86 5.87 2.43a8.23 8.23 0 0 1 2.43 5.88c0 4.58-3.73 8.31-8.36 8.31Zm4.56-6.2c-.25-.12-1.47-.72-1.7-.8-.23-.08-.4-.12-.57.12-.17.25-.65.8-.8.96-.15.17-.3.19-.55.07-.25-.12-1.05-.39-2-1.24-.74-.66-1.24-1.47-1.39-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.24-.42.08-.17.04-.32-.02-.44-.06-.12-.57-1.37-.78-1.87-.2-.49-.4-.42-.57-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.23.9 2.43 1.02 2.59.12.17 1.77 2.7 4.29 3.78.6.26 1.08.42 1.44.53.61.19 1.17.16 1.61.1.49-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}
