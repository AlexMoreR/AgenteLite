import QRCode from "qrcode";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Smartphone } from "lucide-react";
import { auth } from "@/auth";
import { AgentPanelShell } from "@/components/agents/agent-panel-shell";
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

export default async function ClienteAgenteCanalesPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+crear+tu+negocio+primero");
  }

  const [{ agentId }, paramsData] = await Promise.all([params, searchParams]);
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
  const remoteIsConnected =
    remoteConnectionState === "open" ||
    remoteConnectionState === "connected" ||
    remoteConnectionState === "connection_open" ||
    remoteConnectionState === "online";
  const remoteConnectionQr = channel?.evolutionInstanceName && !remoteIsConnected
    ? await getEvolutionConnectionQr(channel.evolutionInstanceName)
    : { qrCode: null, pairingCode: null };

  if (channel?.id && remoteIsConnected && channel.status !== "CONNECTED") {
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        status: "CONNECTED",
        qrCode: null,
        lastConnectionAt: new Date(),
      },
    });
  }

  if (channel?.id && remoteConnectionQr.qrCode && channel.qrCode !== remoteConnectionQr.qrCode) {
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        status: "QRCODE",
        qrCode: remoteConnectionQr.qrCode,
        metadata: {
          pairingCode: remoteConnectionQr.pairingCode ?? null,
        },
      },
    });
  }

  const okMessage = typeof paramsData.ok === "string" ? paramsData.ok : "";
  const errorMessage = typeof paramsData.error === "string" ? paramsData.error : "";
  const isConnected = remoteIsConnected || channel?.status === "CONNECTED";
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
    <AgentPanelShell agentId={agent.id}>
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={effectiveErrorMessage}
        okTitle="WhatsApp listo"
        errorTitle="No pudimos completar la conexión"
      />

      {!isConnected ? <WhatsappQrAutoRefresh isConnected={isConnected} /> : null}

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.3)]">
          {isConnected ? (
            <div className="flex flex-col items-center text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,#16a34a_12%,white)] text-[#16a34a]">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.04em] text-slate-950">WhatsApp conectado</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Tu canal ya está vinculado y listo para seguir con la configuración del agente.</p>
              <Link
                href={`/cliente/agentes/${agent.id}`}
                className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                Ir al panel del agente
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

        <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.24)]">
          {isConnected ? (
            <div className="rounded-[24px] border border-[rgba(22,163,74,0.12)] bg-[color-mix(in_srgb,#16a34a_4%,white)] px-5 py-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,#16a34a_12%,white)] text-[#16a34a]">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Conexión completada</h2>
                  <p className="text-sm text-slate-600">Tu número ya está vinculado con este agente.</p>
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
                <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-4 py-4">
                  <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-[var(--primary)] shadow-sm">1</div>
                  <p className="mt-3 text-sm font-semibold leading-5 text-slate-900">Abre WhatsApp</p>
                  <p className="mt-2 text-sm leading-5 text-slate-600">En tu teléfono, abre la app principal.</p>
                </div>
                <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-4 py-4">
                  <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-[var(--primary)] shadow-sm">2</div>
                  <p className="mt-3 text-sm font-semibold leading-5 text-slate-900">Ve a dispositivos vinculados</p>
                  <p className="mt-2 text-sm leading-5 text-slate-600">Entra al menú y toca la opción para vincular un dispositivo.</p>
                </div>
                <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-4 py-4">
                  <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-[var(--primary)] shadow-sm">3</div>
                  <p className="mt-3 text-sm font-semibold leading-5 text-slate-900">Escanea el código QR</p>
                  <p className="mt-2 text-sm leading-5 text-slate-600">Apunta la cámara y espera la confirmación de conexión.</p>
                </div>
              </div>

              <div className="pt-1">
                <Link href="/cliente/agentes" className="text-sm font-medium text-[var(--primary)] transition hover:opacity-80">
                  ¿Necesitas ayuda?
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </AgentPanelShell>
  );
}
