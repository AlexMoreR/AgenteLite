import { Prisma } from "@prisma/client";

import { calcularReparto, leerColaboradores, leerMonitores } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { filtrarSinPausaManual } from "@/lib/en-linea";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { filtrarPorHorario } from "@/lib/horario-de-reparto";
import { prisma } from "@/lib/prisma";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";
import { avisarAsignacionPorPush } from "@/lib/reparto-de-leads";

import { CONFIG_GRAVEDAD_POR_DEFECTO } from "@/features/avisos-gravedad/dominio/reglas";
import { leerAvisosCrudos, leerConfigGravedad, pushAAlexander } from "@/features/avisos-gravedad/servicios/enrutador";
import type { ChatAbierto } from "@/features/supervisor/dominio/detectores-atencion";
import { leerChatsAbiertos, nombresDeAsesoras } from "@/features/supervisor/servicios/datos";

import {
  claveDelEpisodio,
  clienteDelChat,
  decidirLaVuelta,
  elegirAsesora,
  enHorarioLaboral,
  enlaceDelChat,
  etiquetaDeEtapa,
  pendientesPorAsesora,
  textoDelAviso,
  type ConfigReasignacion,
  type Decision,
  type LineaDeAviso,
  type TipoDeAviso,
} from "../dominio/reglas";
import { negociosConReasignacion } from "./config";

/**
 * EL VIGILANTE (cada minuto, desde el cron). Lee los chats abiertos de las líneas del V3, decide con
 * ../dominio/reglas.ts, ANOTA en SupervisorAviso, reasigna y manda los WhatsApp por la línea Admin.
 *
 * Para no avisar dos veces: cada aviso se anota primero (chat + tipo + episodio, con regla única en
 * la base). Si no se pudo anotar —ya estaba o la base falló— NO se manda.
 *
 * Los avisos solo salen por la línea configurada si es ADMINISTRATIVA y solo a números de la lista
 * de avisos del equipo (Mi empresa → Equipo). Al cliente nunca se le manda nada.
 *
 * Nunca lanza hacia el cron: un negocio que falla no tumba la vuelta de los otros.
 */

const DIA = 86_400_000;
const ORIGEN_REASIGNACION = "supervisor-reasignacion";
/** Destinatario especial: el dueño (aviso de "no hay a quién pasarlo"). */
const DUENO = "__dueno__";

/** Candado en memoria: una vuelta a la vez. Si una se cuelga, a los 5 min se deja pasar la siguiente. */
let corriendoDesde: number | null = null;
const CANDADO_MAXIMO_MS = 5 * 60_000;

export async function vigilarAvisosYReasignacion(ahora = new Date()): Promise<void> {
  if (corriendoDesde !== null && Date.now() - corriendoDesde < CANDADO_MAXIMO_MS) return;
  const mio = Date.now();
  corriendoDesde = mio;
  try {
    for (const { workspaceId, config } of await negociosConReasignacion()) {
      try {
        await vueltaDelNegocio({ workspaceId, config, ahora });
      } catch (error) {
        console.error("[supervisor-reasignacion]", workspaceId, error instanceof Error ? error.message : error);
      }
    }
  } finally {
    if (corriendoDesde === mio) corriendoDesde = null;
  }
}

type Anotacion = {
  tipo: TipoDeAviso;
  conversationId: string;
  asesoraId: string;
  asesoraNuevaId?: string | null;
  episodio: Date;
  minutosEsperando: number;
  error?: string | null;
};

/** Anota en el registro. Devuelve el id, o null si ya estaba (regla única) o si la base falló. */
async function anotar(workspaceId: string, a: Anotacion): Promise<string | null> {
  try {
    const fila = await prisma.supervisorAviso.create({
      data: {
        workspaceId,
        conversationId: a.conversationId,
        tipo: a.tipo,
        asesoraId: a.asesoraId,
        asesoraNuevaId: a.asesoraNuevaId ?? null,
        episodio: a.episodio,
        minutosEsperando: a.minutosEsperando,
        error: a.error ?? null,
      },
      select: { id: true },
    });
    return fila.id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      console.warn("[supervisor-reasignacion] no se pudo anotar; no se manda", a.tipo, error instanceof Error ? error.message : error);
    }
    return null;
  }
}

/** Lo que ya está en el registro para estos chats (las claves de claveDelEpisodio). */
async function yaAnotados(workspaceId: string, ids: string[], ahora: Date): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const filas = await prisma.supervisorAviso.findMany({
    where: { workspaceId, conversationId: { in: ids }, creadoEn: { gte: new Date(ahora.getTime() - 8 * DIA) } },
    select: { conversationId: true, tipo: true, episodio: true },
  });
  return new Set(filas.map((f) => claveDelEpisodio(f.conversationId, f.tipo as TipoDeAviso, new Date(f.episodio))));
}

/** ¿Una persona del equipo le escribió al cliente después de su último mensaje? (justo antes de reasignar) */
async function respondioUnaPersona(conversationId: string, despuesDe: Date): Promise<boolean> {
  const fila = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "OUTBOUND",
      type: { not: "SYSTEM" },
      createdAt: { gt: despuesDe },
      OR: [{ rawPayload: { path: ["source"], equals: "manual" } }, { rawPayload: { path: ["source"], equals: "instance" } }],
    },
    select: { id: true },
  });
  return Boolean(fila);
}

/** Las asesoras que pueden recibir un chat de esta línea: colaboradoras sin pausa, activas, en horario y sin pausa manual. */
async function asesorasDisponibles(workspaceId: string, metadata: unknown, ahora: Date): Promise<string[]> {
  const rueda = calcularReparto(metadata);
  if (!rueda.length) return [];
  const activas = await prisma.workspaceMember.findMany({ where: { workspaceId, isActive: true, userId: { in: rueda } }, select: { userId: true } });
  const idsActivos = new Set(activas.map((m) => m.userId));
  const enHorario = await filtrarPorHorario(workspaceId, rueda.filter((id) => idsActivos.has(id)), ahora);
  const sinPausa = await filtrarSinPausaManual(workspaceId, enHorario, ahora);
  return enHorario.filter((id) => sinPausa.has(id));
}

type Envio = { lineas: LineaDeAviso[]; filas: string[] };

/**
 * Una vuelta para un negocio. Exportada para las pruebas (con la base y los envíos simulados).
 * Devuelve lo que se decidió y lo que salió.
 */
export async function vueltaDelNegocio(input: { workspaceId: string; config: ConfigReasignacion; ahora: Date }): Promise<{
  decisiones: Decision[];
  reasignados: Array<{ conversationId: string; de: string; a: string }>;
  enviados: Array<{ destino: string; numero: string | null; texto: string; ok: boolean }>;
}> {
  const { workspaceId, config, ahora } = input;
  const vacio = { decisiones: [], reasignados: [], enviados: [] };
  // Fuera de horario no avisa ni reasigna: ni se leen los chats (la consulta pesa y corre cada minuto).
  if (!enHorarioLaboral(ahora, config.horario)) return vacio;
  const chats = await leerChatsAbiertos({ workspaceId, ahora, conTurno: true });
  const conDuena = chats.filter((c) => c.asesoraId);
  if (!conDuena.length) return vacio;

  const anotados = await yaAnotados(workspaceId, conDuena.map((c) => c.conversationId), ahora);
  const decisiones = decidirLaVuelta({ chats: conDuena, ahora, config, yaAnotados: anotados });
  if (!decisiones.length) return { ...vacio, decisiones };

  const ids = [...new Set(decisiones.map((d) => d.chat.conversationId))];
  const [conversaciones, nombres] = await Promise.all([
    prisma.conversation.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, numero: true, channelId: true, contactId: true } }),
    nombresDeAsesoras(workspaceId).catch(() => ({}) as Record<string, string>),
  ]);
  const datos = new Map(conversaciones.map((c) => [c.id, c]));
  const nombre = (id: string | null | undefined) => (id ? nombres[id] ?? "una asesora" : "nadie");
  const pendientes = pendientesPorAsesora(chats, ahora, config.horario);
  const lineas = new Map<string, Promise<{ asesoras: Set<string>; disponibles: string[] } | null>>();
  /** De cada línea: quiénes la atienden (sin las que solo miran) y quiénes pueden recibir un chat ahora. */
  const deLaLinea = (channelId: string) => {
    if (!lineas.has(channelId)) {
      lineas.set(
        channelId,
        prisma.whatsAppChannel
          .findFirst({ where: { id: channelId, workspaceId }, select: { metadata: true } })
          .then(async (linea) => {
            if (!linea) return null;
            const monitores = new Set(leerMonitores(linea.metadata));
            return {
              asesoras: new Set(leerColaboradores(linea.metadata).filter((id) => !monitores.has(id))),
              disponibles: await asesorasDisponibles(workspaceId, linea.metadata, ahora),
            };
          })
          .catch(() => null),
      );
    }
    return lineas.get(channelId) as Promise<{ asesoras: Set<string>; disponibles: string[] } | null>;
  };

  const envios = new Map<string, Envio>();
  const agregar = (destino: string, linea: LineaDeAviso, fila: string) => {
    const envio = envios.get(destino) ?? { lineas: [], filas: [] };
    envio.lineas.push(linea);
    if (!envio.filas.includes(fila)) envio.filas.push(fila);
    envios.set(destino, envio);
  };
  const base = (d: Decision) => {
    const conv = datos.get(d.chat.conversationId);
    return { cliente: clienteDelChat(d.chat), etapa: etiquetaDeEtapa(d.chat.etapa), minutos: d.minutos, enlace: enlaceDelChat(conv?.numero, d.chat.conversationId) };
  };
  const reasignados: Array<{ conversationId: string; de: string; a: string }> = [];

  for (const d of decisiones) {
    const anotacion = { tipo: d.tipo, conversationId: d.chat.conversationId, asesoraId: d.asesoraId, episodio: d.episodio, minutosEsperando: d.minutos };
    try {
      if (d.tipo === "AVISO" || d.tipo === "BOT_PIDIO_ASESORA" || d.tipo === "CALIENTE_24H") {
        const fila = await anotar(workspaceId, anotacion);
        if (fila) agregar(d.asesoraId, { tipo: d.tipo, ...base(d) }, fila);
        continue;
      }
      if (d.tipo === "SIN_CANDIDATA") {
        const fila = await anotar(workspaceId, { ...anotacion, error: "ya se reasignó por este mensaje y sigue sin respuesta" });
        if (fila) agregar(DUENO, { tipo: "SIN_CANDIDATA", ...base(d), otra: nombre(d.asesoraId), motivo: d.motivo }, fila);
        continue;
      }
      // REASIGNACION
      const conv = datos.get(d.chat.conversationId);
      if (!conv) continue;
      const linea = conv.channelId ? await deLaLinea(conv.channelId) : null;
      // Solo se les quitan chats a las asesoras de la línea: el chat que tomó el dueño (o una
      // supervisora que no atiende la línea) no se mueve.
      if (!linea?.asesoras.has(d.asesoraId)) continue;
      const nueva = elegirAsesora(linea.disponibles, pendientes, d.asesoraId);
      if (!nueva) {
        // No hay a quién: el chat no se mueve, queda anotado y le llega al dueño (una vez por mensaje del cliente).
        const fila = await anotar(workspaceId, { ...anotacion, tipo: "SIN_CANDIDATA", error: "no hay otra asesora activa" });
        if (fila) agregar(DUENO, { tipo: "SIN_CANDIDATA", ...base(d), otra: nombre(d.asesoraId), motivo: "sin_asesora" }, fila);
        continue;
      }
      // Si la asesora acaba de escribir, no se mueve.
      if (d.chat.ultimoClienteEn && (await respondioUnaPersona(conv.id, d.chat.ultimoClienteEn))) continue;
      const fila = await anotar(workspaceId, { ...anotacion, asesoraNuevaId: nueva });
      if (!fila) continue;
      // Solo si el chat sigue siendo de la anterior y sigue abierto (nadie lo movió entre tanto). Si
      // no se movió (o falló), se borra la anotación: la próxima vuelta lo vuelve a intentar.
      const cambio = await prisma.conversation
        .updateMany({ where: { id: conv.id, workspaceId, assignedToUserId: d.asesoraId, status: "OPEN" }, data: { assignedToUserId: nueva } })
        .catch((error: unknown) => {
          console.warn("[supervisor-reasignacion] no se pudo reasignar", conv.id, error instanceof Error ? error.message : error);
          return { count: 0 };
        });
      if (cambio.count === 0) {
        await prisma.supervisorAviso.delete({ where: { id: fila } }).catch(() => null);
        continue;
      }
      reasignados.push({ conversationId: conv.id, de: d.asesoraId, a: nueva });
      pendientes.set(nueva, (pendientes.get(nueva) ?? 0) + 1);
      pendientes.set(d.asesoraId, Math.max(0, (pendientes.get(d.asesoraId) ?? 0) - 1));
      await recordConversationActivity({
        workspaceId,
        conversationId: conv.id,
        channelId: conv.channelId,
        contactId: conv.contactId,
        kind: "assigned",
        text: `Supervisor asignó a ${nombre(nueva)} (${nombre(d.asesoraId)} llevaba ${d.minutos} min sin responder)`,
        assigneeUserId: nueva,
        origen: ORIGEN_REASIGNACION,
      });
      // "waha-update" hace que la bandeja vuelva a pedir la fila de ese chat (la nueva lo ve en Mías).
      await notifyRealtimeUpdate({ workspaceId, conversationId: conv.id, type: "waha-update" });
      await avisarAsignacionPorPush({ conversationId: conv.id, userId: nueva });
      agregar(nueva, { tipo: "REASIGNADO_A_TI", ...base(d), otra: nombre(d.asesoraId) }, fila);
      agregar(d.asesoraId, { tipo: "TE_LO_QUITARON", ...base(d), otra: nombre(nueva) }, fila);
    } catch (error) {
      console.warn("[supervisor-reasignacion] decisión", d.tipo, d.chat.conversationId, error instanceof Error ? error.message : error);
    }
  }

  const enviados = await mandarLosAvisos({ workspaceId, config, envios, chats });
  return { decisiones, reasignados, enviados };
}

/** Un mensaje por persona con todo lo suyo de la vuelta, y el resultado anotado en cada fila. */
async function mandarLosAvisos(input: { workspaceId: string; config: ConfigReasignacion; envios: Map<string, Envio>; chats: ChatAbierto[] }) {
  const { workspaceId, config, envios, chats } = input;
  const salida: Array<{ destino: string; numero: string | null; texto: string; ok: boolean }> = [];
  if (!envios.size) return salida;

  const avisos = await leerAvisosCrudos(workspaceId).catch(() => ({}) as Awaited<ReturnType<typeof leerAvisosCrudos>>);
  const destinos = avisos.destinos ?? [];
  const limpio = (n: string | undefined | null) => (n ?? "").replace(/\D/g, "");
  const numerosDelEquipo = new Set(destinos.map((d) => limpio(d.numero)).filter((n) => n.length >= 10));
  // Ningún número de cliente: si por error uno estuviera en la lista, igual no se le manda.
  const numerosDeClientes = new Set(chats.flatMap((c) => [limpio(c.telefono), limpio(c.telefonoDescubierto)]).filter(Boolean));
  const gravedad = await leerConfigGravedad(workspaceId).catch(() => CONFIG_GRAVEDAD_POR_DEFECTO);
  const numeroDe = (destino: string): string | null => {
    const numero =
      destino === DUENO
        ? limpio(gravedad.whatsapp.numero ?? destinos.find((d) => d.soloDe === null || d.soloDe === undefined)?.numero)
        : limpio(destinos.find((d) => d.userId === destino || d.soloDe === destino)?.numero);
    if (!numero || !numerosDelEquipo.has(numero) || numerosDeClientes.has(numero)) return null;
    return numero;
  };

  // Solo la línea configurada y solo si es ADMINISTRATIVA (nunca una de ventas).
  const linea = await prisma.whatsAppChannel
    .findFirst({ where: { id: config.canalId, workspaceId }, select: { purpose: true, evolutionInstanceName: true } })
    .catch(() => null);
  const errorDeLinea = !linea
    ? "la línea de avisos no existe"
    : linea.purpose !== "ADMIN"
      ? "la línea de avisos no es administrativa"
      : !linea.evolutionInstanceName
        ? "la línea de avisos no está conectada"
        : null;

  const resultado = new Map<string, string[]>();
  const anotarResultado = (filas: string[], error: string | null) => {
    for (const fila of filas) resultado.set(fila, [...(resultado.get(fila) ?? []), ...(error ? [error] : [])]);
  };

  for (const [destino, envio] of envios) {
    const texto = textoDelAviso(envio.lineas);
    const numero = numeroDe(destino);
    let error: string | null = errorDeLinea;
    if (!error && !numero) error = destino === DUENO ? "el dueño no tiene número de avisos" : "la asesora no tiene número de avisos";
    if (!error && linea?.evolutionInstanceName && numero) {
      try {
        await sendEvolutionTextMessageWithReconnect({ instanceName: linea.evolutionInstanceName, phoneNumber: numero, text: texto });
      } catch (fallo) {
        error = `no salió el WhatsApp: ${fallo instanceof Error ? fallo.message : String(fallo)}`.slice(0, 300);
      }
    }
    if (destino === DUENO) {
      await pushAAlexander(workspaceId, gravedad, { title: "Supervisor: chat sin a quién pasarlo", body: texto.slice(0, 180), tag: `reasignacion:${Date.now()}`, url: "/cliente/crm/supervisor" }).catch(() => 0);
    }
    salida.push({ destino, numero, texto, ok: !error });
    anotarResultado(envio.filas, error);
  }

  for (const [fila, errores] of resultado) {
    await prisma.supervisorAviso
      .update({ where: { id: fila }, data: { whatsappEnviado: errores.length === 0, ...(errores.length ? { error: errores.join(" · ").slice(0, 500) } : {}) } })
      .catch(() => null);
  }
  return salida;
}
