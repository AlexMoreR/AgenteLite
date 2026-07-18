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
  const flowNodes = nodes.filter(
    (node) => node.type === "flujo" && agentToolTargets.has(node.id),
  );
  const textNodes = nodes.filter((node) => node.type === "texto");
  const conditionNodes = nodes.filter((node) => node.type === "condicion");
  // Nodo "Notificar asesor": configura la acción de notificación global del agente
  // (un solo número/instrucción por agente; si hay varios nodos, usamos el primero).
  const notifyNode = nodes.find((node) => node.type === "notificar");
  const rawNotifyPhones = notifyNode?.data?.phoneNumbers;
  const notifyPhones = (Array.isArray(rawNotifyPhones) ? rawNotifyPhones : [])
    .map((value) => asString(value).replace(/[^\d]/g, "").trim())
    .filter(Boolean);
  const notifyInstruction = asString(notifyNode?.data?.instruction).trim();
  const notifyEnabled = Boolean(notifyNode) && notifyPhones.length > 0;

  const agentData = agentNode?.data ?? {};
  const agentPrompt = asString(agentData.prompt);
  const fixedWelcome = agentData.fixedWelcome === true;
  const welcomeText = asString(agentData.welcome);
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

  // 1) Upsert de knowledge products desde los nodos Producto.
  const graphProductIds: string[] = [];
  if (consultProducts) {
    for (const node of productNodes) {
      const productId = asString(node.data?.productId);
      if (!productId) {
        continue;
      }
      graphProductIds.push(productId);
      const useFunnel = node.data?.useFunnel === true;
      const opening = useFunnel ? textForStage(node.id, "empresa") : "";
      const qualification = useFunnel ? textForStage(node.id, "necesidad") : "";
      const presentation = useFunnel ? textForStage(node.id, "producto") : "";
      const faq = useFunnel ? textForStage(node.id, "dudas") : "";
      const closing = useFunnel ? textForStage(node.id, "cierre") : "";
      const activation = activationForProduct(node);

      const funnelSteps = [
        opening ? `Paso 1 - Presentacion: ${opening}` : null,
        qualification ? `Paso 2 - Identificacion (descubre la necesidad): ${qualification}` : null,
        presentation ? `Paso 3 - Presentacion del producto (construye valor): ${presentation}` : null,
        faq ? `Paso 4 - Dudas y objeciones: ${faq}` : null,
        closing ? `Paso 5 - Cierre y precio: ${closing}` : null,
      ].filter(Boolean);
      const funnelBlock =
        useFunnel && funnelSteps.length
          ? "PASOS DEL EMBUDO DE ESTE PRODUCTO. Siguelos EN ORDEN, no te saltes pasos ni adelantes etapas. " +
            "NO menciones ni incluyas el precio hasta el Paso 5 (Cierre), salvo que el cliente lo pida explicitamente.\n" +
            funnelSteps.join("\n")
          : null;

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
        },
        update: {
          instructions,
          funnelOpening: opening || null,
          funnelQualification: qualification || null,
          funnelPresentation: presentation || null,
          funnelFaq: faq || null,
          funnelClosing: closing || null,
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
    ? Array.from(new Set(flowNodes.flatMap((node) => getGraphNodeFlowIds(node))))
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
        autoNotifyOnUnknownProduct: defaultAgentTrainingConfig.actions.notify.autoNotifyOnUnknownProduct,
      },
    },
  });

  const welcomeMessage =
    fixedWelcome && welcomeText.trim()
      ? welcomeText
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
