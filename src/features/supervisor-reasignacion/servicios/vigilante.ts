import { calcularReparto } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { filtrarSinPausaManual } from "@/lib/en-linea";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { filtrarPorHorario } from "@/lib/horario-de-reparto";
import { prisma } from "@/lib/prisma";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";
import { avisarAsignacionPorPush } from "@/lib/reparto-de-leads";
import { sendPushToUser } from "@/lib/web-push";

import { CONFIG_GRAVEDAD_POR_DEFECTO } from "@/features/avisos-gravedad/dominio/reglas";
import { leerConfigGravedad, numeroDeAvisosDeLaPersona, pushAAlexander } from "@/features/avisos-gravedad/servicios/enrutador";
import { enHorario } from "@/features/supervisor/dominio/detectores-atencion";
import { leerChatsAbiertos } from "@/features/supervisor/servicios/datos";

import {
  claveDeAviso,
  decidir,
  elegirAsesora,
  enlaceDelChat,
  etiquetaDeEtapa,
  etiquetaDelCliente,
  pendientesPorAsesora,
  textoParaAsesora,
  type ConfigReasignacion,
  type Decision,
  type LineaDeChat,
  type MensajeParaAsesora,
  type TipoDeAviso,
} from "../dominio/reglas";
import { leerConfigReasignacion, negociosConReasignacion } from "./config";

/**
 * EL VIGILANTE (servicio): una vuelta por minuto desde /api/cron/follows. Las reglas están en
 * ../dominio/reglas.ts.
 *
 * Qué hace: lee los chats abiertos de las líneas de ventas, anota en `SupervisorAviso` lo que toca
 * (la regla única de la tabla impide repetirlo), reasigna lo vencido y manda UN WhatsApp por asesora
 * por vuelta desde la línea Admin. NUNCA le escribe al cliente: el destino es siempre el número de
 * avisos de una persona del equipo (Mi empresa → Equipo).
 *
 * Nunca lanza hacia el reloj: una vuelta que falla no tumba los envíos.
 */

let corriendo = false;

const ORIGEN_REASIGNACION = "supervisor-reasignacion";

type FilaAnotada = { id: string };

/** Una asesora a la que hay que escribirle en esta vuelta, con las filas del registro que cubre su mensaje. */
type Destinataria = { mensaje: MensajeParaAsesora; filas: FilaAnotada[]; hayNuevos: string[] };

const mensajeVacio = (config: ConfigReasignacion): MensajeParaAsesora => ({
  esperando: [],
  calientes: [],
  recibidos: [],
  perdidos: [],
  minutosReasignacion: config.minutosReasignacion,
  horasCaliente: config.horasCaliente,
});

/** Anota en el registro. false = ya estaba anotado (o no se pudo): en los dos casos NO se manda nada. */
async function anotar(input: {
  workspaceId: string;
  conversationId: string;
  tipo: TipoDeAviso;
  asesoraId: string | null;
  asesoraNuevaId?: string | null;
  episodio: string;
  minutos: number;
  error?: string | null;
}): Promise<FilaAnotada | null> {
  try {
    const fila = await prisma.supervisorAviso.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        tipo: input.tipo,
        asesoraId: input.asesoraId,
        asesoraNuevaId: input.asesoraNuevaId ?? null,
        episodio: input.episodio,
        minutosEsperando: input.minutos,
        error: input.error ?? null,
      },
      select: { id: true },
    });
    return fila;
  } catch (error) {
    // P2002 = ya estaba anotado (otra vuelta u otro proceso): es lo esperado y no se repite.
    if ((error as { code?: string })?.code !== "P2002") {
      console.warn("[supervisor-reasignacion] no se pudo anotar", error instanceof Error ? error.message : error);
    }
    return null;
  }
}

/** Las asesoras que pueden recibir un chat de esta línea: colaboradoras activas, en su horario y sin pausa. */
async function candidatasDeLaLinea(workspaceId: string, channelId: string | null, ahora: Date): Promise<string[]> {
  if (!channelId) return [];
  const canal = await prisma.whatsAppChannel.findFirst({ where: { id: channelId, workspaceId }, select: { metadata: true } });
  const colaboradoras = calcularReparto(canal?.metadata ?? {});
  if (!colaboradoras.length) return [];
  const activas = await prisma.workspaceMember.findMany({
    where: { workspaceId, isActive: true, userId: { in: colaboradoras } },
    select: { userId: true },
  });
  const idsActivos = new Set(activas.map((m) => m.userId));
  const enHorarioDeReparto = new Set(await filtrarPorHorario(workspaceId, colaboradoras.filter((id) => idsActivos.has(id)), ahora));
  const sinPausa = await filtrarSinPausaManual(workspaceId, [...enHorarioDeReparto], ahora);
  return colaboradoras.filter((id) => enHorarioDeReparto.has(id) && sinPausa.has(id));
}

/** ¿La asesora contestó después de que el cliente escribió? (por si lo hizo justo ahora). */
async function yaContesto(conversationId: string, desde: Date): Promise<boolean> {
  const mensajes = await prisma.message.findMany({
    where: { conversationId, direction: "OUTBOUND", type: { not: "SYSTEM" }, createdAt: { gt: desde } },
    select: { rawPayload: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return mensajes.some((m) => {
    const origen = (m.rawPayload as { source?: string } | null)?.source;
    return origen === "manual" || origen === "instance";
  });
}

async function nombreDe(userId: string): Promise<string> {
  const usuario = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }).catch(() => null);
  return usuario?.name?.trim() || usuario?.email || "otra asesora";
}

/** WhatsApp desde la línea Admin al número de avisos de una persona del equipo. Devuelve null si salió, o el motivo. */
async function mandarWhatsApp(workspaceId: string, canalId: string, userId: string, texto: string): Promise<string | null> {
  const canal = await prisma.whatsAppChannel
    .findFirst({ where: { id: canalId, workspaceId, purpose: "ADMIN" }, select: { evolutionInstanceName: true } })
    .catch(() => null);
  if (!canal?.evolutionInstanceName) return "la línea de avisos no existe o no es administrativa";
  const numero = await numeroDeAvisosDeLaPersona(workspaceId, userId).catch(() => null);
  if (!numero) return "la asesora no tiene número de avisos (Mi empresa → Equipo)";
  try {
    await sendEvolutionTextMessageWithReconnect({ instanceName: canal.evolutionInstanceName, phoneNumber: numero, text: texto });
    return null;
  } catch (error) {
    return `no salió el WhatsApp: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`;
  }
}

/** Una vuelta para un negocio. Devuelve cuántos avisos y reasignaciones hizo. */
export async function vigilarNegocio(workspaceId: string, ahora = new Date()): Promise<{ avisos: number; reasignados: number }> {
  const config = await leerConfigReasignacion(workspaceId);
  const resultado = { avisos: 0, reasignados: 0 };
  if (!config.avisosActivo && !config.reasignacionActiva) return resultado;
  // Fuera de horario no avisa ni reasigna: ni siquiera se leen los chats.
  if (!enHorario(ahora, config.horario)) return resultado;

  // Con el turno: si ya contestó el bot y se espera al cliente, el chat no está esperando a la asesora.
  const chats = await leerChatsAbiertos({ workspaceId, ahora, conTurno: true });
  if (!chats.length) return resultado;
  const filasPrevias = await prisma.supervisorAviso.findMany({
    where: { workspaceId, conversationId: { in: chats.map((c) => c.conversationId) }, creadoEn: { gte: new Date(ahora.getTime() - 14 * 86_400_000) } },
    select: { conversationId: true, tipo: true, episodio: true },
  });
  const registrados = new Set(filasPrevias.map((f) => claveDeAviso(f.conversationId, f.tipo as TipoDeAviso, f.episodio)));
  const decisiones = decidir({ chats, ahora, config, registrados });
  if (!decisiones.length) return resultado;

  const datos = await prisma.conversation.findMany({
    where: { workspaceId, id: { in: decisiones.map((d) => d.conversationId) } },
    select: { id: true, numero: true, channelId: true },
  });
  const infoDe = new Map(datos.map((d) => [d.id, d]));
  const pendientes = pendientesPorAsesora(chats, ahora, config.horario);
  const candidatasPorLinea = new Map<string, string[]>();

  const destinatarias = new Map<string, Destinataria>();
  const de = (userId: string) => {
    let d = destinatarias.get(userId);
    if (!d) {
      d = { mensaje: mensajeVacio(config), filas: [], hayNuevos: [] };
      destinatarias.set(userId, d);
    }
    return d;
  };
  const lineaDe = (d: Decision, minutos = d.minutos): LineaDeChat => ({
    cliente: etiquetaDelCliente(d.nombre, d.telefono),
    etapa: etiquetaDeEtapa(d.etapa),
    minutos,
    enlace: enlaceDelChat(infoDe.get(d.conversationId)?.numero),
  });

  for (const decision of decisiones) {
    try {
      if (decision.tipo !== "REASIGNACION") {
        const fila = await anotar({ workspaceId, ...decision, asesoraId: decision.asesoraId });
        if (!fila) continue;
        const destino = de(decision.asesoraId);
        destino.filas.push(fila);
        if (decision.tipo === "CALIENTE_24H") destino.mensaje.calientes.push(lineaDe(decision));
        else destino.mensaje.esperando.push(lineaDe(decision));
        resultado.avisos += 1;
        continue;
      }

      // REASIGNACIÓN. Primero se busca a quién: sin candidata el chat no se mueve y queda anotado.
      const info = infoDe.get(decision.conversationId);
      const claveLinea = info?.channelId ?? "";
      if (!candidatasPorLinea.has(claveLinea)) candidatasPorLinea.set(claveLinea, await candidatasDeLaLinea(workspaceId, info?.channelId ?? null, ahora));
      const nueva = elegirAsesora(candidatasPorLinea.get(claveLinea) ?? [], pendientes, decision.asesoraId);
      if (!nueva) {
        const fila = await anotar({ workspaceId, ...decision, tipo: "SIN_CANDIDATA", error: "no hay otra asesora activa, en horario y sin pausa" });
        if (fila) {
          const gravedad = await leerConfigGravedad(workspaceId).catch(() => CONFIG_GRAVEDAD_POR_DEFECTO);
          await pushAAlexander(workspaceId, gravedad, {
            title: "Chat sin respuesta y sin a quién pasarlo",
            body: `${etiquetaDelCliente(decision.nombre, decision.telefono)} lleva ${decision.minutos} min esperando y no hay otra asesora disponible.`.slice(0, 180),
            tag: `reasignacion:${decision.conversationId}`,
            url: info?.numero ? enlaceDelChat(info.numero) : "/cliente/crm/supervisor",
          }).catch(() => 0);
        }
        continue;
      }

      // Si ella contestó justo ahora, no se mueve (ni se anota: la próxima vuelta ya no lo verá esperando).
      const cliente = new Date(decision.episodio);
      if (await yaContesto(decision.conversationId, cliente).catch(() => false)) continue;

      const fila = await anotar({ workspaceId, ...decision, asesoraNuevaId: nueva });
      if (!fila) continue;
      // Solo si el chat SIGUE siendo de la asesora anterior (otra persona pudo habérselo cambiado).
      const cambio = await prisma.conversation.updateMany({
        where: { id: decision.conversationId, workspaceId, assignedToUserId: decision.asesoraId },
        data: { assignedToUserId: nueva },
      });
      if (cambio.count === 0) {
        await prisma.supervisorAviso.update({ where: { id: fila.id }, data: { error: "el chat ya no era de ella: no se movió" } }).catch(() => {});
        continue;
      }
      pendientes.set(nueva, (pendientes.get(nueva) ?? 0) + 1);
      const nombreNueva = await nombreDe(nueva);
      await recordConversationActivity({
        workspaceId,
        conversationId: decision.conversationId,
        channelId: info?.channelId ?? null,
        kind: "assigned",
        assigneeUserId: nueva,
        origen: ORIGEN_REASIGNACION,
        text: `${nombreNueva} asignado por el Supervisor (la asesora anterior no respondió en ${decision.minutos} min)`,
      });
      void notifyRealtimeUpdate({ workspaceId, conversationId: decision.conversationId });
      const linea = lineaDe(decision);
      const paraNueva = de(nueva);
      paraNueva.filas.push(fila);
      paraNueva.hayNuevos.push(decision.conversationId);
      paraNueva.mensaje.recibidos.push(linea);
      const paraAnterior = de(decision.asesoraId);
      paraAnterior.filas.push(fila);
      paraAnterior.mensaje.perdidos.push({ ...linea, aQuien: nombreNueva });
      resultado.reasignados += 1;
    } catch (error) {
      console.warn("[supervisor-reasignacion] decisión", decision.tipo, error instanceof Error ? error.message : error);
    }
  }

  // Un solo WhatsApp por asesora por vuelta.
  for (const [userId, destino] of destinatarias) {
    const texto = textoParaAsesora(destino.mensaje);
    if (!texto) continue;
    const motivo = await mandarWhatsApp(workspaceId, config.canalId, userId, texto);
    for (const fila of destino.filas) {
      // Una reasignación toca a dos asesoras: si a una le salió y a la otra no, queda el primer error.
      await prisma.supervisorAviso
        .update({ where: { id: fila.id }, data: motivo ? { error: motivo } : { whatsappEnviado: true } })
        .catch(() => {});
    }
    if (motivo) {
      console.warn("[supervisor-reasignacion] sin WhatsApp para la asesora", { asesora: userId, motivo });
      // Sin WhatsApp, al menos el push al teléfono: quien recibió un chat se tiene que enterar.
      for (const conversationId of destino.hayNuevos) void avisarAsignacionPorPush({ conversationId, userId });
      if (!destino.hayNuevos.length) {
        await sendPushToUser({ userId, payload: { title: "Cliente esperando respuesta", body: "Tienes chats sin responder.", tag: `supervisor-reasignacion:${userId}`, url: "/cliente/crm/mi-dia" } }).catch(() => 0);
      }
    }
  }
  return resultado;
}

/** La vuelta del minuto: todos los negocios con algún interruptor prendido. */
export async function vigilarReasignacion(ahora = new Date()): Promise<{ negocios: number; avisos: number; reasignados: number }> {
  if (corriendo) return { negocios: 0, avisos: 0, reasignados: 0 };
  corriendo = true;
  try {
    const negocios = await negociosConReasignacion();
    let avisos = 0;
    let reasignados = 0;
    for (const workspaceId of negocios) {
      try {
        const r = await vigilarNegocio(workspaceId, ahora);
        avisos += r.avisos;
        reasignados += r.reasignados;
      } catch (error) {
        console.error("[supervisor-reasignacion]", workspaceId, error instanceof Error ? error.message : error);
      }
    }
    return { negocios: negocios.length, avisos, reasignados };
  } finally {
    corriendo = false;
  }
}
