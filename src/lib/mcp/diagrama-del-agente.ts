import { randomUUID } from "node:crypto";

import { publicarAgenteV2 } from "@/app/actions/agent-v2-actions";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { anotarCambioMcp } from "@/lib/mcp/cambios";
import { prisma } from "@/lib/prisma";

/*
  Armar el diagrama del agente desde Claude (etapa 3, Alex 21-sep-2026).

  El caso que lo pidio, con sus palabras: "cuando una persona diga quiero cotizar mesas de manicura
  con sillas, que mande la bienvenida -es obligatoria- y enseguida el catalogo". Con las
  herramientas de la etapa 2 se podia escribir la bienvenida, pero no CREAR la condicion ni
  conectarla al flujo: habia que ir al diagrama a mano.

  Se crean las mismas cajas que crea el editor, con la misma forma de datos y los mismos nombres de
  conectores. Si esto inventara su propia forma, el diagrama se dibujaria igual y no responderia
  nada -y la compilacion no fallaria-, que es el error tipico de este constructor.

  Dos redes, porque una caja mal conectada deja al agente mudo:
  1. Antes de publicar se revisa que el diagrama cierre (sin lineas al vacio, sin cajas vacias).
  2. Cada cambio guarda el diagrama ENTERO de antes, asi deshacer_cambio lo deja como estaba.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const BORRA = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/*
  El nodo Agente es el centro del que cuelga todo. Su id lo pone el editor ("agent-root" en los
  diagramas de hoy), asi que se busca POR TIPO: un id escrito a mano aca envejece mal.
*/
function idDelAgente(nodos: NodoDelGrafo[]): string {
  return nodos.find((nodo) => nodo.type === "agent")?.id ?? "agent-root";
}
const TIPOS_DE_COINCIDENCIA = ["contiene", "exacta", "ia"] as const;

type NodoDelGrafo = {
  id?: string;
  type?: string;
  position?: { x: number; y: number };
  style?: Record<string, unknown>;
  data?: Record<string, unknown>;
};
type AristaDelGrafo = {
  id?: string;
  source?: string;
  target?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  markerEnd?: unknown;
};
type Grafo = { nodes?: NodoDelGrafo[]; edges?: AristaDelGrafo[] };

export const HERRAMIENTAS_MCP_DIAGRAMA = [
  {
    name: "ver_diagrama_del_agente",
    title: "Ver el diagrama del agente",
    description:
      "Las cajas del agente V2 y como estan conectadas: id, tipo, que dice cada una y de donde sale cada linea. Es el mapa para saber donde enganchar algo nuevo. Hay que llamarla antes de crear o conectar.",
    inputSchema: {
      type: "object",
      properties: { agente_id: { type: "string" } },
      required: ["agente_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "crear_condicion_en_el_agente",
    title: "Crear una condicion",
    description:
      "Crea una caja Condicion con sus palabras ('cuando el cliente diga X') colgando del Agente, o de la caja que se indique. Devuelve el id de la caja y el id de la regla, que es lo que despues se conecta a lo que tiene que pasar.",
    inputSchema: {
      type: "object",
      properties: {
        agente_id: { type: "string" },
        palabras: {
          type: "array",
          items: { type: "string" },
          description: "Frases que disparan la condicion. Mejor frases que palabras sueltas: un 'si' suelto engancha 'silla'.",
        },
        tipo: {
          type: "string",
          enum: TIPOS_DE_COINCIDENCIA,
          description: "contiene (por defecto), exacta, o ia (por intencion, con el campo intencion)",
        },
        intencion: { type: "string", description: "Solo con tipo 'ia': que intencion tiene que mostrar el cliente" },
        desde_nodo_id: { type: "string", description: "De que caja cuelga. Por defecto, del Agente." },
      },
      required: ["agente_id", "palabras"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "crear_nodo_de_flujo",
    title: "Crear una caja de Flujo",
    description:
      "Crea una caja Flujo que manda un flujo ya armado (un catalogo, unas fotos, un PDF). Despues hay que conectarla con conectar_en_el_agente para que se dispare.",
    inputSchema: {
      type: "object",
      properties: {
        agente_id: { type: "string" },
        flujo_id: { type: "string", description: "Id del flujo (ver listar_flujos)" },
      },
      required: ["agente_id", "flujo_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "conectar_en_el_agente",
    title: "Conectar dos cajas",
    description:
      "Une dos cajas del diagrama: de donde sale y a donde llega. Desde una Condicion hay que decir de que regla sale (regla_id), que es lo que hace que ESA palabra dispare ESA accion.",
    inputSchema: {
      type: "object",
      properties: {
        agente_id: { type: "string" },
        desde_nodo_id: { type: "string" },
        hasta_nodo_id: { type: "string" },
        regla_id: { type: "string", description: "Solo si sale de una Condicion" },
      },
      required: ["agente_id", "desde_nodo_id", "hasta_nodo_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "borrar_nodo_del_agente",
    title: "Borrar una caja",
    description:
      "Saca una caja del diagrama con todas sus lineas. No se pueden borrar el Agente ni la Bienvenida. Se deshace desde el historial.",
    inputSchema: {
      type: "object",
      properties: { agente_id: { type: "string" }, nodo_id: { type: "string" } },
      required: ["agente_id", "nodo_id"],
      additionalProperties: false,
    },
    annotations: BORRA,
  },
] as const;

const NOMBRES = new Set(HERRAMIENTAS_MCP_DIAGRAMA.map((herramienta) => herramienta.name));

export function esHerramientaDeDiagrama(nombre: string) {
  return NOMBRES.has(nombre as (typeof HERRAMIENTAS_MCP_DIAGRAMA)[number]["name"]);
}

async function agenteDelNegocio(contexto: Contexto, agenteId: string) {
  const agente = await prisma.agent.findFirst({
    where: { id: agenteId, workspaceId: contexto.workspaceId },
    select: { id: true, name: true, graph: true },
  });
  if (!agente) {
    throw new Error("Ese agente no existe en este negocio");
  }
  const grafo = (agente.graph ?? {}) as Grafo;
  return {
    agente,
    nodos: Array.isArray(grafo.nodes) ? grafo.nodes : [],
    aristas: Array.isArray(grafo.edges) ? grafo.edges : [],
  };
}

/** Un lugar libre a la derecha de todo, para que la caja nueva no caiga encima de otra. */
function lugarLibre(nodos: NodoDelGrafo[]) {
  const derecha = Math.max(0, ...nodos.map((nodo) => nodo.position?.x ?? 0));
  const abajo = Math.max(0, ...nodos.map((nodo) => nodo.position?.y ?? 0));
  return { x: derecha + 360, y: abajo + 120 };
}

/*
  Que el diagrama cierre antes de publicar.

  No valida el sentido de lo que se armo -eso lo decide quien lo pide- sino que no queden piezas
  rotas: una linea a una caja que no existe, una condicion sin palabras o un flujo sin flujo
  elegido. Son las tres formas en que el agente se queda mudo sin que nada falle.
*/
function revisar(nodos: NodoDelGrafo[], aristas: AristaDelGrafo[]): string[] {
  const ids = new Set(nodos.map((nodo) => nodo.id).filter(Boolean) as string[]);
  const avisos: string[] = [];

  for (const arista of aristas) {
    if (!arista.source || !ids.has(arista.source) || !arista.target || !ids.has(arista.target)) {
      avisos.push(`Hay una linea que apunta a una caja que no existe (${arista.source ?? "?"} -> ${arista.target ?? "?"}).`);
    }
  }
  for (const nodo of nodos) {
    if (nodo.type === "condicion") {
      const reglas = Array.isArray(nodo.data?.rules) ? (nodo.data.rules as Record<string, unknown>[]) : [];
      const vacia = reglas.every((regla) => {
        const palabras = Array.isArray(regla.keywords) ? regla.keywords : [];
        return palabras.length === 0 && !String(regla.intent ?? "").trim();
      });
      if (reglas.length === 0 || vacia) {
        avisos.push(`La condicion ${nodo.id} no tiene palabras ni intencion: nunca se va a disparar.`);
      }
    }
    if (nodo.type === "flujo") {
      const uno = String(nodo.data?.flowId ?? "").trim();
      const varios = Array.isArray(nodo.data?.flowIds) ? (nodo.data.flowIds as unknown[]) : [];
      if (!uno && varios.length === 0) {
        avisos.push(`La caja de flujo ${nodo.id} no tiene ningun flujo elegido: no va a mandar nada.`);
      }
    }
  }
  return avisos;
}

/** Guarda el diagrama, lo publica y deja el cambio en el historial para poder deshacerlo. */
async function guardarYPublicar(input: {
  contexto: Contexto;
  agente: { id: string; name: string; graph: unknown };
  nodos: NodoDelGrafo[];
  aristas: AristaDelGrafo[];
  titulo: string;
  despues: Record<string, unknown>;
}) {
  const avisos = revisar(input.nodos, input.aristas);
  const grafo = { ...((input.agente.graph ?? {}) as Grafo), nodes: input.nodos, edges: input.aristas };
  await prisma.agent.update({ where: { id: input.agente.id }, data: { graph: grafo as never } });

  /*
    Con piezas rotas se guarda pero NO se publica.

    Publicar a medias es lo caro: el que contesta en WhatsApp se queda con un diagrama que no
    cierra. Guardado y sin publicar, lo que esta al aire sigue siendo lo de antes y se puede
    terminar de armar (o deshacer) con calma.
  */
  const publicado = avisos.length === 0 ? await publicarAgenteV2({ agentId: input.agente.id, workspaceId: input.contexto.workspaceId }) : null;

  const cambio = await anotarCambioMcp(input.contexto.workspaceId, {
    titulo: input.titulo,
    tabla: "Agent",
    filaId: input.agente.id,
    accion: "editar",
    antes: { graph: input.agente.graph },
    despues: input.despues,
    agenteId: input.agente.id,
  });

  return {
    ok: true as const,
    cambio_id: cambio.id,
    publicado: publicado?.ok === true,
    avisos: avisos.length > 0 ? avisos : undefined,
    aviso:
      avisos.length > 0
        ? "Se guardo pero NO se publico: el diagrama tiene piezas sueltas (ver avisos). Al aire sigue lo de antes."
        : publicado?.ok
          ? "Listo y publicado: ya contesta asi."
          : "Se guardo, pero no se pudo publicar.",
  };
}

export async function ejecutarHerramientaMcpDiagrama(
  nombre: string,
  argumentos: Argumentos,
  contexto: Contexto,
): Promise<unknown> {
  const agenteId = String(argumentos.agente_id ?? "");

  if (nombre === "ver_diagrama_del_agente") {
    const { agente, nodos, aristas } = await agenteDelNegocio(contexto, agenteId);
    const flujos = await getCreatedFlowItems({ workspaceId: contexto.workspaceId, includeOfficialApi: false });
    const titulo = new Map(flujos.map((flujo) => [flujo.id, flujo.title]));
    return {
      agente: { id: agente.id, nombre: agente.name },
      cajas: nodos.map((nodo) => ({
        nodo_id: nodo.id,
        tipo: nodo.type,
        // Lo justo para reconocerla: el resto se pide con ver_textos_del_agente.
        resumen:
          nodo.type === "condicion"
            ? (Array.isArray(nodo.data?.rules) ? (nodo.data.rules as Record<string, unknown>[]) : []).map((regla) => ({
                regla_id: regla.id,
                tipo: regla.matchType,
                palabras: regla.keywords,
                intencion: regla.intent,
              }))
            : nodo.type === "flujo"
              ? {
                  flujos: [
                    ...new Set([
                      ...(Array.isArray(nodo.data?.flowIds) ? (nodo.data.flowIds as string[]) : []),
                      String(nodo.data?.flowId ?? ""),
                    ]),
                  ]
                    .filter(Boolean)
                    .map((flowId) => ({ flujo_id: flowId, titulo: titulo.get(flowId) ?? "(borrado)" })),
                }
              : String(nodo.data?.texto ?? nodo.data?.text ?? nodo.data?.prompt ?? "").slice(0, 120) || null,
      })),
      lineas: aristas.map((arista) => ({
        desde: arista.source,
        desde_regla: arista.sourceHandle && arista.sourceHandle !== "source" ? arista.sourceHandle : undefined,
        hasta: arista.target,
      })),
    };
  }

  if (nombre === "crear_condicion_en_el_agente") {
    const { agente, nodos, aristas } = await agenteDelNegocio(contexto, agenteId);
    const palabras = (Array.isArray(argumentos.palabras) ? argumentos.palabras : [])
      .map((palabra) => String(palabra).trim())
      .filter(Boolean);
    const tipo = TIPOS_DE_COINCIDENCIA.includes(argumentos.tipo as (typeof TIPOS_DE_COINCIDENCIA)[number])
      ? (argumentos.tipo as (typeof TIPOS_DE_COINCIDENCIA)[number])
      : "contiene";
    const intencion = String(argumentos.intencion ?? "").trim();
    if (tipo === "ia" ? !intencion : palabras.length === 0) {
      throw new Error(tipo === "ia" ? "Falta la intencion" : "Hay que dar al menos una palabra o frase");
    }

    const desde = String(argumentos.desde_nodo_id ?? "") || idDelAgente(nodos);
    if (!nodos.some((nodo) => nodo.id === desde)) {
      throw new Error(`No existe la caja ${desde} en el diagrama`);
    }

    const nodoId = `condicion-${randomUUID()}`;
    const reglaId = `${nodoId}-r0`;
    const nodoNuevo: NodoDelGrafo = {
      id: nodoId,
      type: "condicion",
      position: lugarLibre(nodos),
      data: { rules: [{ id: reglaId, matchType: tipo, keywords: palabras, intent: intencion }] },
    };
    const aristaNueva: AristaDelGrafo = {
      id: `linea-${randomUUID()}`,
      source: desde,
      sourceHandle: "source",
      target: nodoId,
      targetHandle: "target",
      type: "agentEdge",
      markerEnd: { type: "arrowclosed" },
    };

    const resultado = await guardarYPublicar({
      contexto,
      agente,
      nodos: [...nodos, nodoNuevo],
      aristas: [...aristas, aristaNueva],
      titulo: `Condicion nueva en ${agente.name}: ${palabras.join(", ") || intencion}`,
      despues: { nodo_id: nodoId, palabras, tipo },
    });
    return { ...resultado, nodo_id: nodoId, regla_id: reglaId };
  }

  if (nombre === "crear_nodo_de_flujo") {
    const { agente, nodos, aristas } = await agenteDelNegocio(contexto, agenteId);
    const flujoId = String(argumentos.flujo_id ?? "").trim();
    const flujos = await getCreatedFlowItems({ workspaceId: contexto.workspaceId, includeOfficialApi: false });
    const flujo = flujos.find((item) => item.id === flujoId);
    if (!flujo) {
      throw new Error("Ese flujo no existe en este negocio (ver listar_flujos)");
    }

    const nodoId = `flujo-${randomUUID()}`;
    const nodoNuevo: NodoDelGrafo = {
      id: nodoId,
      type: "flujo",
      position: lugarLibre(nodos),
      data: { flowId: flujoId, flowIds: [flujoId] },
    };
    const resultado = await guardarYPublicar({
      contexto,
      agente,
      nodos: [...nodos, nodoNuevo],
      aristas,
      titulo: `Caja de flujo "${flujo.title}" en ${agente.name}`,
      despues: { nodo_id: nodoId, flujo: flujo.title },
    });
    return {
      ...resultado,
      nodo_id: nodoId,
      aviso: `${resultado.aviso} Falta conectarla: sin linea que llegue, el flujo no se dispara.`,
    };
  }

  if (nombre === "conectar_en_el_agente") {
    const { agente, nodos, aristas } = await agenteDelNegocio(contexto, agenteId);
    const desde = String(argumentos.desde_nodo_id ?? "");
    const hasta = String(argumentos.hasta_nodo_id ?? "");
    const nodoDesde = nodos.find((nodo) => nodo.id === desde);
    const nodoHasta = nodos.find((nodo) => nodo.id === hasta);
    if (!nodoDesde || !nodoHasta) {
      throw new Error("Alguna de las dos cajas no existe en el diagrama");
    }

    /*
      Desde una condicion, la linea sale de UNA regla.

      Es lo que ata "si dice esto" con "entonces pasa esto". Saliendo del conector comun, la
      condicion queda decorativa: se cumple y no dispara nada.
    */
    let salida = "source";
    if (nodoDesde.type === "condicion") {
      const reglas = Array.isArray(nodoDesde.data?.rules) ? (nodoDesde.data.rules as Record<string, unknown>[]) : [];
      const reglaId = String(argumentos.regla_id ?? "") || String(reglas[0]?.id ?? "");
      if (!reglas.some((regla) => String(regla.id) === reglaId)) {
        throw new Error("Esa regla no existe en la condicion (ver ver_diagrama_del_agente)");
      }
      salida = reglaId;
    }

    const yaEsta = aristas.some(
      (arista) => arista.source === desde && arista.target === hasta && (arista.sourceHandle ?? "source") === salida,
    );
    if (yaEsta) {
      return { ok: true, aviso: "Ya estaban conectadas: no se toco nada." };
    }

    const aristaNueva: AristaDelGrafo = {
      id: `linea-${randomUUID()}`,
      source: desde,
      sourceHandle: salida,
      target: hasta,
      targetHandle: "target",
      type: "agentEdge",
      markerEnd: { type: "arrowclosed" },
    };
    return guardarYPublicar({
      contexto,
      agente,
      nodos,
      aristas: [...aristas, aristaNueva],
      titulo: `Conexion ${nodoDesde.type} -> ${nodoHasta.type} en ${agente.name}`,
      despues: { desde, hasta, regla: salida },
    });
  }

  if (nombre === "borrar_nodo_del_agente") {
    const { agente, nodos, aristas } = await agenteDelNegocio(contexto, agenteId);
    const nodoId = String(argumentos.nodo_id ?? "");
    const nodo = nodos.find((fila) => fila.id === nodoId);
    if (!nodo) {
      throw new Error("Esa caja no esta en el diagrama");
    }
    if (nodo.type === "agent" || nodo.type === "bienvenida") {
      throw new Error("El Agente y la Bienvenida no se pueden borrar");
    }
    return guardarYPublicar({
      contexto,
      agente,
      nodos: nodos.filter((fila) => fila.id !== nodoId),
      aristas: aristas.filter((arista) => arista.source !== nodoId && arista.target !== nodoId),
      titulo: `Caja ${nodo.type} borrada en ${agente.name}`,
      despues: { nodo_id: nodoId, tipo: nodo.type },
    });
  }

  throw new Error(`Herramienta desconocida: ${nombre}`);
}
