import { CheckCircle2, Clock3, KeyRound, Link2 } from "lucide-react";
import type { OfficialApiAdminSummary } from "@/features/official-api";

type OfficialApiClientSummaryProps = {
  summary: OfficialApiAdminSummary;
};

export function OfficialApiClientSummary({ summary }: OfficialApiClientSummaryProps) {
  return (
    <div className="rounded-xl border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Api oficial</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Base estructural de WhatsApp Cloud API por cliente.
          </p>
        </div>
        <span
          className={
            summary.setupStatus === "connected"
              ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
              : "inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
          }
        >
          {summary.setupStatus === "connected" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
          {summary.setupStatus === "connected" ? "Configurado" : "Pendiente"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-muted p-4">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Workspace del cliente</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {summary.hasWorkspace ? summary.workspaceName : "Este usuario aun no tiene negocio principal."}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-muted p-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Campos previstos</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.configuredFields.length > 0 ? (
              summary.configuredFields.map((field) => (
                <span
                  key={field}
                  className="inline-flex rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground"
                >
                  {field}
                </span>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">
                access_token, phone_number_id y waba_id se conectaran en la siguiente fase.
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        En la Fase 2 este bloque tendra el formulario para guardar credenciales reales desde administracion de usuarios.
      </p>
    </div>
  );
}
