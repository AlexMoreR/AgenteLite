import QRCode from "qrcode";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, QrCode, RefreshCw } from "lucide-react";
import { auth } from "@/auth";
import { WhatsappQrAutoRefresh } from "@/components/agents/whatsapp-qr-auto-refresh";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

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
    width: 320,
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
  const qrDataUrl = await buildQrDataUrl(channel?.qrCode ?? null);
  const pairingCode =
    channel?.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? ((channel.metadata as { pairingCode?: string | null }).pairingCode ?? "")
      : "";

  const paramsData = await searchParams;
  const okMessage = typeof paramsData.ok === "string" ? paramsData.ok : "";
  const errorMessage = typeof paramsData.error === "string" ? paramsData.error : "";
  const hasQrCode = Boolean(qrDataUrl);
  const isConnected = channel?.status === "CONNECTED";
  const effectiveErrorMessage = hasQrCode || channel?.status === "QRCODE" || isConnected ? "" : errorMessage;

  return (
    <section className="w-full space-y-4 overflow-x-hidden">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={effectiveErrorMessage}
        okTitle="WhatsApp listo"
        errorTitle="No pudimos completar la conexión"
      />
      <WhatsappQrAutoRefresh hasQrCode={hasQrCode} isConnected={isConnected} />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-[-0.05em] text-slate-950">
              {isConnected ? "WhatsApp conectado" : "Conecta WhatsApp"}
            </h1>
            <p className="text-sm text-slate-600">
              {isConnected ? (
                <>
                  <span className="font-medium text-slate-900">{agent.name}</span> ya quedó vinculado con tu número.
                </>
              ) : (
                <>
                  Escanea el QR para enlazar <span className="font-medium text-slate-900">{agent.name}</span> con tu número.
                </>
              )}
            </p>
          </div>
          <Link
            href="/cliente/agentes"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.16)] px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Volver a agentes
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-6">
            <div className="space-y-4">
              <div
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${
                  isConnected
                    ? "bg-[color-mix(in_srgb,#16a34a_14%,white)] text-[#16a34a]"
                    : "bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]"
                }`}
              >
                {isConnected ? <CheckCircle2 className="h-5 w-5" /> : <QrCode className="h-5 w-5" />}
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">
                  {isConnected ? "Conexión completada" : "QR de conexión"}
                </h2>
                <p className="text-sm leading-6 text-slate-600">
                  {isConnected
                    ? "Tu agente ya está vinculado y listo para seguir con la configuración."
                    : "Abre WhatsApp en tu teléfono, entra a dispositivos vinculados y escanea este código."}
                </p>
              </div>

              {isConnected ? (
                <div className="rounded-[28px] border border-[rgba(22,163,74,0.16)] bg-[color-mix(in_srgb,#16a34a_6%,white)] px-5 py-10 text-center">
                  <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,#16a34a_14%,white)] text-[#16a34a]">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>
                  <p className="mt-4 text-base font-semibold text-slate-950">WhatsApp conectado correctamente</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Ya puedes cerrar esta pantalla o volver a tus agentes.</p>
                </div>
              ) : qrDataUrl ? (
                <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-slate-50 p-5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="QR de conexión de WhatsApp" className="mx-auto h-auto w-full max-w-[320px]" />
                </div>
              ) : (
                <div className="rounded-[28px] border border-dashed border-[rgba(148,163,184,0.24)] bg-slate-50 px-5 py-8 text-center">
                  <p className="text-sm text-slate-600">Aún no pudimos generar el QR.</p>
                </div>
              )}

              {!isConnected && pairingCode ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Código alterno</p>
                  <p className="mt-2 font-mono text-sm font-semibold text-slate-900">{pairingCode}</p>
                </div>
              ) : null}
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-6">
              <div className="space-y-3">
                <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">
                  {isConnected ? "Siguiente paso" : "Qué sigue"}
                </h3>
                {isConnected ? (
                  <>
                    <p className="text-sm leading-6 text-slate-600">1. Vuelve al módulo de agentes.</p>
                    <p className="text-sm leading-6 text-slate-600">2. Termina la configuración de respuestas y comportamiento.</p>
                    <p className="text-sm leading-6 text-slate-600">3. Después podrás probar mensajes reales desde WhatsApp.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-6 text-slate-600">1. Escanea el QR desde tu teléfono.</p>
                    <p className="text-sm leading-6 text-slate-600">2. Espera la confirmación de conexión.</p>
                    <p className="text-sm leading-6 text-slate-600">3. Después podrás empezar a recibir mensajes en este agente.</p>
                  </>
                )}
              </div>
            </Card>

            <Link
              href="/cliente/agentes"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]"
            >
              <RefreshCw className="h-4 w-4" />
              Ver agentes
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
