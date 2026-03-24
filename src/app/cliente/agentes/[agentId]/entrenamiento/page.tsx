import { redirect } from "next/navigation";
import { Save, Shield, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { updateAgentTrainingAction } from "@/app/actions/agent-actions";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { Card } from "@/components/ui/card";
import {
  forbiddenRuleOptions,
  getResponseLengthLabel,
  getResponseLengthSliderValue,
  parseAgentTrainingConfig,
  targetAudienceOptions,
  toneOptions,
  type AgentTrainingConfig,
} from "@/lib/agent-training";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ agentId: string }>;
};

const defaultTraining: AgentTrainingConfig = {
  businessDescription: "",
  targetAudiences: ["Mujer"],
  priceRangeMin: "",
  priceRangeMax: "",
  salesTone: "amigable-profesional",
  responseLength: "equilibrado",
  useEmojis: false,
  useExpressivePunctuation: true,
  useTuteo: true,
  useCustomerName: true,
  askNameFirst: true,
  offerBestSeller: true,
  handlePriceObjections: true,
  askForOrder: true,
  sendPaymentLink: false,
  handoffToHuman: true,
  forbiddenRules: [...forbiddenRuleOptions.slice(0, 4)],
  customRules: "",
};

function ToggleField({
  name,
  title,
  description,
  defaultChecked,
}: {
  name: string;
  title: string;
  description: string;
  defaultChecked: boolean;
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

export default async function AgentTrainingPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+crear+tu+negocio+primero");
  }

  const { agentId } = await params;
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      name: true,
      trainingConfig: true,
      workspace: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const training = parseAgentTrainingConfig(agent.trainingConfig) ?? defaultTraining;

  return (
    <AgentPanelShell agentId={agent.id}>
      <form action={updateAgentTrainingAction} className="space-y-4">
        <input type="hidden" name="agentId" value={agent.id} />
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-6">
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div className="space-y-1.5 pt-0.5">
                  <h2 className="text-[1.85rem] font-semibold tracking-[-0.05em] text-slate-950">Entrenamiento del agente</h2>
                  <p className="max-w-xl text-sm leading-6 text-slate-600">
                    Ensenale al agente como vende tu negocio y nosotros regeneramos sus instrucciones internas.
                  </p>
                </div>
              </div>

              <div className="grid gap-5">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700">Nombre del negocio</span>
                  <input
                    name="businessName"
                    defaultValue={agent.workspace.name}
                    className="field-select h-12 rounded-2xl"
                    required
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700">Que vendes</span>
                  <textarea
                    name="businessDescription"
                    rows={5}
                    defaultValue={training.businessDescription}
                    className="flex w-full rounded-[24px] border border-[rgba(148,163,184,0.18)] bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-[var(--primary)]"
                    required
                  />
                </label>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium text-slate-700">A quien le vendes</legend>
                  <div className="flex flex-wrap gap-2">
                    {targetAudienceOptions.map((option) => (
                      <label key={option} className="cursor-pointer">
                        <input
                          type="checkbox"
                          name="targetAudiences"
                          value={option}
                          defaultChecked={training.targetAudiences.includes(option)}
                          className="peer sr-only"
                        />
                        <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition peer-checked:border-[var(--primary)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_8%,white)] peer-checked:text-[var(--primary)]">
                          {option}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-slate-700">Precio minimo</span>
                    <input name="priceRangeMin" defaultValue={training.priceRangeMin} className="field-select h-12 rounded-2xl" />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-slate-700">Precio maximo</span>
                    <input name="priceRangeMax" defaultValue={training.priceRangeMax} className="field-select h-12 rounded-2xl" />
                  </label>
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium text-slate-700">Tono</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {toneOptions.map((option) => (
                      <label key={option.value} className="cursor-pointer">
                        <input
                          type="radio"
                          name="salesTone"
                          value={option.value}
                          defaultChecked={training.salesTone === option.value}
                          className="peer sr-only"
                        />
                        <span className="flex min-h-[108px] flex-col justify-between rounded-[24px] border border-[rgba(148,163,184,0.16)] bg-white p-4 transition peer-checked:border-[var(--primary)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_6%,white)]">
                          <span className="text-sm font-semibold text-slate-900">{option.label}</span>
                          <span className="text-sm leading-6 text-slate-600">{option.prompt}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="space-y-2">
                  <span className="flex items-center justify-between text-sm font-medium text-slate-700">
                    <span>Longitud de respuesta</span>
                    <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)] px-3 py-1 text-xs font-semibold text-[var(--primary)]">
                      {getResponseLengthLabel(training.responseLength)}
                    </span>
                  </span>
                  <input
                    type="range"
                    name="responseLengthValue"
                    min="0"
                    max="100"
                    step="50"
                    defaultValue={getResponseLengthSliderValue(training.responseLength)}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[var(--primary)]"
                  />
                  <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    <span>Muy corto</span>
                    <span>Equilibrado</span>
                    <span>Detallado</span>
                  </div>
                </label>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-950">Estilo y cierre</h3>
                <div className="grid gap-3">
                  <ToggleField name="useEmojis" title="Usar emojis" description="Puede usarlos con moderacion." defaultChecked={training.useEmojis} />
                  <ToggleField name="useExpressivePunctuation" title="Usar ! y ?" description="Usa signos expresivos cuando suene natural." defaultChecked={training.useExpressivePunctuation} />
                  <ToggleField name="useTuteo" title="Tutear al cliente" description="Habla de tu en lugar de usted." defaultChecked={training.useTuteo} />
                  <ToggleField name="useCustomerName" title="Llamarlo por nombre" description="Usa el nombre cuando ya lo sepa." defaultChecked={training.useCustomerName} />
                  <ToggleField name="askNameFirst" title="Preguntar el nombre al inicio" description="Se presenta y pide el nombre." defaultChecked={training.askNameFirst} />
                  <ToggleField name="offerBestSeller" title="Ofrecer el producto mas vendido" description="Si el cliente duda, recomienda una opcion fuerte." defaultChecked={training.offerBestSeller} />
                  <ToggleField name="handlePriceObjections" title="Manejar objeciones de precio" description='Responde "esta muy caro" con argumentos de valor.' defaultChecked={training.handlePriceObjections} />
                  <ToggleField name="askForOrder" title="Pedir el pedido directamente" description='Despues de resolver dudas, intenta cerrar con "Te lo reservo?".' defaultChecked={training.askForOrder} />
                  <ToggleField name="sendPaymentLink" title="Enviar link de pago" description="Si el cliente confirma, indica el paso de pago." defaultChecked={training.sendPaymentLink} />
                  <ToggleField name="handoffToHuman" title="Escalar a humano" description="Avisa cuando algo este fuera de su alcance." defaultChecked={training.handoffToHuman} />
                </div>
              </div>
            </Card>

            <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-6">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-[var(--primary)]" />
                  <h3 className="text-lg font-semibold text-slate-950">Reglas importantes</h3>
                </div>
                <div className="grid gap-3">
                  {forbiddenRuleOptions.map((rule) => (
                    <label key={rule} className="flex items-center gap-3 rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-slate-50 px-4 py-3">
                      <input
                        type="checkbox"
                        name="forbiddenRules"
                        value={rule}
                        defaultChecked={training.forbiddenRules.includes(rule)}
                        className="h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
                      />
                      <span className="text-sm text-slate-700">{rule}</span>
                    </label>
                  ))}
                </div>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700">Otras reglas especificas del negocio</span>
                  <textarea
                    name="customRules"
                    rows={5}
                    defaultValue={training.customRules}
                    className="flex w-full rounded-[24px] border border-[rgba(148,163,184,0.18)] bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-[var(--primary)]"
                  />
                </label>
              </div>
            </Card>

            <input type="hidden" name="connectWhatsappNow" value="despues" />
            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                <Save className="h-4 w-4" />
                Guardar entrenamiento
              </button>
            </div>
          </div>
        </div>
      </form>
    </AgentPanelShell>
  );
}
