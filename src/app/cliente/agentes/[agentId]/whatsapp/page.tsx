import QRCode from "qrcode";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Smartphone } from "lucide-react";
import { auth } from "@/auth";
import { WhatsappQrAutoRefresh } from "@/components/agents/whatsapp-qr-auto-refresh";
import { WhatsappQrCountdown } from "@/components/agents/whatsapp-qr-countdown";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { getEvolutionConnectionQr, getEvolutionConnectionState } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function buildQrDataUrl(qrValue: string | null) {
  if (!qrValue) {
    return "";
  }

  if (qrValue.startsWith("data:image")) {
    return qrValue;
  }

  if (/^[A-Za-z0-9+/=]+$/.test(qrValue) && qrValue.length > 300) {
    return `data:image/png;base64,${qrValue}`;
  }

  return QRCode.toDataURL(qrValue, {
    margin: 1,
    width: 220,
  });
}

export default async function ClienteAgenteWhatsappPage({ params, searchParams }: PageProps) {
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
    include: {
      channels: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const channel = agent.channels[0] ?? null;
  const remoteConnectionState = channel?.evolutionInstanceName
    ? await getEvolutionConnectionState(channel.evolutionInstanceName)
    : null;
  const remoteConnectionQr = channel?.evolutionInstanceName
    ? await getEvolutionConnectionQr(channel.evolutionInstanceName)
    : { qrCode: null, pairingCode: null };

  const paramsData = await searchParams;
  const okMessage = typeof paramsData.ok === "string" ? paramsData.ok : "";
  const errorMessage = typeof paramsData.error === "string" ? paramsData.error : "";
  const isConnected =
    remoteConnectionState === "open" ||
    remoteConnectionState === "connected" ||
    channel?.status === "CONNECTED";
  const rawQrCode = isConnected ? null : remoteConnectionQr.qrCode;
  const qrDataUrl = await buildQrDataUrl(rawQrCode);
  const pairingCode =
    remoteConnectionQr.pairingCode ||
    (channel?.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? ((channel.metadata as { pairingCode?: string | null }).pairingCode ?? "")
      : "");
  const hasQrCode = Boolean(qrDataUrl) && !isConnected;
  const effectiveErrorMessage = hasQrCode || channel?.status === "QRCODE" || isConnected ? "" : errorMessage;

  return (
    <section className="w-full overflow-x-hidden">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={effectiveErrorMessage}
        okTitle="WhatsApp listo"
        errorTitle="No pudimos completar la conexión"
      />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Canal de WhatsApp</p>
            <h1 className="text-[1.35rem] font-semibold tracking-[-0.04em] text-slate-950">
              {isConnected ? "Conexión completada" : "Conecta tu número"}
            </h1>
            <p className="text-sm text-slate-600">{agent.name}</p>
          </div>

          <Link
            href="/cliente/agentes"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[rgba(148,163,184,0.16)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
        </div>

        {!isConnected ? <WhatsappQrAutoRefresh isConnected={isConnected} /> : null}

        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.3)]">
            {isConnected ? (
              <div className="flex flex-col items-center text-center">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,#16a34a_12%,white)] text-[#16a34a]">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h2 className="mt-4 text-xl font-semibold tracking-[-0.04em] text-slate-950">WhatsApp conectado</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Tu agente quedó vinculado correctamente y ya puede seguir con el flujo.</p>
                <Link
                  href="/cliente/agentes"
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                >
                  Ir a agentes
                </Link>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="flex h-[248px] w-[248px] items-center justify-center rounded-[24px] bg-slate-50">
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrDataUrl} alt="QR de conexión de WhatsApp" className="h-auto w-[220px]" />
                  ) : (
                    <p className="text-sm text-slate-500">Esperando QR...</p>
                  )}
                </div>

                {pairingCode ? (
                  <div className="mt-4 w-full rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Código alterno</p>
                    <p className="mt-2 font-mono text-sm font-semibold text-slate-900">{pairingCode}</p>
                  </div>
                ) : null}

                <div className="mt-4 w-full">
                  <WhatsappQrCountdown isConnected={isConnected} cycleSeconds={40} />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.24)]">
            {isConnected ? (
              <div className="space-y-4">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,#16a34a_10%,white)] text-[#16a34a]">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Todo listo</h2>
                  <p className="max-w-lg text-sm leading-7 text-slate-600">
                    La conexión ya se completó. Ahora puedes volver a tu agente y continuar con la configuración de respuestas.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start gap-4 rounded-[24px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-5 py-5">
                  <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-[1.2rem] font-semibold tracking-[-0.04em] text-slate-950">Vincula tu cuenta</h2>
                    <p className="max-w-xl text-sm leading-6 text-slate-600">
                      Usa WhatsApp en tu teléfono para escanear el código y dejar conectado el agente.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-4 py-4 min-h-[168px]">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-semibold text-[var(--primary)] shadow-sm">
                      1
                    </div>
                    <p className="mt-3 text-sm font-medium leading-5 text-slate-900">Abre WhatsApp</p>
                    <p className="mt-2 text-sm leading-5 text-slate-600">En tu teléfono, abre la aplicación principal.</p>
                  </div>
                  <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-4 py-4 min-h-[168px]">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-semibold text-[var(--primary)] shadow-sm">
                      2
                    </div>
                    <p className="mt-3 text-sm font-medium leading-5 text-slate-900">Ve a Dispositivos vinculados</p>
                    <p className="mt-2 text-sm leading-5 text-slate-600">Entra al menú y toca la opción para vincular un dispositivo.</p>
                  </div>
                  <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-4 py-4 min-h-[168px]">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-semibold text-[var(--primary)] shadow-sm">
                      3
                    </div>
                    <p className="mt-3 text-sm font-medium leading-5 text-slate-900">Escanea el código QR</p>
                    <p className="mt-2 text-sm leading-5 text-slate-600">Apunta la cámara al código para completar la conexión.</p>
                  </div>
                </div>

                <div className="pt-1">
                  <Link
                    href="/cliente/agentes"
                    className="text-sm font-medium text-[var(--primary)] transition hover:opacity-80"
                  >
                    ¿Necesitas ayuda?
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
