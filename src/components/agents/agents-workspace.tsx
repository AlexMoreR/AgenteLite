"use client";

import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  CircleDollarSign,
  Globe2,
  Link2,
  MessageSquareMore,
  MoreHorizontal,
  Package,
  Plus,
  QrCode,
  RotateCcw,
  Sparkles,
  Store,
  Tags,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { createAgentAction, deleteAgentAction } from "@/app/actions/agent-actions";
import { resetWorkspaceAction } from "@/app/actions/workspace-actions";
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

type StepDefinition = {
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
};

const steps: StepDefinition[] = [
  { title: "¿Qué tipo de negocio tienes?", subtitle: "Esto define la base comercial del agente.", icon: Store },
  { title: "Tu perfil", subtitle: "Así hablará el agente contigo y con tu contexto.", icon: UserRound },
  { title: "¿Cómo se llama tu negocio?", subtitle: "La marca será parte del contexto del asistente.", icon: Sparkles },
  { title: "¿A qué rubro pertenece?", subtitle: "Eso ayuda a orientar mejor las respuestas del agente.", icon: Tags },
  { title: "¿Qué vende tu negocio?", subtitle: "Describe oferta, beneficios y forma de atención.", icon: Package },
  { title: "¿Cómo cobras a tus clientes?", subtitle: "Definimos la lógica comercial principal.", icon: CircleDollarSign },
  { title: "¿Cuál es tu volumen de venta diario?", subtitle: "Nos da una referencia del ritmo del negocio.", icon: BarChart3 },
  { title: "¿Dónde atenderás a tus clientes?", subtitle: "Elige el canal principal para este agente.", icon: MessageSquareMore },
  { title: "Conectar WhatsApp", subtitle: "Dejamos lista la siguiente acción del canal.", icon: QrCode },
];

const statusLabelMap = {
  DRAFT: "Borrador",
  ACTIVE: "Activo",
  PAUSED: "Pausado",
  ARCHIVED: "Archivado",
} as const;

const statusToneMap = {
  DRAFT: "bg-amber-50 text-amber-700 ring-amber-200",
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PAUSED: "bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)] ring-slate-200",
  ARCHIVED: "bg-rose-50 text-rose-700 ring-rose-200",
} as const;

function ProgressDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <span
      className={`h-2 rounded-full transition-all ${
        active ? "w-8 bg-[var(--primary)]" : done ? "w-4 bg-[color-mix(in_srgb,var(--primary)_65%,white)]" : "w-4 bg-slate-200"
      }`}
    />
  );
}

function ChoiceCard({
  name,
  value,
  title,
  description,
  icon: Icon,
  defaultChecked,
  badge,
  compact = false,
  hideIndicator = false,
}: {
  name: string;
  value: string;
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  defaultChecked?: boolean;
  badge?: string;
  compact?: boolean;
  hideIndicator?: boolean;
}) {
  return (
    <label className="block cursor-pointer has-[:checked]:[&>span]:border-[var(--primary)] has-[:checked]:[&>span]:bg-[color-mix(in_srgb,var(--primary)_5%,white)] has-[:checked]:[&_.choice-indicator]:border-[var(--primary)] has-[:checked]:[&_.choice-indicator]:bg-[var(--primary)]">
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} className="sr-only" />
      <span
        className={`relative flex flex-col justify-between rounded-[24px] border border-[rgba(148,163,184,0.18)] bg-white transition hover:border-[var(--primary)]/30 ${
          compact ? "min-h-[112px] p-4" : "min-h-[138px] p-5"
        }`}
      >
        {!hideIndicator ? (
          <span className="absolute right-5 top-5 flex items-center gap-2">
            {badge ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {badge}
              </span>
            ) : null}
            <span className="choice-indicator inline-flex h-4 w-4 rounded-full border border-slate-300 bg-white" />
          </span>
        ) : null}

        <span className={`inline-flex items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)] ${compact ? "h-10 w-10" : "h-12 w-12"}`}>
          {Icon ? <Icon className="h-5 w-5" /> : null}
        </span>

        <span className="block space-y-1.5">
          <span className={`block font-semibold tracking-[-0.03em] text-slate-950 ${compact ? "text-sm" : "text-base"}`}>{title}</span>
          {description ? <span className="block text-sm leading-6 text-slate-600">{description}</span> : null}
        </span>
      </span>
    </label>
  );
}

function StepFrame({
  icon: Icon,
  title,
  subtitle,
  compact = false,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      {compact ? (
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
            <Icon className="h-5 w-5" />
          </span>
          <p className="max-w-xl pt-1 text-sm leading-6 text-slate-600">{subtitle}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
            <Icon className="h-5 w-5" />
          </span>
          <div className="space-y-1.5">
            <h3 className="text-[1.9rem] font-semibold tracking-[-0.05em] text-slate-950">{title}</h3>
            <p className="max-w-xl text-sm leading-6 text-slate-600">{subtitle}</p>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export function AgentsWorkspace({ hasWorkspace, businessName, agents }: AgentsWorkspaceProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<AgentCard | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const openCreateFlow = () => {
    setStep(0);
    setModalOpen(true);
  };

  const nextStep = () => setStep((current) => Math.min(current + 1, steps.length - 1));
  const previousStep = () => setStep((current) => Math.max(current - 1, 0));
  const closeModal = () => setModalOpen(false);
  const CurrentStepIcon = steps[step].icon;

  return (
    <>
      <div className="space-y-6">
        {agents.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">Agentes creados</h2>
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

            <div className="grid gap-4 xl:grid-cols-2">
              {agents.map((agent) => (
                <Card key={agent.id} className="border border-[rgba(148,163,184,0.14)] bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-4">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                        <Bot className="h-5 w-5" />
                      </span>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">{agent.name}</h3>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${statusToneMap[agent.status]}`}
                          >
                            {statusLabelMap[agent.status]}
                          </span>
                        </div>
                        <p className="text-sm leading-6 text-slate-600">
                          {agent.description || "Aún no tiene descripción comercial."}
                        </p>
                      </div>
                    </div>

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

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Último ajuste</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{agent.updatedAtLabel}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Canales</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{agent.channelCount}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Bienvenida</p>
                      <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-900">{agent.welcomeMessage || "Pendiente"}</p>
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
                  {hasWorkspace ? "Tu negocio está listo para crear un agente." : "Empieza creando tu primer agente."}
                </h2>
                <p className="text-sm leading-6 text-slate-600">
                  {hasWorkspace
                    ? `Vamos a usar ${businessName || "tu negocio"} como base y completar el resto en el modal.`
                    : "Crea tu primer agente que vende 24/7 con conocimientos de tu negocio."}
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
            className="flex h-full w-full max-w-[860px] flex-col overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-white md:max-h-[92vh] md:rounded-[30px] md:shadow-[0_38px_90px_-44px_rgba(15,23,42,0.48)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[rgba(148,163,184,0.14)] px-5 py-5 md:px-7">
              <div className="relative flex items-start justify-center gap-4">
                <div className="space-y-3 text-center">
                  <div className="flex flex-wrap justify-center gap-2">
                    {steps.map((item, index) => (
                      <ProgressDot key={item.title} active={index === step} done={index < step} />
                    ))}
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-[2.2rem] font-semibold tracking-[-0.06em] text-slate-950">{steps[step].title}</h2>
                    <p className="text-base text-slate-600">{steps[step].subtitle}</p>
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

            <form action={createAgentAction} noValidate className="flex min-h-0 flex-1 flex-col">
              <input type="hidden" name="agentName" value="" />

              <div className="flex-1 overflow-y-auto px-5 py-6 md:px-7">
                <div className="mx-auto w-full max-w-[680px]">
                  <div className={step === 0 ? "block" : "hidden"}>
                    <StepFrame icon={CurrentStepIcon} title="¿Qué tipo de negocio tienes?" subtitle="Elige la opción que mejor representa cómo vende o atiende tu negocio." compact>
                      <div className="grid gap-4 md:grid-cols-2">
                        <ChoiceCard
                          name="businessType"
                          value="productos"
                          title="Vendo productos"
                          description="Tienda, ecommerce o catálogo."
                          icon={Package}
                          defaultChecked
                        />
                        <ChoiceCard
                          name="businessType"
                          value="servicios"
                          title="Ofrezco servicios"
                          description="Consultoría, soporte o atención."
                          icon={BriefcaseBusiness}
                        />
                      </div>
                    </StepFrame>
                  </div>

                  <div className={step === 1 ? "block" : "hidden"}>
                    <StepFrame icon={CurrentStepIcon} title="Tu perfil" subtitle="Así el agente sabrá cómo referirse a ti y desde qué contexto opera." compact>
                      <div className="grid gap-5 lg:grid-cols-[1fr_0.95fr]">
                        <div className="space-y-4">
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-slate-700">Tu nombre</span>
                            <Input name="ownerName" placeholder="Ej. Carlos Ramírez" required className="h-12 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white px-4" />
                          </label>
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-slate-700">¿Cómo prefieres que te llame tu asistente?</span>
                            <Input
                              name="assistantGreetingName"
                              placeholder="Ej. Carlos, equipo comercial o doctora Laura"
                              required
                              className="h-12 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white px-4"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-slate-700">País</span>
                            <Input name="country" placeholder="Ej. Colombia" required className="h-12 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white px-4" />
                          </label>
                        </div>

                        <fieldset className="space-y-3">
                          <legend className="text-sm font-medium text-slate-700">Identidad</legend>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <ChoiceCard name="ownerIdentity" value="hombre" title="Hombre" icon={UserRound} defaultChecked compact />
                            <ChoiceCard name="ownerIdentity" value="mujer" title="Mujer" icon={UserRound} compact />
                            <ChoiceCard
                              name="ownerIdentity"
                              value="prefiero-no-decir"
                              title="Prefiero no definirlo"
                              icon={UserRound}
                              compact
                            />
                          </div>
                        </fieldset>
                      </div>
                    </StepFrame>
                  </div>

                  <div className={step === 2 ? "block" : "hidden"}>
                    <StepFrame icon={CurrentStepIcon} title="¿Cómo se llama tu negocio?" subtitle="Este nombre será reconocido por el agente en sus respuestas." compact>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-slate-700">Nombre del negocio</span>
                        <Input
                          name="businessName"
                          placeholder="Ej. Sonrisa Dental"
                          defaultValue={businessName ?? ""}
                          required
                          className="h-14 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white px-4 text-base"
                        />
                      </label>
                    </StepFrame>
                  </div>

                  <div className={step === 3 ? "block" : "hidden"}>
                    <StepFrame icon={CurrentStepIcon} title="¿A qué rubro pertenece?" subtitle="Esto ayuda a ubicar mejor el contexto del negocio." compact>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-slate-700">Rubro</span>
                        <Input
                          name="industry"
                          placeholder="Ej. Odontología, moda, educación o bienes raíces"
                          required
                          className="h-14 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white px-4 text-base"
                        />
                      </label>
                    </StepFrame>
                  </div>

                  <div className={step === 4 ? "block" : "hidden"}>
                    <StepFrame icon={CurrentStepIcon} title="¿Qué vende tu negocio?" subtitle="Describe lo que ofreces y cómo te diferencias." compact>
                      <div className="space-y-4">
                        <label className="block space-y-2">
                          <span className="text-sm font-medium text-slate-700">Descripción</span>
                          <textarea
                            name="businessOffering"
                            rows={6}
                            className="flex w-full rounded-[24px] border border-[rgba(148,163,184,0.18)] bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-slate-900"
                            placeholder="Ej. Vendemos tratamientos de ortodoncia y diseño de sonrisa. Atendemos por cita y hacemos seguimiento por WhatsApp."
                            required
                          />
                        </label>

                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-slate-700">Link principal del negocio</span>
                            <span className="relative block">
                              <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <Input
                                name="productLink"
                                placeholder="Web, catálogo o producto principal"
                                className="h-12 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white pl-11 pr-4"
                              />
                            </span>
                          </label>
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-slate-700">Redes sociales</span>
                            <Input
                              name="socialLinks"
                              placeholder="Instagram, Facebook, TikTok..."
                              className="h-12 rounded-2xl border-[rgba(148,163,184,0.18)] bg-white px-4"
                            />
                          </label>
                        </div>
                      </div>
                    </StepFrame>
                  </div>

                  <div className={step === 5 ? "block" : "hidden"}>
                    <StepFrame icon={CurrentStepIcon} title="¿Cómo cobras a tus clientes?" subtitle="El agente usará esto como referencia comercial." compact>
                      <div className="grid gap-4 md:grid-cols-2">
                        <ChoiceCard name="chargeModel" value="por-producto" title="Por producto" description="Ideal para tiendas y catálogos." icon={CircleDollarSign} defaultChecked />
                        <ChoiceCard name="chargeModel" value="por-servicio" title="Por servicio" description="La conversación gira alrededor de una atención." icon={CircleDollarSign} />
                        <ChoiceCard name="chargeModel" value="mixto" title="Mixto" description="Necesito ambas lógicas." icon={CircleDollarSign} />
                        <ChoiceCard name="chargeModel" value="cotizacion" title="Por cotización" description="Primero se capta interés y luego se cotiza." icon={CircleDollarSign} />
                      </div>
                    </StepFrame>
                  </div>

                  <div className={step === 6 ? "block" : "hidden"}>
                    <StepFrame icon={CurrentStepIcon} title="¿Cuál es tu volumen de venta diario?" subtitle="Solo necesitamos una referencia general." compact>
                      <div className="grid gap-4 md:grid-cols-3">
                        <ChoiceCard name="salesVolume" value="bajo" title="Bajo" description="Pocas conversaciones y trato cercano." icon={BarChart3} defaultChecked />
                        <ChoiceCard name="salesVolume" value="medio" title="Medio" description="Respuestas frecuentes y seguimiento." icon={BarChart3} />
                        <ChoiceCard name="salesVolume" value="alto" title="Alto" description="Necesitas rapidez y filtros." icon={BarChart3} />
                      </div>
                    </StepFrame>
                  </div>

                  <div className={step === 7 ? "block" : "hidden"}>
                    <StepFrame icon={CurrentStepIcon} title="¿Dónde atenderás a tus clientes?" subtitle="Define el canal principal para este agente." compact>
                      <div className="grid gap-4 md:grid-cols-2">
                        <ChoiceCard
                          name="contactChannel"
                          value="whatsapp"
                          title="WhatsApp"
                          description="El camino principal del producto."
                          badge="Activo"
                          icon={MessageSquareMore}
                          defaultChecked
                        />
                        <ChoiceCard
                          name="contactChannel"
                          value="api-oficial"
                          title="API oficial"
                          description="La dejamos preparada para más adelante."
                          badge="Pronto"
                          icon={Globe2}
                        />
                      </div>
                    </StepFrame>
                  </div>

                  <div className={step === 8 ? "block" : "hidden"}>
                    <StepFrame icon={CurrentStepIcon} title="Conectar WhatsApp" subtitle="Decide si quieres dejar listo el siguiente paso del canal." compact>
                      <div className="grid gap-4 md:grid-cols-2">
                        <ChoiceCard
                          name="connectWhatsappNow"
                          value="si"
                          title="Sí, quiero conectarlo después"
                          description="Crear el agente y seguir con la conexión."
                          badge="Recomendado"
                          icon={QrCode}
                          defaultChecked
                        />
                        <ChoiceCard
                          name="connectWhatsappNow"
                          value="despues"
                          title="Lo haré después"
                          description="Primero quiero revisar el agente."
                          icon={Tags}
                        />
                      </div>
                    </StepFrame>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-[rgba(148,163,184,0.14)] bg-white px-5 py-4 md:px-7">
                <button
                  type="button"
                  onClick={previousStep}
                  disabled={step === 0}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.16)] px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Volver
                </button>

                {step < steps.length - 1 ? (
                  <button
                    type="button"
                    onClick={nextStep}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                  >
                    Continuar
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                  >
                    Crear agente
                    <Sparkles className="h-4 w-4" />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a7a] p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Eliminar agente"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-[rgba(148,163,184,0.2)] bg-white p-5 shadow-[0_24px_60px_-38px_rgba(15,23,42,0.34)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Eliminar agente</h3>
              <p className="text-sm text-slate-600">
                Vas a eliminar <span className="font-medium text-slate-900">{pendingDelete.name}</span>.
              </p>
              <p className="text-sm text-slate-600">
                Si este agente ya tiene canales o conversaciones, el sistema bloqueará la eliminación.
              </p>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <form action={deleteAgentAction}>
                <input type="hidden" name="agentId" value={pendingDelete.id} />
                <button
                  type="submit"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-medium text-white transition hover:bg-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {resetOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a7a] p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Empezar de cero"
          onClick={() => setResetOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-[rgba(148,163,184,0.2)] bg-white p-5 shadow-[0_24px_60px_-38px_rgba(15,23,42,0.34)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Empezar de cero</h3>
              <p className="text-sm text-slate-600">
                Esto eliminará el negocio actual, sus agentes y toda la configuración creada en este espacio.
              </p>
              <p className="text-sm text-slate-600">
                Si ya tienes conversaciones o canales conectados, también se perderán.
              </p>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.18)] px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <form action={resetWorkspaceAction}>
                <input type="hidden" name="confirm" value="RESET" />
                <button
                  type="submit"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-medium text-white transition hover:bg-rose-700"
                >
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

