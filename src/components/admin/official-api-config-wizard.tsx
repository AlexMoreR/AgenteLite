"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  KeyRound,
  ShieldCheck,
  Smartphone,
  Webhook,
  X,
} from "lucide-react";
import { adminUpdateOfficialApiConfigAction } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const OFFICIAL_API_WEBHOOK_PATH = "/api/webhooks/meta/official-api";

type OfficialApiWorkspaceConfig = {
  accessToken: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  webhookVerifyToken: string | null;
  appSecret: string | null;
  status: "NOT_CONNECTED" | "CONNECTED" | "ERROR";
  lastValidatedAt: Date | null;
} | null;

type WebhookStatusSnapshot = {
  status: "NOT_CONNECTED" | "CONNECTED" | "ERROR";
  lastValidatedAt: string | Date | null;
} | null;

type SubscriptionStatusSnapshot = {
  ok: boolean;
  subscribed: boolean;
  appId: string | null;
  error: string | null;
} | null;

type OfficialApiConfigWizardProps = {
  user: {
    id: string;
    name: string | null;
    email: string;
  };
  workspace: {
    id: string;
    name: string;
    officialApiConfig: OfficialApiWorkspaceConfig;
  } | null;
  onClose?: () => void;
  backHref?: string;
  presentation?: "modal" | "page";
  publicBaseUrl?: string;
  previewHref?: string;
  previewChatsHref?: string;
};

const steps = [
  {
    key: "fase-1",
    title: "Paso 1",
    description: "Datos del cliente.",
    icon: ShieldCheck,
  },
  {
    key: "fase-2",
    title: "Paso 2",
    description: "Conectar WhatsApp.",
    icon: Smartphone,
  },
  {
    key: "fase-3",
    title: "Paso 3",
    description: "Crear app.",
    icon: KeyRound,
  },
  {
    key: "fase-4",
    title: "Paso 4",
    description: "Probar",
    icon: CreditCard,
  },
  {
    key: "fase-5",
    title: "Paso 5",
    description: "Webhook y guardar.",
    icon: Webhook,
  },
] as const;

const metaChecklistSections = [
  {
    title: "Fase 1",
    heading: "Pedir datos al cliente",
    items: [
      "Acceso al Business Manager de Meta.",
      "Numero telefonico que no este usado en WhatsApp Business App.",
      "Correo administrador.",
      "Nombre de empresa.",
      "Logo y descripcion del negocio.",
      "El cliente debe contar con metodo de pago en Meta.",
    ],
  },
  {
    title: "Fase 2",
    heading: "Crear o conectar WhatsApp en Meta",
    items: [
      {
        text: "Ir a la pagina business.facebook.com.",
        href: "https://business.facebook.com/",
      },
      "Ir a Configuracion del negocio > Cuentas > Cuentas de WhatsApp.",
      "Crear nueva cuenta de WhatsApp Business.",
      "Guardar el WABA ID. En Meta tambien puede aparecer como Identificador.",
      "Ir a la pestana Numeros de telefono.",
      "Seleccionar si el numero sera nuevo o existente.",
      "Ingresar el numero de WhatsApp.",
      "Verificar con SMS o llamada.",
    ],
  },
  {
    title: "Fase 3",
    heading: "Crear app en Meta Developers",
    items: [
      {
        text: "Ir a la pagina developers.facebook.com.",
        href: "https://developers.facebook.com/",
      },
      "Crear una app tipo Business.",
      "Agregar el producto WhatsApp.",
      "Entrar a WhatsApp > Configuracion de la API (Empezar a usar la Api).",
      "Hacer clic en Generar token de acceso.",
      "Seleccionar la cuenta de WhatsApp Business y el numero conectado.",
      "Copiar y guardar el Access Token.",
      "Usar la seccion Enviar y recibir mensajes para hacer una prueba si hace falta.",
    ],
  },
  {
    title: "Fase 4",
    heading: "Probar",
    items: [
      "Probar POST /messages con el Phone Number ID.",
      "Enviar un texto de prueba con Bearer token.",
      "Antes de probar, manda primero un mensaje al numero oficial.",
      "Si funciona, el cliente queda listo del lado API.",
    ],
  },
] as const;

const webhookSaveSteps = [
  "Configurar Callback URL y Verify token.",
  "Agregar App secret",
  "Suscribir app al WABA.",
  "Revisar datos finales antes de guardar.",
] as const;

const OFFICIAL_API_WIZARD_DRAFT_KEY = "official-api-config-wizard:v1";
const DEFAULT_TEST_MESSAGE = "Hola, esta es una prueba desde la API oficial de WhatsApp.";

function renderChecklistItem(item: string | { text: string; href: string }) {
  if (typeof item === "string") {
    return item;
  }

  return (
    <>
      {item.text.replace(/ business\.facebook\.com\.| developers\.facebook\.com\./, "")}{" "}
      <Link
        href={item.href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-[var(--primary)] underline underline-offset-4"
      >
        {item.href.replace(/^https?:\/\//, "").replace(/\/$/, "")}
      </Link>
      .
    </>
  );
}

function renderChecklistSection(section?: (typeof metaChecklistSections)[number]) {
  if (!section) {
    return null;
  }

  return (
    <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-5">
      <p className="text-base font-semibold text-slate-900">{section.heading}</p>
      <div className="mt-4 grid gap-2.5">
        {section.items.map((item, index) => (
          <div
            key={typeof item === "string" ? item : item.text}
            className="flex items-start gap-3 text-sm leading-6 text-slate-700"
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
              {index + 1}
            </span>
            <span>{renderChecklistItem(item)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type StepKey = (typeof steps)[number]["key"];

type FormState = {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  webhookVerifyToken: string;
  appSecret: string;
  registrationPin: string;
};

function getInitialFormState(workspace: OfficialApiConfigWizardProps["workspace"]): FormState {
  return {
    accessToken: workspace?.officialApiConfig?.accessToken ?? "",
    phoneNumberId: workspace?.officialApiConfig?.phoneNumberId ?? "",
    wabaId: workspace?.officialApiConfig?.wabaId ?? "",
    webhookVerifyToken: workspace?.officialApiConfig?.webhookVerifyToken ?? "",
    appSecret: workspace?.officialApiConfig?.appSecret ?? "",
    registrationPin: "",
  };
}

function clampStepIndex(value: number) {
  return Math.max(0, Math.min(steps.length - 1, value));
}

function getSavedProgressStep(
  form: FormState,
  officialApiConfig: OfficialApiWorkspaceConfig,
) {
  const hasPhoneIds = form.phoneNumberId.trim().length > 0 || form.wabaId.trim().length > 0;
  const hasStep2Ready =
    form.phoneNumberId.trim().length > 0 && form.wabaId.trim().length > 0;
  const hasAccessToken = form.accessToken.trim().length > 0;
  const hasAllCredentials = hasStep2Ready && hasAccessToken;
  const hasWebhookData =
    form.webhookVerifyToken.trim().length > 0 ||
    form.appSecret.trim().length > 0 ||
    officialApiConfig?.status === "CONNECTED";

  if (hasWebhookData) {
    return 4;
  }

  if (hasAllCredentials) {
    return 3;
  }

  if (hasAccessToken || hasStep2Ready) {
    return 2;
  }

  if (hasPhoneIds) {
    return 1;
  }

  return 0;
}

function getCompletedSteps(
  currentStep: number,
  form: FormState,
  officialApiConfig: OfficialApiWorkspaceConfig,
) {
  const completed = new Set<number>();
  const savedProgressStep = getSavedProgressStep(form, officialApiConfig);
  const visualProgressStep = Math.max(currentStep, savedProgressStep);

  for (let index = 0; index < visualProgressStep; index += 1) {
    completed.add(index);
  }

  if (
    form.phoneNumberId.trim().length > 0 &&
    form.wabaId.trim().length > 0
  ) {
    completed.add(1);
  }

  if (form.accessToken.trim().length > 0) {
    completed.add(2);
  }

  if (
    form.accessToken.trim().length > 0 &&
    form.phoneNumberId.trim().length > 0 &&
    form.wabaId.trim().length > 0
  ) {
    completed.add(3);
    completed.add(4);
  }

  if (
    form.webhookVerifyToken.trim().length > 0 ||
    form.appSecret.trim().length > 0 ||
    officialApiConfig?.status === "CONNECTED"
  ) {
    completed.add(4);
  }

  return completed;
}

export function OfficialApiConfigWizard({
  user,
  workspace,
  onClose,
  backHref,
  presentation = "modal",
  publicBaseUrl = "",
  previewHref,
  previewChatsHref,
}: OfficialApiConfigWizardProps) {
  const [currentStep, setCurrentStep] = React.useState(0);
  const [form, setForm] = React.useState<FormState>(() => getInitialFormState(workspace));
  const [testRecipient, setTestRecipient] = React.useState("");
  const [testMessage, setTestMessage] = React.useState(DEFAULT_TEST_MESSAGE);
  const [callbackUrl, setCallbackUrl] = React.useState("");
  const [isTestingMessage, setIsTestingMessage] = React.useState(false);
  const [isRegisteringPhone, setIsRegisteringPhone] = React.useState(false);
  const [hasHydratedDraft, setHasHydratedDraft] = React.useState(false);
  const [webhookStatus, setWebhookStatus] = React.useState<WebhookStatusSnapshot>(
    workspace?.officialApiConfig
      ? {
          status: workspace.officialApiConfig.status,
          lastValidatedAt: workspace.officialApiConfig.lastValidatedAt,
        }
      : null,
  );
  const [subscriptionStatus, setSubscriptionStatus] = React.useState<SubscriptionStatusSnapshot>(null);
  const [isLoadingSubscriptionStatus, setIsLoadingSubscriptionStatus] = React.useState(false);
  const [isSubscribingApp, setIsSubscribingApp] = React.useState(false);
  const [testMessageResult, setTestMessageResult] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [registerPhoneResult, setRegisterPhoneResult] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const draftStorageKey = workspace
    ? `${OFFICIAL_API_WIZARD_DRAFT_KEY}:${user.id}:${workspace.id}`
    : `${OFFICIAL_API_WIZARD_DRAFT_KEY}:${user.id}:no-workspace`;
  const effectiveOfficialApiConfig = React.useMemo(
    () => {
      if (!workspace?.officialApiConfig && !webhookStatus) {
        return null;
      }

      const rawValidatedAt = webhookStatus?.lastValidatedAt ?? workspace?.officialApiConfig?.lastValidatedAt ?? null;
      const normalizedValidatedAt =
        rawValidatedAt instanceof Date
          ? rawValidatedAt
          : rawValidatedAt
            ? new Date(rawValidatedAt)
            : null;

      return {
        accessToken: workspace?.officialApiConfig?.accessToken ?? null,
        phoneNumberId: workspace?.officialApiConfig?.phoneNumberId ?? null,
        wabaId: workspace?.officialApiConfig?.wabaId ?? null,
        webhookVerifyToken: workspace?.officialApiConfig?.webhookVerifyToken ?? null,
        appSecret: workspace?.officialApiConfig?.appSecret ?? null,
        status: webhookStatus?.status ?? workspace?.officialApiConfig?.status ?? "NOT_CONNECTED",
        lastValidatedAt:
          normalizedValidatedAt && !Number.isNaN(normalizedValidatedAt.getTime())
            ? normalizedValidatedAt
            : null,
      };
    },
    [webhookStatus, workspace?.officialApiConfig],
  );
  const completedSteps = React.useMemo(
    () => getCompletedSteps(currentStep, form, effectiveOfficialApiConfig),
    [currentStep, effectiveOfficialApiConfig, form],
  );
  const webhookVerifiedLabel = React.useMemo(() => {
    const validatedAt = effectiveOfficialApiConfig?.lastValidatedAt;
    if (!validatedAt) {
      return "";
    }

    const parsedDate = validatedAt instanceof Date ? validatedAt : new Date(validatedAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(parsedDate);
  }, [effectiveOfficialApiConfig?.lastValidatedAt]);

  React.useEffect(() => {
    setWebhookStatus(
      workspace?.officialApiConfig
        ? {
            status: workspace.officialApiConfig.status,
            lastValidatedAt: workspace.officialApiConfig.lastValidatedAt,
          }
        : null,
    );
  }, [workspace?.officialApiConfig]);

  React.useEffect(() => {
    const normalizedBaseUrl = publicBaseUrl.trim().replace(/\/+$/, "");
    if (normalizedBaseUrl) {
      setCallbackUrl(`${normalizedBaseUrl}${OFFICIAL_API_WEBHOOK_PATH}`);
      return;
    }

    if (typeof window !== "undefined") {
      setCallbackUrl(`${window.location.origin}${OFFICIAL_API_WEBHOOK_PATH}`);
    }
  }, [publicBaseUrl]);

  React.useEffect(() => {
    const nextForm = getInitialFormState(workspace);
    let nextStep = getSavedProgressStep(nextForm, workspace?.officialApiConfig ?? null);
    let nextRecipient = "";
    let nextMessage = DEFAULT_TEST_MESSAGE;

    setHasHydratedDraft(false);

    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(draftStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            currentStep?: number;
            form?: Partial<FormState>;
            testRecipient?: string;
            testMessage?: string;
          };

          if (parsed.form) {
            nextForm.accessToken = parsed.form.accessToken ?? nextForm.accessToken;
            nextForm.phoneNumberId = parsed.form.phoneNumberId ?? nextForm.phoneNumberId;
            nextForm.wabaId = parsed.form.wabaId ?? nextForm.wabaId;
            nextForm.webhookVerifyToken =
              parsed.form.webhookVerifyToken ?? nextForm.webhookVerifyToken;
            nextForm.appSecret = parsed.form.appSecret ?? nextForm.appSecret;
            nextForm.registrationPin = parsed.form.registrationPin ?? nextForm.registrationPin;
          }

          if (typeof parsed.testRecipient === "string") {
            nextRecipient = parsed.testRecipient;
          }

          if (typeof parsed.testMessage === "string" && parsed.testMessage.trim()) {
            nextMessage = parsed.testMessage;
          }

          if (typeof parsed.currentStep === "number") {
            nextStep = clampStepIndex(
              Math.max(
                parsed.currentStep,
                getSavedProgressStep(nextForm, workspace?.officialApiConfig ?? null),
              ),
            );
          } else {
            nextStep = getSavedProgressStep(nextForm, workspace?.officialApiConfig ?? null);
          }
        }
      } catch {
        // Ignore malformed drafts and keep current server-loaded values.
      }
    }

    setCurrentStep(nextStep);
    setForm(nextForm);
    setTestRecipient(nextRecipient);
    setTestMessage(nextMessage);
    setTestMessageResult(null);
    setRegisterPhoneResult(null);
    setHasHydratedDraft(true);
  }, [draftStorageKey, user.id, workspace]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !workspace || !hasHydratedDraft) {
      return;
    }

    window.localStorage.setItem(
      draftStorageKey,
      JSON.stringify({
        currentStep,
        form,
        testRecipient,
        testMessage,
      }),
    );
  }, [currentStep, draftStorageKey, form, hasHydratedDraft, testMessage, testRecipient, workspace]);

  React.useEffect(() => {
    if (
      currentStep !== 4 ||
      effectiveOfficialApiConfig?.lastValidatedAt ||
      !workspace?.id ||
      !form.webhookVerifyToken.trim()
    ) {
      return;
    }

    let cancelled = false;

    const syncWebhookStatus = async () => {
      try {
        const response = await fetch(
          `/api/admin/official-api/webhook-status?workspaceId=${encodeURIComponent(workspace.id)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              config?: WebhookStatusSnapshot;
            }
          | null;

        if (!response.ok || !payload?.ok || cancelled) {
          return;
        }

        if (payload.config) {
          setWebhookStatus(payload.config);
        }
      } catch {
        // Ignore transient polling errors while waiting for Meta verification.
      }
    };

    void syncWebhookStatus();

    const intervalId = window.setInterval(() => {
      void syncWebhookStatus();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentStep, effectiveOfficialApiConfig?.lastValidatedAt, form.webhookVerifyToken, workspace?.id]);

  React.useEffect(() => {
    if (
      currentStep !== 4 ||
      !workspace?.id ||
      !form.wabaId.trim() ||
      !form.accessToken.trim()
    ) {
      return;
    }

    let cancelled = false;

    const syncSubscriptionStatus = async () => {
      setIsLoadingSubscriptionStatus(true);

      try {
        const response = await fetch(
          `/api/admin/official-api/subscribed-app?workspaceId=${encodeURIComponent(workspace.id)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const payload = (await response.json().catch(() => null)) as SubscriptionStatusSnapshot;

        if (cancelled || !payload) {
          return;
        }

        setSubscriptionStatus(payload);
      } catch {
        if (!cancelled) {
          setSubscriptionStatus({
            ok: false,
            subscribed: false,
            appId: null,
            error: "No se pudo consultar la suscripcion actual de la app al WABA.",
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSubscriptionStatus(false);
        }
      }
    };

    void syncSubscriptionStatus();

    return () => {
      cancelled = true;
    };
  }, [currentStep, form.accessToken, form.wabaId, workspace?.id]);

  const updateField =
    (field: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    };

  const isCredentialStepValid =
    form.accessToken.trim().length > 0 &&
    form.phoneNumberId.trim().length > 0 &&
    form.wabaId.trim().length > 0;
  const isPhoneSetupStepValid =
    form.phoneNumberId.trim().length > 0 &&
    form.wabaId.trim().length > 0;
  const isAccessTokenStepValid = form.accessToken.trim().length > 0;

  const canGoNext = (() => {
    const key = steps[currentStep]?.key satisfies StepKey;
    if (key === "fase-2") {
      return isPhoneSetupStepValid;
    }
    if (key === "fase-3") {
      return isAccessTokenStepValid;
    }
    if (key === "fase-4") {
      return isCredentialStepValid;
    }
    return currentStep < steps.length - 1;
  })();

  const nextStep = () => {
    setCurrentStep((value) => Math.min(steps.length - 1, value + 1));
  };

  const previousStep = () => {
    setCurrentStep((value) => Math.max(0, value - 1));
  };

  const handleSendTestMessage = async () => {
    if (!workspace) {
      return;
    }

    setIsTestingMessage(true);
    setTestMessageResult(null);

    try {
      const response = await fetch("/api/admin/official-api/test-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          accessToken: form.accessToken,
          phoneNumberId: form.phoneNumberId,
          recipient: testRecipient,
          message: testMessage,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            recipient?: string;
            messageId?: string | null;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "No se pudo enviar el mensaje de prueba.");
      }

      setTestMessageResult({
        ok: true,
        message: payload.messageId
          ? `Meta acepto la solicitud para ${payload.recipient}. ID: ${payload.messageId}. Esto no confirma entrega en WhatsApp todavia.`
          : `Meta acepto la solicitud para ${payload.recipient}. Esto no confirma entrega en WhatsApp todavia.`,
      });
    } catch (error) {
      setTestMessageResult({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo enviar el mensaje de prueba.",
      });
    } finally {
      setIsTestingMessage(false);
    }
  };

  const handleRegisterPhone = async () => {
    setIsRegisteringPhone(true);
    setRegisterPhoneResult(null);

    try {
      const response = await fetch("/api/admin/official-api/register-phone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessToken: form.accessToken,
          phoneNumberId: form.phoneNumberId,
          pin: form.registrationPin,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "No se pudo registrar el numero.");
      }

      setRegisterPhoneResult({
        ok: true,
        message: "Numero registrado correctamente en la API oficial.",
      });
    } catch (error) {
      setRegisterPhoneResult({
        ok: false,
        message:
          error instanceof Error ? error.message : "No se pudo registrar el numero.",
      });
    } finally {
      setIsRegisteringPhone(false);
    }
  };

  const handleSubscribeApp = async () => {
    if (!workspace) {
      return;
    }

    setIsSubscribingApp(true);

    try {
      const response = await fetch("/api/admin/official-api/subscribed-app", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          accessToken: form.accessToken,
          wabaId: form.wabaId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as SubscriptionStatusSnapshot;

      if (!response.ok || !payload) {
        throw new Error(payload?.error || "No se pudo suscribir la app al WABA.");
      }

      setSubscriptionStatus(payload);
    } catch (error) {
      setSubscriptionStatus({
        ok: false,
        subscribed: false,
        appId: null,
        error: error instanceof Error ? error.message : "No se pudo suscribir la app al WABA.",
      });
    } finally {
      setIsSubscribingApp(false);
    }
  };

  const isModal = presentation === "modal";

  if (!workspace) {
    return (
      <div
        className={
          isModal
            ? "fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4 py-6 backdrop-blur-[2px]"
            : "w-full"
        }
        onClick={isModal ? onClose : undefined}
      >
        <div
          className={`saas-card w-full overflow-hidden rounded-[1.6rem] p-0 ${
            isModal ? "max-w-2xl shadow-[0_24px_80px_-40px_rgba(15,23,42,0.28)]" : ""
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-[var(--line)] bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Configuracion por cliente
                </p>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">
                  Configurar api oficial WhatsApp
                </h2>
              </div>
              {backHref && !isModal ? (
                <Link
                  href={backHref}
                  className="rounded-full border border-[var(--line)] p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                  aria-label="Volver"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              ) : onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-[var(--line)] p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="p-6">
            <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Este cliente aun no tiene un negocio principal creado. Primero debe existir el workspace del cliente para configurar la API oficial.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        isModal
          ? "fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4 py-6 backdrop-blur-[2px]"
          : "w-full"
      }
      onClick={isModal ? onClose : undefined}
    >
        <div
          className={`saas-card w-full overflow-hidden rounded-[1.8rem] p-0 ${
            isModal ? "max-w-6xl shadow-[0_24px_80px_-40px_rgba(15,23,42,0.28)]" : ""
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-[var(--line)] bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="shrink-0">
                {backHref && !isModal ? (
                  <Link
                    href={backHref}
                    className="rounded-full border border-[var(--line)] p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                    aria-label="Volver"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                ) : onClose ? (
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full border border-[var(--line)] p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                    aria-label="Cerrar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                  {steps.map((step, index) => {
                    const Icon = step.icon;
                    const isActive = index === currentStep;
                    const isDone = completedSteps.has(index) && !isActive;

                    return (
                      <div
                        key={step.key}
                        className={`rounded-[1.15rem] border px-4 py-3 transition ${
                          isActive
                            ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_8%,white)]"
                            : isDone
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-[var(--line)] bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                              isActive
                                ? "bg-[var(--primary)] text-white"
                                : isDone
                                  ? "bg-emerald-600 text-white"
                                  : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                            <p className="truncate text-[11px] text-slate-500">{step.description}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>
          </div>
          <form
          action={adminUpdateOfficialApiConfigAction}
          className={isModal ? "max-h-[calc(100vh-9rem)] overflow-y-auto" : ""}
        >
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="accessToken" value={form.accessToken} />
        <input type="hidden" name="phoneNumberId" value={form.phoneNumberId} />
        <input type="hidden" name="wabaId" value={form.wabaId} />
        <input type="hidden" name="webhookVerifyToken" value={form.webhookVerifyToken} />
        <input type="hidden" name="appSecret" value={form.appSecret} />
        <input
          type="hidden"
          name="returnTo"
          value={
            !isModal && backHref
              ? `${backHref.replace(/\/$/, "")}/${user.id}/api-oficial?ok=API+oficial+de+WhatsApp+actualizada`
              : ""
          }
        />

          <div className="p-6">
            {currentStep === 0 ? (
              <div className="space-y-4">
                {renderChecklistSection(metaChecklistSections[0])}
              </div>
            ) : null}

            {currentStep === 1 ? (
              <div className="space-y-4">
                <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-5">
                  <p className="text-base font-semibold text-slate-900">
                    {metaChecklistSections[1]?.heading}
                  </p>

                  <div className="mt-4 grid gap-2.5">
                    {metaChecklistSections[1]?.items.map((item, index) => (
                      <div key={typeof item === "string" ? item : item.text} className="space-y-3">
                        {index !== 3 ? (
                          <div className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                              {index < 3 ? index + 1 : index}
                            </span>
                            <span>{renderChecklistItem(item)}</span>
                          </div>
                        ) : null}

                        {index === 3 ? (
                          <div className="ml-8">
                            <label className="block space-y-1.5">
                              <Input
                                value={form.wabaId}
                                onChange={updateField("wabaId")}
                                className="h-11 rounded-xl"
                                placeholder="Guardar el WABA ID. En Meta tambien puede aparecer como Identificador."
                              />
                            </label>
                          </div>
                        ) : null}

                        {index === 7 ? (
                          <div className="ml-8">
                            <label className="block space-y-1.5">
                              <Input
                                value={form.phoneNumberId}
                                onChange={updateField("phoneNumberId")}
                                className="h-11 rounded-xl"
                                placeholder="Copia y pega el identificador del numero de whatsapp"
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {currentStep === 2 ? (
              <div className="space-y-4">
                <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-5">
                  <p className="text-base font-semibold text-slate-900">
                    {metaChecklistSections[2]?.heading}
                  </p>

                  <div className="mt-4 grid gap-2.5">
                    {metaChecklistSections[2]?.items.map((item, index) => (
                      <div key={typeof item === "string" ? item : item.text} className="space-y-3">
                        <div className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                            {index + 1}
                          </span>
                          <span>{renderChecklistItem(item)}</span>
                        </div>

                        {index === 6 ? (
                          <div className="ml-8">
                            <textarea
                              rows={6}
                              value={form.accessToken}
                              onChange={updateField("accessToken")}
                              className="w-full rounded-[20px] border border-[var(--line)] bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[var(--primary)]"
                              placeholder="EAAG..."
                            />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-5">
                  <p className="text-base font-semibold text-slate-900">
                    {metaChecklistSections[3]?.heading}
                  </p>

                  <div className="mt-4 grid gap-2.5">
                    {metaChecklistSections[3]?.items.map((item, index) => (
                      <div key={`${index}-${item}`} className="space-y-3">
                        <div className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                            {index + 1}
                          </span>
                          <span>{renderChecklistItem(item)}</span>
                        </div>

                        {index === 2 ? (
                          <div className="ml-8 grid gap-4">
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                              <label className="block space-y-1.5">
                                <Input
                                  value={form.registrationPin}
                                  onChange={updateField("registrationPin")}
                                  className="h-11 rounded-xl"
                                  placeholder="Si configuraste verificacion en dos pasos para el numero, pon aqui el PIN."
                                />
                              </label>

                              <Button
                                type="button"
                                className="h-11 rounded-xl px-4"
                                onClick={handleRegisterPhone}
                                disabled={
                                  isRegisteringPhone ||
                                  !form.accessToken.trim() ||
                                  !form.phoneNumberId.trim()
                                }
                              >
                                {isRegisteringPhone ? "Registrando..." : "Registrar"}
                              </Button>
                            </div>

                            {registerPhoneResult ? (
                              <div
                                className={`rounded-[1.25rem] border p-4 text-sm ${
                                  registerPhoneResult.ok
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-rose-200 bg-rose-50 text-rose-800"
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  {registerPhoneResult.ok ? (
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                                  ) : (
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                  )}
                                  <span>{registerPhoneResult.message}</span>
                                </div>
                              </div>
                            ) : null}

                            <label className="block space-y-1.5">
                              <Input
                                value={testRecipient}
                                onChange={(event) => setTestRecipient(event.target.value)}
                                className="h-11 rounded-xl"
                                placeholder="Ingresa el numero al que vamos enviar el mensaje de prueba."
                              />
                            </label>

                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                              <label className="block space-y-1.5">
                                <span className="text-sm font-medium text-slate-700">Mensaje de prueba</span>
                                <Input
                                  value={testMessage}
                                  onChange={(event) => setTestMessage(event.target.value)}
                                  className="h-11 rounded-xl"
                                  placeholder="Escribe el mensaje de prueba"
                                />
                              </label>

                              <Button
                                type="button"
                                className="h-11 rounded-xl px-4"
                                onClick={handleSendTestMessage}
                                disabled={
                                  isTestingMessage ||
                                  !form.accessToken.trim() ||
                                  !form.phoneNumberId.trim() ||
                                  !form.wabaId.trim() ||
                                  !testRecipient.trim() ||
                                  !testMessage.trim()
                                }
                              >
                                {isTestingMessage ? "Probando..." : "Probar envio"}
                              </Button>
                            </div>

                            {!form.accessToken.trim() || !form.phoneNumberId.trim() || !form.wabaId.trim() ? (
                              <span className="text-xs text-amber-700">
                                Completa primero Access Token, Phone Number ID y WABA ID.
                              </span>
                            ) : null}

                            {testMessageResult ? (
                              <div
                                className={`rounded-[1.25rem] border p-4 text-sm ${
                                  testMessageResult.ok
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-rose-200 bg-rose-50 text-rose-800"
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  {testMessageResult.ok ? (
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                                  ) : (
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                  )}
                                  <span>{testMessageResult.message}</span>
                                </div>
                              </div>
                            ) : null}

                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-slate-700">Access token</span>
                              <textarea
                                rows={6}
                                value={form.accessToken}
                                onChange={updateField("accessToken")}
                                className="w-full rounded-[20px] border border-[var(--line)] bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[var(--primary)]"
                                placeholder="EAAG..."
                              />
                            </label>

                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="block space-y-1.5">
                                <span className="text-sm font-medium text-slate-700">Phone number id</span>
                                <Input
                                  value={form.phoneNumberId}
                                  onChange={updateField("phoneNumberId")}
                                  className="h-11 rounded-xl"
                                  placeholder="123456789012345"
                                />
                              </label>

                              <label className="block space-y-1.5">
                                <span className="text-sm font-medium text-slate-700">WABA id</span>
                                <Input
                                  value={form.wabaId}
                                  onChange={updateField("wabaId")}
                                  className="h-11 rounded-xl"
                                  placeholder="987654321098765"
                                />
                              </label>
                            </div>

                            {!isCredentialStepValid ? (
                              <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                                Para continuar, completa access token, phone number id y WABA id.
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            ) : null}

            {currentStep === 4 ? (
              <div className="space-y-4">
                <div className="grid gap-5">
                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <p className="text-base font-semibold text-slate-900">Webhook y guardar</p>
                      {effectiveOfficialApiConfig?.lastValidatedAt ? (
                        <div className="inline-flex w-full items-start gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 md:w-auto md:max-w-[32rem]">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            Webhook verificado por Meta.
                            {webhookVerifiedLabel ? ` ${webhookVerifiedLabel}` : ""}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-2.5">
                      {webhookSaveSteps.map((item, index) => (
                        <div key={item} className="space-y-3">
                          <div className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                              {index + 1}
                            </span>
                            <span>{item}</span>
                          </div>

                          {index === 0 ? (
                            <div className="ml-8 grid gap-4 md:grid-cols-2">
                              <label className="block space-y-1.5">
                                <Input
                                  value={callbackUrl}
                                  readOnly
                                  className="h-11 rounded-xl bg-slate-50"
                                  placeholder="https://tu-dominio.com/api/webhooks/meta/official-api"
                                />
                              </label>

                              <label className="block space-y-1.5">
                                <Input
                                  value={form.webhookVerifyToken}
                                  onChange={updateField("webhookVerifyToken")}
                                  className="h-11 rounded-xl"
                                  placeholder="meta-webhook-verzay-2026"
                                />
                              </label>
                            </div>
                          ) : null}

                          {index === 1 ? (
                            <div className="ml-8">
                              <label className="block space-y-1.5">
                                <Input
                                  value={form.appSecret}
                                  onChange={updateField("appSecret")}
                                  className="h-11 rounded-xl"
                                  placeholder="App secret"
                                />
                              </label>
                            </div>
                          ) : null}

                          {index === 2 ? (
                            <div className="ml-8 rounded-[1rem] border border-[var(--line)] bg-white p-4">
                              <div className="flex justify-end">

                                <Button
                                  type="button"
                                  variant={subscriptionStatus?.subscribed ? "outline" : "default"}
                                  className={`h-10 rounded-xl px-4 ${
                                    subscriptionStatus?.subscribed
                                      ? "border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)]"
                                      : ""
                                  }`}
                                  onClick={handleSubscribeApp}
                                  disabled={
                                    isSubscribingApp ||
                                    !form.accessToken.trim() ||
                                    !form.wabaId.trim()
                                  }
                                >
                                  {isSubscribingApp
                                    ? "Suscribiendo..."
                                    : subscriptionStatus?.subscribed
                                      ? "Reintentar suscripcion"
                                      : "Suscribir app al WABA"}
                                </Button>
                              </div>

                              <div className="mt-4 grid gap-3 text-sm">
                                <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 text-slate-700">
                                  <div className="flex items-start gap-3">
                                    {subscriptionStatus?.subscribed ? (
                                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                    ) : subscriptionStatus?.error ? (
                                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                                    ) : (
                                      <Webhook className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                                    )}
                                    <div className="space-y-1">
                                      <p className="font-medium text-slate-900">
                                        {isLoadingSubscriptionStatus
                                          ? "Consultando suscripcion actual..."
                                          : subscriptionStatus?.subscribed
                                            ? "La app suscrita al WABA."
                                            : "La suscripcion confirmada."}
                                      </p>
                                      {subscriptionStatus?.appId ? (
                                        <p className="text-slate-600">App ID detectado en Meta: {subscriptionStatus.appId}</p>
                                      ) : null}
                                      {subscriptionStatus?.error ? (
                                        <p className="text-rose-700">{subscriptionStatus.error}</p>
                                      ) : null}
                                      {!subscriptionStatus?.subscribed && !subscriptionStatus?.error ? (
                                        <p className="text-slate-600">
                                          Si los mensajes reales no llegan, revisa esta suscripcion.
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {index === 3 ? (
                            <div className="ml-8 rounded-[1rem] border border-[var(--line)] bg-white p-4">
                              <p className="text-sm font-semibold text-slate-900">Datos a guardar</p>
                              <div className="mt-4 grid gap-3 md:grid-cols-2">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Access token</p>
                                  <p className="mt-1 text-sm text-slate-700">
                                    {form.accessToken.trim() ? `${form.accessToken.trim().slice(0, 10)}...` : "No definido"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Phone number id</p>
                                  <p className="mt-1 text-sm text-slate-700">{form.phoneNumberId.trim() || "No definido"}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">WABA id</p>
                                  <p className="mt-1 text-sm text-slate-700">{form.wabaId.trim() || "No definido"}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Webhook verify token</p>
                                  <p className="mt-1 text-sm text-slate-700">{form.webhookVerifyToken.trim() || "Opcional / vacio"}</p>
                                </div>
                                <div className="md:col-span-2">
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">App secret</p>
                                  <p className="mt-1 text-sm text-slate-700">{form.appSecret.trim() || "Opcional / vacio"}</p>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {currentStep === 4 && (previewHref || previewChatsHref) ? (
              <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                {previewHref ? (
                  <Button asChild variant="outline" className="rounded-xl">
                    <Link href={previewHref}>Vista previa</Link>
                  </Button>
                ) : null}
                {previewChatsHref ? (
                  <Button asChild variant="outline" className="rounded-xl">
                    <Link href={previewChatsHref}>Vista previa chats</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--line)] bg-white px-6 py-5 md:flex-row md:items-center md:justify-between">
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-xl px-4"
              onClick={currentStep === 0 ? onClose : previousStep}
              asChild={Boolean(currentStep === 0 && backHref && !isModal)}
            >
              {currentStep === 0 && backHref && !isModal ? (
                <Link href={backHref}>
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Volver
                </Link>
              ) : (
                <>
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  {currentStep === 0 ? "Cancelar" : "Anterior"}
                </>
              )}
            </Button>

            <div className="flex items-center gap-2 self-end md:self-auto">
              {currentStep < steps.length - 1 ? (
                <Button
                  type="button"
                  className="h-10 rounded-xl px-4"
                  onClick={nextStep}
                  disabled={!canGoNext}
                >
                  Siguiente
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button type="submit" className="h-10 rounded-xl px-4">
                  Guardar configuracion
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
