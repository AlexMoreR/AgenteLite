import Link from "next/link";
import { CheckCircle2, ChevronLeft, Smartphone } from "lucide-react";
import { toggleConnectionChannelStatusAction } from "@/app/actions/connection-actions";
import { WhatsappQrAutoRefresh } from "@/components/agents/whatsapp-qr-auto-refresh";
import { WhatsappQrCountdown } from "@/components/agents/whatsapp-qr-countdown";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";

type WhatsAppBusinessConnectionWorkspaceProps = {
  connection: {
    id: string;
    name: string;
    provider: string;
    isActive: boolean;
    agentId: string | null;
    agentName: string;
  };
  isConnected: boolean;
  qrDataUrl: string;
  pairingCode: string;
  hasQrCode: boolean;
  channelStatus: string | null | undefined;
  okMessage: string;
  errorMessage: string;
};

export function WhatsAppBusinessConnectionWorkspace({
  connection,
  isConnected,
  qrDataUrl,
  pairingCode,
  hasQrCode,
  channelStatus,
  okMessage,
  errorMessage,
}: WhatsAppBusinessConnectionWorkspaceProps) {
  const effectiveErrorMessage = hasQrCode || channelStatus === "QRCODE" || isConnected ? "" : errorMessage;

  return (
    <section className="space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={effectiveErrorMessage}
        okTitle="WhatsApp listo"
        errorTitle="No pudimos completar la conexion"
      />

      {!isConnected ? <WhatsappQrAutoRefresh isConnected={isConnected} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/cliente/conexion"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          <ChevronLeft className="h-4 w-4" />
          Volver
        </Link>
        <form action={toggleConnectionChannelStatusAction}>
          <input type="hidden" name="channelId" value={connection.id} />
          <input type="hidden" name="returnTo" value={`/cliente/conexion/whatsapp-business/${connection.id}`} />
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-2.5 rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
            aria-label={connection.isActive ? `Apagar ${connection.name}` : `Encender ${connection.name}`}
          >
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${
                connection.isActive ? "bg-emerald-500/90" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_2px_10px_-4px_rgba(15,23,42,0.45)] transition-transform ${
                  connection.isActive ? "translate-x-4.5" : "translate-x-0.5"
                }`}
              />
            </span>
            {connection.isActive ? "Canal encendido" : "Canal apagado"}
          </button>
        </form>
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">{connection.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {connection.provider === "OFFICIAL_API" ? "WhatsApp API (Meta)" : "WhatsApp QR Code"}
            {connection.agentName ? ` · Agente vinculado: ${connection.agentName}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.3)] sm:rounded-[28px] sm:p-5">
          {isConnected ? (
            <div className="flex flex-col items-center text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,#16a34a_12%,white)] text-[#16a34a]">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.04em] text-slate-950">WhatsApp conectado</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Este canal ya esta vinculado y listo para seguir operando.
              </p>
              {connection.agentId ? (
                <Link
                  href={`/cliente/agentes/${connection.agentId}`}
                  className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-full bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] sm:w-auto"
                >
                  Ir al agente
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="flex aspect-square w-full max-w-[248px] items-center justify-center rounded-[24px] bg-slate-50">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt="QR de conexion de WhatsApp" className="h-auto w-[90%] max-w-[220px]" />
                ) : (
                  <p className="text-sm text-slate-500">Esperando QR...</p>
                )}
              </div>

              {pairingCode ? (
                <div className="mt-4 w-full rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Codigo alterno</p>
                  <p className="mt-2 font-mono text-sm font-semibold text-slate-900">{pairingCode}</p>
                </div>
              ) : null}

              <div className="mt-4 w-full">
                <WhatsappQrCountdown isConnected={isConnected} cycleSeconds={40} />
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.24)] sm:rounded-[28px] sm:p-5">
          {isConnected ? (
            <div className="rounded-[24px] border border-[rgba(22,163,74,0.12)] bg-[color-mix(in_srgb,#16a34a_4%,white)] px-5 py-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,#16a34a_12%,white)] text-[#16a34a]">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Conexion completada</h2>
                  <p className="text-sm text-slate-600">Tu canal ya quedo activo.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-[1.05rem] font-semibold tracking-[-0.04em] text-slate-950">Vincula tu cuenta</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Escanea el QR desde WhatsApp para dejar este canal conectado.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <StepCard step="1" title="Abre WhatsApp" description="En tu telefono, abre la app principal." />
                <StepCard
                  step="2"
                  title="Ve a dispositivos vinculados"
                  description="Entra al menu y toca la opcion para vincular un dispositivo."
                />
                <StepCard
                  step="3"
                  title="Escanea el codigo QR"
                  description="Apunta la camara y espera la confirmacion de conexion."
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StepCard({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-4 py-4">
      <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-[var(--primary)] shadow-sm">
        {step}
      </div>
      <p className="mt-3 text-sm font-semibold leading-5 text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-5 text-slate-600">{description}</p>
    </div>
  );
}
