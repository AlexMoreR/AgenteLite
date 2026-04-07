import type { OfficialApiOverview } from "@/features/official-api/types/official-api";
import { Card } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

type OfficialApiWorkspaceProps = {
  overview: OfficialApiOverview;
};

export function OfficialApiWorkspace({ overview }: OfficialApiWorkspaceProps) {
  return (
    <section className="space-y-5">
      <Card className="overflow-hidden border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(239,246,255,0.98)_100%)] p-6 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.18)]">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Resumen
          </div>
          <div className="space-y-2">
            <h1 className="text-[1.5rem] font-semibold tracking-[-0.05em] text-slate-950 sm:text-[1.8rem]">
              Api oficial activa
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">{overview.connectedLabel}</p>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              Workspace actual: {overview.workspaceName}
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}
