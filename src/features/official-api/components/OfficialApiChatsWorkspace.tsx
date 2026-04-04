import { MessageSquareText, Send, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { OfficialApiOverview } from "@/features/official-api/types/official-api";

type OfficialApiChatsWorkspaceProps = {
  overview: OfficialApiOverview;
};

export function OfficialApiChatsWorkspace({ overview }: OfficialApiChatsWorkspaceProps) {
  const isConnected = overview.setupStatus === "connected";

  return (
    <section className="space-y-5">
      <Card className="overflow-hidden border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(239,246,255,0.98)_100%)] p-5 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.18)]">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
            <MessageSquareText className="h-3.5 w-3.5" />
            Chats
          </div>

          <div className="space-y-2">
            <h1 className="text-[1.5rem] font-semibold tracking-[-0.05em] text-slate-950 sm:text-[1.8rem]">
              Bandeja de conversaciones
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Esta seccion sera la entrada para conversaciones, contactos y envio de mensajes usando la Cloud API oficial de Meta.
            </p>
          </div>

          <div
            className={`rounded-[18px] border px-4 py-3 text-sm leading-6 ${
              isConnected
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {isConnected
              ? "La configuracion base ya existe. El siguiente paso es conectar la bandeja con conversaciones reales."
              : "La bandeja aun no puede activarse porque primero falta completar o validar las credenciales base de la API oficial."}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.16)]">
          <div className="flex items-center gap-2">
            <Users className="h-4.5 w-4.5 text-[var(--primary)]" />
            <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Contactos</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Directorio sincronizado por cliente con identificadores de WhatsApp y datos basicos del contacto.
          </p>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.16)]">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4.5 w-4.5 text-[var(--primary)]" />
            <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Conversaciones</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Hilo por contacto con estados, ultima actividad y seguimiento de mensajes entrantes y salientes.
          </p>
        </Card>

        <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.16)]">
          <div className="flex items-center gap-2">
            <Send className="h-4.5 w-4.5 text-[var(--primary)]" />
            <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Envio</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Preparado para agregar composer, plantillas y control de estado de entrega en la siguiente fase.
          </p>
        </Card>
      </div>
    </section>
  );
}
