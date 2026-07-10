import QRCode from "qrcode";
import {
  fetchEvolutionInstanceProfile,
  fetchEvolutionProfilePictureUrl,
  getEvolutionConnectionQr,
  getEvolutionConnectionState,
} from "@/lib/evolution";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { prisma } from "@/lib/prisma";

// Tiempos maximos que esperamos a Evolution GO antes de seguir con un fallback,
// para que un gateway lento no bloquee el render de la pantalla de detalle.
const EVOLUTION_CALL_TIMEOUT_MS = 6000;
const EVOLUTION_QR_TIMEOUT_MS = 9000; // el QR puede tener una espera interna (~2s)

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

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

export async function getWhatsAppBusinessConnectionDetail(workspaceId: string, channelOrAgentId: string) {
  let channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: channelOrAgentId,
      workspaceId,
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          isActive: true,
          status: true,
          trainingConfig: true,
        },
      },
    },
  });

  if (!channel) {
    channel = await prisma.whatsAppChannel.findFirst({
      where: {
        workspaceId,
        agentId: channelOrAgentId,
      },
      orderBy: { createdAt: "desc" },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            isActive: true,
            status: true,
            trainingConfig: true,
          },
        },
      },
    });
  }

  if (!channel) {
    return null;
  }

  const instanceName = channel.provider === "EVOLUTION" ? channel.evolutionInstanceName : null;

  // Ola 1 (en paralelo): config oficial, estado remoto y perfil de la instancia.
  // Antes se hacian en serie, sumando 3+ round-trips a Evolution.
  const [officialApiConfig, remoteConnectionState, instanceProfile] = await Promise.all([
    channel.provider === "OFFICIAL_API"
      ? getOfficialApiConfigByWorkspaceId(workspaceId)
      : Promise.resolve(null),
    instanceName
      ? withTimeout(getEvolutionConnectionState(instanceName), EVOLUTION_CALL_TIMEOUT_MS, null)
      : Promise.resolve(null),
    instanceName
      ? withTimeout(fetchEvolutionInstanceProfile(instanceName), EVOLUTION_CALL_TIMEOUT_MS, null)
      : Promise.resolve(null),
  ]);

  const remoteIsConnected =
    remoteConnectionState === "open" ||
    remoteConnectionState === "connected" ||
    remoteConnectionState === "connection_open" ||
    remoteConnectionState === "online";

  const normalizedInstanceOwner = instanceProfile?.owner ? instanceProfile.owner.split("@")[0]?.replace(/\D/g, "") ?? "" : "";
  const resolvedPhoneNumber = channel.phoneNumber || normalizedInstanceOwner || null;

  // Ola 2 (en paralelo): QR (solo si no esta conectado) y foto de perfil (solo si el perfil no la trajo).
  const [remoteConnectionQr, fetchedProfilePictureUrl] = await Promise.all([
    instanceName && !remoteIsConnected
      ? withTimeout(getEvolutionConnectionQr(instanceName), EVOLUTION_QR_TIMEOUT_MS, {
          qrCode: null,
          pairingCode: null,
        })
      : Promise.resolve({ qrCode: null as string | null, pairingCode: null as string | null }),
    !instanceProfile?.profilePictureUrl && instanceName && resolvedPhoneNumber
      ? withTimeout(
          fetchEvolutionProfilePictureUrl({ instanceName, phoneNumber: resolvedPhoneNumber }),
          EVOLUTION_CALL_TIMEOUT_MS,
          null,
        )
      : Promise.resolve(null),
  ]);

  const profilePictureUrl = instanceProfile?.profilePictureUrl || fetchedProfilePictureUrl;

  if (channel.id && resolvedPhoneNumber && channel.phoneNumber !== resolvedPhoneNumber) {
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        phoneNumber: resolvedPhoneNumber,
      },
    });
    channel.phoneNumber = resolvedPhoneNumber;
  }

  if (channel?.id && remoteIsConnected && channel.status !== "CONNECTED") {
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        status: "CONNECTED",
        qrCode: null,
        lastConnectionAt: new Date(),
      },
    });
    channel.status = "CONNECTED";
    channel.qrCode = null;
  }

  if (
    channel?.id &&
    remoteConnectionQr.qrCode &&
    (channel.qrCode !== remoteConnectionQr.qrCode || channel.status !== "QRCODE")
  ) {
    const baseMetadata =
      channel.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
        ? (channel.metadata as Record<string, unknown>)
        : {};
    const nextMetadata = {
      ...baseMetadata,
      pairingCode: remoteConnectionQr.pairingCode ?? null,
    };

    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        status: "QRCODE",
        qrCode: remoteConnectionQr.qrCode,
        // Fusionamos para no borrar otras claves del metadata (p. ej. collaboratorIds).
        metadata: nextMetadata,
      },
    });
    channel.status = "QRCODE";
    channel.qrCode = remoteConnectionQr.qrCode;
    channel.metadata = nextMetadata;
  } else if (channel?.id && !remoteIsConnected && !remoteConnectionQr.qrCode && channel.status === "CONNECTED") {
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        status: "DISCONNECTED",
        lastDisconnectionAt: new Date(),
      },
    });
    channel.status = "DISCONNECTED";
  }

  const isConnected = channel.provider === "OFFICIAL_API" ? channel.status === "CONNECTED" : remoteIsConnected || channel?.status === "CONNECTED";
  const persistedQrCode = typeof channel.qrCode === "string" && channel.qrCode.trim() ? channel.qrCode.trim() : null;
  const rawQrCode = isConnected ? null : remoteConnectionQr.qrCode || persistedQrCode;
  const qrDataUrl = await buildQrDataUrl(rawQrCode);
  const pairingCode =
    remoteConnectionQr.pairingCode ||
    (channel?.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? ((channel.metadata as { pairingCode?: string | null }).pairingCode ?? "")
      : "");
  const agentTrainingConfig =
    channel.agent?.trainingConfig && typeof channel.agent.trainingConfig === "object" && !Array.isArray(channel.agent.trainingConfig)
      ? (channel.agent.trainingConfig as {
          reactivationMessage?: unknown;
          responseDelaySeconds?: unknown;
        })
      : null;

  return {
    connection: {
      id: channel.id,
      name: channel.name,
      provider: channel.provider,
      phoneNumber: channel.phoneNumber ?? "",
      isActive: channel.isActive,
      agentId: channel.agent?.id ?? null,
      agentName: channel.agent?.name ?? "",
      agentIsActive: channel.agent?.isActive ?? false,
      agentStatus: channel.agent?.status ?? null,
      agentReactivationMessage: typeof agentTrainingConfig?.reactivationMessage === "string" ? agentTrainingConfig.reactivationMessage : "",
      agentResponseDelaySeconds:
        typeof agentTrainingConfig?.responseDelaySeconds === "number" && Number.isFinite(agentTrainingConfig.responseDelaySeconds)
          ? Math.max(0, Math.min(120, Math.round(agentTrainingConfig.responseDelaySeconds)))
          : 10,
      logoUrl: profilePictureUrl,
    },
    channel,
    officialApiConfig,
    isConnected,
    qrDataUrl,
    pairingCode,
    hasQrCode: Boolean(qrDataUrl) && !isConnected,
  };
}
