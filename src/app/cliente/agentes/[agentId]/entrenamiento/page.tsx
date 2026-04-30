import { redirect } from "next/navigation";
import { Shield } from "lucide-react";
import { BusinessNameHeader } from "@/components/agents/business-name-header";
import { AgentTrainingAutosaveForm } from "@/components/agents/agent-training-autosave-form";
import { auth } from "@/auth";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
import { TrainingSalesToneField } from "@/components/agents/training-sales-tone-field";
import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import { TrainingResponseLengthField } from "@/components/agents/training-response-length-field";
import { NewCustomerWelcomeField } from "@/components/agents/new-customer-welcome-field";
import { TrainingTextareaField } from "@/components/agents/training-textarea-field";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  buildDefaultNewCustomerWelcomeMessage,
  defaultAgentTrainingConfig,
  forbiddenRuleOptions,
  parseAgentTrainingConfig,
  targetAudienceOptions,
} from "@/lib/agent-training";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { parseWorkspaceBusinessConfig } from "@/lib/workspace-business-config";

type PageProps = {
  params: Promise<{ agentId: string }>;
};

function SectionHeader({
  title,
  helpText,
}: {
  title: string;
  helpText?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-[var(--primary)]" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</span>
      {helpText ? <TrainingHelpPopover title={title} description={helpText} /> : null}
    </div>
  );
}

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
    <label className="group flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-[18px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] px-3.5 py-3 transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-[color-mix(in_srgb,var(--primary)_34%,white)] hover:shadow-[0_18px_32px_-28px_rgba(15,23,42,0.26)] active:scale-[0.997]">
      <span className="min-w-0 space-y-0.5">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold leading-5 text-slate-900">
          <span>{title}</span>
          <TrainingHelpPopover title={title} description={helpText} />
        </span>
        <span className="block text-[12px] leading-5 text-slate-500">{description}</span>
      </span>
      <span className="relative shrink-0">
        <Switch
          name={name}
          defaultChecked={defaultChecked}
          aria-label={title}
          className="h-6 w-11 bg-slate-200 data-[state=checked]:bg-[var(--primary)] data-[state=checked]:shadow-[0_8px_18px_-14px_color-mix(in_srgb,var(--primary)_88%,black)]"
        />
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
      description: true,
      trainingConfig: true,
      workspace: {
        select: {
          name: true,
          businessConfig: true,
        },
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const training = parseAgentTrainingConfig(agent.trainingConfig) ?? defaultAgentTrainingConfig;
  const workspaceBusiness = parseWorkspaceBusinessConfig(agent.workspace.businessConfig);

  // Campos de negocio: workspace.businessConfig es la fuente de verdad
  const businessDescription = workspaceBusiness.businessDescription || training.businessDescription;
  const targetAudiences = workspaceBusiness.targetAudiences.length > 0 ? workspaceBusiness.targetAudiences : training.targetAudiences;
  const priceRangeMin = workspaceBusiness.priceRangeMin || training.priceRangeMin;
  const priceRangeMax = workspaceBusiness.priceRangeMax || training.priceRangeMax;
  const location = workspaceBusiness.location || training.location;
  const website = workspaceBusiness.website || training.website;
  const contactPhone = workspaceBusiness.contactPhone || training.contactPhone;
  const contactEmail = workspaceBusiness.contactEmail || training.contactEmail;
  const instagram = workspaceBusiness.instagram || training.instagram;
  const facebook = workspaceBusiness.facebook || training.facebook;
  const tiktok = workspaceBusiness.tiktok || training.tiktok;
  const youtube = workspaceBusiness.youtube || training.youtube;

  return (
    <AgentPanelShell agentId={agent.id}>
      <AgentTrainingAutosaveForm agentId={agent.id} className="space-y-4">
        <input type="hidden" name="agentId" value={agent.id} />
        <input type="hidden" name="postCreateAction" value="probar" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(340px,0.82fr)]">
          <Card className="border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] p-4 shadow-[0_20px_44px_-38px_rgba(15,23,42,0.18)] sm:p-5">
            <div className="space-y-5">
              <BusinessNameHeader
                agentId={agent.id}
                businessName={agent.workspace.name}
                businessSummary={workspaceBusiness.businessDescription || agent.description || ""}
                location={location}
                website={website}
                contactPhone={contactPhone}
                contactEmail={contactEmail}
                instagram={instagram}
                facebook={facebook}
                tiktok={tiktok}
                youtube={youtube}
              />

              <div className="space-y-3.5">
                <label className="space-y-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                    <span>Nombre del asistente</span>
                    <TrainingHelpPopover
                      title="Nombre del asistente"
                      description="Como quieres que se presente el agente con los clientes. Ejemplo: Magilus, Magi, Asesora Ingrid. Si lo dejas vacio usa el nombre del agente por defecto."
                    />
                  </span>
                  <input
                    type="text"
                    name="assistantName"
                    defaultValue={training.assistantName}
                    placeholder={agent.name}
                    maxLength={40}
                    className="flex w-full rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-white px-3.5 py-2.5 text-[13px] leading-6 text-slate-800 shadow-[0_18px_32px_-34px_rgba(15,23,42,0.18)] outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)]"
                  />
                </label>

                <NewCustomerWelcomeField
                  businessName={agent.workspace.name}
                  defaultChecked={training.greetNewCustomers}
                  defaultMessage={training.customWelcomeMessage || buildDefaultNewCustomerWelcomeMessage(agent.workspace.name)}
                />

                <SectionHeader
                  title="Contexto"
                  helpText="Aqui va la explicacion comercial que el agente usara para vender por WhatsApp. Es distinta al resumen general del negocio."
                />
                <label className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                    <span>Que vendes y como lo explicarias en WhatsApp</span>
                  </span>
                  <TrainingTextareaField
                    name="businessDescription"
                    rows={4}
                    defaultValue={businessDescription}
                    placeholder="Escribe como se lo explicarias a un cliente por WhatsApp: que vendes, para quien y por que deberia interesarle."
                    minLength={12}
                    className="flex min-h-[138px] w-full rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-white px-3.5 py-3 text-[13px] leading-6 text-slate-800 shadow-[0_18px_32px_-34px_rgba(15,23,42,0.18)] outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)]"
                    required
                  />
                </label>

                <fieldset className="space-y-2.5">
                  <legend className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                    <span>A que tipo de cliente le vendes</span>
                    <TrainingHelpPopover
                      title="Tipo de cliente"
                      description="Selecciona los perfiles que mas te compran. Esto ayuda al agente a usar ejemplos y tono mas cercanos."
                    />
                  </legend>
                  <p className="text-[12px] leading-5 text-slate-500">Marca las opciones que mas se parezcan a tu cliente ideal.</p>
                  <div className="flex flex-wrap gap-2">
                    {targetAudienceOptions.map((option) => (
                      <label key={option} className="cursor-pointer">
                        <input
                          type="checkbox"
                          name="targetAudiences"
                          value={option}
                          defaultChecked={targetAudiences.includes(option)}
                          className="peer sr-only"
                        />
                        <span className="inline-flex min-h-9 items-center justify-center rounded-full border border-[rgba(148,163,184,0.14)] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 shadow-[0_10px_18px_-26px_rgba(15,23,42,0.22)] transition hover:border-[color-mix(in_srgb,var(--primary)_30%,white)] peer-checked:border-[color-mix(in_srgb,var(--primary)_88%,white)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_8%,white)] peer-checked:text-[var(--primary)]">
                          {option}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <TrainingSalesToneField
                  defaultValue={training.salesTone}
                  helpText="Aqui eliges la personalidad del agente al responder: mas formal, mas cercano o mas entusiasta."
                />
              </div>

              <div className="rounded-[22px] border border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fafbfc_100%)] p-4">
                <div className="min-w-0 space-y-3">
                    <div className="space-y-0.5">
                      <SectionHeader
                        title="Ajuste fino"
                        helpText="Si manejas un rango de precios, escribirlo ayuda a que el agente oriente mejor al cliente."
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                          <span>Precio desde</span>
                          <TrainingHelpPopover
                            title="Precio desde"
                            description="Pon el valor mas bajo habitual de tu oferta. Si no manejas un minimo claro, puedes dejarlo vacio."
                          />
                        </span>
                        <input
                          name="priceRangeMin"
                          defaultValue={priceRangeMin}
                          placeholder="Ej. 80.000 COP"
                          className="field-select h-10 rounded-[16px] border-[rgba(148,163,184,0.14)] bg-slate-50 text-[13px] focus:border-[var(--primary)]"
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                          <span>Precio hasta</span>
                          <TrainingHelpPopover
                            title="Precio hasta"
                            description="Pon el valor mas alto habitual para que el agente pueda orientar mejor a clientes con distinto presupuesto."
                          />
                        </span>
                        <input
                          name="priceRangeMax"
                          defaultValue={priceRangeMax}
                          placeholder="Ej. 220.000 COP"
                          className="field-select h-10 rounded-[16px] border-[rgba(148,163,184,0.14)] bg-slate-50 text-[13px] focus:border-[var(--primary)]"
                        />
                      </label>
                    </div>

                    <TrainingResponseLengthField
                      defaultValue={training.responseLength}
                      helpText="Controla si el agente respondera corto y directo o con mas contexto cuando explique y venda."
                    />
                </div>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] p-4 shadow-[0_20px_44px_-38px_rgba(15,23,42,0.18)] sm:p-5">
              <div className="space-y-3.5">
                <SectionHeader
                  title="Estilo y cierre"
                  helpText="Activa aqui los comportamientos que quieres ver en la conversacion: como habla, como recomienda y como intenta cerrar la venta."
                />
                <div className="grid gap-2.5">
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

            <Card className="border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] p-4 shadow-[0_20px_44px_-38px_rgba(15,23,42,0.18)] sm:p-5">
              <div className="space-y-3.5">
                <div className="flex items-center justify-between gap-3">
                  <SectionHeader
                    title="Reglas importantes"
                    helpText="Estas reglas protegen al negocio para que el agente no invente informacion ni haga promesas incorrectas."
                  />
                  <Shield className="h-4.5 w-4.5 shrink-0 text-[var(--primary)]" />
                </div>
                <div className="grid gap-2.5">
                  {forbiddenRuleOptions.map((rule) => (
                    <label key={rule} className="flex items-center gap-2.5 rounded-[16px] border border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-3.5 py-2.5 transition hover:border-[color-mix(in_srgb,var(--primary)_28%,white)]">
                      <input
                        type="checkbox"
                        name="forbiddenRules"
                        value={rule}
                        defaultChecked={training.forbiddenRules.includes(rule)}
                        className="h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
                      />
                      <span className="text-[13px] leading-5 text-slate-700">{rule}</span>
                    </label>
                  ))}
                </div>
                <label className="space-y-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                    <span>Otras reglas especificas del negocio</span>
                    <TrainingHelpPopover
                      title="Otras reglas del negocio"
                      description="Escribe aqui condiciones especiales que el agente deba respetar, por ejemplo politicas, tiempos o limites de atencion."
                    />
                  </span>
                  <TrainingTextareaField
                    name="customRules"
                    rows={4}
                    defaultValue={training.customRules}
                    className="flex w-full rounded-[20px] border border-[rgba(148,163,184,0.16)] bg-white px-3.5 py-3 text-[13px] leading-6 text-slate-800 outline-none transition focus:border-[var(--primary)]"
                  />
                </label>
              </div>
            </Card>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-[16px] bg-[var(--primary)] px-5 text-[13px] font-semibold text-white shadow-[0_18px_32px_-20px_color-mix(in_srgb,var(--primary)_58%,black)] transition hover:bg-[var(--primary-strong)]"
          >
            Guardar entrenamiento
          </button>
        </div>
      </AgentTrainingAutosaveForm>
    </AgentPanelShell>
  );
}
