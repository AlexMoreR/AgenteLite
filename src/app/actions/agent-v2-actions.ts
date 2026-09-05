"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { generateUniqueAgentSlug } from "@/lib/agent";
import {
  buildAgentSystemPrompt,
  buildAgentTrainingConfig,
  buildFallbackMessage,
  buildHandoffMessage,
  buildWelcomeMessage,
  defaultAgentTrainingConfig,
  type AgentKnowledgePromptFlow,
  type AgentKnowledgePromptProduct,
} from "@/lib/agent-training";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import {
  nombreDelFlujoEnBienvenida,
  textoSinLaLineaDeFlujo,
} from "@/features/agents-v2/domain/flujo-de-bienvenida";

async function getV2Workspace() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  await requireClientWorkspaceAccess("agents_v2");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  return membership?.workspace.id ?? null;
}

async function bindChannelToAgent(workspaceId: string, agentId: string, channelId: string | null) {
  // Un agente V2 queda vinculado a un solo canal: se desvincula el anterior.
  await prisma.whatsAppChannel.updateMany({
    where: { workspaceId, agentId },
    data: { agentId: null },
  });
  if (channelId) {
    await prisma.whatsAppChannel.updateMany({
      where: { id: channelId, workspaceId },
      data: { agentId },
    });
  }
}

export async function createAgentV2Action(input: {
  name: string;
  connectionId?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const workspaceId = await getV2Workspace();
  if (!workspaceId) {
    return { ok: false, error: "No autorizado" };
  }
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: "El nombre es obligatorio" };
  }

  const slug = await generateUniqueAgentSlug(workspaceId, name);
  const agent = await prisma.agent.create({
    data: {
      workspaceId,
      name,
      slug,
      agentType: "V2",
      status: "ACTIVE",
      isActive: true,
    },
    select: { id: true },
  });

  if (input.connectionId) {
    await bindChannelToAgent(workspaceId, agent.id, input.connectionId);
  }

  revalidatePath("/cliente/agente-v2");
  return { ok: true, id: agent.id };
}

export async function updateAgentV2Action(input: {
  agentId: string;
  name: string;
  connectionId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspaceId = await getV2Workspace();
  if (!workspaceId) {
    return { ok: false, error: "No autorizado" };
  }
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: "El nombre es obligatorio" };
  }

  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, workspaceId, agentType: "V2" },
    select: { id: true },
  });
  if (!agent) {
    return { ok: false, error: "Agente no encontrado" };
  }

  await prisma.agent.update({ where: { id: agent.id }, data: { name } });
  await bindChannelToAgent(workspaceId, agent.id, input.connectionId || null);

  revalidatePath("/cliente/agente-v2");
  return { ok: true };
}

export async function toggleAgentV2Action(input: {
  agentId: string;
  active: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspaceId = await getV2Workspace();
  if (!workspaceId) {
    return { ok: false, error: "No autorizado" };
  }
  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, workspaceId, agentType: "V2" },
    select: { id: true },
  });
  if (!agent) {
    return { ok: false, error: "Agente no encontrado" };
  }

  await prisma.agent.update({
    where: { id: agent.id },
    data: { status: input.active ? "ACTIVE" : "PAUSED", isActive: input.active },
  });

  revalidatePath("/cliente/agente-v2");
  return { ok: true };
}

export async function deleteAgentV2Action(input: {
  agentId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspaceId = await getV2Workspace();
  if (!workspaceId) {
    return { ok: false, error: "No autorizado" };
  }
  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, workspaceId, agentType: "V2" },
    select: { id: true },
  });
  if (!agent) {
    return { ok: false, error: "Agente no encontrado" };
  }

  await prisma.$transaction([
    prisma.whatsAppChannel.updateMany({ where: { workspaceId, agentId: agent.id }, data: { agentId: null } }),
    prisma.message.deleteMany({ where: { agentId: agent.id } }),
    prisma.conversation.deleteMany({ where: { agentId: agent.id } }),
    prisma.agent.delete({ where: { id: agent.id } }),
  ]);

  revalidatePath("/cliente/agente-v2");
  return { ok: true };
}

export async function saveAgentV2GraphAction(input: {
  agentId: string;
  graph: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspaceId = await getV2Workspace();
  if (!workspaceId) {
    return { ok: false, error: "No autorizado" };
  }
  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, workspaceId, agentType: "V2" },
    select: { id: true },
  });
  if (!agent) {
    return { ok: false, error: "Agente no encontrado" };
  }

  await prisma.agent.update({
    where: { id: agent.id },
    data: { graph: input.graph as Prisma.InputJsonValue },
  });
  return { ok: true };
}

export type AgentV2BusinessInput = {
  name: string;
  sector: string;
  location: string;
  website: string;
  phone: string;
  email: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  youtube: string;
};

export async function saveAgentV2BusinessConfigAction(
  input: AgentV2BusinessInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("agents_v2");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { ok: false, error: "Debes configurar tu negocio primero" };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: membership.workspace.id },
    select: { name: true, businessConfig: true },
  });

  const currentConfig =
    workspace?.businessConfig && typeof workspace.businessConfig === "object"
      ? (workspace.businessConfig as Record<string, unknown>)
      : {};
  const businessDescription =
    typeof currentConfig.businessDescription === "string" ? currentConfig.businessDescription : "";

  const nextName = input.name.trim() || workspace?.name || membership.workspace.name;

  await prisma.workspace.update({
    where: { id: membership.workspace.id },
    data: {
      name: nextName,
      businessConfig: {
        businessDescription,
        sectorRubro: input.sector,
        location: input.location,
        website: input.website,
        contactPhone: input.phone,
        contactEmail: input.email,
        instagram: input.instagram,
        facebook: input.facebook,
        tiktok: input.tiktok,
        youtube: input.youtube,
      },
    },
  });

  revalidatePath("/cliente/agente-v2");
  revalidatePath("/cliente");

  return { ok: true };
}

type GraphNode = { id: string; type?: string; data?: Record<string, unknown> };
type GraphEdge = { source?: string; target?: string; sourceHandle?: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getGraphNodeFlowIds(node: GraphNode): string[] {
  const flowIds = asStringArray(node.data?.flowIds).map((flowId) => flowId.trim()).filter(Boolean);
  const legacyFlowId = asString(node.data?.flowId).trim();
  return Array.from(new Set([...flowIds, legacyFlowId].filter(Boolean)));
}

// Compila el grafo V2 a las estructuras que el motor existente usa para responder.
export async function publishAgentV2Action(input: {
  agentId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("agents_v2");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { ok: false, error: "Sin workspace" };
  }
  const workspaceId = membership.workspace.id;

  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, workspaceId, agentType: "V2" },
    select: { id: true, name: true, graph: true, trainingConfig: true },
  });
  if (!agent) {
    return { ok: false, error: "Agente no encontrado" };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, businessConfig: true },
  });
  const cfg =
    workspace?.businessConfig && typeof workspace.businessConfig === "object"
      ? (workspace.businessConfig as Record<string, unknown>)
      : {};
  const business = {
    name: workspace?.name ?? "",
    description: asString(cfg.businessDescription),
    sector: asString(cfg.sectorRubro),
    location: asString(cfg.location),
    website: asString(cfg.website),
    phone: asString(cfg.contactPhone),
    email: asString(cfg.contactEmail),
    instagram: asString(cfg.instagram),
    facebook: asString(cfg.facebook),
    tiktok: asString(cfg.tiktok),
    youtube: asString(cfg.youtube),
  };

  const graph = agent.graph as { nodes?: GraphNode[]; edges?: GraphEdge[] } | null;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  const agentNode = nodes.find((node) => node.type === "agent");
  const bienvenidaNode = nodes.find((node) => node.type === "bienvenida");
  // Solo cuentan los nodos Producto/Flujo realmente conectados al Agente (handles
  // tool-products / tool-flows). Sin conexión, la herramienta no los considera.
  const agentToolTargets = new Set(
    edges
      .filter((edge) => edge.source === agentNode?.id && Boolean(edge.target))
      .map((edge) => edge.target),
  );
  const productNodes = nodes.filter(
    (node) => node.type === "producto" && agentToolTargets.has(node.id),
  );
  /**
   * Los flujos que la IA puede ejecutar.
   *
   * Ademas de los colgados del Agente, entran los que señala una rama de Condicion. Sin esto, al
   * publicar le dabamos una orden imposible: la rama decia "ejecuta OBLIGATORIAMENTE el flujo de
   * las fotos" pero ese flujo no figuraba en su lista de flujos conocidos, asi que no lo
   * encontraba y terminaba improvisando —el famoso "lamentablemente, no puedo enviar fotos"—
   * mientras en el diagrama la conexion se veia perfecta.
   */
  const conditionNodeIds = new Set(
    nodes.filter((node) => node.type === "condicion").map((node) => node.id),
  );
  const flowNodeIdsFromConditions = new Set(
    edges
      .filter((edge) => Boolean(edge.source) && conditionNodeIds.has(edge.source as string))
      .map((edge) => edge.target)
      .filter((target): target is string => Boolean(target)),
  );
  /*
    Lo que sale de "Llamar al siguiente bloque" de la Bienvenida.

    Alex conecto ahi un Flujo, publico, y el agente saludo y siguio improvisando: el compilador
    solo miraba los flujos colgados del Agente o de una Condicion, asi que ese quedaba fuera de la
    lista de flujos conocidos y la conexion era un dibujo.
  */
  const despuesDeLaBienvenida = bienvenidaNode
    ? edges.find((edge) => edge.source === bienvenidaNode.id && edge.sourceHandle === "next-block")
        ?.target
    : undefined;

  /*
    Los nodos IA: una instruccion suelta cada uno, para ir sacando reglas del Prompt principal y
    ponerlas donde se ven. Lo que cuelga de su "Llamar al siguiente nodo" tiene que entrar en la
    lista de flujos conocidos por el mismo motivo que el de la Bienvenida: si no, la conexion es
    un dibujo.
  */
  /*
    La escalera "si no contesta" de la Bienvenida.

    Cada escalon es una union desde un asa "no-reply-*" hacia un nodo Texto. Se compila a tiempo +
    mensaje y se guarda en la configuracion; el envio lo hace el motor de Seguimientos que ya
    existe, con su cancelacion incluida: si el cliente contesta antes, el webhook ya cancela lo
    pendiente. Eso es todo el sentido de "si no contesta".

    Un escalon conectado a algo que no sea Texto se ignora en silencio: un Flujo tendria que
    mandarse por otro camino y prometer a medias es peor que no prometer.
  */
  const TIEMPO_POR_ESPERA: Record<string, { timeType: "MINUTES" | "HOURS" | "DAYS"; timeValue: number }> = {
    "no-reply-5m": { timeType: "MINUTES", timeValue: 5 },
    "no-reply-1h": { timeType: "HOURS", timeValue: 1 },
    "no-reply-1d": { timeType: "DAYS", timeValue: 1 },
    "no-reply-3d": { timeType: "DAYS", timeValue: 3 },
  };
  const noReplyFollowUps = bienvenidaNode
    ? Object.entries(TIEMPO_POR_ESPERA).flatMap(([asa, tiempo]) => {
        const edge = edges.find(
          (e) => e.source === bienvenidaNode.id && e.sourceHandle === asa,
        );
        const destino = edge?.target ? nodeById.get(edge.target) : undefined;
        const texto = destino?.type === "texto" ? asString(destino.data?.text).trim() : "";
        return texto ? [{ ...tiempo, content: texto }] : [];
      })
    : [];

  /*
    La misma escalera, pero colgando de un nodo Flujo.

    Se guarda por flowId y no por nodo porque quien la usa es el webhook, que sabe QUE flujo acaba
    de mandar, no de que caja del dibujo salio. Si dos nodos apuntan al mismo flujo gana el
    primero: dos escaleras para el mismo catalogo serian dos tandas de mensajes por el mismo
    silencio.
  */
  const flowNoReplyFollowUps: Array<{
    flowId: string;
    followUps: Array<{ timeType: "MINUTES" | "HOURS" | "DAYS"; timeValue: number; content: string }>;
  }> = [];
  const flujosConEscalera = new Set<string>();
  for (const node of nodes.filter((n) => n.type === "flujo")) {
    const followUps = Object.entries(TIEMPO_POR_ESPERA).flatMap(([asa, tiempo]) => {
      const edge = edges.find((e) => e.source === node.id && e.sourceHandle === asa);
      const destino = edge?.target ? nodeById.get(edge.target) : undefined;
      const texto = destino?.type === "texto" ? asString(destino.data?.text).trim() : "";
      return texto ? [{ ...tiempo, content: texto }] : [];
    });
    if (followUps.length === 0) {
      continue;
    }
    for (const flowId of getGraphNodeFlowIds(node)) {
      if (flujosConEscalera.has(flowId)) {
        continue;
      }
      flujosConEscalera.add(flowId);
      flowNoReplyFollowUps.push({ flowId, followUps });
    }
  }

  const iaNodes = nodes.filter((node) => node.type === "ia");
  const iaNodeIds = new Set(iaNodes.map((node) => node.id));
  const despuesDeCadaIa = new Set(
    edges
      .filter((edge) => Boolean(edge.source) && iaNodeIds.has(edge.source as string) && edge.sourceHandle === "next-block")
      .map((edge) => edge.target)
      .filter((target): target is string => Boolean(target)),
  );

  const flowNodes = nodes.filter(
    (node) =>
      node.type === "flujo" &&
      (agentToolTargets.has(node.id) ||
        flowNodeIdsFromConditions.has(node.id) ||
        node.id === despuesDeLaBienvenida ||
        despuesDeCadaIa.has(node.id)),
  );
  const textNodes = nodes.filter((node) => node.type === "texto");
  const conditionNodes = nodes.filter((node) => node.type === "condicion");
  /**
   * Nodos "Notificar asesor": arman la accion de notificacion global del agente.
   *
   * Se leen TODOS y se juntan. Antes se tomaba el primero del array y se descartaba el resto:
   * en pantalla son dos nodos iguales, no hay forma de saber cual gana, y el texto del otro
   * desaparecia en silencio. Quien lo escribia creia que estaba aplicando una regla que el
   * agente nunca vio.
   *
   * El destino y el "cuando avisar" siguen siendo del AGENTE, no de cada nodo (la herramienta
   * es una sola). Cada nodo aporta su caso al texto y su numero a la lista.
   */
  const notifyNodes = nodes.filter((node) => node.type === "notificar");
  const notifyPhones = Array.from(
    new Set(
      notifyNodes.flatMap((node) => {
        const raw = node.data?.phoneNumbers;
        return (Array.isArray(raw) ? raw : [])
          .map((value) => asString(value).replace(/[^\d]/g, "").trim())
          .filter(Boolean);
      }),
    ),
  );
  // Distintos: si el mismo texto esta repetido en varios nodos (la forma en que hoy se evita
  // depender de cual gana), va una sola vez.
  const notifyInstruction = Array.from(
    new Set(
      notifyNodes
        .map((node) => asString(node.data?.instruction).trim())
        .filter(Boolean),
    ),
  ).join("\n\n");
  const notifyEnabled = notifyNodes.length > 0 && notifyPhones.length > 0;

  const agentData = agentNode?.data ?? {};
  const agentPrompt = asString(agentData.prompt);
  /*
    La bienvenida sale de su propio nodo.

    Vivia adentro del nodo Agente y se saco afuera, entre "Comenzar" y "Agente", para que el grafo
    se lea en el orden en que pasan las cosas. Si esto siguiera leyendo del Agente, mover la caja
    habria dejado al agente sin saludo en produccion sin que nada avisara.

    El texto del nodo manda; si no hay nodo (un grafo viejo que todavia no se abrio en el editor)
    se sigue leyendo de donde estaba. Y ya no hace falta un interruptor de "bienvenida fija": que
    haya texto escrito ES la decision de tener una bienvenida fija; vacio significa que la escribe
    la IA.
  */
  const textoDeBienvenida = bienvenidaNode
    ? asString(bienvenidaNode.data?.texto)
    : asString(agentData.welcome);
  const fixedWelcome = bienvenidaNode
    ? textoDeBienvenida.trim().length > 0
    : agentData.fixedWelcome === true;
  const consultProducts = agentData.consultProducts !== false;
  const consultFlows = agentData.consultFlows !== false;

  // Un nodo Texto es un mensaje literal escrito por el usuario: debe enviarse tal
  // cual, sin que la IA lo reformule. Anteponemos esta instrucción al compilar el
  // texto de cada etapa (mismo patrón que ya usa el prompt de apertura del agente).
  const VERBATIM_PREFIX =
    "Usa exactamente este mensaje sin modificarlo ni agregar nada más antes ni después:";
  const textForStage = (productNodeId: string, stageKey: string): string => {
    const edge = edges.find((e) => e.source === productNodeId && e.sourceHandle === stageKey);
    if (!edge?.target) {
      return "";
    }
    const target = textNodes.find((node) => node.id === edge.target);
    const text = asString(target?.data?.text).trim();
    if (!text) {
      return "";
    }
    return `${VERBATIM_PREFIX}\n${text}`;
  };

  const activationForProduct = (
    node: GraphNode,
  ): { mode: "default" | "ia" | "chatbot"; matchType: "exacta" | "contiene"; keywords: string[] } => {
    const data = node.data ?? {};
    if (data.startOnMatch === true) {
      if (data.matchType === "ia") {
        return { mode: "ia", matchType: "exacta", keywords: [] };
      }
      return {
        mode: "chatbot",
        matchType: data.matchType === "exacta" ? "exacta" : "contiene",
        keywords: asStringArray(data.matchKeywords),
      };
    }
    for (const cond of conditionNodes) {
      const rules = Array.isArray(cond.data?.rules)
        ? (cond.data?.rules as Array<Record<string, unknown>>)
        : [];
      for (const rule of rules) {
        const ruleId = asString(rule.id);
        const edge = edges.find(
          (e) => e.source === cond.id && e.sourceHandle === ruleId && e.target === node.id,
        );
        if (edge) {
          if (rule.matchType === "ia") {
            return { mode: "ia", matchType: "exacta", keywords: [] };
          }
          return {
            mode: "chatbot",
            matchType: rule.matchType === "exacta" ? "exacta" : "contiene",
            keywords: asStringArray(rule.keywords),
          };
        }
      }
    }
    return { mode: "default", matchType: "exacta", keywords: [] };
  };

  // Mapa de nodos + títulos de flujo, para describir las acciones de las
  // Condición que cuelgan del embudo de un producto.
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const allFlowItems = await getCreatedFlowItems({ workspaceId, includeOfficialApi: true });
  const flowTitleById = new Map(allFlowItems.map((flow) => [flow.id, flow.title] as const));

  /**
   * El /flujo escrito en el embudo ES la conexion del flujo con el producto.
   *
   * Asi es como se entiende al escribirlo —pones "/Foto de combo de camilla" en el paso 4 y
   * esperas que ese flujo quede atado a ese producto— pero no era asi: el /nombre solo le decia a
   * la IA que lo mandara, y ademas hay un filtro que ESCONDE los flujos que no estan anclados al
   * producto activo. Resultado: el agente recibia la orden de mandar un flujo que su propia
   * busqueda no podia ver, y terminaba disculpandose.
   *
   * El anclaje vivia en un campo aparte de la pantalla vieja del agente, que ya nadie abre.
   * Ahora se deduce del texto, que es donde el usuario lo escribio.
   */
  const normalizarTitulo = (valor: string) =>
    valor
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const flujoReferidoEnElEmbudo = (textoDelEmbudo: string): string | null => {
    const texto = normalizarTitulo(textoDelEmbudo);
    if (!texto.includes("/")) {
      return null;
    }
    // El titulo mas largo primero: si un flujo se llama "Fotos" y otro "Fotos combo camillas",
    // gana el especifico.
    const porLargo = [...allFlowItems].sort((a, b) => b.title.length - a.title.length);
    for (const flujo of porLargo) {
      const titulo = normalizarTitulo(flujo.title);
      if (titulo && texto.includes(`/${titulo}`)) {
        return flujo.id;
      }
    }
    return null;
  };

  /*
    Un "Flujo: Bienvenida" adentro del nodo ES el flujo con el que se saluda.

    Se escribe con el nombre completo -y el nodo lo pinta como etiqueta- porque la primera version
    usaba "/Bienvenida" y ahi no se veia que eso fuera un flujo: una barra suelta se lee como parte
    del mensaje. La forma vieja se sigue entendiendo, para no romper lo ya escrito.

    El renglon se SACA del texto que se manda: si no, el cliente recibiria literalmente
    "Flujo: Bienvenida" como primer mensaje del negocio. Y si al sacarlo no queda nada, no hay
    bienvenida fija -el saludo lo da el flujo entero, que es justo lo que se pidio-.
  */
  /** El flujo que se llama asi, o null. Lo usan la Bienvenida y los nodos IA. */
  const idDelFlujoPorNombre = (nombre: string | null): string | null => {
    if (!nombre) {
      return null;
    }
    const buscado = normalizarTitulo(nombre);
    // Primero el nombre tal cual, y recien despues uno que lo contenga: si hay "Fotos" y
    // "Fotos combo camillas", escribir "Fotos" tiene que dar "Fotos".
    const exacto = allFlowItems.find((flujo) => normalizarTitulo(flujo.title) === buscado);
    if (exacto) {
      return exacto.id;
    }
    const porLargo = [...allFlowItems].sort((a, b) => b.title.length - a.title.length);
    return porLargo.find((flujo) => normalizarTitulo(flujo.title).includes(buscado))?.id ?? null;
  };
  const flujoDeBienvenida = idDelFlujoPorNombre(nombreDelFlujoEnBienvenida(textoDeBienvenida));
  const welcomeText = flujoDeBienvenida
    ? textoSinLaLineaDeFlujo(textoDeBienvenida)
    : textoDeBienvenida;

  /*
    Cada nodo IA se compila a una regla mas del prompt.

    El "Flujo: nombre" escrito adentro se convierte en dos cosas: el flujo entra a la lista de
    permitidos (si no, consultar_flujos no lo encuentra y el agente termina disculpandose) y la
    regla le dice al agente que ESE es el flujo que manda cuando la instruccion lo pida. El renglon
    del flujo se saca del texto: es una orden nuestra, no algo que decirle al cliente.

    Un nodo vacio y sin flujo no compila a nada: no hay que meterle al prompt una regla en blanco.
  */
  const instruccionesIa = iaNodes
    .map((node) => {
      const textoCompleto = asString(node.data?.texto);
      const flujoId = idDelFlujoPorNombre(nombreDelFlujoEnBienvenida(textoCompleto));
      return {
        texto: (flujoId ? textoSinLaLineaDeFlujo(textoCompleto) : textoCompleto).trim(),
        flujoId,
        siguiente: edges.find((edge) => edge.source === node.id && edge.sourceHandle === "next-block")
          ?.target,
      };
    })
    .filter((instruccion) => instruccion.texto || instruccion.flujoId);


  const describeRuleTrigger = (rule: Record<string, unknown>): string => {
    const matchType = asString(rule.matchType);
    if (matchType === "ia") {
      const intent = asString(rule.intent).trim();
      return `Si el cliente, por intencion, ${intent || "muestra interes relacionado"}`;
    }
    const list = asStringArray(rule.keywords).map((kw) => `«${kw}»`).join(", ") || "(sin palabras)";
    return matchType === "exacta"
      ? `Si el mensaje del cliente es EXACTAMENTE alguna de estas palabras: ${list}`
      : `Si el mensaje del cliente CONTIENE alguna de estas palabras: ${list}`;
  };

  const describeNodeAction = (targetId: string | undefined): string => {
    const target = targetId ? nodeById.get(targetId) : undefined;
    if (!target) {
      return "continua la conversacion normal con la IA";
    }
    if (target.type === "texto") {
      const text = asString(target.data?.text).trim();
      return text
        ? `responde EXACTAMENTE con este mensaje, sin modificarlo ni agregar nada: "${text}"`
        : "continua la conversacion normal con la IA";
    }
    if (target.type === "flujo") {
      const titles = getGraphNodeFlowIds(target)
        .map((flowId) => flowTitleById.get(flowId))
        .filter((title): title is string => Boolean(title));
      if (titles.length === 1) {
        return `ejecuta OBLIGATORIAMENTE el flujo "${titles[0]}" llamando a la herramienta consultar_flujos con ese nombre exacto. ` +
            `NO respondas con texto propio ni con la descripcion/precio del producto: deja que el flujo entregue el contenido (fotos, precio, etc.)`;
      }
      return titles.length > 1
        ? `ejecuta OBLIGATORIAMENTE uno de estos flujos segun el contexto del cliente: ${titles.map((title) => `"${title}"`).join(", ")}. ` +
            `Llama a la herramienta consultar_flujos con el nombre exacto del flujo elegido y NO respondas con texto propio antes de ejecutarlo.`
        : "ejecuta el flujo configurado llamando a la herramienta consultar_flujos";
    }
    if (target.type === "condicion") {
      return "evalua la siguiente condicion segun sus reglas";
    }
    if (target.type === "producto") {
      return "presenta ese producto";
    }
    /**
     * Rama que termina en "Notificar asesor": es un pedido explicito de sacar a la IA y meter a
     * una persona. Antes caia en el "continua la conversacion normal con la IA" de abajo, asi
     * que la condicion acertaba y el resultado era el contrario del configurado: la IA seguia
     * hablando (y a veces improvisaba que no podia hacer algo) en vez de pasar el caso.
     *
     * Si el nodo existe pero no tiene numero, la herramienta ni siquiera esta disponible: en ese
     * caso no se le pide que la llame —quedaria inventando— y el aviso del constructor es el que
     * se encarga de que eso no pase desapercibido.
     */
    if (target.type === "notificar") {
      return notifyEnabled
        ? "llama OBLIGATORIAMENTE a la herramienta Notificar_asesor con un resumen breve del caso. " +
            "NO sigas el embudo ni respondas con texto propio: avisa en una linea que un asesor continua"
        : "avisa en una linea que un asesor va a continuar y no sigas el embudo";
    }
    return "continua la conversacion normal con la IA";
  };

  // Recorre la cadena hacia adelante desde el producto y compila las reglas de
  // ramificación de todas las Condición que cuelguen de su embudo. La IA las
  // sigue como guía fuerte (no es un motor determinístico).
  const buildBranchingBlock = (productNodeId: string): string | null => {
    const seenConditions = new Set<string>();
    const orderedConditions: GraphNode[] = [];
    const visited = new Set<string>();
    const queue: string[] = [productNodeId];
    while (queue.length) {
      const current = queue.shift() as string;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const edge of edges) {
        if (edge.source !== current || !edge.target || visited.has(edge.target)) {
          continue;
        }
        const target = nodeById.get(edge.target);
        if (target?.type === "condicion" && !seenConditions.has(target.id)) {
          seenConditions.add(target.id);
          orderedConditions.push(target);
        }
        queue.push(edge.target);
      }
    }

    const lines: string[] = [];
    for (const cond of orderedConditions) {
      const rules = Array.isArray(cond.data?.rules)
        ? (cond.data?.rules as Array<Record<string, unknown>>)
        : [];
      for (const rule of rules) {
        const actionEdge = edges.find(
          (e) => e.source === cond.id && e.sourceHandle === asString(rule.id),
        );
        lines.push(`- ${describeRuleTrigger(rule)} → ${describeNodeAction(actionEdge?.target)}.`);
      }
      const elseEdge = edges.find((e) => e.source === cond.id && e.sourceHandle === "else");
      if (elseEdge?.target) {
        lines.push(`- Si no coincide con ninguna de las anteriores → ${describeNodeAction(elseEdge.target)}.`);
      }
    }

    if (!lines.length) {
      return null;
    }
    return (
      "REGLAS DE RAMIFICACION (segun lo que responda el cliente, aplica la PRIMERA regla que " +
      "coincida; si ninguna coincide, sigue la conversacion normal). Estas reglas tienen " +
      "PRIORIDAD: cuando una regla pida ejecutar un flujo, hazlo con consultar_flujos en lugar " +
      "de describir el producto con consultar_productos:\n" + lines.join("\n")
    );
  };

  /**
   * El embudo escrito en Producto V2 MANDA sobre el del diagrama.
   *
   * Tenerlo en dos lugares era administrar una contradiccion: el texto de uno y la ejecucion de
   * flujos del otro. Ahora, si el producto tiene su embudo escrito, ese es el que se compila —y
   * por lo tanto el que ve el escaneo de referencias /flujo, que es lo unico que dispara un flujo
   * de forma determinista. Si no lo tiene, se sigue usando el del diagrama y no cambia nada.
   */
  const embudosDelProducto = new Map<string, Record<string, { goal: string; script: string }>>();
  try {
    const filas = await prisma.productPlaybook.findMany({
      where: { workspaceId },
      select: {
        productId: true,
        stages: { select: { stage: true, goal: true, script: true } },
      },
    });
    for (const fila of filas) {
      const porEtapa: Record<string, { goal: string; script: string }> = {};
      for (const etapa of fila.stages) {
        const goal = etapa.goal?.trim() || "";
        const script = etapa.script?.trim() || "";
        if (goal || script) {
          porEtapa[etapa.stage] = { goal, script };
        }
      }
      if (Object.keys(porEtapa).length > 0) {
        embudosDelProducto.set(fila.productId, porEtapa);
      }
    }
  } catch {
    // Sin embudos propios se sigue con el del diagrama: publicar nunca puede fallar por esto.
  }

  // 1) Upsert de knowledge products desde los nodos Producto.
  const graphProductIds: string[] = [];
  if (consultProducts) {
    for (const node of productNodes) {
      const productId = asString(node.data?.productId);
      if (!productId) {
        continue;
      }
      graphProductIds.push(productId);
      // El del producto primero; el del diagrama solo si el producto no tiene el suyo.
      const propio = embudosDelProducto.get(productId);
      const useFunnel = Boolean(propio) || node.data?.useFunnel === true;
      /**
       * El guion del producto va CRUDO en estos campos.
       *
       * La orden de mandarlo literal NO se pega aca: estos textos se guardan en
       * AgentKnowledgeProduct y la pantalla de Producto V2 los vuelve a mostrar en el editor. Al
       * pegarles la instruccion, quedaba guardada dentro del guion —y en la siguiente publicacion
       * se le pegaba otra vez—. La orden va UNA sola vez en la cabecera del bloque del embudo
       * (funnelBlock), que no vuelve a ninguna pantalla.
       */
      const delProducto = (etapa: string) => propio?.[etapa]?.script ?? "";
      const objetivo = (etapa: string) => propio?.[etapa]?.goal ?? "";

      const opening = propio ? delProducto("PRESENTACION") : useFunnel ? textForStage(node.id, "empresa") : "";
      const qualification = propio ? delProducto("IDENTIFICACION") : useFunnel ? textForStage(node.id, "necesidad") : "";
      const presentation = propio ? delProducto("PRODUCTO") : useFunnel ? textForStage(node.id, "producto") : "";
      const faq = propio ? delProducto("OBJECIONES") : useFunnel ? textForStage(node.id, "dudas") : "";
      const closing = propio ? delProducto("CIERRE") : useFunnel ? textForStage(node.id, "cierre") : "";
      const activation = activationForProduct(node);

      // Con el embudo del producto se suma el OBJETIVO de cada etapa: es la condicion para
      // pasar a la siguiente, y sin eso la IA no sabe cuando dio por cumplida una etapa (repite
      // la pregunta o se adelanta).
      const conObjetivo = (texto: string, etapa: string) => {
        const meta = objetivo(etapa);
        return meta ? `${texto} (objetivo: ${meta})` : texto;
      };

      const funnelSteps = [
        opening ? `Paso 1 - Presentacion: ${conObjetivo(opening, "PRESENTACION")}` : null,
        qualification
          ? `Paso 2 - Identificacion (descubre la necesidad): ${conObjetivo(qualification, "IDENTIFICACION")}`
          : null,
        presentation
          ? `Paso 3 - Presentacion del producto (construye valor): ${conObjetivo(presentation, "PRODUCTO")}`
          : null,
        faq ? `Paso 4 - Dudas y objeciones: ${conObjetivo(faq, "OBJECIONES")}` : null,
        closing ? `Paso 5 - Cierre y precio: ${conObjetivo(closing, "CIERRE")}` : null,
      ].filter(Boolean);
      /**
       * La orden de literalidad va ACA, una sola vez, y no pegada a cada guion: este bloque se
       * guarda en `instructions` y no vuelve a ninguna pantalla de edicion.
       *
       * Lo del hueco es lo que mas se rompe: al no saber el nombre, el agente borro "[Nombre]"
       * pero dejo "Perfecto, *Sra.*" — un tratamiento colgando sin nombre. Por eso se dice
       * explicitamente que se van las palabras que dependan del dato, con el ejemplo.
       */
      const funnelBlock =
        useFunnel && funnelSteps.length
          ? "PASOS DEL EMBUDO DE ESTE PRODUCTO. Siguelos EN ORDEN, no te saltes pasos ni adelantes etapas. " +
            "NO menciones ni incluyas el precio hasta el Paso 5 (Cierre), salvo que el cliente lo pida explicitamente.\n" +
            "El texto de cada paso se envia TAL COMO ESTA ESCRITO: no lo reformules, no cambies el " +
            "orden y no agregues frases propias antes ni despues. Lo unico que cambias son los " +
            "datos entre corchetes, que reemplazas por el dato real. Si no conoces ese dato, borra " +
            "el hueco Y las palabras que dependan de el: sin el nombre, \"Perfecto, *Sra. [Nombre]*\" " +
            "queda \"Perfecto,\" — nunca \"Perfecto, Sra.\".\n" +
            "ESO NO TE AMORDAZA: si el cliente hace una pregunta concreta (precio, medidas, envio, " +
            "colores, formas de pago), CONTESTALA primero con el dato real, y despues segui con el " +
            "paso que toca. Repetir el guion sin responder lo que preguntaron es lo peor que podes " +
            "hacer: el cliente pregunta de nuevo, y a la tercera se va. La literalidad es para el " +
            "guion, no una prohibicion de contestar.\n" +
            funnelSteps.join("\n")
          : null;

      // El /flujo que el embudo nombre queda ANCLADO a este producto: es lo que lo hace visible
      // para la busqueda del agente cuando esta hablando de el.
      const flujoAnclado = flujoReferidoEnElEmbudo(
        [opening, qualification, presentation, faq, closing].filter(Boolean).join("\n"),
      );

      const branchingBlock = buildBranchingBlock(node.id);

      const instructions = [
        `Activacion: ${activation.mode}`,
        activation.mode === "chatbot" ? `Coincidencia: ${activation.matchType}` : null,
        activation.mode === "chatbot" && activation.keywords.length
          ? `Palabras clave: ${activation.keywords.join(" | ")}`
          : null,
        funnelBlock,
        branchingBlock,
      ]
        .filter(Boolean)
        .join("\n\n");

      await prisma.agentKnowledgeProduct.upsert({
        where: { agentId_productId: { agentId: agent.id, productId } },
        create: {
          agentId: agent.id,
          productId,
          instructions,
          funnelOpening: opening || null,
          funnelQualification: qualification || null,
          funnelPresentation: presentation || null,
          funnelFaq: faq || null,
          funnelClosing: closing || null,
          followUpFlowId: flujoAnclado,
        },
        update: {
          instructions,
          funnelOpening: opening || null,
          funnelQualification: qualification || null,
          funnelPresentation: presentation || null,
          funnelFaq: faq || null,
          funnelClosing: closing || null,
          // Solo se pisa cuando el embudo NOMBRA un flujo. Si no nombra ninguno, se deja el que
          // hubiera: puede venir anclado a mano desde la pantalla vieja del agente y publicar no
          // tiene por que borrarlo.
          ...(flujoAnclado ? { followUpFlowId: flujoAnclado } : {}),
        },
      });
    }
  }
  await prisma.agentKnowledgeProduct.deleteMany({
    where: {
      agentId: agent.id,
      ...(graphProductIds.length ? { productId: { notIn: graphProductIds } } : {}),
    },
  });

  // 2) Knowledge flows desde los nodos Flujo.
  const flowIds = consultFlows
    ? Array.from(
        new Set([
          ...flowNodes.flatMap((node) => getGraphNodeFlowIds(node)),
          // El flujo con el que se saluda tiene que estar en la lista de flujos CONOCIDOS: sin
          // esto se le da la orden de ejecutarlo y su propia busqueda no lo encuentra, y termina
          // disculpandose.
          ...(flujoDeBienvenida ? [flujoDeBienvenida] : []),
          ...instruccionesIa.flatMap((instruccion) => (instruccion.flujoId ? [instruccion.flujoId] : [])),
        ]),
      )
    : [];
  let knowledgeFlows: AgentKnowledgePromptFlow[] = [];
  if (flowIds.length) {
    const idSet = new Set(flowIds);
    knowledgeFlows = allFlowItems
      .filter((flow) => idSet.has(flow.id))
      .map((flow) => ({
        id: flow.id,
        title: flow.title,
        intent: flow.intent,
        description: flow.description,
        sourceLabel: flow.badge,
      }));
  }

  // 3) Productos para el prompt.
  const knowledgeRows = await prisma.agentKnowledgeProduct.findMany({
    where: { agentId: agent.id },
    include: { product: { include: { category: { select: { name: true } } } } },
  });
  const knowledgeProducts: AgentKnowledgePromptProduct[] = knowledgeRows.map((row) => ({
    name: row.product.name,
    description: row.product.description,
    price: row.product.price ? row.product.price.toString() : null,
    categoryName: row.product.category?.name ?? null,
    thumbnailUrl: row.product.thumbnailUrl,
    code: row.product.code,
    slug: row.product.slug,
    funnelOpening: row.funnelOpening,
    funnelQualification: row.funnelQualification,
    funnelPresentation: row.funnelPresentation,
    funnelFaq: row.funnelFaq,
    funnelClosing: row.funnelClosing,
    instructions: row.instructions,
    followUpFlowId: row.followUpFlowId,
  }));

  // 4) Training config + system prompt.
  const rules: string[] = [];
  if (fixedWelcome) {
    rules.push(
      "Ya se envio un mensaje de bienvenida al cliente. No vuelvas a saludar ni a presentarte; continua la conversacion directamente.",
    );
  }
  rules.push(
    "REGLA DE PRECIO (no negociable): NO menciones ni incluyas el precio en la presentacion inicial de un producto, " +
      "aunque lo tengas en el catalogo. Primero conecta el producto con la necesidad del cliente y presenta el valor; el precio va despues. " +
      "EXCEPCION: si el cliente pregunta el precio explicitamente, dalo de inmediato acompanado de una frase corta de valor y una pregunta para avanzar; " +
      "nunca evadas ni respondas 'primero cuentame'.",
  );
  rules.push(
    "Conduce la venta por etapas: entiende para que lo necesita, presenta el valor conectado a su necesidad, resuelve dudas y cierra. " +
      "Si el cliente cambia de tema o pregunta por otro producto, sigue su tema y atiende lo que pide; el embudo es una guia, no una camisa de fuerza.",
  );
  /*
    Que hacer APENAS termina la bienvenida.

    Sin esto, "Llamar al siguiente bloque" no llegaba al agente de ninguna forma: se dibujaba la
    flecha, se publicaba, y el agente saludaba y despues improvisaba. La orden se arma con el mismo
    describeNodeAction que usan las ramas de Condicion, asi que un Flujo colgado aca se ejecuta
    igual que uno colgado de una rama.
  */
  /*
    El "/nombre" escrito dentro de la bienvenida: ese flujo ES el saludo.

    Va antes que el "siguiente bloque" porque es mas directo -se escribio adentro del saludo- y
    porque si estan los dos, manda el que se escribio ahi.
  */
  /*
    Pedirle a la IA que mande el saludo NO alcanzaba.

    Se probo en Ventas 1 el 3-sep-2026: la regla estaba en el prompt publicado y el flujo estaba
    en la lista de permitidos, y aun asi el cliente recibio la frase de apertura escrita en el
    Prompt principal ("usa exactamente esta frase... sin agregar nada mas antes ni despues"). Esa
    orden es mas concreta que la nuestra y gana; pelearle al prompt del usuario con otra regla es
    una pelea que se pierde sola.

    Asi que el saludo deja de ser una sugerencia: el id queda guardado en welcomeFlowId y el motor
    manda ese flujo en el primer mensaje, antes de que la IA hable. A la IA solo se le avisa -para
    los turnos que siguen- que ese flujo YA salio, para que no lo repita.
  */
  if (flujoDeBienvenida) {
    const tituloDelSaludo = flowTitleById.get(flujoDeBienvenida);
    if (tituloDelSaludo) {
      rules.push(
        `La bienvenida de este negocio es el flujo "${tituloDelSaludo}", y se envia solo, ` +
          `automaticamente, apenas escribe un cliente nuevo. Cuando te toque responder ya salio: ` +
          `NO lo vuelvas a enviar y NO describas su contenido; continua la conversacion desde ahi.`,
      );
    }
  }


  if (despuesDeLaBienvenida) {
    rules.push(
      `Apenas des la bienvenida, y ANTES de preguntar nada, ${describeNodeAction(despuesDeLaBienvenida)}.`,
    );
  }

  /*
    "Cuando responda": lo que sale de esa union es lo que hay que hacer con la PRIMERA respuesta.

    Va como regla del prompt y no como disparo del motor porque el destino puede ser cualquier
    cosa -una Condicion, un Flujo, un Texto- y las Condicion ya se evaluan solas en cada mensaje.
    Antes esta union no llegaba al agente de ninguna forma: se dibujaba y no existia.
  */
  const alResponderLaBienvenida = bienvenidaNode
    ? edges.find((edge) => edge.source === bienvenidaNode.id && edge.sourceHandle === "on-reply")
        ?.target
    : undefined;
  if (alResponderLaBienvenida) {
    const accion = describeNodeAction(alResponderLaBienvenida);
    if (accion !== "continua la conversacion normal con la IA") {
      rules.push(`Cuando el cliente responda a la bienvenida, ${accion}.`);
    }
  }

  for (const instruccion of instruccionesIa) {
    const tituloDelFlujo = instruccion.flujoId ? flowTitleById.get(instruccion.flujoId) : undefined;
    const partes = [instruccion.texto];
    if (tituloDelFlujo) {
      partes.push(
        `Para eso, envia el flujo "${tituloDelFlujo}": llama a consultar_flujos con ese nombre ` +
          `exacto, toma el flow_id que devuelve y llama a enviar_flujo con ese id. Lo haces vos, ` +
          `sin avisar ni pedir permiso.`,
      );
    }
    if (instruccion.siguiente) {
      partes.push(`Despues de eso, ${describeNodeAction(instruccion.siguiente)}.`);
    }
    rules.push(partes.filter(Boolean).join(" "));
  }


  const compiledRules = rules.join("\n\n");

  const training = buildAgentTrainingConfig({
    ...defaultAgentTrainingConfig,
    assistantName: agent.name,
    businessDescription: business.description,
    sectorRubro: business.sector,
    instruction: agentPrompt,
    location: business.location,
    website: business.website,
    contactPhone: business.phone,
    contactEmail: business.email,
    instagram: business.instagram,
    facebook: business.facebook,
    tiktok: business.tiktok,
    youtube: business.youtube,
    // Si hay bienvenida fija, esa la maneja welcomeMessage; la IA no debe re-saludar.
    greetNewCustomers: fixedWelcome ? false : defaultAgentTrainingConfig.greetNewCustomers,
    askNameFirst: fixedWelcome ? false : defaultAgentTrainingConfig.askNameFirst,
    customWelcomeMessage: fixedWelcome ? welcomeText : "",
    customRules: compiledRules,
    knowledgeFlowIds: flowIds,
    // El saludo por flujo: lo ejecuta el motor en el primer mensaje, no la IA.
    welcomeFlowId: flujoDeBienvenida ?? "",
    noReplyFollowUps,
    flowNoReplyFollowUps,
    // Toggles "Consultar productos/flujos": apagados => el motor no ofrece la tool.
    enableProductLookup: consultProducts,
    enableFlowLookup: consultFlows,
    // Motor IA-primero: aun no hay toggle en la UI, asi que el publish PRESERVA el valor actual
    // del agente (si no, cada publicacion lo apagaria y volveria al motor deterministico).
    aiDrivenFlows:
      (agent.trainingConfig as { aiDrivenFlows?: boolean } | null)?.aiDrivenFlows === true,
    // Nodo "Notificar asesor": habilita la herramienta Notificar_asesor con el número
    // e instrucción configurados. Sin nodo (o sin número) => deshabilitada.
    actions: {
      notify: {
        enabled: notifyEnabled,
        destinationPhoneNumber: notifyPhones[0] ?? "",
        destinationPhoneNumbers: notifyPhones,
        instruction: notifyInstruction,
        pauseConversationAfterNotify: defaultAgentTrainingConfig.actions.notify.pauseConversationAfterNotify,
      },
    },
  });

  /*
    Con flujo de bienvenida y sin texto suelto, NO se manda un saludo automatico.

    Si se escribio solo "/Bienvenida", al sacarle la barra el texto queda vacio y aca se caia al
    saludo generico: el cliente recibia un "hola" armado por la app y despues el flujo. Dos
    saludos, que es justo lo que se venia de arreglar.
  */
  const welcomeMessage =
    fixedWelcome && welcomeText.trim()
      ? welcomeText
      : flujoDeBienvenida
        ? ""
        : buildWelcomeMessage({ agentName: agent.name, businessName: business.name, training });

  const systemPrompt = buildAgentSystemPrompt({
    agentName: agent.name,
    businessName: business.name,
    training,
    knowledgeProducts,
    knowledgeFlows,
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      trainingConfig: training as unknown as Prisma.InputJsonValue,
      systemPrompt,
      welcomeMessage,
      fallbackMessage: buildFallbackMessage(training),
      handoffMessage: buildHandoffMessage(),
    },
  });

  revalidatePath("/cliente/agente-v2");
  return { ok: true };
}
