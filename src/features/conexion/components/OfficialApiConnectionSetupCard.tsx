"use client";

import { useRef, useState } from "react";
import { Eye, EyeOff, FlaskConical, Loader2 } from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type OfficialApiConnectionSetupCardProps = {
  channelId: string;
  appId: string;
  appSecret: string;
  initialAccessToken?: string;
  initialPhoneNumberId?: string;
  initialWabaId?: string;
  initialWebhookVerifyToken?: string;
  webhookCallbackUrl?: string;
};

export function OfficialApiConnectionSetupCard({
  channelId,
  appId,
  appSecret,
  initialAccessToken = "",
  initialPhoneNumberId = "",
  initialWabaId = "",
  initialWebhookVerifyToken = "",
  webhookCallbackUrl = "",
}: OfficialApiConnectionSetupCardProps) {
  const [showEmbeddedImport, setShowEmbeddedImport] = useState(false);
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [accessTokenTouched, setAccessTokenTouched] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const [officialApiForm, setOfficialApiForm] = useState({
    embeddedCode: "",
    sessionResponse: "",
    appId,
    appSecret,
    accessToken: "",
    phoneNumberId: initialPhoneNumberId,
    wabaId: initialWabaId,
    webhookVerifyToken: initialWebhookVerifyToken,
  });
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const redirectTimeoutRef = useRef<number | null>(null);

  const updateField = (field: keyof typeof officialApiForm, value: string) => {
    setOfficialApiForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleCopyCallbackUrl = async () => {
    if (!webhookCallbackUrl.trim()) {
      toast.error("No hay una URL de webhook para copiar.");
      return;
    }

    try {
      await navigator.clipboard.writeText(webhookCallbackUrl);
      setCopyFeedback("copied");
      window.setTimeout(() => setCopyFeedback("idle"), 1800);
    } catch {
      toast.error("No se pudo copiar la URL al portapapeles.");
    }
  };

  const handleImportFromMeta = async () => {
    if (!officialApiForm.sessionResponse.trim()) {
      toast.error("Pega primero la respuesta de registro de la sesion de Meta.");
      return;
    }

    setIsImporting(true);

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

      toast.success("Importamos el token y los IDs de Meta. Ahora ya puedes guardar la conexion.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo importar la configuracion de Meta.");
    } finally {
      setIsImporting(false);
    }
  };

  const getResolvedCredentials = () => {
    const resolvedAccessToken = officialApiForm.accessToken.trim() || initialAccessToken.trim();

    if (!resolvedAccessToken || !officialApiForm.phoneNumberId.trim() || !officialApiForm.wabaId.trim()) {
      toast.error("Completa el token de acceso, el Phone Number ID y el ID de la cuenta para continuar.");
      return null;
    }

    return {
      accessToken: resolvedAccessToken,
      phoneNumberId: officialApiForm.phoneNumberId.trim(),
      wabaId: officialApiForm.wabaId.trim(),
      webhookVerifyToken: officialApiForm.webhookVerifyToken.trim(),
    };
  };

  const handleTestApi = async () => {
    const resolvedCredentials = getResolvedCredentials();
    if (!resolvedCredentials) {
      return;
    }

    setIsTesting(true);

    try {
      const response = await fetch("/api/cliente/conexion/official-api/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessToken: resolvedCredentials.accessToken,
          phoneNumberId: resolvedCredentials.phoneNumberId,
          wabaId: resolvedCredentials.wabaId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "No se pudo probar la API oficial.");
      }

      toast.success(payload.message || "La API oficial responde correctamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo probar la API oficial.");
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const resolvedCredentials = getResolvedCredentials();
    if (!resolvedCredentials) {
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/cliente/conexion/official-api/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId,
          accessToken: resolvedCredentials.accessToken,
          phoneNumberId: resolvedCredentials.phoneNumberId,
          wabaId: resolvedCredentials.wabaId,
          webhookVerifyToken: resolvedCredentials.webhookVerifyToken,
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
        throw new Error(payload?.error || "No se pudo guardar la conexion oficial.");
      }

      toast.success("Conexion oficial guardada. Vamos a recargar esta pagina.");

      redirectTimeoutRef.current = window.setTimeout(() => {
        const params = new URLSearchParams();
        params.set("ok", "Canal+oficial+configurado");
        window.location.href = `/cliente/conexion/whatsapp-business/${payload.channelId}?${params.toString()}`;
      }, 700);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la conexion oficial.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Credenciales API</h2>
          <p className="text-sm text-muted-foreground">
            Ingresa tus credenciales de WhatsApp Business API de Meta.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Checkbox
            id="toggle-embedded-import-page"
            checked={showEmbeddedImport}
            onCheckedChange={(checked) => setShowEmbeddedImport(checked === true)}
          />
          <Label htmlFor="toggle-embedded-import-page">Importar desde Embedded Signup</Label>
        </div>

        {showEmbeddedImport ? (
          <Card className="min-w-0">
            <CardContent className="min-w-0 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="official-api-embedded-code-page">Code de registro insertado</Label>
                <Textarea
                  id="official-api-embedded-code-page"
                  className="min-w-0 [field-sizing:fixed]"
                  value={officialApiForm.embeddedCode}
                  onChange={(event) => updateField("embeddedCode", event.target.value)}
                  placeholder="AQJ..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="official-api-session-response-page">Respuesta de registro de la sesion</Label>
                <Textarea
                  id="official-api-session-response-page"
                  className="min-w-0 [field-sizing:fixed]"
                  value={officialApiForm.sessionResponse}
                  onChange={(event) => updateField("sessionResponse", event.target.value)}
                  placeholder='[{"data":{"phone_number_id":"...","waba_id":"...","business_id":"..."},"type":"WA_EMBEDDED_SIGNUP","event":"FINISH"}]'
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="official-api-provider-app-id-page">App ID del proveedor (opcional)</Label>
                  <Input
                    id="official-api-provider-app-id-page"
                    type="text"
                    value={officialApiForm.appId}
                    onChange={(event) => updateField("appId", event.target.value)}
                    placeholder="1096639035350984"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="official-api-provider-app-secret-page">App Secret del proveedor (opcional)</Label>
                  <Input
                    id="official-api-provider-app-secret-page"
                    type="password"
                    value={officialApiForm.appSecret}
                    onChange={(event) => updateField("appSecret", event.target.value)}
                    placeholder="Se usa solo si vas a cambiar el code por token"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleImportFromMeta}
                  disabled={isImporting || !officialApiForm.sessionResponse.trim()}
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Importando...
                    </>
                  ) : (
                    "Importar desde Meta"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="official-api-phone-number-id-page">Phone Number ID</Label>
            <Input
              id="official-api-phone-number-id-page"
              type="text"
              value={officialApiForm.phoneNumberId}
              onChange={(event) => updateField("phoneNumberId", event.target.value)}
              placeholder="1230794916781773"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="official-api-waba-id-page">ID de la cuenta de WhatsApp Business</Label>
            <Input
              id="official-api-waba-id-page"
              type="text"
              value={officialApiForm.wabaId}
              onChange={(event) => updateField("wabaId", event.target.value)}
              placeholder="1040209858511004"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="official-api-access-token-page">Token de acceso permanente</Label>
            <div className="relative">
              <Input
                id="official-api-access-token-page"
                type={showAccessToken ? "text" : "password"}
                value={officialApiForm.accessToken}
                onChange={(event) => {
                  setAccessTokenTouched(true);
                  updateField("accessToken", event.target.value);
                }}
                placeholder={initialAccessToken ? "••••••••••••••••••••" : "EAAP..."}
                className="pr-10"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowAccessToken((current) => !current)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={showAccessToken ? "Ocultar token" : "Mostrar token"}
              >
                {showAccessToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {initialAccessToken && !accessTokenTouched
                ? "El token actual esta oculto por seguridad. Escribelo de nuevo solo si deseas actualizarlo."
                : "Usa un token permanente de Meta con permisos para este numero."}
            </p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="official-api-webhook-verify-token-page">Webhook Verify Token</Label>
            <Input
              id="official-api-webhook-verify-token-page"
              type="text"
              value={officialApiForm.webhookVerifyToken}
              onChange={(event) => updateField("webhookVerifyToken", event.target.value)}
              placeholder="Crea un token de verificacion personalizado"
            />
            <p className="text-xs text-muted-foreground">
              Debe coincidir exactamente con el token que configures en el webhook de Meta.
            </p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="official-api-webhook-callback-url-page">Webhook Callback URL</Label>
            <div className="flex gap-2">
              <Input
                id="official-api-webhook-callback-url-page"
                type="text"
                value={webhookCallbackUrl}
                readOnly
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" onClick={handleCopyCallbackUrl} disabled={!webhookCallbackUrl.trim()}>
                {copyFeedback === "copied" ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pega esta URL en Facebook o Meta como callback del webhook.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestApi}
            disabled={
              isTesting ||
              isSaving ||
              !(officialApiForm.accessToken.trim() || initialAccessToken.trim()) ||
              !officialApiForm.phoneNumberId.trim() ||
              !officialApiForm.wabaId.trim()
            }
          >
            {isTesting ? (
              <>
                <Loader2 className="animate-spin" />
                Probando...
              </>
            ) : (
              <>
                <FlaskConical className="size-4" />
                Probar API
              </>
            )}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={
              isSaving ||
              isTesting ||
              !(officialApiForm.accessToken.trim() || initialAccessToken.trim()) ||
              !officialApiForm.phoneNumberId.trim() ||
              !officialApiForm.wabaId.trim()
            }
          >
            {isSaving ? (
              <>
                <Loader2 className="animate-spin" />
                Guardando...
              </>
            ) : (
              "Guardar conexion"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
