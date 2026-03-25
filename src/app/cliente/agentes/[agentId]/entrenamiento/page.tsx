import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircleHeart, PlayCircle, Save, Shield, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { updateAgentTrainingAction } from "@/app/actions/agent-actions";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import { TrainingResponseLengthField } from "@/components/agents/training-response-length-field";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  forbiddenRuleOptions,
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
  helpText,
}: {
  name: string;
  title: string;
  description: string;
  defaultChecked: boolean;
  helpText: string;
}) {
  return (
    <label className="group flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-white px-4 py-3 transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-[color-mix(in_srgb,var(--primary)_24%,white)] active:scale-[0.995]">
      <span className="space-y-1">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span>{title}</span>
          <TrainingHelpPopover title={title} description={helpText} />
        </span>
        <span className="block text-sm leading-6 text-slate-600">{description}</span>
      </span>
      <span className="relative shrink-0">
        <Switch name={name} defaultChecked={defaultChecked} aria-label={title} />
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
          <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 sm:p-5 lg:p-6">
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                  <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <h2 className="text-[1.25rem] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[1.45rem]">Entrenamiento del agente</h2>
                    <Link
                      href={`/cliente/agentes/${agent.id}/probar`}
                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] sm:w-auto"
                    >
                      <PlayCircle className="h-4 w-4" />
                      Probar agente
                    </Link>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 rounded-[24px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 p-4 sm:rounded-[28px] sm:p-5">
                <label className="space-y-2.5">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <span>Como se llama tu negocio</span>
                    <TrainingHelpPopover
                      title="Nombre del negocio"
                      description="Este nombre se usara cuando el agente se presente y tambien para identificarlo dentro del negocio."
                    />
                  </span>
                  <input
                    name="businessName"
                    defaultValue={agent.workspace.name}
                    placeholder="Ej. Aizen Store"
                    className="field-select h-[52px] rounded-[22px] border-white bg-white shadow-[0_10px_24px_-22px_rgba(15,23,42,0.24)]"
                    required
                  />
                </label>

                <label className="space-y-2.5">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <span>Que vendes y como lo explicarias en WhatsApp</span>
                    <TrainingHelpPopover
                      title="Que vendes"
                      description="Describe tus productos o servicios con palabras simples. Mientras mas claro seas, mejor respondera el agente."
                    />
                  </span>
                  <textarea
                    name="businessDescription"
                    rows={5}
                    defaultValue={training.businessDescription}
                    placeholder="Escribe aqui una explicacion simple de lo que vendes, para quien es y que te diferencia."
                    className="flex min-h-[180px] w-full rounded-[24px] border border-white bg-white px-4 py-4 text-sm leading-7 text-slate-800 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.24)] outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)]"
                    required
                  />
                </label>

                <fieldset className="space-y-3.5">
                  <legend className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <span>A que tipo de cliente le vendes</span>
                    <TrainingHelpPopover
                      title="Tipo de cliente"
                      description="Selecciona los perfiles que mas te compran. Esto ayuda al agente a usar ejemplos y tono mas cercanos."
                    />
                  </legend>
                  <p className="text-sm leading-6 text-slate-500">Marca las opciones que mas se parezcan a tu cliente ideal.</p>
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
                        <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-white bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.2)] transition peer-checked:border-[var(--primary)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_8%,white)] peer-checked:text-[var(--primary)]">
                          {option}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="rounded-[24px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                      <MessageCircleHeart className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">Ayuda extra para responder mejor</p>
                      <p className="text-sm leading-6 text-slate-500">
                        Si manejas un rango de precios, escribirlo ayuda a que el agente oriente mejor al cliente.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                        <span>Precio desde</span>
                        <TrainingHelpPopover
                          title="Precio desde"
                          description="Pon el valor mas bajo habitual de tu oferta. Si no manejas un minimo claro, puedes dejarlo vacio."
                        />
                      </span>
                      <input
                        name="priceRangeMin"
                        defaultValue={training.priceRangeMin}
                        placeholder="Ej. 80.000 COP"
                        className="field-select h-12 rounded-2xl border-[rgba(148,163,184,0.16)] bg-slate-50"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                        <span>Precio hasta</span>
                        <TrainingHelpPopover
                          title="Precio hasta"
                          description="Pon el valor mas alto habitual para que el agente pueda orientar mejor a clientes con distinto presupuesto."
                        />
                      </span>
                      <input
                        name="priceRangeMax"
                        defaultValue={training.priceRangeMax}
                        placeholder="Ej. 220.000 COP"
                        className="field-select h-12 rounded-2xl border-[rgba(148,163,184,0.16)] bg-slate-50"
                      />
                    </label>
                  </div>
                </div>

                <fieldset className="space-y-3">
                  <legend className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <span>Tono</span>
                    <TrainingHelpPopover
                      title="Tono"
                      description="Aqui eliges la personalidad del agente al responder: mas formal, mas cercano o mas entusiasta."
                    />
                  </legend>
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

                <TrainingResponseLengthField
                  defaultValue={training.responseLength}
                  helpText="Controla si el agente respondera corto y directo o con mas contexto cuando explique y venda."
                />
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 sm:p-5 lg:p-6">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-950">Estilo y cierre</h3>
                  <TrainingHelpPopover
                    title="Estilo y cierre"
                    description="Activa aqui los comportamientos que quieres ver en la conversacion: como habla, como recomienda y como intenta cerrar la venta."
                  />
                </div>
                <div className="grid gap-3">
                  <ToggleField name="useEmojis" title="Usar emojis" description="Puede usarlos con moderacion." defaultChecked={training.useEmojis} helpText="Activalo si tu marca se comunica de forma cercana y natural. Si tu negocio es mas serio, puedes dejarlo apagado." />
                  <ToggleField name="useExpressivePunctuation" title="Usar ! y ?" description="Usa signos expresivos cuando suene natural." defaultChecked={training.useExpressivePunctuation} helpText="Permite respuestas con mas energia cuando encajen con la conversacion, sin sonar exagerado." />
                  <ToggleField name="useTuteo" title="Tutear al cliente" description="Habla de tu en lugar de usted." defaultChecked={training.useTuteo} helpText="Enciendelo si tu negocio habla de forma cercana. Apagalo si prefieres una comunicacion mas formal o neutra." />
                  <ToggleField name="useCustomerName" title="Llamarlo por nombre" description="Usa el nombre cuando ya lo sepa." defaultChecked={training.useCustomerName} helpText="Ayuda a que la conversacion se sienta mas personal cuando el cliente ya compartio su nombre." />
                  <ToggleField name="askNameFirst" title="Preguntar el nombre al inicio" description="Se presenta y pide el nombre." defaultChecked={training.askNameFirst} helpText="Sirve si quieres que el agente personalice desde el primer mensaje. Si prefieres ir directo al punto, puedes apagarlo." />
                  <ToggleField name="offerBestSeller" title="Ofrecer el producto mas vendido" description="Si el cliente duda, recomienda una opcion fuerte." defaultChecked={training.offerBestSeller} helpText="Hace que el agente sugiera una opcion segura cuando el cliente no sabe cual elegir." />
                  <ToggleField name="handlePriceObjections" title="Manejar objeciones de precio" description='Responde "esta muy caro" con argumentos de valor.' defaultChecked={training.handlePriceObjections} helpText="Permite que el agente defienda el valor de tu oferta cuando el cliente dude por precio." />
                  <ToggleField name="askForOrder" title="Pedir el pedido directamente" description='Despues de resolver dudas, intenta cerrar con "Te lo reservo?".' defaultChecked={training.askForOrder} helpText="Hace que el agente intente cerrar la venta con una pregunta directa cuando vea intencion de compra." />
                  <ToggleField name="sendPaymentLink" title="Enviar link de pago" description="Si el cliente confirma, indica el paso de pago." defaultChecked={training.sendPaymentLink} helpText="Usalo si tu proceso de venta ya tiene un enlace o paso de pago claro que el agente pueda mencionar." />
                  <ToggleField name="handoffToHuman" title="Escalar a humano" description="Avisa cuando algo este fuera de su alcance." defaultChecked={training.handoffToHuman} helpText="Recomendado para casos especiales, dudas complejas o cuando el cliente necesite atencion de una persona." />
                </div>
              </div>
            </Card>

            <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 sm:p-5 lg:p-6">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-[var(--primary)]" />
                  <h3 className="text-lg font-semibold text-slate-950">Reglas importantes</h3>
                  <TrainingHelpPopover
                    title="Reglas importantes"
                    description="Estas reglas protegen al negocio para que el agente no invente informacion ni haga promesas incorrectas."
                  />
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
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <span>Otras reglas especificas del negocio</span>
                    <TrainingHelpPopover
                      title="Otras reglas del negocio"
                      description="Escribe aqui condiciones especiales que el agente deba respetar, por ejemplo politicas, tiempos o limites de atencion."
                    />
                  </span>
                  <textarea
                    name="customRules"
                    rows={5}
                    defaultValue={training.customRules}
                    className="flex w-full rounded-[24px] border border-[rgba(148,163,184,0.18)] bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-[var(--primary)]"
                  />
                </label>
              </div>
            </Card>

            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] sm:w-auto"
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
