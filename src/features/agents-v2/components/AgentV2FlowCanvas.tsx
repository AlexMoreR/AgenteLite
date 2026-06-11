"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Megaphone, Plus, Rocket, Trash2 } from "lucide-react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import {
  BaseNode,
  BaseNodeContent,
  BaseNodeHeader,
  BaseNodeHeaderTitle,
} from "@/components/reactflow/base-node";

const AGENT_NODE_ID = "agent-root";

type EntradaKind = "general" | "keyword";

type NodeDataPatch = Partial<{ welcome: string; keywords: string; prompt: string }>;

type EntradaData = {
  kind: EntradaKind;
  welcome: string;
  keywords: string;
  onChange?: (id: string, patch: NodeDataPatch) => void;
  onDelete?: (id: string) => void;
};

type AgentData = {
  name: string;
  welcome: string;
  prompt: string;
  onChange?: (id: string, patch: NodeDataPatch) => void;
};

function EntradaNode({ id, data, selected }: NodeProps) {
  const nodeData = data as EntradaData;
  const isKeyword = nodeData.kind === "keyword";

  return (
    <>
      {isKeyword ? (
        <NodeToolbar isVisible={selected} position={Position.Top} align="end" offset={8}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              nodeData.onDelete?.(id);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
            aria-label="Eliminar entrada"
            title="Eliminar entrada"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </NodeToolbar>
      ) : null}

      <BaseNode className="w-[320px]">
        <BaseNodeHeader className="items-center justify-start gap-2.5">
          <span className="inline-flex shrink-0 items-center justify-center">
            {isKeyword ? (
              <Megaphone className="h-4 w-4 text-amber-600" />
            ) : (
              <Rocket className="h-4 w-4 text-blue-600" />
            )}
          </span>
          <BaseNodeHeaderTitle className="truncate">
            {isKeyword ? "Entrada por pauta" : "Comenzar"}
          </BaseNodeHeaderTitle>
        </BaseNodeHeader>
        <BaseNodeContent>
          <p className="text-xs leading-5 text-muted-foreground">
            {isKeyword
              ? "Cuando el mensaje trae una palabra clave (anuncio/pauta)."
              : "Lead nuevo sin historial y sin palabra clave."}
          </p>

          {isKeyword ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Palabras clave</label>
              <input
                value={nodeData.keywords}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => nodeData.onChange?.(id, { keywords: event.target.value })}
                placeholder="oferta, promo, descuento"
                className="nodrag block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:focus:ring-amber-950"
              />
            </div>
          ) : null}

          {isKeyword ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Mensaje de bienvenida</label>
              <textarea
                value={nodeData.welcome}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => nodeData.onChange?.(id, { welcome: event.target.value })}
                placeholder="¡Viste nuestra promo? Te cuento los detalles..."
                className="nodrag nowheel block min-h-[64px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:focus:ring-amber-950"
              />
            </div>
          ) : null}
        </BaseNodeContent>
        <Handle
          id="source"
          type="source"
          position={Position.Right}
          className="!h-4 !w-4 !border-2 !border-white !bg-blue-600"
        />
      </BaseNode>
    </>
  );
}

function AgentNode({ id, data }: NodeProps) {
  const nodeData = data as AgentData;

  return (
    <>
      <Handle
        id="target"
        type="target"
        position={Position.Left}
        className="!h-4 !w-4 !border-2 !border-white !bg-sky-600"
      />
      <BaseNode className="w-[320px]">
        <BaseNodeHeader className="items-center justify-start gap-2.5">
          <span className="inline-flex shrink-0 items-center justify-center">
            <Bot className="h-4 w-4 text-violet-600" />
          </span>
          <BaseNodeHeaderTitle className="truncate">Agente</BaseNodeHeaderTitle>
        </BaseNodeHeader>
        <BaseNodeContent>
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Mensaje de bienvenida</label>
            <textarea
              value={nodeData.welcome}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => nodeData.onChange?.(id, { welcome: event.target.value })}
              placeholder="Hola, bienvenido a..."
              className="nodrag nowheel block min-h-[64px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-950"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Prompt principal</label>
            <textarea
              value={nodeData.prompt}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => nodeData.onChange?.(id, { prompt: event.target.value })}
              placeholder="Eres el asistente de... Tu objetivo es..."
              className="nodrag nowheel block min-h-[88px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-950"
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              Instruccion base de la IA. Desde aqui conectaras conocimiento, productos y flujos.
            </p>
          </div>
        </BaseNodeContent>
        <Handle
          id="source"
          type="source"
          position={Position.Right}
          className="!h-4 !w-4 !border-2 !border-white !bg-violet-600"
        />
      </BaseNode>
    </>
  );
}

const nodeTypes = { entrada: EntradaNode, agent: AgentNode };

type StoredGraph = {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Partial<EntradaData> & Partial<AgentData>;
  }>;
  edges: Array<Pick<Edge, "id" | "source" | "target" | "sourceHandle" | "targetHandle">>;
};

function graphStorageKey(agentId: string) {
  return `agentV2.graph.${agentId}`;
}

function buildDefaultGraph(agentName: string): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: [
      {
        id: "entry-general",
        type: "entrada",
        position: { x: 0, y: 60 },
        data: { kind: "general", welcome: "", keywords: "" } satisfies EntradaData,
      },
      {
        id: AGENT_NODE_ID,
        type: "agent",
        position: { x: 440, y: 80 },
        data: { name: agentName, welcome: "", prompt: "" } satisfies AgentData,
      },
    ],
    edges: [
      {
        id: "entry-general-agent",
        source: "entry-general",
        sourceHandle: "source",
        target: AGENT_NODE_ID,
        targetHandle: "target",
        markerEnd: { type: MarkerType.ArrowClosed },
      },
    ],
  };
}

function loadGraph(agentId: string, agentName: string): { nodes: Node[]; edges: Edge[] } {
  if (typeof window === "undefined") {
    return buildDefaultGraph(agentName);
  }
  try {
    const raw = window.localStorage.getItem(graphStorageKey(agentId));
    if (!raw) {
      return buildDefaultGraph(agentName);
    }
    const parsed = JSON.parse(raw) as StoredGraph;
    if (!Array.isArray(parsed?.nodes) || parsed.nodes.length === 0) {
      return buildDefaultGraph(agentName);
    }
    const nodes: Node[] = parsed.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data:
        node.type === "agent"
          ? ({
              name: node.data.name ?? agentName,
              welcome: node.data.welcome ?? "",
              prompt: node.data.prompt ?? "",
            } satisfies AgentData)
          : ({
              kind: (node.data.kind as EntradaKind) ?? "general",
              welcome: node.data.welcome ?? "",
              keywords: node.data.keywords ?? "",
            } satisfies EntradaData),
      deletable: node.type === "agent" ? false : node.id !== "entry-general",
    }));
    const edges: Edge[] = parsed.edges.map((edge) => ({
      ...edge,
      markerEnd: { type: MarkerType.ArrowClosed },
    }));
    return { nodes, edges };
  } catch {
    return buildDefaultGraph(agentName);
  }
}

type AgentV2FlowCanvasProps = {
  agentId: string;
  agentName: string;
  onBack: () => void;
};

function FlowCanvasInner({ agentId, agentName, onBack }: AgentV2FlowCanvasProps) {
  const initial = useMemo(() => loadGraph(agentId, agentName), [agentId, agentName]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const keywordCount = useRef(
    initial.nodes.filter((node) => node.type === "entrada" && node.id !== "entry-general").length,
  );

  const updateNodeData = useCallback(
    (id: string, patch: NodeDataPatch) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      );
    },
    [setNodes],
  );

  const deleteEntrada = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    },
    [setNodes, setEdges],
  );

  // Inyecta callbacks en los nodos de entrada (no se persisten, se re-atan en cada render).
  const nodesWithHandlers = useMemo(
    () =>
      nodes.map((node) => {
        if (node.type === "entrada") {
          return { ...node, data: { ...node.data, onChange: updateNodeData, onDelete: deleteEntrada } };
        }
        if (node.type === "agent") {
          return { ...node, data: { ...node.data, onChange: updateNodeData } };
        }
        return node;
      }),
    [nodes, updateNodeData, deleteEntrada],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed } }, current),
      );
    },
    [setEdges],
  );

  const addKeywordEntry = useCallback(() => {
    keywordCount.current += 1;
    const index = keywordCount.current;
    const newId = `entry-keyword-${crypto.randomUUID()}`;
    const newNode: Node = {
      id: newId,
      type: "entrada",
      position: { x: 0, y: 60 + index * 280 },
      data: { kind: "keyword", welcome: "", keywords: "" } satisfies EntradaData,
    };
    setNodes((current) => [...current, newNode]);
    setEdges((current) =>
      addEdge(
        {
          source: newId,
          sourceHandle: "source",
          target: AGENT_NODE_ID,
          targetHandle: "target",
          markerEnd: { type: MarkerType.ArrowClosed },
        },
        current,
      ),
    );
  }, [setNodes, setEdges]);

  // Persistencia por agente (sin callbacks).
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored: StoredGraph = {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type ?? "entrada",
        position: node.position,
        data:
          node.type === "agent"
            ? {
                name: (node.data as AgentData).name,
                welcome: (node.data as AgentData).welcome,
                prompt: (node.data as AgentData).prompt,
              }
            : {
                kind: (node.data as EntradaData).kind,
                welcome: (node.data as EntradaData).welcome,
                keywords: (node.data as EntradaData).keywords,
              },
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
    };
    window.localStorage.setItem(graphStorageKey(agentId), JSON.stringify(stored));
  }, [agentId, nodes, edges]);

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-foreground">{agentName}</p>
            <p className="text-xs text-muted-foreground">Agente V2 · constructor de flujo</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={addKeywordEntry}>
          <Plus className="h-4 w-4" />
          Agregar entrada por pauta
        </Button>
      </div>
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodesWithHandlers}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function AgentV2FlowCanvas(props: AgentV2FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
