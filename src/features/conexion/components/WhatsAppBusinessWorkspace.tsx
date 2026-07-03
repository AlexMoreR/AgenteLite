import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, Clock3, MessageSquareText, Smartphone } from "lucide-react";

type WhatsAppBusinessWorkspaceProps = {
  summary: {
    totalAgents: number;
    connectedAgents: number;
    pendingAgents: number;
    disconnectedAgents: number;
  };
  items: Array<{
    id: string;
    name: string;
    provider: string;
    providerLabel: string;
    linkedAgentName: string;
    linkedAgentStatus: string;
    channelStatus: string | null;
    channelStatusLabel: string;
    phoneNumber: string;
    lastConnectionAt: Date | null;
    conversationsCount: number;
    messagesCount: number;
  }>;
};

export function WhatsAppBusinessWorkspace({ summary, items }: WhatsAppBusinessWorkspaceProps) {
  return (
    <section className="app-page space-y-5">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Conexion</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">WhatsApp Business</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Aqui administras los canales de WhatsApp que se crean dentro del modulo de conexion.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Canales" value={String(summary.totalAgents)} icon={<MessageSquareText className="h-4 w-4" />} />
        <SummaryCard label="Conectados" value={String(summary.connectedAgents)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <SummaryCard label="Esperando QR" value={String(summary.pendingAgents)} icon={<Clock3 className="h-4 w-4" />} />
        <SummaryCard label="Sin conectar" value={String(summary.disconnectedAgents)} icon={<Smartphone className="h-4 w-4" />} />
      </div>

      <div className="grid gap-2">
        {items.length ? (
          items.map((item) => {
            const isConnected = item.channelStatus === "CONNECTED";
            const isPending = item.channelStatus === "QRCODE";

            return (
              <Link
                key={item.id}
                href={`/cliente/conexion/whatsapp-business/${item.id}`}
                className="group rounded-2xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-tight text-foreground">{item.name}</h2>
                      <StatusPill
                        label={item.channelStatusLabel}
                        tone={isConnected ? "success" : isPending ? "warning" : "neutral"}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                      {item.linkedAgentName ? (
                        <span className="rounded-full bg-muted px-3 py-1">
                          Agente: {item.linkedAgentName} ({item.linkedAgentStatus})
                        </span>
                      ) : null}
                      {item.phoneNumber ? (
                        <span className="rounded-full bg-muted px-3 py-1">Numero: {item.phoneNumber}</span>
                      ) : null}
                      <span className="rounded-full bg-muted px-3 py-1">{item.conversationsCount} conversaciones</span>
                      <span className="rounded-full bg-muted px-3 py-1">{item.messagesCount} mensajes</span>
                    </div>
                  </div>

                  <div className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                    Abrir conexion
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed bg-card px-5 py-8 text-sm text-muted-foreground">
            Aun no hay canales creados. Usa el boton de nuevo canal para crear una conexion.
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        {icon}
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "warning" | "neutral" }) {
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-border bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest ${className}`}>
      {label}
    </span>
  );
}
