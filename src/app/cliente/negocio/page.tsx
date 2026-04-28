import { redirect } from "next/navigation";
import { Building2, Globe, Instagram, Mail, MapPin, Phone, Save, Tag, Youtube } from "lucide-react";
import { auth } from "@/auth";
import { saveWorkspaceBusinessConfigAction } from "@/app/actions/workspace-actions";
import { BusinessChatsCleanupMenu } from "./BusinessChatsCleanupMenu";
import { Card } from "@/components/ui/card";
import { targetAudienceOptions } from "@/lib/agent-training";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { parseWorkspaceBusinessConfig } from "@/lib/workspace-business-config";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-[var(--primary)]" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</span>
    </div>
  );
}

function Field({
  label,
  name,
  icon,
  defaultValue,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  icon: React.ReactNode;
  defaultValue: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
        {icon}
        {label}
      </label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="field-select h-10 w-full rounded-[16px] border-[rgba(148,163,184,0.14)] bg-white text-[13px] focus:border-[var(--primary)]"
      />
    </div>
  );
}

export default async function MiNegocioPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/onboarding");
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: membership.workspace.id },
    select: { id: true, name: true, businessConfig: true },
  });

  if (!workspace) {
    redirect("/cliente/onboarding");
  }

  const config = parseWorkspaceBusinessConfig(workspace.businessConfig);
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-[var(--primary)]" />
        <div>
          <h1 className="text-[18px] font-semibold tracking-[-0.04em] text-slate-950">Mi negocio</h1>
          <p className="text-sm text-slate-500">Informacion base que el agente usa para responder.</p>
        </div>
      </div>

      {okMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {okMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <form action={saveWorkspaceBusinessConfigAction} className="space-y-5">
        <Card className="border border-[rgba(148,163,184,0.14)] p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
            <SectionHeader title="Identidad" />
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-700">Nombre del negocio</label>
              <input
                name="businessName"
                defaultValue={workspace.name}
                placeholder="Ej. Magilus"
                required
                minLength={2}
                className="field-select h-10 w-full rounded-[16px] border-[rgba(148,163,184,0.14)] bg-white text-[13px] focus:border-[var(--primary)]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-700">Descripcion del negocio</label>
              <textarea
                name="businessDescription"
                defaultValue={config.businessDescription}
                rows={4}
                placeholder="Escribe como se lo explicarias a un cliente por WhatsApp: que vendes, para quien y por que deberia interesarle."
                className="flex min-h-[120px] w-full resize-y rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-white px-4 py-3 text-[13px] leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)]"
              />
            </div>
          </div>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
            <SectionHeader title="Cliente ideal" />
            <p className="text-[12px] leading-5 text-slate-500">Marca las opciones que mas se parezcan a tu cliente ideal.</p>
            <div className="flex flex-wrap gap-2">
              {targetAudienceOptions.map((option) => (
                <label key={option} className="cursor-pointer">
                  <input
                    type="checkbox"
                    name="targetAudiences"
                    value={option}
                    defaultChecked={config.targetAudiences.includes(option)}
                    className="peer sr-only"
                  />
                  <span className="inline-flex min-h-9 items-center justify-center rounded-full border border-[rgba(148,163,184,0.14)] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 shadow-[0_10px_18px_-26px_rgba(15,23,42,0.22)] transition hover:border-[color-mix(in_srgb,var(--primary)_30%,white)] peer-checked:border-[color-mix(in_srgb,var(--primary)_88%,white)] peer-checked:bg-[color-mix(in_srgb,var(--primary)_8%,white)] peer-checked:text-[var(--primary)]">
                    {option}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
            <SectionHeader title="Rango de precios" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Precio desde" name="priceRangeMin" icon={null} defaultValue={config.priceRangeMin} placeholder="Ej. 80.000 COP" />
              <Field label="Precio hasta" name="priceRangeMax" icon={null} defaultValue={config.priceRangeMax} placeholder="Ej. 220.000 COP" />
            </div>
          </div>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
            <SectionHeader title="Contacto y ubicacion" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ubicacion / Direccion" name="location" icon={<MapPin className="h-3.5 w-3.5" />} defaultValue={config.location} placeholder="Ej. Calle 10 #45-20, Bogota" />
              <Field label="Sitio web" name="website" icon={<Globe className="h-3.5 w-3.5" />} defaultValue={config.website} placeholder="Ej. www.minegocio.com" />
              <Field label="Numero de contacto" name="contactPhone" icon={<Phone className="h-3.5 w-3.5" />} defaultValue={config.contactPhone} placeholder="Ej. +57 300 000 0000" />
              <Field label="Correo" name="contactEmail" icon={<Mail className="h-3.5 w-3.5" />} defaultValue={config.contactEmail} placeholder="Ej. hola@minegocio.com" type="email" />
            </div>
          </div>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
            <SectionHeader title="Redes sociales" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Instagram" name="instagram" icon={<Instagram className="h-3.5 w-3.5" />} defaultValue={config.instagram} placeholder="@minegocio" />
              <Field label="Facebook" name="facebook" icon={<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>} defaultValue={config.facebook} placeholder="@minegocio" />
              <Field label="TikTok" name="tiktok" icon={<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.75a4.84 4.84 0 0 1-1.01-.06z"/></svg>} defaultValue={config.tiktok} placeholder="@minegocio" />
              <Field label="YouTube" name="youtube" icon={<Youtube className="h-3.5 w-3.5" />} defaultValue={config.youtube} placeholder="@minegocio" />
            </div>
          </div>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
            <SectionHeader title="Automatizaciones base" />
            <div className="rounded-[20px] border border-[color-mix(in_srgb,var(--primary)_12%,white)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                  <Tag className="h-4 w-4" />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-slate-950">Nuevo lead por defecto</p>
                  <p className="text-sm leading-6 text-slate-600">
                    Cuando entra un contacto nuevo por WhatsApp, el sistema puede asignarle esta etiqueta de forma automática.
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                <label className="text-[13px] font-medium text-slate-700">Nombre de la etiqueta</label>
                <input
                  name="newLeadTagName"
                  defaultValue={config.newLeadTagName}
                  placeholder="Ej. Nuevo lead"
                  className="field-select h-10 w-full rounded-[16px] border-[rgba(148,163,184,0.14)] bg-white text-[13px] focus:border-[var(--primary)]"
                />
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[18px] border border-slate-100 bg-white px-4 py-3 transition hover:border-[color-mix(in_srgb,var(--primary)_20%,white)]">
                <input
                  type="checkbox"
                  name="autoTagNewLeads"
                  defaultChecked={config.autoTagNewLeads}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
                />
                <span className="space-y-1">
                  <span className="block text-[13px] font-medium text-slate-800">Activar etiqueta automática</span>
                  <span className="block text-[12px] leading-5 text-slate-500">
                    Se creará y asignará la etiqueta <span className="font-medium text-slate-700">Nuevo lead</span> solo en contactos que aparezcan por primera vez.
                  </span>
                </span>
              </label>
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] leading-5 text-slate-500">
            El menu de acciones del negocio queda disponible aqui abajo para tareas sensibles.
          </p>
          <div className="flex items-center gap-2">
            <BusinessChatsCleanupMenu />
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[16px] bg-[var(--primary)] px-5 text-[13px] font-semibold text-white shadow-[0_18px_32px_-20px_color-mix(in_srgb,var(--primary)_58%,black)] transition hover:bg-[var(--primary-strong)]"
            >
              <Save className="h-4 w-4" />
              Guardar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
