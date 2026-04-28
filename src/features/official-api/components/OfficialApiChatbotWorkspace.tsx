"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from "react";
import {
  Bot,
  Route,
  X,
  Clock3,
  Copy,
  Image as ImageIcon,
  AudioLines,
  Video,
  File,
  ChevronLeft,
  ChevronRight,
  FileText,
  MessageSquarePlus,
  MoreVertical,
  Inbox,
  Upload,
  Plus,
  Save,
  Settings2,
  Split,
  Trash2,
  UserRound,
  Workflow,
  Rocket,
  Zap,
} from "lucide-react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  ReactFlow,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  BaseNode,
  BaseNodeContent,
  BaseNodeFooter,
  BaseNodeHeader,
  BaseNodeHeaderTitle,
} from "@/components/reactflow/base-node";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type {
  OfficialApiChatbotBuilderNode,
  OfficialApiChatbotData,
  OfficialApiChatbotNodesByScenarioId,
  OfficialApiChatbotScenario,
} from "@/features/official-api/types/official-api";
import { toast } from "sonner";

type OfficialApiChatbotWorkspaceProps = {
  data: OfficialApiChatbotData;
  initialScenarioId?: string;
  basePath?: string;
  routeQuery?: string;
  saveEndpoint?: string;
  uploadEndpoint?: string;
  saveSuccessDescription?: string;
};

type BuilderNode = OfficialApiChatbotBuilderNode;
type NodePosition = { x: number; y: number };
type NodePositionsByScenarioId = Record<string, Record<string, NodePosition>>;
type BuilderEdge = { id: string; source: string; target: string };
type EdgesByScenarioId = Record<string, BuilderEdge[]>;
type FlowNodeData = {
  kind: BuilderNode["kind"];
  title: string;
  body: string;
  meta: string;
  orderLabel: string;
};
type EdgeAppearance = {
  stroke: string;
  strokeWidth: number;
  markerColor: string;
  curvature: number;
};

function ChatbotFlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const preview = data.kind === "image"
    ? (data.body.trim() || data.meta.trim() || "Sin contenido aun.")
    : (data.body.trim() || "Sin contenido aun.");
  const imageUrl = data.kind === "image" && isLikelyDirectImageUrl(data.meta) ? data.meta.trim() : "";
  const imageCaption = data.kind === "image" ? data.body.trim() : "";
  const headerIcon =
    data.kind === "trigger" ? (
      <Rocket className="h-4 w-4 text-blue-600" />
    ) : data.kind === "message" ? (
      <MessageSquarePlus className="h-4 w-4 text-sky-600" />
    ) : data.kind === "image" ? (
      <ImageIcon className="h-4 w-4 text-indigo-600" />
    ) : data.kind === "audio" ? (
      <AudioLines className="h-4 w-4 text-fuchsia-600" />
    ) : data.kind === "video" ? (
      <Video className="h-4 w-4 text-rose-600" />
    ) : data.kind === "document" ? (
      <File className="h-4 w-4 text-violet-600" />
    ) : data.kind === "input" ? (
      <UserRound className="h-4 w-4 text-emerald-600" />
    ) : data.kind === "condition" ? (
      <Split className="h-4 w-4 text-amber-600" />
    ) : (
      <Zap className="h-4 w-4 text-slate-600" />
    );

  return (
    <>
      {data.kind === "trigger" ? null : (
        <Handle
          id="target"
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !border-2 !border-white !bg-sky-600"
        />
      )}
      <BaseNode
        className={cn(
          "w-[300px] transition-shadow",
          selected ? "border-blue-400 shadow-[0_24px_50px_-28px_rgba(37,99,235,0.52)]" : "",
        )}
      >
        <BaseNodeHeader className="items-center justify-start gap-2.5">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
            {headerIcon}
          </span>
          <BaseNodeHeaderTitle className="truncate">{data.title}</BaseNodeHeaderTitle>
        </BaseNodeHeader>
        <BaseNodeContent>
          {data.kind === "image" && imageUrl ? (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <img
                  src={imageUrl}
                  alt="Vista previa de imagen del nodo"
                  className="h-36 w-full object-cover"
                />
              </div>
              {imageCaption ? (
                <p className="line-clamp-3 whitespace-pre-line text-sm leading-5 text-slate-700">{imageCaption}</p>
              ) : null}
            </div>
          ) : (
            <p className="line-clamp-4 whitespace-pre-line text-sm leading-5 text-slate-700">{preview}</p>
          )}
        </BaseNodeContent>
        <BaseNodeFooter>
          <p className="truncate text-xs text-slate-500">
            {data.meta.trim() ? `Meta: ${data.meta}` : data.orderLabel}
          </p>
        </BaseNodeFooter>
      </BaseNode>
      <Handle
        id="source"
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-blue-600"
      />
    </>
  );
}

const nodeTypes = { chatbotNode: ChatbotFlowNode };

type ChatbotFlowCanvasProps = {
  scenarioKey: string;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  edgeAppearance: EdgeAppearance;
  onNodesChange: (changes: NodeChange<Node>[]) => void;
  onConnect: (connection: Connection) => void;
  onProximityConnect: (sourceId: string, targetId: string) => void;
  onEdgeClick: (event: MouseEvent, edge: Edge) => void;
  onNodeOpen: (nodeId: string) => void;
};

const PROXIMITY_DISTANCE_PX = 220;

function getDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isLikelyDirectImageUrl(value: string) {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) {
    return false;
  }

  return /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(trimmed);
}

function isUploadableNodeKind(kind: BuilderNode["kind"]): kind is "image" | "audio" | "video" | "document" {
  return kind === "image" || kind === "audio" || kind === "video" || kind === "document";
}

function getUploadAcceptByKind(kind: "image" | "audio" | "video" | "document") {
  if (kind === "image") {
    return "image/*";
  }
  if (kind === "audio") {
    return "audio/*";
  }
  if (kind === "video") {
    return "video/*";
  }
  return ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function getUploadLabelByKind(kind: "image" | "audio" | "video" | "document") {
  if (kind === "image") {
    return "imagen";
  }
  if (kind === "audio") {
    return "audio";
  }
  if (kind === "video") {
    return "video";
  }
  return "documento";
}

function getClosestNodeByProximity(input: {
  draggingNode: Node;
  nodes: Node[];
  edges: Edge[];
}) {
  const { draggingNode, nodes, edges } = input;
  const draggingNodeId = draggingNode.id;
  const draggingPosition = draggingNode.position;
  const hasEdge = (sourceId: string, targetId: string) =>
    edges.some((edge) => edge.source === sourceId && edge.target === targetId);

  let bestConnection: { sourceId: string; targetId: string } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    if (node.id === draggingNodeId) {
      continue;
    }

    const shouldFlowFromLeftToRight = draggingPosition.x > node.position.x;
    const sourceId = shouldFlowFromLeftToRight ? node.id : draggingNodeId;
    const targetId = shouldFlowFromLeftToRight ? draggingNodeId : node.id;

    if (hasEdge(sourceId, targetId)) {
      continue;
    }

    const distance = getDistance(draggingPosition, node.position);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestConnection = { sourceId, targetId };
    }
  }

  if (!bestConnection || bestDistance > PROXIMITY_DISTANCE_PX) {
    return null;
  }

  return bestConnection;
}

function ChatbotFlowCanvas({
  scenarioKey,
  nodes,
  edges,
  edgeAppearance,
  onNodesChange,
  onConnect,
  onProximityConnect,
  onEdgeClick,
  onNodeOpen,
}: ChatbotFlowCanvasProps) {
  const [canvasNodes, setCanvasNodes, onCanvasNodesChange] = useNodesState(nodes);
  const [canvasEdges, setCanvasEdges, onCanvasEdgesChange] = useEdgesState(edges);
  const [previewEdge, setPreviewEdge] = useState<Edge | null>(null);
  const nodesSignature = useMemo(
    () =>
      nodes
        .map(
          (node) =>
            `${node.id}:${node.position.x}:${node.position.y}:${String(node.data?.title ?? "")}:${String(node.data?.body ?? "")}:${String(node.data?.meta ?? "")}`,
        )
        .join("|"),
    [nodes],
  );
  const canvasNodesSignature = useMemo(
    () =>
      canvasNodes
        .map(
          (node) =>
            `${node.id}:${node.position.x}:${node.position.y}:${String(node.data?.title ?? "")}:${String(node.data?.body ?? "")}:${String(node.data?.meta ?? "")}`,
        )
        .join("|"),
    [canvasNodes],
  );
  const edgesSignature = useMemo(
    () => edges.map((edge) => `${edge.id}:${edge.source}:${edge.target}`).join("|"),
    [edges],
  );
  const canvasEdgesSignature = useMemo(
    () => canvasEdges.map((edge) => `${edge.id}:${edge.source}:${edge.target}`).join("|"),
    [canvasEdges],
  );

  useEffect(() => {
    if (canvasNodesSignature !== nodesSignature) {
      setCanvasNodes(nodes);
    }
  }, [canvasNodesSignature, nodes, nodesSignature, scenarioKey, setCanvasNodes]);

  useEffect(() => {
    if (canvasEdgesSignature !== edgesSignature) {
      setCanvasEdges(edges);
    }
  }, [canvasEdgesSignature, edges, edgesSignature, scenarioKey, setCanvasEdges]);

  return (
    <ReactFlow
      key={scenarioKey}
      className="chatbot-flow-canvas"
      nodes={canvasNodes}
      edges={previewEdge ? [...canvasEdges, previewEdge] : canvasEdges}
      nodeTypes={nodeTypes}
      onNodesChange={(changes) => {
        onCanvasNodesChange(changes);
        onNodesChange(changes);
      }}
      onEdgesChange={onCanvasEdgesChange}
      onConnect={(connection) => {
        setCanvasEdges((current) => addEdge(connection, current));
        onConnect(connection);
      }}
      onEdgeClick={onEdgeClick}
      onNodeDrag={(_event, draggingNode) => {
        const candidate = getClosestNodeByProximity({
          draggingNode,
          nodes: canvasNodes,
          edges: canvasEdges,
        });

        if (!candidate) {
          setPreviewEdge(null);
          return;
        }

        setPreviewEdge({
          id: `preview-${candidate.sourceId}-${candidate.targetId}`,
          source: candidate.sourceId,
          sourceHandle: "source",
          target: candidate.targetId,
          targetHandle: "target",
          type: "default",
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(37,99,235,0.45)" },
          style: {
            stroke: "rgba(37,99,235,0.55)",
            strokeWidth: 1.8,
            strokeDasharray: "6 4",
            strokeLinecap: "round",
          },
        });
      }}
      onNodeDragStop={(_event, draggingNode) => {
        const candidate = getClosestNodeByProximity({
          draggingNode,
          nodes: canvasNodes,
          edges: canvasEdges,
        });

        setPreviewEdge(null);
        if (!candidate) {
          return;
        }

        setCanvasEdges((current) => [
          ...current.filter((edge) => edge.source !== candidate.sourceId),
          {
            id: createEdgeId(candidate.sourceId, candidate.targetId),
            source: candidate.sourceId,
            sourceHandle: "source",
            target: candidate.targetId,
            targetHandle: "target",
          },
        ]);
        onProximityConnect(candidate.sourceId, candidate.targetId);
      }}
      onNodeClick={(event, node: Node) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".react-flow__handle")) {
          return;
        }
        onNodeOpen(node.id);
      }}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      fitView
      onlyRenderVisibleElements={false}
      nodesConnectable
      nodesDraggable
      elementsSelectable
      panOnDrag
      connectOnClick
      connectionMode={ConnectionMode.Loose}
      connectionRadius={42}
      connectionLineStyle={{ stroke: edgeAppearance.stroke, strokeWidth: edgeAppearance.strokeWidth }}
      defaultEdgeOptions={{
        type: "default",
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeAppearance.markerColor },
        style: { stroke: edgeAppearance.stroke, strokeWidth: edgeAppearance.strokeWidth, strokeLinecap: "round" },
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        color="rgba(100,116,139,0.35)"
        gap={22}
        size={1.7}
      />
      <Controls position="bottom-right" />
    </ReactFlow>
  );
}

function getSafePosition(input: NodePosition | undefined, index: number): NodePosition {
  const col = index % 3;
  const row = Math.floor(index / 3);
  const fallback = {
    x: 80 + col * 380,
    y: 120 + row * 220,
  };
  if (!input) {
    return fallback;
  }

  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    return fallback;
  }

  return {
    x: input.x,
    y: input.y,
  };
}

function buildSequentialEdges(nodes: BuilderNode[]): BuilderEdge[] {
  if (nodes.length < 2) {
    return [];
  }

  return nodes.slice(0, -1).map((node, index) => ({
    id: createEdgeId(node.id, nodes[index + 1].id),
    source: node.id,
    target: nodes[index + 1].id,
  }));
}

function createEdgeId(source: string, target: string) {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `edge_${safe(source)}__${safe(target)}`;
}

function normalizeScenarioEdges(nodes: BuilderNode[], inputEdges: BuilderEdge[] | undefined): BuilderEdge[] {
  if (nodes.length < 2) {
    return [];
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const cleaned = (inputEdges ?? []).filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target,
  );

  if (cleaned.length > 0) {
    return cleaned.map((edge, index) => ({
      id: edge.id || `${createEdgeId(edge.source, edge.target)}_${index}`,
      source: edge.source,
      target: edge.target,
    }));
  }

  return buildSequentialEdges(nodes);
}

const sendBlockLibrary = [
  {
    id: "message",
    title: "Texto",
    description: "Texto, saludo o respuesta corta.",
    icon: MessageSquarePlus,
    style: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  {
    id: "image",
    title: "Imagen",
    description: "Comparte una imagen del producto con contexto.",
    icon: ImageIcon,
    style: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  },
  {
    id: "audio",
    title: "Audio",
    description: "Envia una nota de voz o audio por URL.",
    icon: AudioLines,
    style: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  },
  {
    id: "video",
    title: "Video",
    description: "Envia un video por URL publica.",
    icon: Video,
    style: "bg-rose-50 text-rose-700 ring-rose-200",
  },
  {
    id: "document",
    title: "Documento",
    description: "Envia un PDF o documento por URL.",
    icon: File,
    style: "bg-violet-50 text-violet-700 ring-violet-200",
  },
] as const;

const blockLibrary = [
  {
    id: "input",
    title: "Captura",
    description: "Nombre, ciudad, producto o presupuesto.",
    icon: UserRound,
    style: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  {
    id: "condition",
    title: "Condicion",
    description: "Rama por horario o intencion.",
    icon: Split,
    style: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  {
    id: "action",
    title: "Accion",
    description: "Asignar asesor, etiquetar o cerrar.",
    icon: Zap,
    style: "bg-slate-100 text-slate-700 ring-slate-200",
  },
] as const;

function createNodeId(kind: BuilderNode["kind"]) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createWorkflowId() {
  return `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createStarterNodes(): BuilderNode[] {
  return [
    {
      id: "trigger",
      kind: "trigger",
      title: "Comenzar",
      body: "Inicia al recibir un mensaje.",
      meta: "",
    },
  ];
}

function getNodeBodyForDisplay(node: BuilderNode) {
  const trimmedBody = node.body.trim();
  if (
    node.kind === "trigger" &&
    trimmedBody === "El flujo inicia cuando entra un mensaje nuevo al numero oficial de WhatsApp."
  ) {
    return "Inicia al recibir un mensaje.";
  }
  return trimmedBody;
}

function getOrderedNodeTitle(node: BuilderNode, index: number) {
  const trimmedTitle = node.title.trim();
  if (trimmedTitle.toLowerCase() === "inicio del flujo") {
    return "Comenzar";
  }
  if (trimmedTitle.toLowerCase() === "nuevo mensaje") {
    return "Enviar mensaje";
  }
  return trimmedTitle || `Paso ${index + 1}`;
}

function normalizeNodesByScenarioForSave(nodesByScenarioId: OfficialApiChatbotNodesByScenarioId) {
  return Object.fromEntries(
    Object.entries(nodesByScenarioId).map(([scenarioId, scenarioNodes]) => [
      scenarioId,
      scenarioNodes.map((node, index) => ({
        ...node,
        title: getOrderedNodeTitle(node, index),
      })),
    ]),
  ) satisfies OfficialApiChatbotNodesByScenarioId;
}

function mergeKeywords(existingMeta: string, nextKeyword: string) {
  const keywords = splitKeywords(existingMeta)
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  if (!keywords.includes(nextKeyword)) {
    keywords.push(nextKeyword);
  }

  return keywords.join(", ");
}

function splitKeywords(existingMeta: string) {
  return existingMeta
    .split(/[,;\n]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function OfficialApiChatbotWorkspace({
  data,
  initialScenarioId,
  basePath = "/cliente/api-oficial/flujos",
  routeQuery = "",
  saveEndpoint = "/api/cliente/api-oficial/chatbot",
  uploadEndpoint = "/api/cliente/api-oficial/chatbot/upload-image",
  saveSuccessDescription = "La configuracion del flujo quedo lista en la API oficial.",
}: OfficialApiChatbotWorkspaceProps) {
  const router = useRouter();
  const initialSelectedScenarioId =
    initialScenarioId && data.defaults.scenarios.some((scenario) => scenario.id === initialScenarioId)
      ? initialScenarioId
      : "";
  const [scenarios, setScenarios] = useState<OfficialApiChatbotScenario[]>(
    data.defaults.scenarios,
  );
  const [selectedScenarioId, setSelectedScenarioId] = useState(initialSelectedScenarioId);
  const [botEnabled] = useState(data.defaults.isBotEnabled);
  const [captureLeadEnabled, setCaptureLeadEnabled] = useState(data.defaults.captureLeadEnabled);
  const [handoffEnabled, setHandoffEnabled] = useState(data.defaults.handoffEnabled);
  const [fallbackEnabled, setFallbackEnabled] = useState(data.defaults.fallbackEnabled);
  const [replyEveryMessageEnabled, setReplyEveryMessageEnabled] = useState(data.defaults.replyEveryMessageEnabled);
  const [businessHours, setBusinessHours] = useState(data.defaults.businessHours);
  const [nodesByScenarioId, setNodesByScenarioId] = useState<OfficialApiChatbotNodesByScenarioId>(
    data.defaults.nodesByScenarioId,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    data.defaults.nodesByScenarioId[initialSelectedScenarioId]?.[0]?.id || "",
  );
  const [copiedTemplateId, setCopiedTemplateId] = useState("");
  const [isSaving, startSaving] = useTransition();
  const [isBlockLibraryOpen, setIsBlockLibraryOpen] = useState(false);
  const [blockLibrarySection, setBlockLibrarySection] = useState<"root" | "send">("root");
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
  const [newWorkflowTitle, setNewWorkflowTitle] = useState("");
  const [isUploadingNodeImage, setIsUploadingNodeImage] = useState(false);
  const [nodeImageUploadError, setNodeImageUploadError] = useState("");
  const [openMenuScenarioId, setOpenMenuScenarioId] = useState("");
  const [scenarioPendingDelete, setScenarioPendingDelete] = useState<OfficialApiChatbotScenario | null>(null);
  const [quickResponsesScenarioId, setQuickResponsesScenarioId] = useState("");
  const [isQuickResponsesModalOpen, setIsQuickResponsesModalOpen] = useState(false);
  const [quickResponseSelectedId, setQuickResponseSelectedId] = useState("");
  const [isQuickResponseKeywordFormOpen, setIsQuickResponseKeywordFormOpen] = useState(false);
  const [quickResponseKeywordDraft, setQuickResponseKeywordDraft] = useState("");
  const [isNodeEditorOpen, setIsNodeEditorOpen] = useState(false);
  const [nodePositionsByScenarioId, setNodePositionsByScenarioId] = useState<NodePositionsByScenarioId>(
    data.defaults.nodePositionsByScenarioId,
  );
  const [edgesByScenarioId, setEdgesByScenarioId] = useState<EdgesByScenarioId>(() =>
    Object.fromEntries(
      Object.entries(data.defaults.nodesByScenarioId).map(([scenarioId, scenarioNodes]) => [
        scenarioId,
        (data.defaults.edgesByScenarioId?.[scenarioId] ?? []).length > 0
          ? data.defaults.edgesByScenarioId[scenarioId]
          : buildSequentialEdges(scenarioNodes),
      ]),
    ),
  );
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSavedSnapshotRef = useRef("");
  const autoSaveScenarioIdRef = useRef("");
  const nodeImageInputRef = useRef<HTMLInputElement | null>(null);
  const blockLibraryButtonRef = useRef<HTMLButtonElement | null>(null);
  const blockLibraryPanelRef = useRef<HTMLDivElement | null>(null);

  const hasWorkflows = scenarios.length > 0;
  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId);
  const quickResponsesScenario = scenarios.find((scenario) => scenario.id === quickResponsesScenarioId) ?? null;
  const hasSelectedFlow = Boolean(selectedScenario);
  const nodes = useMemo(
    () => (selectedScenario ? (nodesByScenarioId[selectedScenario.id] ?? []) : []),
    [nodesByScenarioId, selectedScenario],
  );
  const quickResponses = useMemo(
    () =>
      quickResponsesScenario
        ? (nodesByScenarioId[quickResponsesScenario.id] ?? []).filter((node) => node.kind === "message")
        : [],
    [nodesByScenarioId, quickResponsesScenario],
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null,
    [nodes, selectedNodeId],
  );
  const selectedQuickResponse = useMemo(
    () => quickResponses.find((node) => node.id === quickResponseSelectedId) ?? quickResponses[0] ?? null,
    [quickResponseSelectedId, quickResponses],
  );
  const selectedImageUrl = selectedNode?.kind === "image" ? selectedNode.meta.trim() : "";
  const hasInvalidImageUrl = selectedNode?.kind === "image" && selectedImageUrl.length > 0 && !isLikelyDirectImageUrl(selectedImageUrl);
  const selectedUploadNodeKind =
    selectedNode && isUploadableNodeKind(selectedNode.kind) ? selectedNode.kind : null;

  useEffect(() => {
    if (!isQuickResponsesModalOpen) {
      setIsQuickResponseKeywordFormOpen(false);
      setQuickResponseKeywordDraft("");
      return;
    }

    const firstQuickResponseId = quickResponses[0]?.id ?? "";
    setQuickResponseSelectedId((current) => (quickResponses.some((node) => node.id === current) ? current : firstQuickResponseId));
  }, [isQuickResponsesModalOpen, quickResponses]);

  const openNodeEditor = useCallback((nodeId: string) => {
    setIsBlockLibraryOpen(false);
    setSelectedNodeId(nodeId);
    setIsNodeEditorOpen(true);
  }, []);
  const scenarioNodePositions = useMemo(
    () => (selectedScenario ? (nodePositionsByScenarioId[selectedScenario.id] ?? {}) : {}),
    [nodePositionsByScenarioId, selectedScenario],
  );
  const scenarioEdges = useMemo(() => {
    if (!selectedScenario) {
      return [];
    }

    return normalizeScenarioEdges(nodes, edgesByScenarioId[selectedScenario.id]);
  }, [edgesByScenarioId, nodes, selectedScenario]);
  const flowNodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      nodes.map((node, index) => ({
        id: node.id,
        type: "chatbotNode",
        position: getSafePosition(scenarioNodePositions[node.id], index),
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          kind: node.kind,
          title: getOrderedNodeTitle(node, index),
          body: getNodeBodyForDisplay(node),
          meta: node.meta,
          orderLabel: `Paso ${index + 1}`,
        },
      })),
    [nodes, scenarioNodePositions],
  );
  const flowEdges = useMemo<Edge[]>(
    () =>
      scenarioEdges.map((edge, index) => ({
        id: edge.id || createEdgeId(edge.source, edge.target) + `_${index}`,
        source: edge.source,
        sourceHandle: "source",
        target: edge.target,
        targetHandle: "target",
        type: "default",
        animated: false,
        pathOptions: { curvature: 0.35 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(37,99,235,0.95)" },
        style: { stroke: "rgba(37,99,235,0.82)", strokeWidth: 2.1, strokeLinecap: "round" },
      })),
    [scenarioEdges],
  );
  const edgeAppearance = useMemo<EdgeAppearance>(
    () => ({
      stroke: "rgba(37,99,235,0.82)",
      strokeWidth: 2.1,
      markerColor: "rgba(37,99,235,0.95)",
      curvature: 0.35,
    }),
    [],
  );
  const renderEdges = useMemo<Edge[]>(() => {
    if (flowEdges.length > 0) {
      return flowEdges.map((edge) => ({
        ...edge,
        pathOptions: { curvature: edgeAppearance.curvature },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeAppearance.markerColor },
        style: { stroke: edgeAppearance.stroke, strokeWidth: edgeAppearance.strokeWidth, strokeLinecap: "round" },
      }));
    }

    if (flowNodes.length < 2) {
      return [];
    }

    // Fallback visible path: if scenario edges fail to hydrate, draw linear native edges.
    return flowNodes.slice(0, -1).map((node, index) => ({
      id: createEdgeId(node.id, flowNodes[index + 1].id),
      source: node.id,
      sourceHandle: "source",
      target: flowNodes[index + 1].id,
      targetHandle: "target",
      type: "default",
      animated: false,
      pathOptions: { curvature: edgeAppearance.curvature },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeAppearance.markerColor },
      style: { stroke: edgeAppearance.stroke, strokeWidth: edgeAppearance.strokeWidth, strokeLinecap: "round" },
    }));
  }, [edgeAppearance, flowEdges, flowNodes]);

  function updateNodesForScenario(scenarioId: string, updater: (nodes: BuilderNode[]) => BuilderNode[]) {
    setNodesByScenarioId((current) => ({
      ...current,
      [scenarioId]: updater(current[scenarioId] ?? []),
    }));
  }

  function updateNodeInScenario(scenarioId: string, nodeId: string, patch: Partial<BuilderNode>) {
    if (!scenarioId) {
      return;
    }

    updateNodesForScenario(scenarioId, (current) =>
      current.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    );
  }

  function updateNode(nodeId: string, patch: Partial<BuilderNode>) {
    if (!selectedScenario) {
      return;
    }

    updateNodeInScenario(selectedScenario.id, nodeId, patch);
  }

  function addBlock(kind: BuilderNode["kind"]) {
    const templates: Record<BuilderNode["kind"], Omit<BuilderNode, "id">> = {
      trigger: {
        kind: "trigger",
        title: "Nuevo disparador",
        body: "El flujo arranca con un nuevo evento.",
        meta: "Evento",
      },
      message: {
        kind: "message",
        title: "Enviar mensaje",
        body: "Escribe aqui la respuesta del bot.",
        meta: "",
      },
      image: {
        kind: "image",
        title: "Enviar imagen",
        body: "",
        meta: "",
      },
      audio: {
        kind: "audio",
        title: "Enviar audio",
        body: "",
        meta: "",
      },
      video: {
        kind: "video",
        title: "Enviar video",
        body: "",
        meta: "",
      },
      document: {
        kind: "document",
        title: "Enviar documento",
        body: "",
        meta: "",
      },
      input: {
        kind: "input",
        title: "Nueva captura",
        body: "Pide el dato que necesitas del usuario.",
        meta: "Dato a capturar",
      },
      condition: {
        kind: "condition",
        title: "Nueva condicion",
        body: "Define la decision del flujo.",
        meta: "palabra1, palabra2",
      },
      action: {
        kind: "action",
        title: "Nueva accion",
        body: "Define la accion interna del sistema.",
        meta: "Accion",
      },
    };

    const nextNode: BuilderNode = {
      id: createNodeId(kind),
      ...templates[kind],
    };

    if (!selectedScenario) {
      return;
    }

    const previousLastNode = nodes[nodes.length - 1];
    const previousLastNodePosition = previousLastNode
      ? getSafePosition(
          scenarioNodePositions[previousLastNode.id],
          Math.max(0, nodes.length - 1),
        )
      : getSafePosition(undefined, 0);
    const nextNodePosition: NodePosition = {
      x: previousLastNodePosition.x + 380,
      y: previousLastNodePosition.y,
    };

    setNodesByScenarioId((currentNodesByScenarioId) => {
      const scenarioNodes = currentNodesByScenarioId[selectedScenario.id] ?? [];
      const previousLastNodeId = scenarioNodes[scenarioNodes.length - 1]?.id;
      const nextScenarioNodes = [...scenarioNodes, nextNode];

      setEdgesByScenarioId((currentEdgesByScenarioId) => {
        const scenarioEdges = currentEdgesByScenarioId[selectedScenario.id] ?? buildSequentialEdges(scenarioNodes);
        if (!previousLastNodeId) {
          return {
            ...currentEdgesByScenarioId,
            [selectedScenario.id]: scenarioEdges,
          };
        }

        return {
          ...currentEdgesByScenarioId,
          [selectedScenario.id]: [
            ...scenarioEdges.filter((edge) => edge.source !== previousLastNodeId),
            {
              id: createEdgeId(previousLastNodeId, nextNode.id),
              source: previousLastNodeId,
              target: nextNode.id,
            },
          ],
        };
      });

      return {
        ...currentNodesByScenarioId,
        [selectedScenario.id]: nextScenarioNodes,
      };
    });
    setNodePositionsByScenarioId((current) => ({
      ...current,
      [selectedScenario.id]: {
        ...(current[selectedScenario.id] ?? {}),
        [nextNode.id]: nextNodePosition,
      },
    }));
    setSelectedNodeId(nextNode.id);
    setIsBlockLibraryOpen(false);
    setBlockLibrarySection("root");
  }

  function createWorkflow() {
    const title = newWorkflowTitle.trim();
    if (!title) {
      toast.error("Completa el flujo", {
        description: "Agrega el nombre antes de crear el flujo.",
      });
      return;
    }

    const nextScenario: OfficialApiChatbotScenario = {
      id: createWorkflowId(),
      title,
      summary: "Flujo personalizado creado desde el builder.",
      messages: [],
    };

    setScenarios((current) => [...current, nextScenario]);
    setSelectedScenarioId(nextScenario.id);
    setIsCreatingWorkflow(false);
    setNewWorkflowTitle("");
    const nextNodes = createStarterNodes();
    const nextScenarios = [...scenarios, nextScenario];
    const nextNodesByScenarioId = {
      ...nodesByScenarioId,
      [nextScenario.id]: nextNodes,
    };
    const nextEdgesByScenarioId = {
      ...edgesByScenarioId,
      [nextScenario.id]: buildSequentialEdges(nextNodes),
    };
    const nextNodePositionsByScenarioId = {
      ...nodePositionsByScenarioId,
      [nextScenario.id]: {},
    };
    setNodesByScenarioId((current) => ({
      ...current,
      [nextScenario.id]: nextNodes,
    }));
    setNodePositionsByScenarioId(nextNodePositionsByScenarioId);
    setEdgesByScenarioId(nextEdgesByScenarioId);
    setSelectedNodeId(nextNodes[0]?.id ?? "");
    setIsBlockLibraryOpen(true);

    startSaving(async () => {
      try {
        await persistBuilderState({
          selectedScenarioId: nextScenario.id,
          scenarios: nextScenarios,
          nodesByScenarioId: nextNodesByScenarioId,
          nodePositionsByScenarioId: nextNodePositionsByScenarioId,
          edgesByScenarioId: nextEdgesByScenarioId,
        });
      } catch (error) {
        toast.error("No se pudo crear el flujo", {
          description: error instanceof Error ? error.message : "Ocurrio un error al crear el flujo.",
        });
      }
    });
  }

  function updateSelectedWorkflow(patch: Partial<Pick<OfficialApiChatbotScenario, "title" | "summary">>) {
    if (!selectedScenario) {
      return;
    }

    setScenarios((current) =>
      current.map((scenario) => (scenario.id === selectedScenario.id ? { ...scenario, ...patch } : scenario)),
    );
  }

  async function handleCopyTemplate(templateId: string, message: string) {
    try {
      await navigator.clipboard.writeText(message);
      setCopiedTemplateId(templateId);
      window.setTimeout(() => {
        setCopiedTemplateId((current) => (current === templateId ? "" : current));
      }, 1800);
    } catch {
      setCopiedTemplateId("");
    }
  }

  const persistBuilderState = useCallback(async (input: {
    selectedScenarioId: string;
    scenarios: OfficialApiChatbotScenario[];
    nodesByScenarioId: OfficialApiChatbotNodesByScenarioId;
    nodePositionsByScenarioId: NodePositionsByScenarioId;
    edgesByScenarioId: EdgesByScenarioId;
    successMessage?: string;
  }) => {
    const normalizedNodesByScenarioId = normalizeNodesByScenarioForSave(input.nodesByScenarioId);
    const activeNodes = normalizedNodesByScenarioId[input.selectedScenarioId] ?? [];
    const response = await fetch(saveEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isBotEnabled: botEnabled,
        welcomeMessage: activeNodes.find((node) => node.id === "welcome")?.body || data.defaults.welcomeMessage,
        fallbackMessage: activeNodes.find((node) => node.id === "fallback")?.body || data.defaults.fallbackMessage,
        businessHours,
        captureLeadEnabled,
        handoffEnabled,
        fallbackEnabled,
        replyEveryMessageEnabled,
        selectedScenarioId: input.selectedScenarioId,
        scenarios: input.scenarios,
        nodesByScenarioId: normalizedNodesByScenarioId,
        nodePositionsByScenarioId: input.nodePositionsByScenarioId,
        edgesByScenarioId: input.edgesByScenarioId,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "No pudimos guardar la configuracion del flujo.");
    }

    if (input.successMessage) {
      toast.success(input.successMessage, {
        description: saveSuccessDescription,
      });
    }
  }, [
    botEnabled,
    businessHours,
    captureLeadEnabled,
    data.defaults.fallbackMessage,
    data.defaults.welcomeMessage,
    fallbackEnabled,
    handoffEnabled,
    replyEveryMessageEnabled,
    saveEndpoint,
    saveSuccessDescription,
  ]);

  function handleSaveBuilder() {
    if (!selectedScenario || scenarios.length === 0 || nodes.length === 0) {
      toast.error("Primero crea un flujo", {
        description: "Necesitas al menos un flujo y un nodo para poder guardar.",
      });
      return;
    }

    startSaving(async () => {
      try {
        await persistBuilderState({
          selectedScenarioId,
          scenarios,
          nodesByScenarioId,
          nodePositionsByScenarioId,
          edgesByScenarioId,
          successMessage: "Flujo guardado",
        });
      } catch {
        toast.error("No se pudo guardar", {
          description: "Ocurrio un error al guardar el flujo.",
        });
      }
    });
  }

  function handleDeleteRequest(scenario: OfficialApiChatbotScenario) {
    setOpenMenuScenarioId("");
    setScenarioPendingDelete(scenario);
  }

  function openQuickResponsesModal(scenarioId: string) {
    setOpenMenuScenarioId("");
    setQuickResponsesScenarioId(scenarioId);
    setQuickResponseSelectedId("");
    setQuickResponseKeywordDraft("");
    setIsQuickResponseKeywordFormOpen(false);
    setIsQuickResponsesModalOpen(true);
  }

  function saveQuickResponseKeyword() {
    if (!quickResponsesScenario || !selectedQuickResponse) {
      return;
    }

    const keyword = quickResponseKeywordDraft.trim();
    if (!keyword) {
      toast.error("Escribe una palabra clave");
      return;
    }

    const nextMeta = mergeKeywords(selectedQuickResponse.meta, keyword);
    updateNodeInScenario(quickResponsesScenario.id, selectedQuickResponse.id, { meta: nextMeta });
    setQuickResponseKeywordDraft("");
    setIsQuickResponseKeywordFormOpen(false);
    toast.success("Palabra clave agregada");
  }

  function deleteQuickResponseKeyword(responseId: string, keywordToRemove: string) {
    if (!quickResponsesScenario) {
      return;
    }

    const response = quickResponses.find((item) => item.id === responseId);
    if (!response) {
      return;
    }

    const nextMeta = splitKeywords(response.meta)
      .filter((keyword) => keyword !== keywordToRemove)
      .join(", ");

    updateNodeInScenario(quickResponsesScenario.id, responseId, { meta: nextMeta });
    setIsQuickResponseKeywordFormOpen(false);
    setQuickResponseKeywordDraft("");
    toast.success("Palabra clave eliminada");
  }

  function confirmDeleteWorkflow() {
    if (!scenarioPendingDelete) {
      return;
    }

    const nextScenarios = scenarios.filter((scenario) => scenario.id !== scenarioPendingDelete.id);
    const nextSelectedScenario = nextScenarios[0];
    const nextNodesByScenarioId = Object.fromEntries(
      Object.entries(nodesByScenarioId).filter(([scenarioId]) => scenarioId !== scenarioPendingDelete.id),
    );
    const nextNodePositionsByScenarioId = Object.fromEntries(
      Object.entries(nodePositionsByScenarioId).filter(([scenarioId]) => scenarioId !== scenarioPendingDelete.id),
    );
    const nextEdgesByScenarioId = Object.fromEntries(
      Object.entries(edgesByScenarioId).filter(([scenarioId]) => scenarioId !== scenarioPendingDelete.id),
    );

    setScenarios(nextScenarios);
    setNodesByScenarioId(nextNodesByScenarioId);
    setNodePositionsByScenarioId(nextNodePositionsByScenarioId);
    setEdgesByScenarioId(nextEdgesByScenarioId);
    setSelectedScenarioId(nextSelectedScenario?.id ?? "");
    setSelectedNodeId(nextNodesByScenarioId[nextSelectedScenario?.id ?? ""]?.[0]?.id ?? "");
    setScenarioPendingDelete(null);

    startSaving(async () => {
      try {
        await persistBuilderState({
          selectedScenarioId: nextSelectedScenario?.id ?? "",
          scenarios: nextScenarios,
          nodesByScenarioId: nextNodesByScenarioId,
          nodePositionsByScenarioId: nextNodePositionsByScenarioId,
          edgesByScenarioId: nextEdgesByScenarioId,
          successMessage: "Flujo eliminado",
        });
      } catch {
        toast.error("No se pudo eliminar", {
          description: "Ocurrio un error al eliminar el flujo.",
        });
      }
    });
  }

  const handleFlowNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    if (!selectedScenario) {
      return;
    }

    setNodePositionsByScenarioId((current) => {
      const nextScenarioPositions = { ...(current[selectedScenario.id] ?? {}) };

      for (const change of changes) {
        if (
          change.type === "position" &&
          change.position &&
          typeof change.position.x === "number" &&
          typeof change.position.y === "number"
        ) {
          nextScenarioPositions[change.id] = change.position;
        }
      }

      return {
        ...current,
        [selectedScenario.id]: nextScenarioPositions,
      };
    });
  }, [selectedScenario]);

  const connectNodesByIds = useCallback((sourceId: string, targetId: string) => {
    if (!selectedScenario || sourceId === targetId) {
      return;
    }

    setEdgesByScenarioId((current) => {
      const currentEdges = current[selectedScenario.id] ?? buildSequentialEdges(nodes);
      const nextEdges = [
        ...currentEdges.filter((edge) => edge.source !== sourceId),
        {
          id: createEdgeId(sourceId, targetId),
          source: sourceId,
          sourceHandle: "source",
          target: targetId,
          targetHandle: "target",
        },
      ];
      return {
        ...current,
        [selectedScenario.id]: nextEdges,
      };
    });
  }, [nodes, selectedScenario]);

  const handleConnectNodes = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }

    connectNodesByIds(connection.source, connection.target);
  }, [connectNodesByIds]);

  const handleProximityConnect = useCallback((sourceId: string, targetId: string) => {
    connectNodesByIds(sourceId, targetId);
  }, [connectNodesByIds]);

  const handleEdgeClick = useCallback((_event: MouseEvent, edge: Edge) => {
    if (!selectedScenario) {
      return;
    }

    setEdgesByScenarioId((current) => {
      const currentEdges = current[selectedScenario.id] ?? buildSequentialEdges(nodes);
      return {
        ...current,
        [selectedScenario.id]: currentEdges.filter((currentEdge) => currentEdge.id !== edge.id),
      };
    });
  }, [nodes, selectedScenario]);

  function handleDeleteNode(nodeId: string) {
    if (!selectedScenario) {
      return;
    }

    const currentNodes = nodesByScenarioId[selectedScenario.id] ?? [];
    if (currentNodes.find((node) => node.id === nodeId)?.kind === "trigger") {
      return;
    }
    const nextNodes = currentNodes.filter((node) => node.id !== nodeId);

    setNodesByScenarioId((current) => ({
      ...current,
      [selectedScenario.id]: nextNodes,
    }));
    setEdgesByScenarioId((current) => {
      const currentEdges = current[selectedScenario.id] ?? buildSequentialEdges(currentNodes);
      return {
        ...current,
        [selectedScenario.id]: currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      };
    });

    setSelectedNodeId(nextNodes[0]?.id ?? "");
    setIsNodeEditorOpen(false);
  }

  function handleDeleteOutgoingConnection(nodeId: string) {
    if (!selectedScenario) {
      return;
    }

    setEdgesByScenarioId((current) => {
      const currentEdges = current[selectedScenario.id] ?? buildSequentialEdges(nodes);
      return {
        ...current,
        [selectedScenario.id]: currentEdges.filter((edge) => edge.source !== nodeId),
      };
    });
  }

  async function handleNodeImageFileSelected(file: File | null) {
    if (!file || !selectedNode || !isUploadableNodeKind(selectedNode.kind)) {
      return;
    }

    const uploadKind = selectedNode.kind;
    const uploadLabel = getUploadLabelByKind(uploadKind);
    setNodeImageUploadError("");
    setIsUploadingNodeImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(uploadEndpoint, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; url?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.url) {
        throw new Error(payload?.error || `No se pudo subir el ${uploadLabel}.`);
      }

      updateNode(selectedNode.id, { meta: payload.url });
      toast.success(`${uploadLabel[0].toUpperCase()}${uploadLabel.slice(1)} subido`, {
        description: "La URL quedo cargada en el nodo.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `No se pudo subir el ${uploadLabel}.`;
      setNodeImageUploadError(message);
      toast.error(`Error al subir ${uploadLabel}`, {
        description: message,
      });
    } finally {
      setIsUploadingNodeImage(false);
    }
  }

  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isBlockLibraryOpen) {
      return;
    }

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target as globalThis.Node | null;
      if (!target) {
        return;
      }

      if (blockLibraryPanelRef.current?.contains(target)) {
        return;
      }

      if (blockLibraryButtonRef.current?.contains(target)) {
        return;
      }

      setIsBlockLibraryOpen(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setIsBlockLibraryOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isBlockLibraryOpen]);

  useEffect(() => {
    if (!hasSelectedFlow || !selectedScenarioId) {
      return;
    }

    const snapshot = JSON.stringify({
      selectedScenarioId,
      scenarios,
      nodesByScenarioId,
      nodePositionsByScenarioId,
      edgesByScenarioId,
      businessHours,
      captureLeadEnabled,
      handoffEnabled,
      fallbackEnabled,
      replyEveryMessageEnabled,
    });

    if (autoSaveScenarioIdRef.current !== selectedScenarioId) {
      autoSaveScenarioIdRef.current = selectedScenarioId;
      lastAutoSavedSnapshotRef.current = snapshot;
      return;
    }

    if (snapshot === lastAutoSavedSnapshotRef.current) {
      return;
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      startSaving(async () => {
        try {
          await persistBuilderState({
            selectedScenarioId,
            scenarios,
            nodesByScenarioId,
            nodePositionsByScenarioId,
            edgesByScenarioId,
          });
          lastAutoSavedSnapshotRef.current = snapshot;
        } catch {
          toast.error("No se pudo autoguardar", {
            description: "Revisa tu conexion e intenta nuevamente.",
          });
        }
      });
    }, 1200);
  }, [
    businessHours,
    captureLeadEnabled,
    fallbackEnabled,
    handoffEnabled,
    replyEveryMessageEnabled,
    hasSelectedFlow,
    edgesByScenarioId,
    nodePositionsByScenarioId,
    nodesByScenarioId,
    persistBuilderState,
    scenarios,
    selectedScenarioId,
    startSaving,
  ]);

  return (
    <section className={hasSelectedFlow ? "space-y-4" : "overflow-hidden"}>
      <Card
        className={`overflow-hidden border border-[rgba(15,23,42,0.1)] bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(255,255,255,0.99)_100%)] p-0 shadow-[0_30px_90px_-54px_rgba(15,23,42,0.3)] ${
          hasSelectedFlow ? "" : "h-[calc(100dvh-12rem)] max-h-[760px]"
        }`}
      >
        <div className={hasWorkflows && !hasSelectedFlow ? "px-5 py-5" : "hidden"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                  <Workflow className="h-4.5 w-4.5" />
                </span>
                <p className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Flujos
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-lg px-4"
                onClick={() => setIsCreatingWorkflow(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Crear
              </Button>
              {hasSelectedFlow ? (
                <Button type="button" size="sm" className="rounded-md" onClick={handleSaveBuilder} disabled={isSaving}>
                  <Save className="h-3.5 w-3.5" />
                  {isSaving ? "Guardando..." : "Guardar"}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {scenarios.map((scenario) => (
              <div
                key={scenario.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`${basePath}/${scenario.id}${routeQuery}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(`${basePath}/${scenario.id}${routeQuery}`);
                  }
                }}
                className={`flex items-center justify-between rounded-2xl border p-3.5 shadow-[0_10px_22px_-18px_rgba(15,23,42,0.2)] transition ${
                  selectedScenarioId === scenario.id
                    ? "border-[color-mix(in_srgb,var(--primary)_26%,white)] bg-[color-mix(in_srgb,var(--primary)_4%,white)]"
                    : "border-slate-200 bg-white hover:border-slate-300"
                } cursor-pointer`}
              >
                <div className="flex min-w-0 items-center gap-3 text-left">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,white)] text-[var(--primary)] ring-1 ring-[color-mix(in_srgb,var(--primary)_28%,white)]">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="truncate text-base font-semibold text-slate-800">{scenario.title}</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">Borrador</span>
                </div>
                <div className="relative ml-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-md"
                    aria-label="Opciones del workflow"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMenuScenarioId((current) => (current === scenario.id ? "" : scenario.id));
                    }}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                  {openMenuScenarioId === scenario.id ? (
                    <div className="absolute right-0 top-11 z-20 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_22px_48px_-30px_rgba(15,23,42,0.35)]">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openQuickResponsesModal(scenario.id);
                          return;
                        }}
                        className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                      >
                        <MessageSquarePlus className="h-4 w-4" />
                        Respuestas rápidas
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteRequest(scenario);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={hasSelectedFlow || !hasWorkflows ? "grid min-h-[76vh]" : "hidden"}>
          <aside className="hidden">
            <div className="space-y-5 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Bloques</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={isBlockLibraryOpen ? "Cerrar bloques" : "Abrir bloques"}
                  aria-expanded={isBlockLibraryOpen}
                  onClick={() => {
                    setIsBlockLibraryOpen((current) => {
                      const next = !current;
                      if (next) {
                        setBlockLibrarySection("root");
                      }
                      return next;
                    });
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {isBlockLibraryOpen ? (
                <div className="grid gap-3">
                  {[
                    {
                      id: "send",
                      title: "Enviar",
                      description: "Texto, imagen o audio.",
                      icon: MessageSquarePlus,
                      style: "bg-sky-50 text-sky-700 ring-sky-200",
                    },
                    ...blockLibrary,
                  ].map((block) => {
                    const Icon = block.icon;
                    return (
                      <button
                        key={block.id}
                        type="button"
                        onClick={() => {
                          if (block.id === "send") {
                            setBlockLibrarySection("send");
                            return;
                          }
                          addBlock(block.id as BuilderNode["kind"]);
                        }}
                        className="rounded-[24px] border border-slate-200 bg-white p-4 text-left shadow-[0_14px_34px_-28px_rgba(15,23,42,0.24)] transition hover:border-slate-300"
                      >
                        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl ring-1 ${block.style}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <p className="mt-3 text-sm font-semibold text-slate-900">{block.title}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{block.description}</p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[22px] border border-dashed border-slate-300 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-500">
                  Haz clic en <span className="font-semibold text-slate-700">+</span> para abrir la libreria de bloques.
                </div>
              )}

              <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <Clock3 className="h-4 w-4" />
                  Regla oficial
                </div>
                <p className="mt-2 text-sm leading-6 text-amber-900/80">
                  Fuera de la ventana de 24 horas usa plantillas y manten la salida a asesor.
                </p>
              </div>
            </div>
          </aside>

          <main
            className={`relative overflow-hidden ${
              hasSelectedFlow
                ? "bg-[radial-gradient(circle_at_top,rgba(203,213,225,0.62),transparent_36%),linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]"
                : "bg-white"
            }`}
          >
            <div
              className={`relative ${
                hasSelectedFlow
                  ? "h-[76vh] overflow-hidden"
                  : "grid min-h-[calc(100dvh-18rem)] place-items-center overflow-hidden"
              }`}
            >
              {selectedScenario ? (
                <div className="relative h-full w-full overflow-hidden bg-transparent">
                  <div className="pointer-events-none absolute left-4 top-4 z-20 flex items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                      <Route className="h-3.5 w-3.5 text-sky-600" />
                      {selectedScenario?.title ?? "Flujo"}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                      <Bot className="h-3.5 w-3.5 text-violet-600" />
                      {nodes.length} bloques
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                      <Split className="h-3.5 w-3.5 text-blue-600" />
                      {renderEdges.length} conexiones
                    </span>
                  </div>
                  <div className="pointer-events-auto absolute right-4 top-4 z-20">
                    <div className="relative">
                      <Button
                        ref={blockLibraryButtonRef}
                        type="button"
                        variant="default"
                        aria-label={isBlockLibraryOpen ? "Cerrar lista de nodos" : "Agregar nodo"}
                        aria-expanded={isBlockLibraryOpen}
                        onClick={() => {
                          setIsBlockLibraryOpen((current) => {
                            const next = !current;
                            if (next) {
                              setBlockLibrarySection("root");
                            }
                            return next;
                          });
                        }}
                        className="h-11 w-11 rounded-full border border-blue-600 bg-blue-600 p-0 text-white shadow-[0_16px_28px_-20px_rgba(37,99,235,0.7)] hover:bg-blue-700"
                      >
                          <Plus className="h-5 w-5 font-bold" strokeWidth={3.2} />
                        </Button>
                      {isBlockLibraryOpen ? (
                        <div
                          ref={blockLibraryPanelRef}
                          className="absolute right-0 top-11 z-20 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-2 shadow-[0_22px_48px_-30px_rgba(15,23,42,0.35)]"
                        >
                          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {blockLibrarySection === "root" ? "Agregar nodo" : "Enviar"}
                          </p>
                          {blockLibrarySection === "send" ? (
                            <button
                              type="button"
                              onClick={() => setBlockLibrarySection("root")}
                              className="mx-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                              Volver
                            </button>
                          ) : null}
                          <div className="grid gap-1 px-2">
                            {(blockLibrarySection === "root"
                              ? [
                                  {
                                    id: "send",
                                    title: "Enviar",
                                    description: "Texto, imagen o audio.",
                                    icon: MessageSquarePlus,
                                    style: "bg-sky-50 text-sky-700 ring-sky-200",
                                  },
                                  ...blockLibrary,
                                ]
                              : sendBlockLibrary).map((block) => {
                              const Icon = block.icon;
                              return (
                                <button
                                  key={block.id}
                                  type="button"
                                  onClick={() => {
                                    if (block.id === "send") {
                                      setBlockLibrarySection("send");
                                      return;
                                    }
                                    addBlock(block.id as BuilderNode["kind"]);
                                  }}
                                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-slate-50"
                                >
                                  <span className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${block.style}`}>
                                    <Icon className="h-3.5 w-3.5" />
                                  </span>
                                  <span>
                                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
                                      {block.title}
                                      {block.id === "send" ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : null}
                                    </span>
                                    {blockLibrarySection === "root" ? (
                                      <span className="block text-xs leading-5 text-slate-500">{block.description}</span>
                                    ) : null}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <ReactFlowProvider>
                    <ChatbotFlowCanvas
                      scenarioKey={selectedScenario?.id ?? "no-scenario"}
                      nodes={flowNodes}
                      edges={renderEdges}
                      edgeAppearance={edgeAppearance}
                      onNodesChange={handleFlowNodesChange}
                      onConnect={handleConnectNodes}
                      onProximityConnect={handleProximityConnect}
                      onEdgeClick={handleEdgeClick}
                      onNodeOpen={openNodeEditor}
                    />
                  </ReactFlowProvider>
                </div>
              ) : hasWorkflows ? (
                <div className="flex w-full items-center justify-center bg-white px-6 py-8 sm:px-10">
                  <div className="flex w-full max-w-lg flex-col items-center text-center">
                    <div className="flex items-center justify-center">
                      <Inbox className="h-10 w-10 text-[var(--primary)]" />
                    </div>

                    <h4 className="mt-6 font-semibold text-slate-950">
                      Selecciona un flujo para empezar
                    </h4>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      El constructor y el inspector se muestran solo cuando entras a un workflow.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex w-full items-center justify-center bg-white px-6 py-8 sm:px-10">
                  <div className="flex w-full max-w-lg flex-col items-center text-center">
                    <div className="flex items-center justify-center">
                      <Inbox className="h-10 w-10 text-[var(--primary)]" />
                    </div>

                    <h4 className="mt-6 font-semibold text-slate-950">
                      Aun no has creado ningun flujo
                    </h4>

                    <Button
                      type="button"
                      className="mt-6 h-10 rounded-xl  px-5 text-sm  text-white hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)]"
                      onClick={() => setIsCreatingWorkflow(true)}
                    >
                      Crear
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </main>

          <aside className="hidden">
            <div className="space-y-5 p-4">
              <div className="rounded-[26px] border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-900">Inspector del flujo</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Edita el flujo y los nodos seleccionados antes de guardar.
                </p>
              </div>

              {selectedNode ? (
                <>
                  {selectedScenario ? (
                    <div className="space-y-3 rounded-[26px] border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-900">Flujo seleccionado</p>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-slate-900">Nombre del flujo</span>
                        <Input
                          value={selectedScenario.title}
                          onChange={(event) => updateSelectedWorkflow({ title: event.target.value })}
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-slate-900">Resumen del flujo</span>
                        <textarea
                          value={selectedScenario.summary}
                          onChange={(event) => updateSelectedWorkflow({ summary: event.target.value })}
                          className="field-textarea min-h-24"
                        />
                      </label>
                    </div>
                  ) : null}

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-900">Titulo del nodo</span>
                    <Input
                      value={selectedNode.title}
                      onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })}
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-900">Contenido</span>
                    <textarea
                      value={selectedNode.body}
                      onChange={(event) => updateNode(selectedNode.id, { body: event.target.value })}
                      className="field-textarea min-h-28"
                      placeholder="Contenido del nodo"
                    />
                  </label>

                  {selectedNode.kind === "condition" ? (
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900">Meta / keywords</span>
                      <Input
                        value={selectedNode.meta}
                        onChange={(event) => updateNode(selectedNode.id, { meta: event.target.value })}
                      />
                    </label>
                  ) : null}
                </>
              ) : selectedScenario ? (
                <div className="rounded-[26px] border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm leading-6 text-slate-600">
                  Abre la libreria de bloques con el boton <span className="font-semibold text-slate-900">+</span> para empezar a construir este flujo.
                </div>
              ) : (
                <div className="rounded-[26px] border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm leading-6 text-slate-600">
                  Crea tu primer flujo para desbloquear el lienzo y empezar a agregar nodos.
                </div>
              )}

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-900">Horario del flujo</span>
                <Input value={businessHours} onChange={(event) => setBusinessHours(event.target.value)} />
              </label>

              <div className="grid gap-3">
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-900">Captura de lead</span>
                    <Switch checked={captureLeadEnabled} onCheckedChange={setCaptureLeadEnabled} aria-label="Captura de lead" />
                  </div>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-900">Transferencia humana</span>
                    <Switch checked={handoffEnabled} onCheckedChange={setHandoffEnabled} aria-label="Transferencia humana" />
                  </div>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-900">Fallback seguro</span>
                    <Switch checked={fallbackEnabled} onCheckedChange={setFallbackEnabled} aria-label="Fallback seguro" />
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-[26px] border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-sky-600" />
                  <p className="text-sm font-semibold text-slate-900">Plantillas</p>
                </div>
                {data.templates.slice(0, 2).map((template) => (
                  <div key={template.id} className="rounded-[20px] border border-slate-200 bg-slate-50/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{template.title}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{template.message}</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => handleCopyTemplate(template.id, template.message)}>
                        <Copy className="h-3.5 w-3.5" />
                        {copiedTemplateId === template.id ? "Copiado" : "Copiar"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-3 rounded-[26px] border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-900">Metricas del bot</p>
                {data.metrics.slice(0, 3).map((metric) => (
                  <div key={metric.id} className="rounded-[20px] border border-white bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{metric.label}</p>
                    <p className="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-950">{metric.value}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{metric.helper}</p>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
        {isCreatingWorkflow ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/20 p-6 backdrop-blur-[2px]">
            <div className="w-full max-w-md overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_30px_80px_-48px_rgba(15,23,42,0.32)]">
              <div className="relative border-b border-slate-200 px-6 py-7 text-center">
                <button
                  type="button"
                  onClick={() => setIsCreatingWorkflow(false)}
                  className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar modal"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)]">
                  <Inbox className="h-6 w-6 text-[var(--primary)]" />
                </div>
                <p className="mt-4 text-xl font-semibold text-slate-950">Crear flujo</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">Empieza creando el nombre de tu flujo.</p>
              </div>

              <div className="space-y-5 px-6 py-6">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-900">Nombre del flujo</span>
                  <Input
                    value={newWorkflowTitle}
                    onChange={(event) => setNewWorkflowTitle(event.target.value)}
                    placeholder="Ej. Bienvenida principal"
                  />
                  <p className="text-xs leading-5 text-slate-500">Usa un nombre claro y facil de identificar.</p>
                </label>

                <Button type="button" className="h-11 w-full rounded-xl" onClick={createWorkflow}>
                  Continuar
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {scenarioPendingDelete ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/25 p-6 backdrop-blur-[2px]">
            <div className="w-full max-w-md overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_30px_80px_-48px_rgba(15,23,42,0.32)]">
              <div className="relative border-b border-slate-200 px-6 py-6 text-center">
                <button
                  type="button"
                  onClick={() => setScenarioPendingDelete(null)}
                  className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar modal"
                >
                  <X className="h-4 w-4" />
                </button>
                <p className="text-lg font-semibold text-slate-950">Eliminar flujo</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Esta accion eliminara <span className="font-semibold text-slate-900">{scenarioPendingDelete.title}</span>.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-5">
                <Button type="button" variant="outline" onClick={() => setScenarioPendingDelete(null)}>
                  Cancelar
                </Button>
                <Button type="button" className="bg-rose-600 text-white hover:bg-rose-700" onClick={confirmDeleteWorkflow}>
                  Eliminar
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {isQuickResponsesModalOpen && quickResponsesScenario ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/25 p-6 backdrop-blur-[2px]">
            <div className="w-full max-w-3xl overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_30px_80px_-48px_rgba(15,23,42,0.32)]">
              <div className="relative border-b border-slate-200 px-6 py-5">
                <button
                  type="button"
                  onClick={() => setIsQuickResponsesModalOpen(false)}
                  className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar modal de respuestas rápidas"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                    <MessageSquarePlus className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-lg font-semibold text-slate-950">Respuestas rápidas</p>
                    <p className="text-sm text-slate-500">{quickResponsesScenario.title}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div className="space-y-3">
                  {quickResponses.length > 0 ? (
                    quickResponses.map((response) => {
                      const isSelected = response.id === selectedQuickResponse?.id;
                      const keywords = splitKeywords(response.meta);
                      return (
                        <div
                          key={response.id}
                          onClick={() => {
                            setQuickResponseSelectedId(response.id);
                            setIsQuickResponseKeywordFormOpen(false);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setQuickResponseSelectedId(response.id);
                              setIsQuickResponseKeywordFormOpen(false);
                            }
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition",
                            isSelected
                              ? "border-[color-mix(in_srgb,var(--primary)_28%,white)] bg-[color-mix(in_srgb,var(--primary)_5%,white)]"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap gap-2">
                              {keywords.length > 0 ? (
                                keywords.map((keyword) => (
                                  <div
                                    key={keyword}
                                    className="group inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)] px-3 py-1 text-sm font-semibold text-[var(--primary-strong)]"
                                  >
                                    {keyword}
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        deleteQuickResponseKeyword(response.id, keyword);
                                      }}
                                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--primary-strong)] opacity-0 transition hover:bg-white/70 group-hover:opacity-100 group-focus-within:opacity-100"
                                      aria-label={`Eliminar palabra clave ${keyword}`}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-500">
                                  Sin palabra clave
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                              {isSelected ? "Seleccionada" : "Ver"}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 text-sm leading-6 text-slate-500">
                      Este flujo todavia no tiene respuestas rapidas.
                    </div>
                  )}
                </div>

                <div className="flex justify-start">
                  <Button
                    type="button"
                    className="rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-strong)]"
                    onClick={() => setIsQuickResponseKeywordFormOpen((current) => !current)}
                    disabled={!selectedQuickResponse}
                  >
                    Agregar
                  </Button>
                </div>

                {isQuickResponseKeywordFormOpen ? (
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={quickResponseKeywordDraft}
                      onChange={(event) => setQuickResponseKeywordDraft(event.target.value)}
                      placeholder="Ej. precio, promo, asesor"
                      disabled={!selectedQuickResponse}
                    />
                    <Button type="button" className="rounded-lg" onClick={saveQuickResponseKeyword} disabled={!selectedQuickResponse}>
                      Guardar
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end border-t border-slate-200 px-6 py-4">
                <Button type="button" onClick={() => setIsQuickResponsesModalOpen(false)}>
                  Cerrar
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {isNodeEditorOpen && selectedNode ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/25 p-6 backdrop-blur-[2px]">
            <div className="w-full max-w-2xl overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_30px_80px_-48px_rgba(15,23,42,0.32)]">
              <div className="relative border-b border-slate-200 px-6 py-5">
                <button
                  type="button"
                  onClick={() => setIsNodeEditorOpen(false)}
                  className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar editor del nodo"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                    <Settings2 className="h-4 w-4" />
                  </span>
                  <p className="text-lg font-semibold text-slate-950">Editar nodo</p>
                </div>
              </div>
              <div className="space-y-4 px-6 py-5">
                {selectedNode.kind === "trigger" ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Modo de respuesta</p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          Define si el flujo responde solo una vez al iniciar o en cada mensaje entrante.
                        </p>
                      </div>
                      <Switch
                        checked={replyEveryMessageEnabled}
                        onCheckedChange={setReplyEveryMessageEnabled}
                        aria-label="Repetir respuesta en cada mensaje"
                      />
                    </div>
                    <p className="mt-3 text-xs font-medium text-slate-700">
                      {replyEveryMessageEnabled ? "Repetir: responde en cada mensaje." : "Unico: responde solo al primer mensaje."}
                    </p>
                  </div>
                ) : selectedNode.kind === "image" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900">URL de imagen</span>
                      <Input
                        value={selectedNode.meta}
                        onChange={(event) => updateNode(selectedNode.id, { meta: event.target.value })}
                        placeholder="https://..."
                      />
                      {hasInvalidImageUrl ? (
                        <p className="text-xs text-amber-600">
                          Usa una URL directa de imagen (`.jpg`, `.png`, `.webp`, etc.) para evitar fallos al enviar.
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Debe ser enlace directo de imagen publica.
                        </p>
                      )}
                    </label>
                    <div className="space-y-2">
                      <Input
                        ref={nodeImageInputRef}
                        type="file"
                        accept={selectedUploadNodeKind ? getUploadAcceptByKind(selectedUploadNodeKind) : "image/*"}
                        className="hidden"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] ?? null;
                          void handleNodeImageFileSelected(file);
                          event.currentTarget.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="inline-flex items-center gap-2"
                        disabled={isUploadingNodeImage}
                        onClick={() => nodeImageInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        {isUploadingNodeImage ? "Subiendo..." : "Subir imagen"}
                      </Button>
                      {nodeImageUploadError ? (
                        <p className="text-xs text-rose-600">{nodeImageUploadError}</p>
                      ) : null}
                    </div>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900">Texto (opcional)</span>
                      <textarea
                        value={selectedNode.body}
                        onChange={(event) => updateNode(selectedNode.id, { body: event.target.value })}
                        className="field-textarea min-h-28"
                        placeholder="Si lo dejas vacio, la imagen se envia sin texto."
                      />
                    </label>
                  </>
                ) : selectedNode.kind === "audio" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900">URL de audio</span>
                      <Input
                        value={selectedNode.meta}
                        onChange={(event) => updateNode(selectedNode.id, { meta: event.target.value })}
                        placeholder="https://.../audio.ogg"
                      />
                    </label>
                    <div className="space-y-2">
                      <Input
                        ref={nodeImageInputRef}
                        type="file"
                        accept={selectedUploadNodeKind ? getUploadAcceptByKind(selectedUploadNodeKind) : "audio/*"}
                        className="hidden"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] ?? null;
                          void handleNodeImageFileSelected(file);
                          event.currentTarget.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="inline-flex items-center gap-2"
                        disabled={isUploadingNodeImage}
                        onClick={() => nodeImageInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        {isUploadingNodeImage ? "Subiendo..." : "Subir audio"}
                      </Button>
                      {nodeImageUploadError ? (
                        <p className="text-xs text-rose-600">{nodeImageUploadError}</p>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">Usa una URL publica directa del archivo de audio.</p>
                  </>
                ) : selectedNode.kind === "video" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900">URL de video</span>
                      <Input
                        value={selectedNode.meta}
                        onChange={(event) => updateNode(selectedNode.id, { meta: event.target.value })}
                        placeholder="https://.../video.mp4"
                      />
                    </label>
                    <div className="space-y-2">
                      <Input
                        ref={nodeImageInputRef}
                        type="file"
                        accept={selectedUploadNodeKind ? getUploadAcceptByKind(selectedUploadNodeKind) : "video/*"}
                        className="hidden"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] ?? null;
                          void handleNodeImageFileSelected(file);
                          event.currentTarget.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="inline-flex items-center gap-2"
                        disabled={isUploadingNodeImage}
                        onClick={() => nodeImageInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        {isUploadingNodeImage ? "Subiendo..." : "Subir video"}
                      </Button>
                      {nodeImageUploadError ? (
                        <p className="text-xs text-rose-600">{nodeImageUploadError}</p>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">Usa una URL publica directa del video.</p>
                  </>
                ) : selectedNode.kind === "document" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900">URL de documento</span>
                      <Input
                        value={selectedNode.meta}
                        onChange={(event) => updateNode(selectedNode.id, { meta: event.target.value })}
                        placeholder="https://.../archivo.pdf"
                      />
                    </label>
                    <div className="space-y-2">
                      <Input
                        ref={nodeImageInputRef}
                        type="file"
                        accept={selectedUploadNodeKind ? getUploadAcceptByKind(selectedUploadNodeKind) : ".pdf,.doc,.docx,.txt"}
                        className="hidden"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] ?? null;
                          void handleNodeImageFileSelected(file);
                          event.currentTarget.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="inline-flex items-center gap-2"
                        disabled={isUploadingNodeImage}
                        onClick={() => nodeImageInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        {isUploadingNodeImage ? "Subiendo..." : "Subir documento"}
                      </Button>
                      {nodeImageUploadError ? (
                        <p className="text-xs text-rose-600">{nodeImageUploadError}</p>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">Usa una URL publica directa (PDF recomendado).</p>
                  </>
                ) : (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-900">Contenido</span>
                    <textarea
                      value={selectedNode.body}
                      onChange={(event) => updateNode(selectedNode.id, { body: event.target.value })}
                      className="field-textarea min-h-32"
                      placeholder="Contenido del nodo"
                    />
                  </label>
                )}
                {selectedNode.kind === "condition" ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-900">Meta / keywords</span>
                    <Input
                      value={selectedNode.meta}
                      onChange={(event) => updateNode(selectedNode.id, { meta: event.target.value })}
                    />
                  </label>
                ) : null}
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
                {selectedNode.kind !== "trigger" ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                      onClick={() => handleDeleteOutgoingConnection(selectedNode.id)}
                    >
                      Quitar conexion
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                      onClick={() => handleDeleteNode(selectedNode.id)}
                    >
                      Eliminar nodo
                    </Button>
                  </div>
                ) : (
                  <div />
                )}
                <Button type="button" onClick={() => setIsNodeEditorOpen(false)}>
                  Cerrar
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
