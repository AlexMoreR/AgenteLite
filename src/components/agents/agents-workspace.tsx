"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  ChevronRight,
  LoaderCircle,
  MessageSquareMore,
  MoreHorizontal,
  Plus,
  QrCode,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { createAgentAction, deleteAgentAction, toggleAgentStatusAction } from "@/app/actions/agent-actions";
import { resetWorkspaceAction } from "@/app/actions/workspace-actions";
import {
  forbiddenRuleOptions,
  getResponseLengthLabel,
  getResponseLengthFromValue,
  targetAudienceOptions,
  toneOptions,
} from "@/lib/agent-training";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type AgentCard = {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  welcomeMessage: string | null;
  updatedAtLabel: string;
  channelCount: number;
};

type AgentsWorkspaceProps = {
  hasWorkspace: boolean;
  businessName?: string;
  agents: AgentCard[];
};

const steps = [
  {
    title: "Tu negocio",
    subtitle: "Ensenale al agente que vendes, para quien y en que rango se mueve tu oferta.",
  },
  {
    title: "Como habla",
    subtitle: "Define el tono, la longitud y los pequenos detalles que hacen que suene como tu negocio.",
  },
  {
    title: "Como cierra ventas",
    subtitle: "Activa el comportamiento comercial que quieres ver en la conversacion.",
  },
  {
    title: "Reglas importantes",
    subtitle: "Marca lo que nunca debe hacer y deja listo el siguiente paso con WhatsApp.",
  },
] as const;

const statusLabelMap = {
  DRAFT: "Borrador",
  ACTIVE: "Activo",
  PAUSED: "Pausado",
  ARCHIVED: "Archivado",
} as const;

const statusToneMap = {
  DRAFT: "bg-amber-50 text-amber-700 ring-amber-200",
  ACTIVE: "bg-emerald-500 text-white ring-emerald-500 shadow-[0_10px_24px_-18px_rgba(16,185,129,0.8)]",
  PAUSED: "bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)] ring-slate-200",
  ARCHIVED: "bg-rose-50 text-rose-700 ring-rose-200",
} as const;

function ProgressDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <span
      className={`h-2 rounded-full transition-all ${
        active
          ? "w-9 bg-[var(--primary)] shadow-[0_8px_18px_-10px_color-mix(in_srgb,var(--primary)_65%,black)]"
          : done
            ? "w-4 bg-[color-mix(in_srgb,var(--primary)_58%,white)]"
            : "w-4 bg-slate-200"
      }`}
    />
  );
}

function StepFrame({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--primary)]">{eyebrow}</p>
        <h3 className="text-[1.9rem] font-semibold tracking-[-0.05em] text-slate-950">{title}</h3>
        <p className="max-w-2xl text-sm leading-6 text-slate-600">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function MultiSelectChip({
  name,
  value,
  label,
  defaultChecked = false,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="cursor-pointer">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="peer sr-only" />
      <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition peer-checked:border-[var(--primary)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_8%,white)] peer-checked:text-[var(--primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[color-mix(in_srgb,var(--primary)_24%,white)]">
        {label}
      </span>
    </label>
  );
}

function ToneCard({
  value,
  title,
  description,
  defaultChecked,
}: {
  value: string;
  title: string;
  description: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="block cursor-pointer">
      <input type="radio" name="salesTone" value={value} defaultChecked={defaultChecked} className="peer sr-only" />
      <span className="flex min-h-[124px] flex-col justify-between rounded-[24px] border border-[rgba(148,163,184,0.16)] bg-[linear-gradient(180deg,#ffffff_0%,#fcfcfd_100%)] p-5 transition peer-checked:border-[var(--primary)] peer-checked:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_6%,white)_0%,white_100%)] peer-checked:shadow-[0_18px_40px_-28px_color-mix(in_srgb,var(--primary)_45%,black)] hover:-translate-y-0.5 hover:border-[var(--primary)]/30">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
          <Sparkles className="h-5 w-5" />
        </span>
        <span className="block space-y-1.5">
          <span className="block text-base font-semibold tracking-[-0.03em] text-slate-950">{title}</span>
          <span className="block text-sm leading-6 text-slate-600">{description}</span>
        </span>
      </span>
    </label>
  );
}

function ToggleRow({
  name,
  title,
  description,
  defaultChecked = false,
}: {
  name: string;
  title: string;
  description: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-14 items-center justify-between gap-4 rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-white px-4 py-3">
      <span className="space-y-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-sm leading-6 text-slate-600">{description}</span>
      </span>
      <span className="relative shrink-0">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
        <span className="inline-flex h-7 w-12 rounded-full bg-slate-300 transition peer-checked:bg-[var(--primary)]">
          <span className="mt-0.5 ml-0.5 h-6 w-6 rounded-full bg-white shadow-[0_2px_10px_-4px_rgba(15,23,42,0.45)] transition peer-checked:translate-x-5" />
        </span>
      </span>
    </label>
  );
}

export function AgentsWorkspace({ hasWorkspace, businessName, agents }: AgentsWorkspaceProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<AgentCard | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [responseLengthValue, setResponseLengthValue] = useState(50);
  const formRef = useRef<HTMLFormElement>(null);

  const openCreateFlow = () => {
    setStep(0);
    setIsSubmitting(false);
    setResponseLengthValue(50);
    setModalOpen(true);
  };

  const nextStep = () => setStep((current) => Math.min(current + 1, steps.length - 1));
  const previousStep = () => setStep((current) => Math.max(current - 1, 0));
  const closeModal = () => {
    setIsSubmitting(false);
    setModalOpen(false);
  };
  const submitCreateFlow = () => {
    setIsSubmitting(true);
    formRef.current?.requestSubmit();
  };

  const responseLengthLabel = getResponseLengthLabel(getResponseLengthFromValue(responseLengthValue));

  return (
    <>
      <div className="space-y-6">
        {agents.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                    <Bot className="h-5 w-5" />
                  </span>
                  <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">Agentes creados</h2>
                </div>
                <p className="text-sm text-slate-600">Administra tus agentes desde un solo lugar.</p>
              </div>
              <button
                type="button"
                onClick={openCreateFlow}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                <Plus className="h-4 w-4" />
                Crear agente
              </button>
            </div>

            <div className="space-y-3">
              {agents.map((agent) => (
                <Card
                  key={agent.id}
                  className="border border-[rgba(148,163,184,0.14)] bg-white p-0 transition hover:border-[var(--primary)]/30 hover:shadow-[0_16px_40px_-32px_rgba(15,23,42,0.18)]"
                >
                  <div className="flex items-center gap-3">
                    <Link href={`/cliente/agentes/${agent.id}`} className="flex min-w-0 flex-1 items-center gap-4 px-5 py-4">
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                        <Bot className="h-5 w-5" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">{agent.name}</h3>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${statusToneMap[agent.status]}`}
                          >
                            {statusLabelMap[agent.status]}
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                            <MessageSquareMore className="h-3.5 w-3.5" />
                            WhatsApp
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-600">
                          {agent.description || "Aun no tiene descripcion comercial."}
                        </p>
                      </div>

                      <div className="hidden shrink-0 items-center gap-8 lg:flex">
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Ultimo ajuste</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{agent.updatedAtLabel}</p>
                        </div>
                      </div>
                    </Link>

                    <div className="flex shrink-0 items-center gap-2 pr-4">
                      <form action={toggleAgentStatusAction}>
                        <input type="hidden" name="agentId" value={agent.id} />
                        <button
                          type="submit"
                          className="inline-flex h-7 items-center justify-center bg-transparent p-0 transition hover:opacity-90"
                          aria-label={agent.status === "ACTIVE" ? `Apagar ${agent.name}` : `Encender ${agent.name}`}
                        >
                          <span
                            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition ${
                              agent.status === "ACTIVE" ? "bg-emerald-500/90" : "bg-slate-300"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-[0_2px_10px_-4px_rgba(15,23,42,0.45)] transition-transform ${
                                agent.status === "ACTIVE" ? "translate-x-5" : "translate-x-0.5"
                              }`}
                            />
                          </span>
                        </button>
                      </form>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.16)] bg-white text-slate-600 transition hover:bg-slate-50"
                            aria-label={`Acciones para ${agent.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => setPendingDelete(agent)}
                            className="flex items-center gap-2 text-rose-600 focus:text-rose-700"
                          >
                            <Trash2 className="h-4 w-4" />
                            Eliminar agente
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <Card className="border border-[rgba(148,163,184,0.14)] bg-white px-6 py-10 text-center">
            <div className="mx-auto max-w-md space-y-4">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                <Bot className="h-6 w-6" />
              </span>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                  {hasWorkspace ? "Tu negocio ya puede entrenar su agente." : "Crea tu primer agente para vender mejor."}
                </h2>
                <p className="text-sm leading-6 text-slate-600">
                  {hasWorkspace
                    ? `Vamos a usar ${businessName || "tu negocio"} como base para ensenarle al agente como atender.`
                    : "Responde unas preguntas rapidas y nosotros convertimos eso en instrucciones internas para el agente."}
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateFlow}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                <Plus className="h-4 w-4" />
                Crear agente
              </button>
            </div>
          </Card>
        )}
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#0f172a80] p-0 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Crear agente"
          onClick={closeModal}
        >
          <div
            className="flex h-full w-full max-w-[980px] flex-col overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,#fdfdfd_0%,#ffffff_100%)] md:max-h-[92vh] md:rounded-[32px] md:shadow-[0_42px_110px_-52px_rgba(15,23,42,0.5)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-6 md:px-8">
              <div className="relative flex items-start justify-center gap-4">
                <div className="space-y-3 text-center">
                  <div className="flex flex-wrap justify-center gap-2">
                    {steps.map((item, index) => (
                      <ProgressDot key={item.title} active={index === step} done={index < step} />
                    ))}
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-[2.15rem] font-semibold tracking-[-0.06em] text-slate-950 md:text-[2.35rem]">
                      Entrena tu vendedor virtual
                    </h2>
                    <p className="mx-auto max-w-2xl text-base text-slate-600">{steps[step].subtitle}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.16)] bg-white text-slate-600 transition hover:bg-slate-50"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <form ref={formRef} action={createAgentAction} noValidate className="flex min-h-0 flex-1 flex-col">
              <div
                className={
                  isSubmitting
                    ? "flex flex-1 items-center justify-center overflow-hidden px-5 py-8 md:px-8 md:py-10"
                    : "flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-7"
                }
              >
                {isSubmitting ? (
                  <div className="mx-auto flex w-full max-w-[480px] flex-col items-center justify-center text-center">
                    <div className="relative flex h-28 w-28 items-center justify-center">
                      <div className="absolute inset-0 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)]" />
                      <div className="absolute inset-[10px] rounded-full border border-[color-mix(in_srgb,var(--primary)_20%,white)]" />
                      <LoaderCircle className="absolute h-24 w-24 animate-spin text-[color-mix(in_srgb,var(--primary)_42%,white)]" />
                      <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-[24px] bg-[color-mix(in_srgb,var(--primary)_14%,white)] text-[var(--primary)] shadow-[0_18px_40px_-24px_color-mix(in_srgb,var(--primary)_45%,black)]">
                        <Bot className="h-8 w-8" />
                      </div>
                    </div>

                    <div className="mt-7 space-y-3">
                      <h3 className="text-[2.1rem] font-semibold tracking-[-0.06em] text-slate-950">Creando tu agente IA</h3>
                      <p className="text-base leading-7 text-slate-600">
                        Estamos transformando tus respuestas en instrucciones internas y dejando listo el canal de WhatsApp.
                      </p>
                    </div>

                    <div className="mt-8 w-full space-y-3">
                      <div className="h-3 overflow-hidden rounded-full bg-[rgba(148,163,184,0.14)] p-[3px]">
                        <div className="h-full w-[58%] animate-pulse rounded-full bg-[var(--primary)] shadow-[0_10px_20px_-12px_color-mix(in_srgb,var(--primary)_70%,black)]" />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                        <span>Guardando entrenamiento</span>
                        <span>Preparando WhatsApp</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto w-full max-w-[760px]">
                    <div className={step === 0 ? "block" : "hidden"}>
                      <StepFrame eyebrow="Paso 1" title="Tu negocio" subtitle="Con esto el agente entiende que vendes, para quien y desde que rango debe responder.">
                        <div className="space-y-5">
                          <label className="block space-y-2">
                            <span className="text-sm font-medium text-slate-700">Nombre del negocio</span>
                            <Input name="businessName" placeholder="Ej. Studio Fit Mujer" defaultValue={businessName ?? ""} required className="h-12 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white px-4" />
                          </label>
                          <label className="block space-y-2">
                            <span className="text-sm font-medium text-slate-700">Que vendes</span>
                            <p className="text-sm leading-6 text-slate-500">Se especifico. Esto define casi todo lo que el agente sabe.</p>
                            <textarea name="businessDescription" rows={5} required className="flex w-full rounded-[24px] border border-[rgba(148,163,184,0.18)] bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-[var(--primary)]" placeholder="Ej. Vendemos ropa deportiva para mujer entre 20 y 40 anos. Tenis, licras y tops de marca propia." />
                          </label>
                          <fieldset className="space-y-3">
                            <legend className="text-sm font-medium text-slate-700">A quien le vendes</legend>
                            <div className="flex flex-wrap gap-2">
                              {targetAudienceOptions.map((option, index) => (
                                <MultiSelectChip key={option} name="targetAudiences" value={option} label={option} defaultChecked={index === 0} />
                              ))}
                            </div>
                          </fieldset>
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="block space-y-2">
                              <span className="text-sm font-medium text-slate-700">Precio minimo</span>
                              <Input name="priceRangeMin" placeholder="Ej. 80.000 COP" className="h-12 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white px-4" />
                            </label>
                            <label className="block space-y-2">
                              <span className="text-sm font-medium text-slate-700">Precio maximo</span>
                              <Input name="priceRangeMax" placeholder="Ej. 220.000 COP" className="h-12 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white px-4" />
                            </label>
                          </div>
                        </div>
                      </StepFrame>
                    </div>

                    <div className={step === 1 ? "block" : "hidden"}>
                      <StepFrame eyebrow="Paso 2" title="Como habla tu vendedor" subtitle="Aqui decides como suena el agente cuando responde por WhatsApp.">
                        <div className="space-y-6">
                          <div className="grid gap-4 md:grid-cols-2">
                            {toneOptions.map((option, index) => (
                              <ToneCard key={option.value} value={option.value} title={option.label} description={option.prompt.replace("Habla ", "").replace(".", "")} defaultChecked={index === 1} />
                            ))}
                          </div>
                          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">Longitud de respuesta</p>
                                <p className="text-sm text-slate-600">Ajusta que tan corto o detallado debe responder.</p>
                              </div>
                              <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)] px-3 py-1 text-sm font-semibold text-[var(--primary)]">{responseLengthLabel}</span>
                            </div>
                            <div className="mt-5">
                              <input type="range" name="responseLengthValue" min="0" max="100" step="1" value={responseLengthValue} onChange={(event) => setResponseLengthValue(Number(event.target.value))} className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[var(--primary)]" />
                              <div className="mt-3 flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                                <span>Muy corto</span>
                                <span>Equilibrado</span>
                                <span>Detallado</span>
                              </div>
                            </div>
                          </div>
                          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-slate-900">Extra de estilo</p>
                              <p className="text-sm text-slate-600">Activa solo lo que realmente representa a tu negocio.</p>
                            </div>
                            <div className="mt-5 grid gap-3 md:grid-cols-2">
                              <ToggleRow name="useEmojis" title="Usar emojis" description="Puede usarlos con moderacion." />
                              <ToggleRow name="useExpressivePunctuation" title="Usar ! y ?" description="Permite signos expresivos de forma natural." defaultChecked />
                              <ToggleRow name="useTuteo" title="Tutear al cliente" description="Habla de tu en lugar de usted." defaultChecked />
                              <ToggleRow name="useCustomerName" title="Llamarlo por nombre" description="Usa el nombre cuando ya lo conozca." defaultChecked />
                            </div>
                          </div>
                        </div>
                      </StepFrame>
                    </div>

                    <div className={step === 2 ? "block" : "hidden"}>
                      <StepFrame eyebrow="Paso 3" title="Como cierra ventas" subtitle="Marca el comportamiento comercial que quieres que el agente use en la conversacion.">
                        <div className="grid gap-3">
                          <ToggleRow name="askNameFirst" title="Preguntar el nombre al inicio" description="Se presenta y pide el nombre para personalizar la conversacion." defaultChecked />
                          <ToggleRow name="offerBestSeller" title="Ofrecer el producto mas vendido" description="Si el cliente duda, recomienda una opcion fuerte." defaultChecked />
                          <ToggleRow name="handlePriceObjections" title="Manejar objeciones de precio" description={'Responde frases como "esta muy caro" con argumentos de valor.'} defaultChecked />
                          <ToggleRow name="askForOrder" title="Pedir el pedido directamente" description={'Despues de resolver dudas, intenta cerrar con una pregunta como "Te lo reservo?".'} defaultChecked />
                          <ToggleRow name="sendPaymentLink" title="Enviar link de pago automatico" description="Si el cliente confirma, indica el paso de pago." />
                          <ToggleRow name="handoffToHuman" title="Escalar a humano si no puede ayudar" description="Avisa cuando algo esta fuera de su alcance." defaultChecked />
                        </div>
                      </StepFrame>
                    </div>

                    <div className={step === 3 ? "block" : "hidden"}>
                      <StepFrame eyebrow="Paso 4" title="Reglas importantes" subtitle="Estas reglas ayudan a que el agente venda sin inventar ni comprometer al negocio.">
                        <div className="space-y-6">
                          <fieldset className="space-y-3">
                            <legend className="text-sm font-medium text-slate-700">Cosas que nunca debe hacer</legend>
                            <div className="grid gap-3">
                              {forbiddenRuleOptions.map((rule, index) => (
                                <label key={rule} className="flex min-h-12 items-center gap-3 rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-white px-4 py-3">
                                  <input type="checkbox" name="forbiddenRules" value={rule} defaultChecked={index < 4} className="h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]" />
                                  <span className="text-sm text-slate-700">{rule}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          <label className="block space-y-2">
                            <span className="text-sm font-medium text-slate-700">Otras reglas especificas de tu negocio</span>
                            <textarea name="customRules" rows={4} className="flex w-full rounded-[24px] border border-[rgba(148,163,184,0.18)] bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-[var(--primary)]" placeholder={"Ej. No ofrecer entregas el mismo dia.\nNo confirmar disponibilidad hasta revisar inventario.\nNo prometer cambios sin revisar politicas."} />
                          </label>
                          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] p-5">
                            <div className="flex items-start gap-3">
                              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                                <QrCode className="h-5 w-5" />
                              </span>
                              <div className="space-y-4">
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold text-slate-900">Conectar WhatsApp ahora</p>
                                  <p className="text-sm leading-6 text-slate-600">Creamos el agente y dejamos listo el siguiente paso para conectarlo.</p>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                  <label className="cursor-pointer">
                                    <input type="radio" name="connectWhatsappNow" value="si" defaultChecked className="peer sr-only" />
                                    <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition peer-checked:border-[var(--primary)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_8%,white)] peer-checked:text-[var(--primary)]">Si, conectarlo ahora</span>
                                  </label>
                                  <label className="cursor-pointer">
                                    <input type="radio" name="connectWhatsappNow" value="despues" className="peer sr-only" />
                                    <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition peer-checked:border-[var(--primary)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_8%,white)] peer-checked:text-[var(--primary)]">Lo hare despues</span>
                                  </label>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </StepFrame>
                    </div>
                  </div>
                )}
              </div>

              {!isSubmitting ? (
                <div className="flex items-center justify-between border-t border-[rgba(148,163,184,0.14)] bg-[rgba(255,255,255,0.92)] px-5 py-4 backdrop-blur md:px-8">
                  <button type="button" onClick={previousStep} disabled={step === 0 || isSubmitting} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.16)] px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    Volver
                  </button>
                  {step < steps.length - 1 ? (
                    <button type="button" onClick={nextStep} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]">
                      Continuar
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button type="button" onClick={submitCreateFlow} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]">
                      Crear agente
                      <Sparkles className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a7a] p-4" role="dialog" aria-modal="true" aria-label="Eliminar agente" onClick={() => setPendingDelete(null)}>
          <div className="w-full max-w-md rounded-[28px] border border-[rgba(148,163,184,0.2)] bg-white p-5 shadow-[0_24px_60px_-38px_rgba(15,23,42,0.34)]" onClick={(event) => event.stopPropagation()}>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Eliminar agente</h3>
              <p className="text-sm text-slate-600">Vas a eliminar <span className="font-medium text-slate-900">{pendingDelete.name}</span>.</p>
              <p className="text-sm text-slate-600">Si este agente ya tiene canales o conversaciones, el sistema bloqueara la eliminacion.</p>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPendingDelete(null)} className="inline-flex h-11 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                Cancelar
              </button>
              <form action={deleteAgentAction}>
                <input type="hidden" name="agentId" value={pendingDelete.id} />
                <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-medium text-white transition hover:bg-rose-700">
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {resetOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a7a] p-4" role="dialog" aria-modal="true" aria-label="Empezar de cero" onClick={() => setResetOpen(false)}>
          <div className="w-full max-w-md rounded-[28px] border border-[rgba(148,163,184,0.2)] bg-white p-5 shadow-[0_24px_60px_-38px_rgba(15,23,42,0.34)]" onClick={(event) => event.stopPropagation()}>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Empezar de cero</h3>
              <p className="text-sm text-slate-600">Esto eliminara el negocio actual, sus agentes y toda la configuracion creada en este espacio.</p>
              <p className="text-sm text-slate-600">Si ya tienes conversaciones o canales conectados, tambien se perderan.</p>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setResetOpen(false)} className="inline-flex h-11 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                Cancelar
              </button>
              <form action={resetWorkspaceAction}>
                <input type="hidden" name="confirm" value="RESET" />
                <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-medium text-white transition hover:bg-rose-700">
                  <RotateCcw className="h-4 w-4" />
                  Reiniciar
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
