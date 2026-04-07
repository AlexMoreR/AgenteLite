import { MessageSquareText } from "lucide-react";
import type { OfficialApiChatsData } from "@/features/official-api/types/official-api";

type OfficialApiChatsWorkspaceProps = {
  data: OfficialApiChatsData;
};

export function OfficialApiChatsWorkspace({}: OfficialApiChatsWorkspaceProps) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
          <MessageSquareText className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-950">Cargando bandeja oficial</h3>
          <p className="text-sm leading-6 text-slate-600">
            Esta vista ahora se resuelve desde la pagina del modulo para reutilizar el layout del chat principal.
          </p>
        </div>
      </div>
    </div>
  );
}
