import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { HERRAMIENTAS_MCP_V3, ejecutarHerramientaMcpV3, esHerramientaV3 } from "@/lib/mcp/agente-v3";
import {
  HERRAMIENTAS_MCP_PRODUCTOS,
  ejecutarHerramientaMcpProductos,
  esHerramientaDeProductos,
} from "@/lib/mcp/productos";
import {
  HERRAMIENTAS_MCP_APLICACION,
  ejecutarHerramientaMcpAplicacion,
  esHerramientaDeLaAplicacion,
} from "@/lib/mcp/que-es-esta-aplicacion";
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

const ETAPAS_CRM = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"] as const;
type EtapaCrm = (typeof ETAPAS_CRM)[number];

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
      "Conversaciones de un periodo, con contacto, linea, etapa del CRM, asesora asignada y cuantos mensajes hubo de cada lado. Siempre devuelve ademas el total por etapa del periodo. Sin 'etapa' trae las que tuvieron MOVIMIENTO en el periodo, de la mas reciente a la mas vieja. Con 'etapa' trae las que CAYERON en esa etapa dentro del periodo, aunque el chat lleve meses quieto: sirve para 'los ganados de septiembre' o 'los perdidos del mes'. El campo 'fechado_por' de la respuesta dice con que fecha se ubico cada etapa. Cada conversacion trae las etiquetas del contacto y si esta oculto del CRM; por defecto los ocultos no vienen (ver incluir_ocultos).",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "number", description: "Cuantos dias hacia atras (1 a 366, por defecto 1). Lo pisan 'desde' y 'hasta'" },
        desde: { type: "string", description: "Dia de inicio, AAAA-MM-DD en hora de Colombia (opcional, por ejemplo 2026-09-01)" },
        hasta: { type: "string", description: "Dia final incluido, AAAA-MM-DD (opcional, por ejemplo 2026-09-30)" },
        etapa: {
          description:
            "Etapa o etapas del CRM: NUEVO, CALIFICADO, PROPUESTA, NEGOCIACION, GANADO, PERDIDO. Acepta una sola o varias. Cambia el sentido del periodo: pasa a ser cuando el lead cayo en la etapa, no cuando hablo",
          anyOf: [
            { type: "string" },
            { type: "array", items: { type: "string", enum: [...ETAPAS_CRM] } },
          ],
        },
        etiqueta: {
          description:
            "Solo contactos con esta etiqueta (o con alguna de estas). Por nombre o slug, sin importar mayusculas, por ejemplo 'Proveedor'. Una etiqueta que no existe da error con la lista de las que si",
          anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        },
        incluir_ocultos: {
          type: "boolean",
          description:
            "Incluir los contactos ocultos del CRM (lineas administrativas como proveedores, o sacados a mano). Por defecto false, con o sin filtro de etapa. Aplica tambien a totales_por_etapa",
        },
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
      "Los mensajes de una conversacion en orden, marcando QUIEN dijo cada uno: cliente, agente_o_flujo (la IA o un flujo automatico), asesora_desde_crm, enviado_desde_el_celular o sistema. Incluye las etiquetas del contacto, si esta oculto del CRM, las decisiones que registro el agente (producto o flujo detectado) y el producto activo. Las notas de voz traen en 'audio_dice' lo que se dijo en ellas, pasado a texto.",
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
      "Busca un texto dentro de los mensajes y de lo que se dijo en las notas de voz (por ejemplo un precio, una medida o una frase) y devuelve donde aparece y quien lo dijo. Util para ver cuantas veces el agente repitio un dato equivocado.",
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

/**
 * Una lista que puede venir como arreglo, como texto suelto o separada por comas.
 *
 * Tambien acepta un arreglo escrito como texto (`'["GANADO","PERDIDO"]'`): pasa cuando el cliente
 * del otro lado todavia tiene cacheado el esquema viejo, donde el parametro era solo texto. Sin
 * esto llegaba con corchetes y comillas pegados y la etapa se rechazaba sin motivo aparente.
 */
/** `enMayusculas`: las etapas se comparan en mayusculas; las etiquetas se dejan como vinieron. */
function lista(args: Argumentos, clave: string, enMayusculas = true) {
  const valor = args[clave];
  let crudos: unknown[] = [];

  if (Array.isArray(valor)) {
    crudos = valor;
  } else if (typeof valor === "string") {
    const recortado = valor.trim();
    if (recortado.startsWith("[")) {
      try {
        const leido: unknown = JSON.parse(recortado);
        crudos = Array.isArray(leido) ? leido : [];
      } catch {
        // No era JSON valido: se limpian los corchetes y se sigue por comas.
        crudos = recortado.replace(/^\[|\]$/g, "").split(",");
      }
    } else {
      crudos = recortado.split(",");
    }
  }

  return crudos
    .map((item) =>
      // Las comillas sueltas salen del camino de respaldo de arriba, cuando el texto parecia un
      // arreglo pero no se pudo leer como JSON.
      typeof item === "string"
        ? (() => {
            const limpio = item.trim().replace(/^["']|["']$/g, "").trim();
            return enMayusculas ? limpio.toUpperCase() : limpio;
          })()
        : "",
    )
    .filter((item) => item.length > 0);
}


/**
 * CON QUE FECHA SE UBICA CADA ETAPA EN EL TIEMPO.
 *
 * No hay historial de etapas: el contacto guarda la etapa en la que esta HOY, no por donde paso.
 * Asi que "los ganados de septiembre" se responde con la fecha que cada etapa sabe de si misma, y
 * es la misma convencion que ya usa el informe del dueño, para que los dos numeros coincidan:
 *
 *  - GANADO: `wonAt`, la fecha REAL del pago. Los ganados historicos sin `wonAt` no entran: su
 *    fecha no se conoce, y contarlos por `updatedAt` es justo lo que hacia poco confiable al
 *    informe (un lead ganado hace meses, tocado hoy, aparecia como venta de hoy).
 *  - NUEVO: `createdAt`, el dia que el lead entro.
 *  - El resto (incluido PERDIDO): `updatedAt`. No existe una fecha de perdida, asi que es una
 *    APROXIMACION: dice cuando se toco la ficha por ultima vez, no cuando cambio de etapa.
 *
 * La respuesta lo dice en `fechado_por` para que quien la lea no tenga que adivinarlo.
 */
const FECHA_DE_LA_ETAPA: Record<EtapaCrm, "wonAt" | "createdAt" | "updatedAt"> = {
  NUEVO: "createdAt",
  CALIFICADO: "updatedAt",
  PROPUESTA: "updatedAt",
  NEGOCIACION: "updatedAt",
  GANADO: "wonAt",
  PERDIDO: "updatedAt",
};

// Colombia no tiene horario de verano: el desfase es fijo y no hace falta una libreria.
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

/** El comienzo (en UTC) del dia "AAAA-MM-DD" de Colombia. `fin` toma el dia entero. */
function diaBogota(valor: string, fin: boolean) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (!partes) {
    return null;
  }
  const [, anio, mes, dia] = partes;
  const medianoche = Date.UTC(Number(anio), Number(mes) - 1, Number(dia) + (fin ? 1 : 0));
  const fecha = new Date(medianoche + BOGOTA_OFFSET_MS);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
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
      /*
        El catalogo ya NO es compartido (29-09-2026): se pregunta derecho por el negocio.

        Antes habia que dar un rodeo -"los productos que usa algun agente de este negocio"- porque
        el producto no tenia dueño. Ese rodeo ademas escondia los productos que todavia no estaban
        en ningun agente, que es justo el caso de uno recien creado.
      */
      workspaceId: contexto.workspaceId,
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
  const limite = numero(args, "limite", 1, 100, 30);
  const canalId = texto(args, "canal_id");
  const buscar = texto(args, "buscar");

  const etapasPedidas = lista(args, "etapa");
  const desconocidas = etapasPedidas.filter((etapa) => !ETAPAS_CRM.includes(etapa as EtapaCrm));
  if (desconocidas.length > 0) {
    throw new Error(
      `Etapa no valida: ${desconocidas.join(", ")}. Las que existen son ${ETAPAS_CRM.join(", ")}.`,
    );
  }
  const etapas = etapasPedidas as EtapaCrm[];

  /*
    Por etiqueta: una o varias, por nombre o por su slug, sin importar mayusculas. Una etiqueta que
    no existe en el negocio es un error y no una lista vacia: una lista vacia se leeria como "no hay
    nadie con esa etiqueta", y el problema real seria que se escribio distinto.
  */
  const etiquetasPedidas = lista(args, "etiqueta", false);
  if (etiquetasPedidas.length > 0) {
    const existentes = await prisma.tag.findMany({
      where: { workspaceId: contexto.workspaceId },
      select: { name: true, slug: true },
      orderBy: { name: "asc" },
    });
    const conocidas = new Set(existentes.flatMap((tag) => [tag.name.toLowerCase(), tag.slug.toLowerCase()]));
    const faltan = etiquetasPedidas.filter((etiqueta) => !conocidas.has(etiqueta.toLowerCase()));
    if (faltan.length > 0) {
      throw new Error(
        `Etiqueta no encontrada: ${faltan.join(", ")}. Las que existen son: ${existentes.map((tag) => tag.name).join(", ")}.`,
      );
    }
  }

  /*
    LOS OCULTOS DEL CRM (excludedFromCrm): contactos de lineas administrativas -proveedores,
    logistica- o sacados a mano. Por defecto NO vienen, con o sin filtro de etapa.

    Antes dependia del filtro: con etapa se excluian y sin etapa entraban todos, asi que la misma
    pregunta daba dos respuestas segun como se hiciera. `incluir_ocultos` los trae, y aplica igual a
    la lista y a los totales.
  */
  const incluirOcultos = args.incluir_ocultos === true || args.incluir_ocultos === "true";

  /*
    EL PERIODO.

    `desde`/`hasta` ("AAAA-MM-DD", dia completo en hora de Colombia) mandan sobre `dias`, que queda
    para las llamadas de siempre. Sin nada, un dia hacia atras, como antes.
  */
  const desdeTexto = texto(args, "desde");
  const hastaTexto = texto(args, "hasta");
  if ((desdeTexto && !diaBogota(desdeTexto, false)) || (hastaTexto && !diaBogota(hastaTexto, true))) {
    throw new Error("Las fechas van como AAAA-MM-DD, por ejemplo desde 2026-09-01 hasta 2026-09-30.");
  }
  const dias = numero(args, "dias", 1, 366, 1);
  const desde = desdeTexto ? diaBogota(desdeTexto, false)! : new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const hasta = hastaTexto ? diaBogota(hastaTexto, true)! : null;
  if (hasta && hasta <= desde) {
    throw new Error("El 'hasta' tiene que ser posterior al 'desde'.");
  }
  const rango = { gte: desde, ...(hasta ? { lt: hasta } : {}) };

  /*
    QUE SIGNIFICA EL PERIODO, que es lo que cambia todo.

    SIN etapa, el periodo es el MOVIMIENTO del chat (`lastMessageAt`): es lo que hacia esta
    herramienta desde siempre y lo que sirve para "que paso ayer".

    CON etapa, el periodo es CUANDO EL LEAD CAYO EN ESA ETAPA, cada una con su fecha (ver
    FECHA_DE_LA_ETAPA). Si se filtrara igual por movimiento, "los ganados de septiembre" dejaria
    afuera justo a los que se cerraron y no volvieron a escribir, que suelen ser la mayoria.
  */
  const filtroDeEtapas = etapas.map((etapa) => ({ crmStage: etapa, [FECHA_DE_LA_ETAPA[etapa]]: rango }));

  /*
    Las dos condiciones sobre el contacto van dentro de un `AND` y no sueltas en el mismo objeto:
    las dos usan `OR` y la segunda pisaria a la primera, dejando pasar de largo el filtro de etapas.
  */
  const condicionesDelContacto = [
    ...(etapas.length > 0 ? [{ OR: filtroDeEtapas }] : []),
    ...(etiquetasPedidas.length > 0
      ? [
          {
            ContactTag: {
              some: {
                Tag: {
                  OR: [
                    { name: { in: etiquetasPedidas, mode: "insensitive" as const } },
                    { slug: { in: etiquetasPedidas.map((etiqueta) => etiqueta.toLowerCase()) } },
                  ],
                },
              },
            },
          },
        ]
      : []),
    ...(buscar
      ? [
          {
            OR: [
              { name: { contains: buscar, mode: "insensitive" as const } },
              { phoneNumber: { contains: buscar.replace(/\D/g, "") || buscar } },
            ],
          },
        ]
      : []),
  ];

  const contactoWhere = {
    ...(incluirOcultos ? {} : { excludedFromCrm: false }),
    AND: condicionesDelContacto,
  };

  const conversaciones = await prisma.conversation.findMany({
    where: {
      workspaceId: contexto.workspaceId,
      // Con etapa, el rango ya se aplico sobre la fecha de la etapa: pedirlo tambien sobre el
      // movimiento volveria a dejar afuera a los chats quietos.
      ...(etapas.length > 0 ? {} : { lastMessageAt: rango }),
      ...(canalId ? { channelId: canalId } : {}),
      // Siempre: aunque no haya otra condicion, por defecto se dejan afuera los ocultos del CRM.
      contact: contactoWhere,
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
      contact: {
        select: {
          name: true,
          phoneNumber: true,
          crmStage: true,
          excludedFromCrm: true,
          ContactTag: { select: { Tag: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  const conteos = conversaciones.length
    ? await prisma.message.groupBy({
        by: ["conversationId", "direction"],
        where: { conversationId: { in: conversaciones.map((fila) => fila.id) }, createdAt: rango, type: { not: "SYSTEM" } },
        _count: { _all: true },
      })
    : [];
  const cuantos = (id: string, direccion: "INBOUND" | "OUTBOUND") =>
    conteos.find((fila) => fila.conversationId === id && fila.direction === direccion)?._count._all ?? 0;

  /*
    EL TOTAL POR ETAPA DEL PERIODO.

    Se cuenta sobre CONTACTOS -personas- y no sobre las conversaciones de arriba, por dos motivos:
    la lista viene recortada por `limite`, asi que contarla daria un numero que depende de cuantas
    filas se pidieron; y una misma persona puede tener dos chats (el del numero oculto del anuncio),
    con lo que contaria doble.

    Cada etapa se cuenta con SU fecha, la misma que usa el filtro de arriba y el informe del dueño.
    Va siempre, se haya filtrado por etapa o no: es la foto del periodo.
  */
  const totales = await Promise.all(
    ETAPAS_CRM.map(async (etapa) => ({
      etapa,
      cuantos: await prisma.contact.count({
        where: {
          workspaceId: contexto.workspaceId,
          // La misma regla que la lista: si se piden los ocultos, cuentan tambien aca.
          ...(incluirOcultos ? {} : { excludedFromCrm: false }),
          crmStage: etapa,
          [FECHA_DE_LA_ETAPA[etapa]]: rango,
        },
      }),
    })),
  );

  return {
    desde: hora(desde),
    hasta: hasta ? hora(new Date(hasta.getTime() - 1)) : null,
    filtrado_por: etapas.length > 0 ? "etapa" : "movimiento_del_chat",
    incluye_ocultos_del_crm: incluirOcultos,
    ...(etiquetasPedidas.length > 0 ? { etiquetas_pedidas: etiquetasPedidas } : {}),
    /*
      Con que fecha se ubico cada etapa en el periodo. Va en la respuesta a proposito: sin esto,
      un "5 perdidos en septiembre" parece un dato exacto, y para PERDIDO es la fecha en que se
      toco la ficha, no la de la perdida.
    */
    fechado_por: Object.fromEntries(
      ETAPAS_CRM.map((etapa) => [
        etapa,
        FECHA_DE_LA_ETAPA[etapa] === "wonAt"
          ? "fecha real de la venta (los ganados historicos sin fecha no entran)"
          : FECHA_DE_LA_ETAPA[etapa] === "createdAt"
            ? "fecha en que entro el lead"
            : "ultima vez que se toco la ficha (aproximado: no hay fecha de cambio de etapa)",
      ]),
    ),
    totales_por_etapa: Object.fromEntries(totales.map((fila) => [fila.etapa, fila.cuantos])),
    /*
      Personas del periodo que NO tienen chat y por eso no pueden aparecer en la lista de abajo
      (se cargaron a mano, o llegaron por telefono). Va solo cuando se filtro por etapa, que es
      cuando el total y la lista se comparan: sin este numero, un total de 7 con 6 filas parece un
      error. Hoy son 33 en todo el negocio.
    */
    ...(etapas.length > 0
      ? {
          personas_sin_chat: await prisma.contact.count({
            where: { workspaceId: contexto.workspaceId, ...contactoWhere, conversations: { none: {} } },
          }),
        }
      : {}),
    conversaciones: conversaciones.map((fila) => ({
      id: fila.id,
      contacto: fila.contact.name || null,
      telefono: fila.contact.phoneNumber,
      linea: fila.channel?.name ?? null,
      etapa_crm: fila.contact.crmStage,
      etiquetas: fila.contact.ContactTag.map((fila) => fila.Tag.name),
      // Contacto de una linea administrativa (proveedores, logistica) o sacado del CRM a mano.
      oculto_del_crm: fila.contact.excludedFromCrm,
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
      contact: {
        select: {
          name: true,
          phoneNumber: true,
          crmStage: true,
          lostReason: true,
          excludedFromCrm: true,
          ContactTag: { select: { Tag: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
        },
      },
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
      select: { createdAt: true, direction: true, type: true, content: true, mediaUrl: true, editedAt: true, rawPayload: true, transcripcion: true },
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
    etiquetas: conversacion.contact.ContactTag.map((fila) => fila.Tag.name),
    oculto_del_crm: conversacion.contact.excludedFromCrm,
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
      // Lo que se dice en la nota de voz: sin esto un audio es solo un archivo y no se sabe que paso.
      ...(mensaje.transcripcion?.trim() ? { audio_dice: mensaje.transcripcion.trim() } : {}),
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
      // Tambien dentro de lo que se dijo en los audios: un precio dicho de viva voz es igual de real.
      OR: [
        { content: { contains: buscado, mode: "insensitive" } },
        { transcripcion: { contains: buscado, mode: "insensitive" } },
      ],
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
      transcripcion: true,
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
      ...(fila.transcripcion?.trim() ? { audio_dice: fila.transcripcion.trim() } : {}),
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
  // Primero: es la que hay que leer antes de las demas.
  ...HERRAMIENTAS_MCP_APLICACION,
  ...HERRAMIENTAS_DE_LECTURA,
  ...HERRAMIENTAS_MCP_ESCRITURA,
  ...HERRAMIENTAS_MCP_DIAGRAMA,
  ...HERRAMIENTAS_MCP_V3,
  ...HERRAMIENTAS_MCP_PRODUCTOS,
];

export async function ejecutarHerramientaMcp(nombre: string, args: Argumentos, contexto: Contexto) {
  if (esHerramientaDeLaAplicacion(nombre)) {
    return ejecutarHerramientaMcpAplicacion(nombre, args, contexto);
  }
  if (esHerramientaDeProductos(nombre)) {
    return ejecutarHerramientaMcpProductos(nombre, args, contexto);
  }
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
