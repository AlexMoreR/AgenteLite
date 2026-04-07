import { LockKeyhole } from "lucide-react";
import { Card } from "@/components/ui/card";

type OfficialApiLockedStateProps = {
  title?: string;
  description?: string;
  workspaceName?: string;
};

export function OfficialApiLockedState({
  title = "Api oficial no disponible",
  description = "Habla con un administrador para activar esta funcion",
  workspaceName,
}: OfficialApiLockedStateProps) {
  return (
    <section className="space-y-5">
      <Card className="overflow-hidden border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.98)_100%)] p-6 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.18)]">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            <LockKeyhole className="h-3.5 w-3.5" />
            Acceso pendiente
          </div>
          <div className="space-y-2">
            <h1 className="text-[1.5rem] font-semibold tracking-[-0.05em] text-slate-950 sm:text-[1.8rem]">
              {title}
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
            {workspaceName ? (
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                Workspace actual: {workspaceName}
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}
