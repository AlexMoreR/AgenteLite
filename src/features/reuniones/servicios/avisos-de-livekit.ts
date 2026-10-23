import { mkdir } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import { userIdDeIdentidad } from "@/features/reuniones/estados";
import { carpetaDeEgress, relativaDesdeEgress, rutaDeArchivo } from "@/features/reuniones/servicios/archivos-de-reuniones";
import { grabarPista, type ConfigLivekit } from "@/features/reuniones/servicios/livekit";

/*
  LOS AVISOS DE LIVEKIT (webhook firmado, llega a /api/reuniones/livekit).

  Registran quién entró, quién salió, el inicio y el fin de cada grabación con su archivo, y el
  cierre de la sala. Cada vez que alguien publica el micrófono, se pide la grabación de esa pista:
  así queda una pista por persona, y si se cae y vuelve, la pista nueva se une por la hora.

  La reunión pasa a "En cola" cuando la sala se cerró y todas sus grabaciones terminaron.

  LiveKit puede mandar el mismo aviso dos veces: todo lo de acá aguanta repetirse.
*/

type Participante = { identity?: string; name?: string };
type Pista = { sid?: string; type?: string | number; source?: string | number };
type ArchivoDeEgress = { filename?: string; location?: string; size?: string | number; startedAt?: string | number; endedAt?: string | number };
type InfoDeEgress = {
  egressId?: string;
  roomName?: string;
  status?: string | number;
  error?: string;
  startedAt?: string | number;
  endedAt?: string | number;
  file?: ArchivoDeEgress;
  fileResults?: ArchivoDeEgress[];
  /** El pedido de grabación de una pista (trae qué pista se grabó). */
  track?: { trackId?: string; track_id?: string };
};

export type AvisoDeLivekit = {
  event?: string;
  room?: { name?: string };
  participant?: Participante;
  track?: Pista;
  egressInfo?: InfoDeEgress;
};

/** Los tiempos de Egress vienen en nanosegundos (int64 como texto). */
export function fechaDeNanos(valor: string | number | undefined): Date | null {
  if (valor === undefined || valor === null || valor === "" || valor === "0" || valor === 0) {
    return null;
  }
  try {
    const ms = Number(BigInt(String(valor)) / BigInt(1_000_000));
    return ms > 0 ? new Date(ms) : null;
  } catch {
    return null;
  }
}

/** Solo se graba el micrófono (no el audio de compartir pantalla). */
export function esMicrofono(pista: Pista | undefined): boolean {
  if (!pista?.sid) {
    return false;
  }
  const tipo = String(pista.type ?? "");
  const fuente = String(pista.source ?? "");
  // LiveKit manda los avisos sin los valores por defecto: AUDIO es el 0, así que en una pista de audio
  // `type` no viene.
  const esAudio = tipo === "" || tipo === "AUDIO" || tipo === "0";
  return esAudio && (fuente === "" || fuente === "MICROPHONE" || fuente === "2");
}

const ESTADOS_DE_EGRESS_CON_ARCHIVO = new Set(["EGRESS_COMPLETE", "EGRESS_LIMIT_REACHED", "3", "6"]);
const ESTADOS_DE_EGRESS_TERMINADOS = new Set(["EGRESS_COMPLETE", "EGRESS_FAILED", "EGRESS_ABORTED", "EGRESS_LIMIT_REACHED", "3", "4", "5", "6"]);

/** El archivo que dejó una grabación terminada (o null si no dejó ninguno). */
export function archivoDeEgress(info: InfoDeEgress) {
  const archivo = info.fileResults?.[0] ?? info.file;
  const ruta = archivo?.filename || archivo?.location;
  if (!archivo || !ruta) {
    return null;
  }
  const bytes = Number(archivo.size ?? 0);
  return {
    ruta,
    bytes: Number.isFinite(bytes) && bytes > 0 ? Math.min(bytes, 2_147_483_647) : null,
    empiezaEn: fechaDeNanos(archivo.startedAt) ?? fechaDeNanos(info.startedAt),
    terminaEn: fechaDeNanos(archivo.endedAt) ?? fechaDeNanos(info.endedAt),
  };
}

async function reunionDeLaSala(sala: string | undefined) {
  if (!sala) {
    return null;
  }
  return prisma.reunion.findUnique({ where: { sala }, select: { id: true, sala: true, estado: true } });
}

async function registrarParticipante(reunionId: string, participante: Participante) {
  const identidad = participante.identity?.trim();
  if (!identidad) {
    return null;
  }
  const nombre = participante.name?.trim().slice(0, 80) || identidad;
  return prisma.reunionParticipante.upsert({
    where: { reunionId_identidad: { reunionId, identidad } },
    create: { reunionId, identidad, nombre, userId: userIdDeIdentidad(identidad) },
    update: { nombre, salioEn: null },
    select: { id: true },
  });
}

/**
 * Si la sala ya se cerró y no queda ninguna grabación andando, la reunión pasa a "En cola".
 * Si se cerró sin que nadie entrara, vuelve a "Esperando": el link sigue sirviendo.
 */
export async function revisarSiTermino(reunionId: string) {
  const reunion = await prisma.reunion.findUnique({
    where: { id: reunionId },
    select: {
      estado: true,
      terminoEn: true,
      _count: { select: { participantes: true } },
      pistas: { select: { estado: true } },
    },
  });
  if (!reunion || !reunion.terminoEn || (reunion.estado !== "EN_VIVO" && reunion.estado !== "ESPERANDO")) {
    return;
  }
  if (reunion.pistas.some((pista) => pista.estado === "GRABANDO")) {
    return;
  }
  if (!reunion._count.participantes) {
    await prisma.reunion.updateMany({
      where: { id: reunionId, estado: { in: ["EN_VIVO", "ESPERANDO"] } },
      data: { estado: "ESPERANDO", terminoEn: null, empezoEn: null },
    });
    return;
  }
  await prisma.reunion.updateMany({
    where: { id: reunionId, estado: { in: ["EN_VIVO", "ESPERANDO"] } },
    data: { estado: "EN_COLA", aviso: null, motivoError: null },
  });
}

async function empezarGrabacion(config: ConfigLivekit, reunion: { id: string; sala: string }, aviso: AvisoDeLivekit) {
  const trackSid = aviso.track?.sid;
  if (!trackSid) {
    return;
  }
  const participante = aviso.participant ? await registrarParticipante(reunion.id, aviso.participant) : null;
  const archivo = `${carpetaDeEgress()}/${reunion.sala}/${trackSid}-${Date.now()}.ogg`;

  // Primero la fila y después la grabación: el índice único (reunionId, trackSid) hace que el mismo
  // aviso repetido no pida dos grabaciones, y la sala no se da por terminada mientras esta pista nace.
  let pistaId: string;
  try {
    const creada = await prisma.reunionPista.create({
      data: {
        reunionId: reunion.id,
        participanteId: participante?.id ?? null,
        trackSid,
        archivo: relativaDesdeEgress(archivo),
        empiezaEn: new Date(),
        estado: "GRABANDO",
      },
      select: { id: true },
    });
    pistaId = creada.id;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return;
    }
    throw error;
  }

  try {
    // Egress no siempre crea la carpeta de la sala: la deja lista el CRM (es el mismo volumen).
    await mkdir(rutaDeArchivo(reunion.sala), { recursive: true }).catch(() => {});
    const egressId = await grabarPista(config, { sala: reunion.sala, trackSid, archivo });
    await prisma.reunionPista.update({ where: { id: pistaId }, data: { egressId } });
  } catch (error) {
    // Sin grabación no queda la fila: cuando LiveKit repita el aviso, se vuelve a intentar.
    await prisma.reunionPista.delete({ where: { id: pistaId } }).catch(() => {});
    throw error;
  }
}

/** La pista de una grabación: por su egressId o, si el aviso llegó antes de guardarlo, por la pista grabada. */
async function pistaDeLaGrabacion(info: InfoDeEgress) {
  const campos = { id: true, reunionId: true, estado: true } as const;
  const porEgress = info.egressId ? await prisma.reunionPista.findUnique({ where: { egressId: info.egressId }, select: campos }) : null;
  if (porEgress) {
    return porEgress;
  }
  const trackSid = info.track?.trackId ?? info.track?.track_id;
  if (!trackSid || !info.roomName) {
    return null;
  }
  return prisma.reunionPista.findFirst({ where: { trackSid, egressId: null, reunion: { sala: info.roomName } }, select: campos });
}

async function terminoGrabacion(info: InfoDeEgress) {
  const pista = await pistaDeLaGrabacion(info);
  if (!pista || pista.estado !== "GRABANDO") {
    return;
  }
  const archivo = archivoDeEgress(info);
  const conArchivo = archivo && ESTADOS_DE_EGRESS_CON_ARCHIVO.has(String(info.status ?? ""));
  await prisma.reunionPista.update({
    where: { id: pista.id },
    data: conArchivo
      ? {
          estado: "LISTA",
          archivo: relativaDesdeEgress(archivo.ruta),
          bytes: archivo.bytes,
          ...(archivo.empiezaEn ? { empiezaEn: archivo.empiezaEn } : {}),
          terminaEn: archivo.terminaEn ?? new Date(),
        }
      : { estado: "ERROR", terminaEn: new Date() },
  });
  if (!conArchivo) {
    console.error("[reuniones] grabación sin archivo", info.egressId, info.status, info.error);
  }
  await revisarSiTermino(pista.reunionId);
}

export async function procesarAvisoDeLivekit(aviso: AvisoDeLivekit, config: ConfigLivekit) {
  const evento = aviso.event ?? "";
  const reunion = await reunionDeLaSala(aviso.room?.name ?? aviso.egressInfo?.roomName);
  if (!reunion) {
    return;
  }
  const ahora = new Date();

  switch (evento) {
    // La sala se crea al pedir el pase (room_started), aunque nadie llegue a conectarse: la reunión
    // empieza cuando entra la primera persona, no antes.
    case "participant_joined": {
      if (aviso.participant) {
        await registrarParticipante(reunion.id, aviso.participant);
      }
      await prisma.reunion.updateMany({
        where: { id: reunion.id, estado: { in: ["ESPERANDO", "EN_VIVO"] } },
        data: { estado: "EN_VIVO", terminoEn: null },
      });
      await prisma.reunion.updateMany({ where: { id: reunion.id, empezoEn: null }, data: { empezoEn: ahora } });
      return;
    }
    case "participant_left": {
      const identidad = aviso.participant?.identity;
      if (identidad) {
        await prisma.reunionParticipante.updateMany({ where: { reunionId: reunion.id, identidad }, data: { salioEn: ahora } });
      }
      return;
    }
    case "track_published": {
      if (esMicrofono(aviso.track) && (reunion.estado === "EN_VIVO" || reunion.estado === "ESPERANDO")) {
        await empezarGrabacion(config, reunion, aviso);
      }
      return;
    }
    case "egress_updated":
    case "egress_ended": {
      if (aviso.egressInfo && (evento === "egress_ended" || ESTADOS_DE_EGRESS_TERMINADOS.has(String(aviso.egressInfo.status ?? "")))) {
        await terminoGrabacion(aviso.egressInfo);
      }
      return;
    }
    case "room_finished": {
      await prisma.reunion.updateMany({ where: { id: reunion.id, terminoEn: null }, data: { terminoEn: ahora } });
      await prisma.reunionParticipante.updateMany({ where: { reunionId: reunion.id, salioEn: null }, data: { salioEn: ahora } });
      await revisarSiTermino(reunion.id);
      return;
    }
    default:
      return;
  }
}
