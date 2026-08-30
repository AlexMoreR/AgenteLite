import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getEvolutionConnectionState } from "@/lib/evolution";
import { sendPushToUser } from "@/lib/web-push";
import { sendAvisoDeCanalEmail } from "@/lib/mailer";

/**
 * Vigila que las lineas de WhatsApp esten realmente vivas, y avisa cuando no.
 *
 * El 28-ago una linea estuvo 24 HORAS sin enviar ni recibir y nadie se entero hasta que una
 * asesora lo reporto. El motivo de fondo no fue la falla en si: fue que el CRM mostraba el
 * puntito verde todo ese tiempo. `WhatsAppChannel.status` solo cambia cuando llega un webhook de
 * conexion o cuando alguien abre el detalle del canal, y un gateway que se muere no alcanza a
 * avisar de su propia muerte.
 *
 * Aca se le PREGUNTA al gateway, cada minuto, en vez de esperar que el avise.
 *
 * El aviso NO va por WhatsApp. Seria avisar de que WhatsApp esta caido usando WhatsApp; si se
 * caen todas las lineas no sale nada. Va por push a la app -que suena con la app cerrada- y por
 * correo, que no dependen del gateway.
 */

/** Cuanto tiene que llevar caida una linea antes de molestar a alguien. */
const MINUTOS_ANTES_DE_AVISAR = 5;

/** Donde se guarda el seguimiento dentro de `WhatsAppChannel.metadata`. */
const CLAVE_MONITOR = "monitor";

type EstadoMonitor = {
  /** Desde cuando se la ve caida. Null = esta sana. */
  caidoDesde?: string | null;
  /** Cuando se aviso por esta caida. Evita repetir el aviso cada minuto. */
  avisadoEn?: string | null;
};

export type ResumenDeRevision = {
  revisados: number;
  caidos: string[];
  avisos: number;
  recuperados: string[];
};

function leerMonitor(metadata: unknown): EstadoMonitor {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const crudo = (metadata as Record<string, unknown>)[CLAVE_MONITOR];
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
    return {};
  }
  const registro = crudo as Record<string, unknown>;
  return {
    caidoDesde: typeof registro.caidoDesde === "string" ? registro.caidoDesde : null,
    avisadoEn: typeof registro.avisadoEn === "string" ? registro.avisadoEn : null,
  };
}

async function guardarMonitor(
  canalId: string,
  metadata: unknown,
  siguiente: EstadoMonitor,
  estado?: "CONNECTED" | "DISCONNECTED" | "QRCODE",
) {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};

  await prisma.whatsAppChannel.update({
    where: { id: canalId },
    data: {
      // Se fusiona: metadata guarda tambien el gateway y los colaboradores del canal.
      metadata: { ...base, [CLAVE_MONITOR]: siguiente } as Prisma.InputJsonValue,
      ...(estado ? { status: estado } : {}),
      ...(estado === "CONNECTED" ? { lastConnectionAt: new Date() } : {}),
      ...(estado === "DISCONNECTED" ? { lastDisconnectionAt: new Date() } : {}),
    },
  });
}

/** Ajuste opcional: ids de personas extra que reciben los avisos, ademas de quien administra. */
const CLAVE_DESTINATARIOS = "alertaCanalesUserIds";

/**
 * A quien se le avisa.
 *
 * Por defecto, quien administra el negocio (ADMIN y CLIENTE): son los unicos que pueden escanear
 * un QR o entrar al servidor. Nadie mas, porque avisarle a una asesora de algo que no puede
 * arreglar solo la preocupa.
 *
 * La lista se puede ampliar sin tocar codigo ni desplegar, con la clave `alertaCanalesUserIds` en
 * la configuracion. Asi el equipo no queda escrito a mano acá: quien atiende los chats hoy puede
 * no ser la misma persona en tres meses.
 */
async function destinatarios(workspaceId: string) {
  const extra = await prisma.appSetting
    .findUnique({ where: { key: CLAVE_DESTINATARIOS }, select: { value: true } })
    .catch(() => null);

  let idsExtra: string[] = [];
  try {
    const leido: unknown = JSON.parse(extra?.value ?? "[]");
    idsExtra = Array.isArray(leido) ? leido.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // Configuracion mal escrita: se ignora y quedan los de siempre, que es lo seguro.
  }

  const miembros = await prisma.workspaceMember.findMany({
    where: {
      workspaceId,
      OR: [
        { user: { role: { in: ["ADMIN", "CLIENTE"] } } },
        ...(idsExtra.length ? [{ userId: { in: idsExtra } }] : []),
      ],
    },
    select: { user: { select: { id: true, name: true, email: true } } },
  });

  return miembros.map((miembro) => miembro.user).filter((usuario) => Boolean(usuario?.id));
}

async function avisar(input: {
  workspaceId: string;
  titulo: string;
  cuerpo: string;
}) {
  const gente = await destinatarios(input.workspaceId);

  await Promise.allSettled(
    gente.flatMap((usuario) => [
      sendPushToUser({
        userId: usuario.id,
        payload: { title: input.titulo, body: input.cuerpo, tag: "canal-caido" },
      }),
      usuario.email
        ? sendAvisoDeCanalEmail({
            to: usuario.email,
            nombre: usuario.name ?? "",
            asunto: input.titulo,
            cuerpo: input.cuerpo,
          })
        : Promise.resolve(),
    ]),
  );

  return gente.length;
}

/** Cuanto hace que esta caida, en palabras. */
function hace(desde: string): string {
  const minutos = Math.max(1, Math.round((Date.now() - new Date(desde).getTime()) / 60000));
  if (minutos < 60) {
    return `${minutos} minuto${minutos === 1 ? "" : "s"}`;
  }
  const horas = Math.round(minutos / 60);
  return `${horas} hora${horas === 1 ? "" : "s"}`;
}

export async function revisarCanales(): Promise<ResumenDeRevision> {
  const canales = await prisma.whatsAppChannel.findMany({
    where: {
      isActive: true,
      provider: "EVOLUTION",
      evolutionInstanceName: { not: null },
    },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      status: true,
      phoneNumber: true,
      evolutionInstanceName: true,
      metadata: true,
    },
  });

  const resumen: ResumenDeRevision = { revisados: 0, caidos: [], avisos: 0, recuperados: [] };

  for (const canal of canales) {
    const instancia = canal.evolutionInstanceName;
    if (!instancia) {
      continue;
    }

    /*
      Si el gateway no contesta, NO se toca nada.

      Un timeout puede ser un pico de red, y marcar la linea como caida por eso llenaria el
      celular de avisos falsos: el que se cansa de las alarmas termina ignorando la de verdad.
    */
    const estado = await getEvolutionConnectionState(instancia).catch(() => null);
    if (estado === null) {
      continue;
    }
    resumen.revisados += 1;

    const viva = estado === "open" || estado === "connected" || estado === "online";
    const necesitaQr = estado === "qr";
    const monitor = leerMonitor(canal.metadata);
    const ahora = new Date().toISOString();

    if (viva) {
      if (monitor.avisadoEn) {
        /*
          Avisar tambien cuando VUELVE.

          Sin esto uno se queda con el susto: recibiste "se cayo" y no sabes si sigue caida. Saber
          que volvio evita ir a revisar algo que ya se arreglo solo.
        */
        await avisar({
          workspaceId: canal.workspaceId,
          titulo: `${canal.name}: volvio`,
          cuerpo: `La linea ${canal.name}${canal.phoneNumber ? ` (${canal.phoneNumber})` : ""} volvio a funcionar.`,
        });
        resumen.recuperados.push(canal.name);
      }
      if (monitor.caidoDesde || monitor.avisadoEn || canal.status !== "CONNECTED") {
        await guardarMonitor(canal.id, canal.metadata, { caidoDesde: null, avisadoEn: null }, "CONNECTED");
      }
      continue;
    }

    resumen.caidos.push(canal.name);
    const caidoDesde = monitor.caidoDesde || ahora;
    const debeAvisar =
      !monitor.avisadoEn &&
      Date.now() - new Date(caidoDesde).getTime() >= MINUTOS_ANTES_DE_AVISAR * 60_000;

    if (debeAvisar) {
      /*
        El aviso dice si hace falta una PERSONA o si se va a arreglar solo.

        Es la diferencia entre levantarse a las 3 de la manana o volver a dormirse: una sesion
        detenida la levanta el vigilante; una que pide QR no la arregla nadie sin el telefono.
      */
      const queHacer = necesitaQr
        ? "Hay que escanear el QR desde Conexion: nadie puede levantarla sola."
        : "El vigilante va a intentar levantarla sola. Si en 10 minutos no volvio, revisala.";

      await avisar({
        workspaceId: canal.workspaceId,
        titulo: `${canal.name} esta caida`,
        cuerpo: `La linea ${canal.name}${canal.phoneNumber ? ` (${canal.phoneNumber})` : ""} lleva ${hace(caidoDesde)} sin conexion. ${queHacer}`,
      });
      resumen.avisos += 1;
    }

    await guardarMonitor(
      canal.id,
      canal.metadata,
      { caidoDesde, avisadoEn: debeAvisar ? ahora : monitor.avisadoEn ?? null },
      necesitaQr ? "QRCODE" : "DISCONNECTED",
    );
  }

  return resumen;
}
