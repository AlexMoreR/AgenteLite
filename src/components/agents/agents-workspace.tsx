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
import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import {
  forbiddenRuleOptions,
  getResponseLengthLabel,
  getResponseLengthFromValue,
  responseLengthOptions,
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
import { Switch } from "@/components/ui/switch";

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
    title: "🏪 Tu negocio",
    subtitle: "Ensenale al agente que vendes, para quien y en que rango se mueve tu oferta.",
  },
  {
    title: "💬 Como habla",
    subtitle: "Define el tono, la longitud y los pequenos detalles que hacen que suene como tu negocio.",
  },
  {
    title: "🤝 Como cierra ventas",
    subtitle: "Activa el comportamiento comercial que quieres ver en la conversacion.",
  },
  {
    title: "🛡️ Reglas importantes",
    subtitle: "Marca lo que nunca debe hacer para proteger la operacion.",
  },
  {
    title: "Activacion",
    subtitle: "Elige si quieres probar el agente primero o conectar WhatsApp ahora.",
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
  children,
}: {
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 md:space-y-5">
      {children}
    </section>
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
      <span className="flex min-h-[108px] flex-col rounded-[24px] border border-[rgba(148,163,184,0.16)] bg-[linear-gradient(180deg,#ffffff_0%,#fcfcfd_100%)] p-5 transition peer-checked:border-[var(--primary)] peer-checked:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_6%,white)_0%,white_100%)] peer-checked:shadow-[0_18px_40px_-28px_color-mix(in_srgb,var(--primary)_45%,black)] hover:-translate-y-0.5 hover:border-[var(--primary)]/30">
        <span className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="block text-base font-semibold tracking-[-0.03em] text-slate-950">{title}</span>
          </span>
          <TrainingHelpPopover title={title} description={description} />
        </span>
      </span>
    </label>
  );
}

function ToggleRow({
  name,
  title,
  defaultChecked = false,
  helpText,
}: {
  name: string;
  title: string;
  defaultChecked?: boolean;
  helpText: string;
}) {
  return (
    <label className="group flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-white px-4 py-3 transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-[color-mix(in_srgb,var(--primary)_24%,white)] active:scale-[0.995]">
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span>{title}</span>
          <TrainingHelpPopover title={title} description={helpText} />
      </span>
      <span className="relative shrink-0">
        <Switch name={name} defaultChecked={defaultChecked} aria-label={title} />
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
  const [postCreateAction, setPostCreateAction] = useState<"probar" | "conectar">("probar");
  const [responseLengthValue, setResponseLengthValue] = useState(50);
  const [audienceMode, setAudienceMode] = useState<"persona" | "empresa">("persona");
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>(["Mujer"]);
  const formRef = useRef<HTMLFormElement>(null);

  const personaAudienceOptions = ["Mujer", "Hombre", "Jovenes", "Adultos mayores", "Mamas", "Otro"];
  const empresaAudienceOptions = ["Empresa", "Pymes", "Emprendedores", "Profesionales", "Otro"];

  const openCreateFlow = () => {
    setStep(0);
    setIsSubmitting(false);
    setPostCreateAction("probar");
    setResponseLengthValue(50);
    setAudienceMode("persona");
    setSelectedAudiences(["Mujer"]);
    setModalOpen(true);
  };

  const nextStep = () => setStep((current) => Math.min(current + 1, steps.length - 1));
  const previousStep = () => setStep((current) => Math.max(current - 1, 0));
  const closeModal = () => {
    setIsSubmitting(false);
    setModalOpen(false);
  };
  const submitCreateFlow = (action: "probar" | "conectar") => {
    setPostCreateAction(action);
    setIsSubmitting(true);
    formRef.current?.requestSubmit();
  };

  const handleAudienceModeChange = (mode: "persona" | "empresa") => {
    setAudienceMode(mode);
    setSelectedAudiences(mode === "persona" ? ["Mujer"] : ["Empresa"]);
  };

  const handleAudienceToggle = (value: string) => {
    setSelectedAudiences((current) => {
      const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];

      if (next.length === 0) {
        return audienceMode === "persona" ? ["Mujer"] : ["Empresa"];
      }

      if (next.length > 5) {
        return current;
      }

      return next;
    });
  };

  const responseLengthLabel = getResponseLengthLabel(getResponseLengthFromValue(responseLengthValue));
  const responseLengthPrompt =
    responseLengthOptions.find((option) => option.value === getResponseLengthFromValue(responseLengthValue))?.prompt ??
    responseLengthOptions[1].prompt;

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
            className="flex h-full w-full max-w-[1120px] flex-col overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,#fdfdfd_0%,#ffffff_100%)] md:max-h-[92vh] md:rounded-[32px] md:shadow-[0_42px_110px_-52px_rgba(15,23,42,0.5)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-5 md:px-8 md:py-4">
              <div className="relative flex items-start justify-center gap-4">
                <div className="space-y-2 text-center">
                  <div className="flex flex-wrap justify-center gap-2">
                    {steps.map((item, index) => (
                      <ProgressDot key={item.title} active={index === step} done={index < step} />
                    ))}
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-[2rem] font-semibold tracking-[-0.06em] text-slate-950 md:text-[2.1rem]">
                      {steps[step].title}
                    </h2>
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
              <input type="hidden" name="postCreateAction" value={postCreateAction} />
              <div
                className={
                  isSubmitting
                    ? "flex flex-1 items-center justify-center overflow-hidden px-5 py-8 md:px-8 md:py-10"
                    : "flex-1 overflow-y-auto bg-[#f1f3f5] px-5 py-6 md:px-8 md:py-4"
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
                      <StepFrame>
                        <div className="grid gap-5 md:grid-cols-[320px_minmax(0,1fr)] md:items-start">
                            <div className="space-y-5">
                              <label className="block space-y-2.5">
                                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
                                  <span>Nombre del negocio</span>
                                  <TrainingHelpPopover
                                    title="Nombre del negocio"
                                    description="Este nombre se usara cuando el agente se presente y tambien para identificarlo dentro del negocio."
                                  />
                                </span>
                                <Input
                                  name="businessName"
                                  placeholder="Ej. Studio Fit Mujer"
                                  defaultValue={businessName ?? ""}
                                  required
                                  className="h-16 rounded-[28px] border border-white bg-white px-6 text-[15px] text-slate-950 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] placeholder:text-slate-400 focus-visible:border-[var(--primary)] focus-visible:ring-[color-mix(in_srgb,var(--primary)_16%,white)]"
                                />
                              </label>

                              <label className="block space-y-2.5">
                                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
                                  <span>Que vendes</span>
                                  <TrainingHelpPopover
                                    title="Que vendes"
                                    description="Describe tus productos o servicios con palabras simples. Mientras mas claro seas, mejor respondera el agente."
                                  />
                                </span>
                              <div className="overflow-hidden rounded-[28px] border border-white bg-white px-5 py-3 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.14)] transition focus-within:border-[var(--primary)] focus-within:ring-4 focus-within:ring-[color-mix(in_srgb,var(--primary)_12%,white)]">
                                <textarea
                                  name="businessDescription"
                                  rows={5}
                                  required
                                  className="flex min-h-[72px] w-full resize-none bg-white py-1 text-[15px] leading-7 text-slate-800 outline-none placeholder:text-slate-400"
                                  placeholder="Ej. Vendemos ropa deportiva para mujer entre 20 y 40 anos. Tenis, licras y tops de marca propia."
                                />
                              </div>
                              </label>
                            </div>

                            <div className="space-y-2.5">
                              <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
                                <span>A quien le vendes</span>
                                <TrainingHelpPopover
                                  title="A quien le vendes"
                                  description="Selecciona los perfiles que mas te compran. Esto ayuda al agente a responder con mas contexto."
                                />
                              </div>
                              <div className="rounded-[28px] border border-white bg-white p-5 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)]">
                                <div className="flex flex-wrap gap-2.5">
                                  <button
                                    type="button"
                                    onClick={() => handleAudienceModeChange("persona")}
                                    className={`inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition ${
                                      audienceMode === "persona"
                                        ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]"
                                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                                    }`}
                                  >
                                    Persona
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAudienceModeChange("empresa")}
                                    className={`inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition ${
                                      audienceMode === "empresa"
                                        ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]"
                                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                                    }`}
                                  >
                                    Empresa
                                  </button>
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2.5">
                                  {(audienceMode === "persona" ? personaAudienceOptions : empresaAudienceOptions).map((option) => (
                                    <label key={option} className="cursor-pointer">
                                      <input
                                        type="checkbox"
                                        name="audienceSelector"
                                        value={option}
                                        checked={selectedAudiences.includes(option)}
                                        onChange={() => handleAudienceToggle(option)}
                                        className="peer sr-only"
                                      />
                                      <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200/90 bg-white px-5 py-2 text-sm font-medium text-slate-700 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.22)] transition peer-checked:border-[var(--primary)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_8%,white)] peer-checked:text-[var(--primary)]">
                                        {option}
                                      </span>
                                    </label>
                                  ))}
                                </div>

                                {selectedAudiences.map((audience) => (
                                  <input key={audience} type="hidden" name="targetAudiences" value={audience} />
                                ))}
                              </div>
                            </div>
                          </div>
                      </StepFrame>
                    </div>

                    <div className={step === 1 ? "block" : "hidden"}>
                      <StepFrame>
                        <div className="space-y-6">
                          <div className="grid gap-4 md:grid-cols-2">
                            {toneOptions.map((option, index) => (
                              <ToneCard key={option.value} value={option.value} title={option.label} description={option.prompt.replace("Habla ", "").replace(".", "")} defaultChecked={index === 1} />
                            ))}
                          </div>
                          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <div className="inline-flex items-center gap-2">
                                  <p className="text-sm font-semibold text-slate-900">Longitud de respuesta</p>
                                  <TrainingHelpPopover
                                    title="Longitud de respuesta"
                                    description="Controla si el agente respondera corto y directo o con mas contexto cuando explique y venda."
                                  />
                                </div>
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
                              <p className="mt-3 text-sm leading-6 text-slate-600">{responseLengthPrompt}</p>
                            </div>
                          </div>
                          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5">
                            <div className="inline-flex items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900">Extra de estilo</p>
                              <TrainingHelpPopover
                                title="Extra de estilo"
                                description="Activa solo lo que realmente representa a tu marca. Si una opcion no encaja contigo, dejala apagada."
                              />
                            </div>
                            <div className="mt-5 grid gap-3 md:grid-cols-2">
                              <ToggleRow name="useEmojis" title="Usar emojis" helpText="Activalo si tu marca se comunica de forma cercana y natural." />
                              <ToggleRow name="useExpressivePunctuation" title="Usar ! y ?" defaultChecked helpText="Permite respuestas con mas energia cuando encajen con la conversacion." />
                              <ToggleRow name="useTuteo" title="Tutear al cliente" defaultChecked helpText="Enciendelo si tu negocio habla de forma cercana. Apagalo si prefieres una comunicacion mas formal." />
                              <ToggleRow name="useCustomerName" title="Llamarlo por nombre" defaultChecked helpText="Ayuda a que la conversacion se sienta mas personal cuando el cliente ya compartio su nombre." />
                            </div>
                          </div>
                        </div>
                      </StepFrame>
                    </div>

                    <div className={step === 2 ? "block" : "hidden"}>
                      <StepFrame>
                        <div className="grid gap-3">
                          <ToggleRow name="askNameFirst" title="Preguntar el nombre al inicio" defaultChecked helpText="Sirve si quieres que el agente personalice desde el primer mensaje." />
                          <ToggleRow name="offerBestSeller" title="Ofrecer el producto mas vendido" defaultChecked helpText="Hace que el agente sugiera una opcion segura cuando el cliente no sabe cual elegir." />
                          <ToggleRow name="handlePriceObjections" title="Manejar objeciones de precio" defaultChecked helpText="Permite que el agente defienda el valor de tu oferta cuando el cliente dude por precio." />
                          <ToggleRow name="askForOrder" title="Pedir el pedido directamente" defaultChecked helpText="Hace que el agente intente cerrar la venta con una pregunta directa cuando vea intencion de compra." />
                          <ToggleRow name="sendPaymentLink" title="Enviar link de pago automatico" helpText="Usalo si tu proceso de venta ya tiene un enlace o paso de pago claro." />
                          <ToggleRow name="handoffToHuman" title="Escalar a humano si no puede ayudar" defaultChecked helpText="Recomendado para casos especiales, dudas complejas o cuando el cliente necesite atencion de una persona." />
                        </div>
                      </StepFrame>
                    </div>

                    <div className={step === 3 ? "block" : "hidden"}>
                      <StepFrame>
                        <div className="space-y-6">
                          <fieldset className="space-y-3">
                            <legend className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                              <span>Cosas que nunca debe hacer</span>
                              <TrainingHelpPopover
                                title="Cosas que nunca debe hacer"
                                description="Estas reglas protegen al negocio para que el agente no invente informacion ni haga promesas incorrectas."
                              />
                            </legend>
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
                            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                              <span>Otras reglas especificas de tu negocio</span>
                              <TrainingHelpPopover
                                title="Otras reglas especificas"
                                description="Escribe aqui condiciones especiales que el agente deba respetar, por ejemplo politicas, tiempos o limites de atencion."
                              />
                            </span>
                            <textarea name="customRules" rows={4} className="flex w-full rounded-[24px] border border-[rgba(148,163,184,0.18)] bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-[var(--primary)]" placeholder={"Ej. No ofrecer entregas el mismo dia.\nNo confirmar disponibilidad hasta revisar inventario.\nNo prometer cambios sin revisar politicas."} />
                          </label>
                        </div>
                      </StepFrame>
                    </div>

                    <div className={step === 4 ? "block" : "hidden"}>
                      <StepFrame>
                        <div className="space-y-6">
                          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] p-5 md:p-6">
                            <div className="flex items-start gap-3">
                              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                                <QrCode className="h-5 w-5" />
                              </span>
                              <div className="space-y-2">
                                <div className="inline-flex items-center gap-2">
                                  <p className="text-sm font-semibold text-slate-900">Ultimo paso</p>
                                  <TrainingHelpPopover
                                    title="Ultimo paso"
                                    description="Te recomendamos probar primero. Si ya lo tienes claro, tambien puedes conectar el WhatsApp de una vez."
                                  />
                                </div>
                                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                                  Para una persona de negocio, lo mejor es probar un par de mensajes y despues conectar el numero real.
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => submitCreateFlow("probar")}
                              className="group rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5 text-left shadow-[0_18px_40px_-34px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:border-[var(--primary)]/30 hover:shadow-[0_24px_48px_-36px_rgba(15,23,42,0.22)]"
                            >
                              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                                <Sparkles className="h-5 w-5" />
                              </span>
                              <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-950">Probar agente</h3>
                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                Crea el agente y abre una simulacion para revisar como responde antes de salir en vivo.
                              </p>
                              <span className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition group-hover:bg-[var(--primary-strong)]">
                                Probar agente
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => submitCreateFlow("conectar")}
                              className="group rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5 text-left shadow-[0_18px_40px_-34px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:border-[var(--primary)]/30 hover:shadow-[0_24px_48px_-36px_rgba(15,23,42,0.22)]"
                            >
                              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                                <MessageSquareMore className="h-5 w-5" />
                              </span>
                              <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-950">Conectar ahora</h3>
                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                Crea el agente y pasa directo al QR para vincular tu WhatsApp en este momento.
                              </p>
                              <span className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition group-hover:border-[var(--primary)]/30 group-hover:text-[var(--primary)]">
                                Conectar ahora
                              </span>
                            </button>
                          </div>
                        </div>
                      </StepFrame>
                    </div>
                  </div>
                )}
              </div>

              {!isSubmitting ? (
                <div className="flex items-center justify-between border-t border-[rgba(148,163,184,0.14)] bg-[rgba(255,255,255,0.92)] px-5 py-4 backdrop-blur md:px-8">
                  <button type="button" onClick={previousStep} disabled={step === 0 || isSubmitting} className="inline-flex h-12 min-w-[120px] items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] bg-white px-5 text-sm font-medium text-slate-700 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.16)] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    Volver
                  </button>
                  {step < steps.length - 1 ? (
                    <button type="button" onClick={nextStep} className="inline-flex h-12 min-w-[186px] items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-6 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]">
                      Continuar
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <div className="text-right text-sm text-slate-500">
                      Elige una de las dos acciones para crear el agente y continuar.
                    </div>
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
