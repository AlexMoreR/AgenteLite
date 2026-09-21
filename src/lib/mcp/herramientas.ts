import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { HERRAMIENTAS_MCP_V3, ejecutarHerramientaMcpV3, esHerramientaV3 } from "@/lib/mcp/agente-v3";
import {
  HERRAMIENTAS_MCP_DIAGRAMA,
  ejecutarHerramientaMcpDiagrama,
  esHerramientaDeDiagrama,
} from "@/lib/mcp/diagrama-del-agente";
import {
  HERRAMIENTAS_MCP_ESCRITURA,
  ejecutarHerramientaMcpEscritura,
  esHerramientaDeEscritura,
} from "@/lib/mcp/escritura";
import { getFlowReply } from "@/lib/agent-product-flow";
import { prisma } from "@/lib/prisma";
import { parseWorkspaceBusinessConfig } from "@/lib/workspace-business-config";

/*
  Herramientas del MCP (etapa 1: SOLO LECTURA).

  Pensadas para el primer uso que pidio Alex: encontrar donde el agente dio informacion equivocada.
  Para eso Claude necesita dos lados: lo que el agente DIJO (conversaciones, busqueda) y lo que
  DEBIA decir (productos, flujos, configuracion del agente y del negocio).

  Regla de todas: el negocio sale de la clave (`contexto.workspaceId`), nunca de un argumento. Todo id
  que manda Claude se busca DENTRO de ese negocio; si no es suyo, "no existe".
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

const HERRAMIENTAS_DE_LECTURA = [
  {
    name: "resumen_del_negocio",
    title: "Resumen del negocio",
    description:
      "Datos del negocio (descripcion, ubicacion, contacto, redes), sus lineas de WhatsApp y sus agentes. Empezar por aca para conocer los ids.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "ver_agente",
    title: "Ver un agente",
    description:
      "Configuracion completa de un agente: prompt principal, bienvenida, mensajes de respaldo, configuracion de entrenamiento, productos que conoce con su embudo e instrucciones, reglas del playbook y el diagrama (Agente V2) resumido. Es la fuente de lo que el agente DEBERIA decir.",
    inputSchema: {
      type: "object",
      properties: { agente_id: { type: "string", description: "Id del agente (ver resumen_del_negocio)" } },
      required: ["agente_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "listar_productos",
    title: "Listar productos",
    description:
      "Productos que conocen los agentes del negocio, con codigo, precio, precio mayorista, cantidad minima mayorista y descripcion. Sirve para comparar precios o datos que dio el agente.",
    inputSchema: {
      type: "object",
      properties: { buscar: { type: "string", description: "Filtra por nombre o codigo (opcional)" } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "listar_flujos",
    title: "Listar flujos",
    description: "Flujos del negocio (catalogos, fotos, PDFs, textos armados) con su intencion y palabras clave.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "ver_flujo",
    title: "Ver un flujo",
    description: "Los pasos exactos que manda un flujo: textos y archivos (imagen, audio, video, documento) en orden.",
    inputSchema: {
      type: "object",
      properties: { flujo_id: { type: "string", description: "Id del flujo (ver listar_flujos)" } },
      required: ["flujo_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "listar_conversaciones",
    title: "Listar conversaciones",
    description:
      "Conversaciones con movimiento en los ultimos dias, de la mas reciente a la mas vieja, con contacto, linea, etapa del CRM, asesora asignada y cuantos mensajes hubo de cada lado en ese periodo.",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "number", description: "Cuantos dias hacia atras (1 a 30, por defecto 1)" },
        canal_id: { type: "string", description: "Solo una linea de WhatsApp (opcional)" },
        buscar: { type: "string", description: "Nombre o telefono del contacto (opcional)" },
        limite: { type: "number", description: "Maximo de conversaciones (1 a 100, por defecto 30)" },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "ver_conversacion",
    title: "Ver una conversacion",
    description:
      "Los mensajes de una conversacion en orden, marcando QUIEN dijo cada uno: cliente, agente_o_flujo (la IA o un flujo automatico), asesora_desde_crm, enviado_desde_el_celular o sistema. Incluye las decisiones que registro el agente (producto o flujo detectado) y el producto activo.",
    inputSchema: {
      type: "object",
      properties: {
        conversacion_id: { type: "string", description: "Id de la conversacion" },
        limite: { type: "number", description: "Ultimos N mensajes (1 a 300, por defecto 80)" },
      },
      required: ["conversacion_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "buscar_mensajes",
    title: "Buscar mensajes",
    description:
      "Busca un texto dentro de los mensajes (por ejemplo un precio, una medida o una frase) y devuelve donde aparece y quien lo dijo. Util para ver cuantas veces el agente repitio un dato equivocado.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Texto a buscar (minimo 3 caracteres)" },
        quien: { type: "string", enum: ["agente", "cliente", "todos"], description: "Por defecto: todos" },
        dias: { type: "number", description: "Cuantos dias hacia atras (1 a 60, por defecto 7)" },
        limite: { type: "number", description: "Maximo de resultados (1 a 100, por defecto 40)" },
      },
      required: ["texto"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
];

function texto(args: Argumentos, clave: string) {
  const valor = args[clave];
  return typeof valor === "string" ? valor.trim() : "";
}

function numero(args: Argumentos, clave: string, minimo: number, maximo: number, porDefecto: number) {
  const valor = Number(args[clave]);
  if (!Number.isFinite(valor)) {
    return porDefecto;
  }
  return Math.min(maximo, Math.max(minimo, Math.round(valor)));
}

const FECHA_BOGOTA = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** "2026-09-14 15:40" en hora de Colombia: es la hora que ve el negocio. */
function hora(fecha: Date | null | undefined) {
  return fecha ? FECHA_BOGOTA.format(fecha) : null;
}

/**
 * Quien dijo el mensaje, segun como quedo guardado:
 *  - "manual": lo escribio una asesora desde el CRM (lleva su firma).
 *  - "instance": salio desde el celular de la linea (puede ser una persona o WhatsApp Business).
 *  - "activity"/"llamada" o tipo SYSTEM: notas del sistema.
 *  - Saliente sin marca: lo mando el agente de IA o un flujo automatico (se guarda la respuesta cruda
 *    del gateway).
 */
function quienDijo(mensaje: { direction: string; type: string; rawPayload: unknown }) {
  if (mensaje.type === "SYSTEM") {
    return "sistema";
  }
  if (mensaje.direction === "INBOUND") {
    return "cliente";
  }
  const origen =
    mensaje.rawPayload && typeof mensaje.rawPayload === "object" && !Array.isArray(mensaje.rawPayload)
      ? (mensaje.rawPayload as Record<string, unknown>).source
      : undefined;
  if (origen === "activity" || origen === "llamada") return "sistema";
  if (origen === "manual") return "asesora_desde_crm";
  if (origen === "instance") return "enviado_desde_el_celular";
  return "agente_o_flujo";
}

function aNumero(valor: unknown) {
  const convertido = Number(valor?.toString());
  return Number.isFinite(convertido) ? convertido : null;
}

async function resumenDelNegocio(contexto: Contexto) {
  const [negocio, canales, agentes] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: contexto.workspaceId },
      select: { name: true, businessConfig: true },
    }),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId: contexto.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, provider: true, agent: { select: { id: true, name: true } } },
    }),
    prisma.agent.findMany({
      where: { workspaceId: contexto.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, agentType: true, status: true, isActive: true, updatedAt: true },
    }),
  ]);
  const datos = parseWorkspaceBusinessConfig(negocio?.businessConfig);
  return {
    negocio: negocio?.name ?? null,
    datos_del_negocio: {
      descripcion: datos.businessDescription,
      rubro: datos.sectorRubro,
      publico: datos.targetAudiences,
      rango_de_precios: { desde: datos.priceRangeMin, hasta: datos.priceRangeMax },
      ubicacion: datos.location,
      direccion_del_local: datos.locationAddress,
      web: datos.website,
      telefono: datos.contactPhone,
      correo: datos.contactEmail,
      redes: { instagram: datos.instagram, facebook: datos.facebook, tiktok: datos.tiktok, youtube: datos.youtube },
    },
    lineas_de_whatsapp: canales.map((canal) => ({
      id: canal.id,
      nombre: canal.name,
      tipo: canal.provider,
      agente: canal.agent ? { id: canal.agent.id, nombre: canal.agent.name } : null,
    })),
    agentes: agentes.map((agente) => ({
      id: agente.id,
      nombre: agente.name,
      version: agente.agentType,
      estado: agente.status,
      activo: agente.isActive,
      actualizado: hora(agente.updatedAt),
    })),
  };
}

/** El diagrama sin posiciones ni medidas: solo que cajas hay, que dicen y como se conectan. */
function diagramaResumido(grafo: unknown) {
  if (!grafo || typeof grafo !== "object" || Array.isArray(grafo)) {
    return null;
  }
  const { nodes, edges } = grafo as { nodes?: unknown; edges?: unknown };
  const nodos = Array.isArray(nodes) ? nodes : [];
  const aristas = Array.isArray(edges) ? edges : [];
  return {
    cajas: nodos.map((nodo) => {
      const n = (nodo ?? {}) as Record<string, unknown>;
      return { id: n.id, tipo: n.type, datos: n.data };
    }),
    conexiones: aristas.map((arista) => {
      const a = (arista ?? {}) as Record<string, unknown>;
      return { de: a.source, salida: a.sourceHandle ?? null, a: a.target };
    }),
  };
}

async function verAgente(args: Argumentos, contexto: Contexto) {
  const agenteId = texto(args, "agente_id");
  const agente = await prisma.agent.findFirst({
    where: { id: agenteId, workspaceId: contexto.workspaceId },
    select: {
      id: true,
      name: true,
      agentType: true,
      status: true,
      isActive: true,
      model: true,
      systemPrompt: true,
      welcomeMessage: true,
      fallbackMessage: true,
      handoffMessage: true,
      reactivationMessage: true,
      trainingConfig: true,
      graph: true,
      updatedAt: true,
      channels: { select: { id: true, name: true } },
      knowledgeProducts: {
        select: {
          instructions: true,
          funnelOpening: true,
          funnelQualification: true,
          funnelPresentation: true,
          funnelFaq: true,
          funnelClosing: true,
          followUpFlowId: true,
          product: { select: { id: true, name: true, code: true, price: true, description: true } },
        },
      },
    },
  });
  if (!agente) {
    throw new Error("No existe ese agente en este negocio. Ver resumen_del_negocio para los ids.");
  }

  const productoIds = agente.knowledgeProducts.map((fila) => fila.product.id);
  const playbooks = productoIds.length
    ? await prisma.productPlaybook.findMany({
        where: { workspaceId: contexto.workspaceId, productId: { in: productoIds } },
        select: {
          productId: true,
          matchKeywords: true,
          matchAdTitles: true,
          idealCustomer: true,
          customerPain: true,
          pitch: true,
          rules: {
            where: { isActive: true },
            orderBy: { sortOrder: "asc" },
            select: { kind: true, trigger: true, text: true },
          },
          stages: { orderBy: { sortOrder: "asc" }, select: { stage: true, goal: true, script: true } },
        },
      })
    : [];

  return {
    id: agente.id,
    nombre: agente.name,
    version: agente.agentType,
    estado: agente.status,
    activo: agente.isActive,
    modelo: agente.model,
    actualizado: hora(agente.updatedAt),
    lineas: agente.channels,
    aviso:
      agente.agentType === "V2"
        ? "Agente V2: el prompt y los productos se generan al PUBLICAR el diagrama. Si el diagrama cambio y no se publico, lo que corre es el prompt de abajo, no el diagrama."
        : null,
    prompt_principal: agente.systemPrompt,
    bienvenida: agente.welcomeMessage,
    mensaje_de_respaldo: agente.fallbackMessage,
    mensaje_al_pasar_a_asesor: agente.handoffMessage,
    mensaje_de_reactivacion: agente.reactivationMessage,
    configuracion: agente.trainingConfig,
    productos: agente.knowledgeProducts.map((fila) => ({
      id: fila.product.id,
      nombre: fila.product.name,
      codigo: fila.product.code,
      precio: aNumero(fila.product.price),
      descripcion: fila.product.description,
      instrucciones: fila.instructions,
      embudo: {
        apertura: fila.funnelOpening,
        calificacion: fila.funnelQualification,
        presentacion: fila.funnelPresentation,
        preguntas_frecuentes: fila.funnelFaq,
        cierre: fila.funnelClosing,
      },
      flujo_siguiente: fila.followUpFlowId,
      playbook: playbooks.find((playbook) => playbook.productId === fila.product.id) ?? null,
    })),
    diagrama: diagramaResumido(agente.graph),
  };
}

async function listarProductos(args: Argumentos, contexto: Contexto) {
  const buscar = texto(args, "buscar");
  const productos = await prisma.product.findMany({
    where: {
      // El catalogo es compartido: solo se muestran los productos que usa algun agente de ESTE negocio.
      agentKnowledge: { some: { agent: { workspaceId: contexto.workspaceId } } },
      ...(buscar
        ? {
            OR: [
              { name: { contains: buscar, mode: "insensitive" as const } },
              { code: { contains: buscar, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      name: true,
      code: true,
      price: true,
      wholesalePrice: true,
      minWholesaleQty: true,
      description: true,
      category: { select: { name: true } },
      _count: { select: { images: true } },
    },
  });
  return productos.map((producto) => ({
    id: producto.id,
    nombre: producto.name,
    codigo: producto.code,
    categoria: producto.category?.name ?? null,
    precio: aNumero(producto.price),
    precio_mayorista: aNumero(producto.wholesalePrice),
    cantidad_minima_mayorista: producto.minWholesaleQty,
    descripcion: producto.description,
    fotos: producto._count.images,
  }));
}

async function listarFlujos(contexto: Contexto) {
  const flujos = await getCreatedFlowItems({ workspaceId: contexto.workspaceId, includeOfficialApi: false });
  return flujos.map((flujo) => ({
    id: flujo.id,
    titulo: flujo.title,
    intencion: flujo.intent,
    descripcion: flujo.description,
    tipo: flujo.flowType,
    coincidencia: flujo.matchType,
    palabras_clave: flujo.keywords,
    es_flujo_hijo: flujo.isChildFlow,
  }));
}

async function verFlujo(args: Argumentos, contexto: Contexto) {
  const flujoId = texto(args, "flujo_id");
  const flujo = await getFlowReply({ workspaceId: contexto.workspaceId, flowId: flujoId, includeOfficialApi: false });
  if (!flujo) {
    throw new Error("No existe ese flujo en este negocio. Ver listar_flujos para los ids.");
  }
  return {
    id: flujoId,
    responde_ia_al_final: flujo.aiFollowUpEnabled,
    pasos: flujo.steps.map((paso, indice) =>
      paso.kind === "text"
        ? { orden: indice + 1, tipo: "texto", texto: paso.content }
        : {
            orden: indice + 1,
            tipo: paso.kind,
            archivo: paso.url,
            texto: paso.caption,
            ...(paso.kind === "document" ? { nombre_del_archivo: paso.fileName } : {}),
          },
    ),
  };
}

async function listarConversaciones(args: Argumentos, contexto: Contexto) {
  const dias = numero(args, "dias", 1, 30, 1);
  const limite = numero(args, "limite", 1, 100, 30);
  const canalId = texto(args, "canal_id");
  const buscar = texto(args, "buscar");
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const conversaciones = await prisma.conversation.findMany({
    where: {
      workspaceId: contexto.workspaceId,
      lastMessageAt: { gte: desde },
      ...(canalId ? { channelId: canalId } : {}),
      ...(buscar
        ? {
            contact: {
              OR: [
                { name: { contains: buscar, mode: "insensitive" as const } },
                { phoneNumber: { contains: buscar.replace(/\D/g, "") || buscar } },
              ],
            },
          }
        : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: limite,
    select: {
      id: true,
      status: true,
      lastMessageAt: true,
      automationPaused: true,
      channel: { select: { id: true, name: true } },
      assignedTo: { select: { name: true } },
      contact: { select: { name: true, phoneNumber: true, crmStage: true } },
    },
  });

  const conteos = conversaciones.length
    ? await prisma.message.groupBy({
        by: ["conversationId", "direction"],
        where: { conversationId: { in: conversaciones.map((fila) => fila.id) }, createdAt: { gte: desde }, type: { not: "SYSTEM" } },
        _count: { _all: true },
      })
    : [];
  const cuantos = (id: string, direccion: "INBOUND" | "OUTBOUND") =>
    conteos.find((fila) => fila.conversationId === id && fila.direction === direccion)?._count._all ?? 0;

  return {
    desde: hora(desde),
    conversaciones: conversaciones.map((fila) => ({
      id: fila.id,
      contacto: fila.contact.name || null,
      telefono: fila.contact.phoneNumber,
      linea: fila.channel?.name ?? null,
      etapa_crm: fila.contact.crmStage,
      asignada_a: fila.assignedTo?.name ?? null,
      estado: fila.status,
      ia_pausada: fila.automationPaused,
      ultimo_mensaje: hora(fila.lastMessageAt),
      mensajes_del_cliente: cuantos(fila.id, "INBOUND"),
      mensajes_enviados: cuantos(fila.id, "OUTBOUND"),
    })),
  };
}

async function verConversacion(args: Argumentos, contexto: Contexto) {
  const conversacionId = texto(args, "conversacion_id");
  const limite = numero(args, "limite", 1, 300, 80);
  const conversacion = await prisma.conversation.findFirst({
    where: { id: conversacionId, workspaceId: contexto.workspaceId },
    select: {
      id: true,
      status: true,
      automationPaused: true,
      activeProductContext: true,
      funnelStage: true,
      funnelStageCount: true,
      channel: { select: { name: true } },
      agent: { select: { id: true, name: true } },
      assignedTo: { select: { name: true } },
      contact: { select: { name: true, phoneNumber: true, crmStage: true, lostReason: true } },
    },
  });
  if (!conversacion) {
    throw new Error("No existe esa conversacion en este negocio. Ver listar_conversaciones.");
  }

  const [mensajes, decisiones] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversacion.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limite,
      select: { createdAt: true, direction: true, type: true, content: true, mediaUrl: true, editedAt: true, rawPayload: true },
    }),
    prisma.contactMatch.findMany({
      where: { workspaceId: contexto.workspaceId, conversationId: conversacion.id },
      orderBy: { detectedAt: "asc" },
      take: 50,
      select: { detectedAt: true, matchType: true, sourceType: true, targetName: true, confidence: true },
    }),
  ]);

  return {
    id: conversacion.id,
    contacto: conversacion.contact.name || null,
    telefono: conversacion.contact.phoneNumber,
    linea: conversacion.channel?.name ?? null,
    agente: conversacion.agent,
    asignada_a: conversacion.assignedTo?.name ?? null,
    etapa_crm: conversacion.contact.crmStage,
    motivo_de_perdida: conversacion.contact.lostReason,
    estado: conversacion.status,
    ia_pausada: conversacion.automationPaused,
    producto_activo: conversacion.activeProductContext,
    etapa_del_embudo: conversacion.funnelStage,
    decisiones_del_agente: decisiones.map((decision) => ({
      cuando: hora(decision.detectedAt),
      detecto: decision.matchType === "PRODUCT" ? "producto" : "flujo",
      por: decision.sourceType,
      nombre: decision.targetName,
      confianza: decision.confidence,
    })),
    mensajes: mensajes.reverse().map((mensaje) => ({
      cuando: hora(mensaje.createdAt),
      quien: quienDijo(mensaje),
      tipo: mensaje.type,
      texto: mensaje.content,
      ...(mensaje.mediaUrl ? { archivo: mensaje.mediaUrl } : {}),
      ...(mensaje.editedAt ? { editado: true } : {}),
    })),
  };
}

async function buscarMensajes(args: Argumentos, contexto: Contexto) {
  const buscado = texto(args, "texto");
  if (buscado.length < 3) {
    throw new Error("El texto a buscar necesita al menos 3 caracteres.");
  }
  const quien = texto(args, "quien") || "todos";
  const dias = numero(args, "dias", 1, 60, 7);
  const limite = numero(args, "limite", 1, 100, 40);
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  // Se piden de mas cuando se filtra por agente: quien lo dijo se sabe recien al leer cada mensaje.
  const filas = await prisma.message.findMany({
    where: {
      workspaceId: contexto.workspaceId,
      createdAt: { gte: desde },
      deletedAt: null,
      type: { not: "SYSTEM" },
      content: { contains: buscado, mode: "insensitive" },
      ...(quien === "cliente" ? { direction: "INBOUND" as const } : {}),
      ...(quien === "agente" ? { direction: "OUTBOUND" as const } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: quien === "agente" ? limite * 3 : limite,
    select: {
      conversationId: true,
      createdAt: true,
      direction: true,
      type: true,
      content: true,
      rawPayload: true,
      contact: { select: { name: true, phoneNumber: true } },
    },
  });

  const resultados = filas
    .map((fila) => ({ fila, dijo: quienDijo(fila) }))
    .filter(({ dijo }) => quien !== "agente" || dijo === "agente_o_flujo")
    .slice(0, limite);

  return {
    buscado,
    desde: hora(desde),
    encontrados: resultados.length,
    resultados: resultados.map(({ fila, dijo }) => ({
      conversacion_id: fila.conversationId,
      contacto: fila.contact?.name || fila.contact?.phoneNumber || null,
      cuando: hora(fila.createdAt),
      quien: dijo,
      texto: fila.content,
    })),
  };
}

/*
  La lista que ve Claude: primero lo que lee, despues lo que escribe (etapa 2, 18-sep-2026).

  Van juntas y no en dos servidores separados porque corregir es un solo trabajo: Claude lee la
  conversacion, entiende que salio mal y arregla el guion sin que nadie tenga que cambiar de
  herramienta a mitad de camino.
*/
export const HERRAMIENTAS_MCP = [
  ...HERRAMIENTAS_DE_LECTURA,
  ...HERRAMIENTAS_MCP_ESCRITURA,
  ...HERRAMIENTAS_MCP_DIAGRAMA,
  ...HERRAMIENTAS_MCP_V3,
];

export async function ejecutarHerramientaMcp(nombre: string, args: Argumentos, contexto: Contexto) {
  if (esHerramientaDeEscritura(nombre)) {
    return ejecutarHerramientaMcpEscritura(nombre, args, contexto);
  }
  if (esHerramientaDeDiagrama(nombre)) {
    return ejecutarHerramientaMcpDiagrama(nombre, args, contexto);
  }
  if (esHerramientaV3(nombre)) {
    return ejecutarHerramientaMcpV3(nombre, args, contexto);
  }
  switch (nombre) {
    case "resumen_del_negocio":
      return resumenDelNegocio(contexto);
    case "ver_agente":
      return verAgente(args, contexto);
    case "listar_productos":
      return listarProductos(args, contexto);
    case "listar_flujos":
      return listarFlujos(contexto);
    case "ver_flujo":
      return verFlujo(args, contexto);
    case "listar_conversaciones":
      return listarConversaciones(args, contexto);
    case "ver_conversacion":
      return verConversacion(args, contexto);
    case "buscar_mensajes":
      return buscarMensajes(args, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
