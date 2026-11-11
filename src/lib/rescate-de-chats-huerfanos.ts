import { leerMarcaExterior } from "@/features/seguimiento-inteligente/dominio/exterior";
import { ventanaDeMadrugada } from "@/lib/en-linea-reglas";
import { prisma } from "@/lib/prisma";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";
import {
  chatsDondeElAgentePidioAsesor,
  elChatNecesitaAsesora,
  leerConfigDeAsignacion,
  leerSiElAgentePidioAsesor,
  type ConfigDeAsignacion,
} from "@/lib/reparto-cuando-lo-necesita";

/**
 * LA RED: un cliente esperando y sin nadie a cargo.
 *
 * Desde el 25-09-2026 los leads se reparten cuando el agente levanta la mano, no al entrar. Es lo
 * que evita que una asesora cargue con decenas de chats que escriben una vez y desaparecen.
 *
 * Pero deja un hueco: si el agente NO levanta la mano —porque no entendió y tampoco escaló, o
 * porque el servidor tuvo un hipo— ese chat se queda sin dueño y sin respuesta, y nadie lo ve en
 * "Mías". Paso de verdad el mismo día, dos veces, con "Pestañas" y con una clienta que solo dijo
 * su nombre y su ciudad.
 *
 * Esto lo tapa: cada vuelta busca chats donde el último que habló fue el cliente, nadie contestó
 * en media hora y no tienen dueño. Los reparte por turnos, igual que el resto.
 *
 * EL SEGUNDO CASO (Alex, 30-10-2026): la clienta respondió la bienvenida y quedó sin asesora.
 *
 * Desde ese día el reparto asigna asesora apenas la clienta responde la bienvenida (cualquier
 * mensaje después del primero nuestro, incluso "ok"). Pero el reparto corre cuando el bot ya
 * contestó, así que si algo falla en ese momento el último mensaje del chat es del bot y el caso
 * de arriba nunca lo ve. El 29-10-2026 quedaron 9 así. Por eso también se buscan los chats de
 * líneas de VENTAS sin dueño con movimiento en las últimas 48 h —sin la media hora de espera: ya
 * respondió— y se rescatan si `respondioLaBienvenida` dice que sí.
 *
 * LA REGLA NUEVA (Alex, 11-11-2026): ninguno de los dos casos se salta `elChatNecesitaAsesora`
 * (reparto-cuando-lo-necesita.ts), la misma regla del reparto por turno. Sin eso, un "Para el combo
 * de estética" que el reparto no asignó lo asignaba el rescate a la media hora.
 *  - Segundo caso: se rescata solo si la regla dice que sí (antes: si respondió la bienvenida).
 *  - Primer caso (media hora sin respuesta): también pasa por la regla, menos cuando nadie le ha
 *    contestado nunca a la clienta. Ese chat sí está abandonado (el bot se cayó) y se rescata igual.
 *  - Con `comoAntes` prendido los dos casos quedan como antes del 11-11-2026.
 * Los chats que ya tienen asesora no se miran: las dos búsquedas piden `assignedToUserId: null`.
 *
 * No manda ningún mensaje al cliente: solo pone a alguien a cargo. Quien decide qué decirle es la
 * asesora que lo recibe.
 */

/** Cuánto se espera antes de rescatar. Menos que esto es no darle tiempo al agente a trabajar. */
const ESPERA_MINUTOS = 30;

/** Un chat de ayer no es un rescate: es otra conversación. */
const VENTANA_MAXIMA_HORAS = 12;

/** Por vuelta: el cron corre cada minuto, así que un atraso se drena solo. */
const CUANTOS_POR_VUELTA = 15;

/** Hasta dónde se busca a quien respondió la bienvenida y quedó sin asesora. */
const VENTANA_BIENVENIDA_HORAS = 48;

/**
 * Cuántos chats de ventas sin dueño se miran por vuelta para el segundo caso. La mayoría nunca
 * respondió la bienvenida (escribieron una vez y se fueron), así que hay que mirar bastantes para
 * que no tapen a los que sí; por eso primero se filtran con dos consultas en lote.
 */
const CUANTOS_MIRAR_BIENVENIDA = 500;

/** Mensajes del comienzo del chat que alcanzan para saber si respondió la bienvenida (`comoAntes`). */
const MENSAJES_PARA_BIENVENIDA = 30;

/** Mensajes (los más nuevos) que se leen para decidir el primer caso con la regla nueva. */
const MENSAJES_PARA_LA_REGLA = 60;

const SELECCION = {
  id: true,
  channelId: true,
  workspaceId: true,
  lastMessageAt: true,
  automationPaused: true,
  contact: { select: { metadata: true } },
} as const;

/** La configuración de cada negocio, leída una vez por vuelta (y con su minuto de memoria). */
function configsPorNegocio() {
  const leidas = new Map<string, Promise<ConfigDeAsignacion>>();
  return (workspaceId: string) => {
    let config = leidas.get(workspaceId);
    if (!config) {
      config = leerConfigDeAsignacion(workspaceId);
      leidas.set(workspaceId, config);
    }
    return config;
  };
}

/**
 * Primer caso: ¿este chat que espera hace media hora necesita asesora?
 * Con la regla nueva: sí si nadie le ha contestado nunca (chat abandonado), o si lo dice la regla.
 */
async function elHuerfanoNecesitaAsesora(
  conversacion: { id: string; automationPaused: boolean },
  config: ConfigDeAsignacion,
): Promise<boolean> {
  if (config.comoAntes) return true;
  const [mensajes, agentePidioAsesor] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversacion.id, type: { not: "SYSTEM" }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: MENSAJES_PARA_LA_REGLA,
      select: { type: true, direction: true, content: true, createdAt: true },
    }),
    leerSiElAgentePidioAsesor(conversacion.id),
  ]);
  if (!mensajes.some((mensaje) => mensaje.direction === "OUTBOUND")) return true;
  return elChatNecesitaAsesora({ mensajes, config, agentePidioAsesor, iaPausada: conversacion.automationPaused });
}

/**
 * Chats de ventas sin dueño de las últimas 48 h donde la clienta respondió y la regla dice que
 * necesitan asesora.
 *
 * Primero, en lote: el primer mensaje nuestro y el último de la clienta de cada chat. Si la clienta
 * no escribió después del primero nuestro, no respondió y no se sigue (el reparto por turno ya lo
 * miró cuando escribió). A los que pasan los decide `elChatNecesitaAsesora`, la misma regla del
 * reparto por turno: con `comoAntes`, leyendo los primeros mensajes de cada chat; con la regla nueva,
 * con dos consultas en lote (lo que escribió la clienta y las notas "El agente pide un asesor").
 */
async function chatsQueNecesitanAsesora(ahora: Date, configDe: (workspaceId: string) => Promise<ConfigDeAsignacion>) {
  const sinDueno = await prisma.conversation.findMany({
    where: {
      assignedToUserId: null,
      status: { notIn: ["CLOSED", "ARCHIVED"] },
      channelId: { not: null },
      channel: { is: { purpose: "SALES" } },
      lastMessageAt: { gte: new Date(ahora.getTime() - VENTANA_BIENVENIDA_HORAS * 3_600_000) },
    },
    select: SELECCION,
    orderBy: { lastMessageAt: "desc" },
    take: CUANTOS_MIRAR_BIENVENIDA,
  });
  if (sinDueno.length === 0) {
    return [];
  }

  const ids = sinDueno.map((conversacion) => conversacion.id);
  const vigentes = { conversationId: { in: ids }, type: { not: "SYSTEM" as const }, deletedAt: null };
  const [primerosNuestros, ultimosDelCliente] = await Promise.all([
    prisma.message.groupBy({
      by: ["conversationId"],
      where: { ...vigentes, direction: "OUTBOUND" },
      _min: { createdAt: true },
    }),
    prisma.message.groupBy({
      by: ["conversationId"],
      where: { ...vigentes, direction: "INBOUND" },
      _max: { createdAt: true },
    }),
  ]);
  const primerNuestro = new Map(primerosNuestros.map((fila) => [fila.conversationId, fila._min.createdAt]));
  const ultimoDelCliente = new Map(ultimosDelCliente.map((fila) => [fila.conversationId, fila._max.createdAt]));

  const respondieron = sinDueno.filter((conversacion) => {
    const nuestro = primerNuestro.get(conversacion.id);
    const cliente = ultimoDelCliente.get(conversacion.id);
    return Boolean(nuestro && cliente && cliente >= nuestro) && !leerMarcaExterior(conversacion.contact?.metadata);
  });
  if (respondieron.length === 0) {
    return [];
  }

  const configs = new Map<string, ConfigDeAsignacion>();
  for (const workspaceId of new Set(respondieron.map((conversacion) => conversacion.workspaceId))) {
    configs.set(workspaceId, await configDe(workspaceId));
  }
  const conReglaNueva = respondieron.filter((conversacion) => !configs.get(conversacion.workspaceId)?.comoAntes);
  const idsReglaNueva = conReglaNueva.map((conversacion) => conversacion.id);
  const [pidioAsesor, textosDeLaClienta] = await Promise.all([
    chatsDondeElAgentePidioAsesor(idsReglaNueva),
    idsReglaNueva.length === 0
      ? Promise.resolve([])
      : prisma.message.findMany({
          // Solo lo de la ventana: lo de antes ya lo miró el reparto por turno cuando ella lo escribió.
          where: {
            conversationId: { in: idsReglaNueva },
            direction: "INBOUND",
            type: "TEXT",
            deletedAt: null,
            createdAt: { gte: new Date(ahora.getTime() - VENTANA_BIENVENIDA_HORAS * 3_600_000) },
          },
          select: { conversationId: true, direction: true, type: true, content: true },
        }),
  ]);
  const textosPorChat = new Map<string, typeof textosDeLaClienta>();
  for (const texto of textosDeLaClienta) {
    const lista = textosPorChat.get(texto.conversationId) ?? [];
    lista.push(texto);
    textosPorChat.set(texto.conversationId, lista);
  }

  const elegidas: typeof sinDueno = [];
  for (const conversacion of respondieron) {
    if (elegidas.length >= CUANTOS_POR_VUELTA * 3) {
      break;
    }
    const config = configs.get(conversacion.workspaceId);
    if (!config) {
      continue;
    }
    let mensajes: Parameters<typeof elChatNecesitaAsesora>[0]["mensajes"];
    if (config.comoAntes) {
      const filas = await prisma.message.findMany({
        where: { conversationId: conversacion.id, type: { not: "SYSTEM" }, deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: MENSAJES_PARA_BIENVENIDA,
        select: { type: true, direction: true, createdAt: true, deletedAt: true },
      });
      mensajes = filas.map((mensaje) => ({
        type: mensaje.type,
        direction: mensaje.direction,
        createdAt: mensaje.createdAt,
        borrado: mensaje.deletedAt != null,
      }));
    } else {
      mensajes = textosPorChat.get(conversacion.id) ?? [];
    }
    const necesita = elChatNecesitaAsesora({
      mensajes,
      config,
      agentePidioAsesor: pidioAsesor.has(conversacion.id),
      iaPausada: conversacion.automationPaused,
    });
    if (necesita) {
      elegidas.push(conversacion);
    }
  }
  return elegidas;
}

export async function rescatarChatsHuerfanos(ahora = new Date()): Promise<{ repartidos: number; revisados: number }> {
  const candidatas = await prisma.conversation.findMany({
    where: {
      assignedToUserId: null,
      status: { notIn: ["CLOSED", "ARCHIVED"] },
      channelId: { not: null },
      lastMessageAt: {
        lte: new Date(ahora.getTime() - ESPERA_MINUTOS * 60_000),
        gte: new Date(ahora.getTime() - VENTANA_MAXIMA_HORAS * 3_600_000),
      },
    },
    select: SELECCION,
    orderBy: { lastMessageAt: "desc" },
    take: CUANTOS_POR_VUELTA * 3,
  });

  /*
    El segundo caso va aparte y con su propio try: si su búsqueda falla, el caso de siempre sigue
    rescatando. Sus chats ya vienen revisados (la regla dijo que necesitan asesora), no hace falta
    que el último mensaje sea de la clienta.
  */
  const configDe = configsPorNegocio();
  let respondieron: Awaited<ReturnType<typeof chatsQueNecesitanAsesora>> = [];
  try {
    respondieron = await chatsQueNecesitanAsesora(ahora, configDe);
  } catch (error) {
    console.error("[rescate] no se pudo buscar a quienes respondieron la bienvenida", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const yaRevisados = new Set(respondieron.map((conversacion) => conversacion.id));

  let repartidos = 0;
  let revisados = 0;

  const todas = [
    ...candidatas.filter((conversacion) => !yaRevisados.has(conversacion.id)).map((conversacion) => ({ conversacion, respondio: false })),
    ...respondieron.map((conversacion) => ({ conversacion, respondio: true })),
  ];

  for (const { conversacion, respondio } of todas) {
    if (repartidos >= CUANTOS_POR_VUELTA) {
      break;
    }
    // Fuera de Colombia (seguimiento inteligente): no se le pasa a ninguna asesora.
    if (leerMarcaExterior(conversacion.contact?.metadata)) {
      continue;
    }
    revisados += 1;

    /*
      Que el cliente esté esperando de verdad: el último mensaje tiene que ser suyo.

      Las notas del sistema no cuentan como hablar —el agente deja una después de cada respuesta—,
      así que mirarlas haría creer que el último en hablar fuimos nosotros.
    */
    if (!conversacion.channelId) {
      continue;
    }
    if (!respondio) {
      const ultimo = await prisma.message.findFirst({
        where: { conversationId: conversacion.id, type: { not: "SYSTEM" } },
        orderBy: { createdAt: "desc" },
        select: { direction: true },
      });
      if (!ultimo || ultimo.direction !== "INBOUND") {
        continue;
      }
    }

    try {
      // La regla nueva tampoco se salta acá (ver arriba). Los del segundo caso ya pasaron por ella.
      if (!respondio && !(await elHuerfanoNecesitaAsesora(conversacion, await configDe(conversacion.workspaceId)))) {
        continue;
      }
    } catch (error) {
      console.error("[rescate] no se pudo revisar si el chat necesita asesora", {
        conversationId: conversacion.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    try {
      /*
        Cuenta solo lo repartido de verdad: null = nadie en turno, o ya lo tomó alguien.

        La madrugada (Alex, 08-10-2026): de noche, sin nadie en línea, NO se reparte (ni al
        respaldo): queda marcado para la mañana. Si el cliente escribió de noche, se reparte como
        chat de madrugada (con tope de 7 a 8, ver en-linea-reglas.ts), no al respaldo a las 7:00.
      */
      const noche = ventanaDeMadrugada(ahora);
      const escribioDeNoche = Boolean(
        conversacion.lastMessageAt && conversacion.lastMessageAt >= noche.desde && conversacion.lastMessageAt < noche.hasta,
      );
      const elegida = await autoAssignConversationToCollaborator({
        conversationId: conversacion.id,
        channelId: conversacion.channelId,
        workspaceId: conversacion.workspaceId,
        ahora,
        ...(escribioDeNoche ? { deMadrugada: true } : {}),
      });
      if (elegida) {
        repartidos += 1;
      }
    } catch (error) {
      console.error("[rescate] no se pudo repartir el chat", {
        conversationId: conversacion.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { repartidos, revisados };
}
