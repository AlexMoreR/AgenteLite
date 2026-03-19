import { redirect } from "next/navigation";
import { Save, Settings } from "lucide-react";
import { auth } from "@/auth";
import {
  adminUpdateBrandNameAction,
  adminUpdateCurrencyAction,
  adminUpdatePrimaryColorAction,
} from "@/app/actions/settings-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { getSystemBrandName, getSystemCurrency, getSystemPrimaryColor } from "@/lib/system-settings";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminConfiguracionNegocioPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "config_business");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  const [systemCurrency, systemPrimaryColor, systemBrandName] = await Promise.all([
    getSystemCurrency(),
    getSystemPrimaryColor(),
    getSystemBrandName(),
  ]);

  return (
    <section className="w-full space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Configuracion guardada"
        errorTitle="Error de configuracion"
      />

      <div>
        <h1 className="inline-flex items-center gap-1 text-lg font-semibold tracking-tight text-slate-900 md:text-xl">
          <Settings className="h-4 w-4 text-slate-500" />
          <span>Configuracion negocio</span>
        </h1>
        <p className="mt-1 text-xs text-slate-600">
          Ajusta moneda activa, identidad visual y parametros generales del sistema.
        </p>
      </div>

      <Card className="space-y-3">
        <form action={adminUpdateBrandNameAction} className="flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Nombre de la marca</span>
            <Input
              name="brandName"
              defaultValue={systemBrandName}
              placeholder="Nombre comercial"
              className="h-11"
              required
            />
          </label>
          <button
            type="submit"
            aria-label="Guardar marca"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
          >
            <Save className="h-4 w-4" />
          </button>
        </form>

        <form action={adminUpdateCurrencyAction} className="flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Moneda activa</span>
            <select name="currency" defaultValue={systemCurrency} className="field-select" required>
              {SUPPORTED_CURRENCIES.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            aria-label="Guardar moneda"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
          >
            <Save className="h-4 w-4" />
          </button>
        </form>

        <form action={adminUpdatePrimaryColorAction} className="flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Color primario</span>
            <div className="flex items-center gap-2">
              <Input
                name="primaryColor"
                type="color"
                defaultValue={systemPrimaryColor}
                className="h-11 w-16 rounded-lg border border-[var(--line)] bg-white p-1"
                required
              />
              <Input
                value={systemPrimaryColor}
                readOnly
                className="h-11 flex-1 bg-slate-50 text-xs text-slate-600"
              />
            </div>
          </label>
          <button
            type="submit"
            aria-label="Guardar color"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
          >
            <Save className="h-4 w-4" />
          </button>
        </form>
      </Card>
    </section>
  );
}
