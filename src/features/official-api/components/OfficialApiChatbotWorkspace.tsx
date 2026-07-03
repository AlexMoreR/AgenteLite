"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from "react";
import {
  BrainCircuit,
  Bot,
  Route,
  X,
  Clock3,
  Copy,
  Image as ImageIcon,
  AudioLines,
  Video,
  File,
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
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MarkerType,
  NodeToolbar,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  ReactFlow,
} from "@xyflow/react";
import { useSetBreadcrumbLabel } from "@/components/breadcrumb-label-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  BaseNode,
  BaseNodeContent,
  BaseNodeHeader,
  BaseNodeHeaderTitle,
} from "@/components/reactflow/base-node";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import {
  normalizeBuilderEdgesForSave,
  normalizeBuilderNodePositionsForSave,
  normalizeBuilderNodesForSave,
  normalizeBuilderScenariosForSave,
} from "@/features/official-api/services/normalizeBuilderStateForSave";
import type {
  OfficialApiChatbotBuilderNode,
  OfficialApiChatbotData,
  OfficialApiChatbotNodesByScenarioId,
  OfficialApiChatbotScenarioFlowType,
  OfficialApiChatbotScenarioMatchType,
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
  onDelete?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  onUpload?: (nodeId: string, file: File | null) => Promise<void> | void;
  onClearFile?: (nodeId: string) => void;
  onChangeBody?: (nodeId: string, value: string) => void;
  replyEveryMessage?: boolean;
  aiFollowUp?: boolean;
  onToggleReplyEveryMessage?: (value: boolean) => void;
  onToggleAiFollowUp?: (value: boolean) => void;
  onOpenQuickResponses?: () => void;
};
type EdgeAppearance = {
  stroke: string;
  strokeWidth: number;
  markerColor: string;
  curvature: number;
};

const workflowTypeOptions: Array<{
  value: OfficialApiChatbotScenarioFlowType;
  title: string;
  description: string;
  icon: typeof Bot;
  accentClassName: string;
}> = [
  {
    value: "ia",
    title: "🧠 IA",
    description: "Detecta intenciones",
    icon: BrainCircuit,
    accentClassName: "border-blue-200 bg-blue-50 text-blue-700 ring-blue-200",
  },
  {
    value: "chatbot",
    title: "🤖 CHATBOT",
    description: "Por palabras clave",
    icon: Bot,
    accentClassName: "border-emerald-200 bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
];

function getWorkflowTypeLabel(flowType?: OfficialApiChatbotScenarioFlowType | null) {
  return flowType === "chatbot" ? "CHATBOT" : "IA";
}

const MEDIA_NODE_KINDS = ["image", "audio", "video", "document"] as const;

function isMediaNodeKind(kind: BuilderNode["kind"]): kind is "image" | "audio" | "video" | "document" {
  return (MEDIA_NODE_KINDS as readonly string[]).includes(kind);
}

function getMediaKindLabel(kind: BuilderNode["kind"]) {
  if (kind === "image") return "Imagen";
  if (kind === "document") return "Documento";
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  return "Archivo";
}

function getFileNameFromUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  let last = "";
  try {
    const path = new URL(trimmed).pathname;
    last = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
  } catch {
    last = trimmed.split(/[\\/?#]/).filter(Boolean).pop() ?? "";
  }
  // Quita el prefijo numerico que agrega la subida (ej. "1781135420296-archivo.pdf").
  return last.replace(/^\d{6,}-/, "");
}

function ChatbotFlowNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const isMedia = isMediaNodeKind(data.kind);
  const canDelete = data.kind !== "trigger";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const isEditingBodyRef = useRef(false);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [bodyDraft, setBodyDraft] = useState(data.body);
  useEffect(() => {
    if (!isEditingBodyRef.current) {
      setBodyDraft(data.body);
    }
  }, [data.body]);
  useEffect(() => {
    const el = bodyTextareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [bodyDraft]);
  const [replyOnce, setReplyOnce] = useState(!data.replyEveryMessage);
  const [aiFollowUp, setAiFollowUp] = useState(data.aiFollowUp ?? true);
  const mediaUrl = isMedia ? data.meta.trim() : "";
  const mediaFileName = mediaUrl ? getFileNameFromUrl(mediaUrl) : "";
  const mediaCaption = isMedia ? data.body.trim() : "";
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
      {canDelete ? (
        <NodeToolbar isVisible={selected} position={Position.Top} align="end" offset={8}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onDuplicate?.(id);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
              aria-label="Duplicar nodo"
              title="Duplicar nodo"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onDelete?.(id);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
              aria-label="Eliminar nodo"
              title="Eliminar nodo"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </NodeToolbar>
      ) : null}
      {data.kind === "trigger" ? null : (
        <Handle
          id="target"
          type="target"
          position={Position.Left}
          className="!h-4 !w-4 !border-2 !border-white !bg-sky-600"
        />
      )}
      <BaseNode
        className={cn(
          "w-[330px] transition-shadow",
          selected ? "border-blue-400 shadow-lg" : "",
        )}
      >
        <BaseNodeHeader className="items-center justify-start gap-2.5">
          <span className="inline-flex shrink-0 items-center justify-center">
            {headerIcon}
          </span>
          <BaseNodeHeaderTitle className="truncate">
            {isMedia ? getMediaKindLabel(data.kind) : data.title}
          </BaseNodeHeaderTitle>
        </BaseNodeHeader>
        <BaseNodeContent>
          {data.kind === "trigger" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <div
                  className="nodrag flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="text-sm text-foreground">Responder una sola vez</span>
                  <Switch
                    checked={replyOnce}
                    onCheckedChange={(checked) => {
                      setReplyOnce(checked);
                      data.onToggleReplyEveryMessage?.(!checked);
                    }}
                    aria-label="Responder una sola vez"
                  />
                </div>
                <div
                  className="nodrag flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="text-sm text-foreground">Responder final con IA</span>
                  <Switch
                    checked={aiFollowUp}
                    onCheckedChange={(checked) => {
                      setAiFollowUp(checked);
                      data.onToggleAiFollowUp?.(checked);
                    }}
                    aria-label="Responder final con IA"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  data.onOpenQuickResponses?.();
                }}
                className="nodrag flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm font-medium text-foreground transition hover:bg-muted"
              >
                <MessageSquarePlus className="h-4 w-4 text-sky-600" />
                Respuestas rápidas
              </button>
            </div>
          ) : data.kind === "image" && imageUrl ? (
            <div className="space-y-2">
              <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
                <img
                  src={imageUrl}
                  alt="Vista previa de imagen del nodo"
                  className="mx-auto block h-auto max-h-[260px] w-auto max-w-full object-contain"
                />
                {selected ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      data.onClearFile?.(id);
                    }}
                    className="nodrag absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white shadow-sm transition hover:bg-black/75"
                    aria-label="Quitar imagen"
                    title="Quitar imagen"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              {imageCaption ? (
                <p className="line-clamp-3 whitespace-pre-line text-sm leading-5 text-foreground">{imageCaption}</p>
              ) : null}
            </div>
          ) : isMedia ? (
            <div className="space-y-2">
              {mediaUrl ? (
                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted px-2.5 py-1.5">
                  {data.kind === "document" ? (
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-600 text-xs font-bold tracking-tight text-white shadow-sm">
                      {(mediaFileName.includes(".") ? mediaFileName.split(".").pop()! : "PDF").slice(0, 4).toUpperCase()}
                    </span>
                  ) : (
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card shadow-sm">
                      {headerIcon}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {mediaFileName || `${getMediaKindLabel(data.kind)} adjunto`}
                    </p>
                    <p className="text-xs text-muted-foreground">{getMediaKindLabel(data.kind)}</p>
                  </div>
                  {selected ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        data.onClearFile?.(id);
                      }}
                      className="nodrag inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-card hover:text-foreground"
                      aria-label="Quitar archivo"
                      title="Quitar archivo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={(event) => {
                    event.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="nodrag flex w-full items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 text-left transition hover:border-violet-400 hover:bg-violet-50/60 disabled:cursor-not-allowed disabled:opacity-70 dark:hover:bg-violet-950/30"
                >
                  <Upload className="h-5 w-5 shrink-0 text-violet-600" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {isUploading ? "Subiendo..." : `Cargar ${getMediaKindLabel(data.kind).toLowerCase()}`}
                    </span>
                    <span className="block text-xs text-muted-foreground">Haz clic para subir el archivo</span>
                  </span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={isUploadableNodeKind(data.kind) ? getUploadAcceptByKind(data.kind) : undefined}
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  if (!file) {
                    return;
                  }
                  setIsUploading(true);
                  void Promise.resolve(data.onUpload?.(id, file)).finally(() => setIsUploading(false));
                }}
              />
              {mediaCaption ? (
                <p className="line-clamp-3 whitespace-pre-line text-sm leading-5 text-foreground">{mediaCaption}</p>
              ) : null}
            </div>
          ) : data.kind === "message" ? (
            <textarea
              ref={bodyTextareaRef}
              value={bodyDraft}
              rows={3}
              onFocus={() => {
                isEditingBodyRef.current = true;
              }}
              onBlur={() => {
                isEditingBodyRef.current = false;
              }}
              onChange={(event) => {
                const value = event.target.value;
                setBodyDraft(value);
                data.onChangeBody?.(id, value);
              }}
              onClick={(event) => event.stopPropagation()}
              placeholder="Escribe aqui la respuesta del bot."
              className="nodrag nowheel block min-h-16 w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-950"
            />
          ) : (
            <p className="line-clamp-4 whitespace-pre-line text-sm leading-5 text-foreground">{preview}</p>
          )}
        </BaseNodeContent>
      </BaseNode>
      <Handle
        id="source"
        type="source"
        position={Position.Right}
        className="!h-4 !w-4 !border-2 !border-white !bg-blue-600"
      />
    </>
  );
}

const nodeTypes = { chatbotNode: ChatbotFlowNode };

type FlowEdgeData = {
  onDelete?: (edgeId: string) => void;
};

function ChatbotFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 14,
  });
  const edgeData = data as FlowEdgeData | undefined;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            edgeData?.onDelete?.(id);
          }}
          className="nodrag nopan inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-300 bg-card text-blue-600 opacity-80 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 hover:opacity-100 dark:border-blue-800 dark:hover:bg-blue-950/40"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          aria-label="Eliminar conexion"
          title="Eliminar conexion"
        >
          <X className="h-3 w-3" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { chatbotEdge: ChatbotFlowEdge };

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
  const hasOutgoing = (sourceId: string) => edges.some((edge) => edge.source === sourceId);
  const hasIncoming = (targetId: string) => edges.some((edge) => edge.target === targetId);

  let bestConnection: { sourceId: string; targetId: string } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    if (node.id === draggingNodeId) {
      continue;
    }

    const shouldFlowFromLeftToRight = draggingPosition.x > node.position.x;
    const sourceId = shouldFlowFromLeftToRight ? node.id : draggingNodeId;
    const targetId = shouldFlowFromLeftToRight ? draggingNodeId : node.id;

    // Solo sugerimos la conexion si ambos extremos estan libres: el origen sin salida
    // y el destino sin entrada. Asi no aparece el preview cuando el nodo ya esta conectado.
    if (hasOutgoing(sourceId) || hasIncoming(targetId)) {
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
      edgeTypes={edgeTypes}
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
          type: "smoothstep",
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
        // Los nodos de medios (imagen, audio, video, documento) y el de mensaje se gestionan
        // desde el propio nodo, sin abrir el modal. Los demas tipos lo abren.
        const nodeKind = (node.data as FlowNodeData | undefined)?.kind;
        if (nodeKind && (isMediaNodeKind(nodeKind) || nodeKind === "message")) {
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
  const [newWorkflowIntent, setNewWorkflowIntent] = useState("");
  const [newWorkflowType, setNewWorkflowType] = useState<OfficialApiChatbotScenarioFlowType | "">("");
  const [newWorkflowMatchType, setNewWorkflowMatchType] = useState<"exacta" | "contiene">("exacta");
  const [newWorkflowKeywords, setNewWorkflowKeywords] = useState<string[]>([]);
  const [newWorkflowKeywordDraft, setNewWorkflowKeywordDraft] = useState("");
  const [isEditingWorkflowIntent, setIsEditingWorkflowIntent] = useState(false);
  const [editingWorkflowIntentDraft, setEditingWorkflowIntentDraft] = useState("");
  const [editingWorkflowIntentScenarioId, setEditingWorkflowIntentScenarioId] = useState("");
  const [editingWorkflowType, setEditingWorkflowType] = useState<OfficialApiChatbotScenarioFlowType | "">("");
  const [editingWorkflowMatchType, setEditingWorkflowMatchType] = useState<OfficialApiChatbotScenarioMatchType>("exacta");
  const [editingWorkflowKeywords, setEditingWorkflowKeywords] = useState<string[]>([]);
  const [editingWorkflowKeywordDraft, setEditingWorkflowKeywordDraft] = useState("");
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

  function openCreateWorkflowModal() {
    setNewWorkflowTitle("");
    setNewWorkflowIntent("");
    setNewWorkflowType("");
    setNewWorkflowMatchType("exacta");
    setNewWorkflowKeywords([]);
    setNewWorkflowKeywordDraft("");
    setIsCreatingWorkflow(true);
  }

  function closeCreateWorkflowModal() {
    setIsCreatingWorkflow(false);
    setNewWorkflowTitle("");
    setNewWorkflowIntent("");
    setNewWorkflowType("");
    setNewWorkflowMatchType("exacta");
    setNewWorkflowKeywords([]);
    setNewWorkflowKeywordDraft("");
  }

  function openEditWorkflowIntentModal(scenario: OfficialApiChatbotScenario) {
    setOpenMenuScenarioId("");
    setEditingWorkflowIntentScenarioId(scenario.id);
    setEditingWorkflowIntentDraft(scenario.intent || "");
    setEditingWorkflowType(scenario.flowType ?? "ia");
    setEditingWorkflowMatchType(scenario.matchType ?? "exacta");
    setEditingWorkflowKeywords(Array.isArray(scenario.keywords) ? scenario.keywords.slice(0, 20) : []);
    setEditingWorkflowKeywordDraft("");
    setIsEditingWorkflowIntent(true);
  }

  function addWorkflowKeyword(rawValue: string) {
    const keyword = rawValue.trim();
    if (!keyword) {
      return;
    }

    setNewWorkflowKeywords((current) => {
      if (current.length >= 20 || current.some((existing) => existing.toLowerCase() === keyword.toLowerCase())) {
        return current;
      }

      return [...current, keyword];
    });
    setNewWorkflowKeywordDraft("");
  }

  function removeWorkflowKeyword(keywordToRemove: string) {
    setNewWorkflowKeywords((current) => current.filter((keyword) => keyword !== keywordToRemove));
  }

  function addEditingWorkflowKeyword(rawValue: string) {
    const keyword = rawValue.trim();
    if (!keyword) {
      return;
    }

    setEditingWorkflowKeywords((current) => {
      if (current.length >= 20 || current.some((existing) => existing.toLowerCase() === keyword.toLowerCase())) {
        return current;
      }

      return [...current, keyword];
    });
    setEditingWorkflowKeywordDraft("");
  }

  function removeEditingWorkflowKeyword(keywordToRemove: string) {
    setEditingWorkflowKeywords((current) => current.filter((keyword) => keyword !== keywordToRemove));
  }

  function closeEditWorkflowIntentModal() {
    setIsEditingWorkflowIntent(false);
    setEditingWorkflowIntentScenarioId("");
    setEditingWorkflowIntentDraft("");
    setEditingWorkflowType("");
    setEditingWorkflowMatchType("exacta");
    setEditingWorkflowKeywords([]);
    setEditingWorkflowKeywordDraft("");
  }

  function saveWorkflowIntent() {
    const scenarioId = editingWorkflowIntentScenarioId.trim();
    const intent =
      editingWorkflowType === "chatbot"
        ? editingWorkflowKeywords.length > 0
          ? `Palabras clave: ${editingWorkflowKeywords.join(", ")}`
          : "Flujo de chatbot por palabras clave."
        : editingWorkflowIntentDraft.trim();
    if (!scenarioId) {
      closeEditWorkflowIntentModal();
      return;
    }

    if (!editingWorkflowType || (editingWorkflowType === "ia" && !intent)) {
      toast.error("Completa la intención", {
        description: "Selecciona un tipo y completa la información antes de guardarla.",
      });
      return;
    }

    const nextScenarios = scenarios.map((scenario) =>
      scenario.id === scenarioId
        ? {
            ...scenario,
            intent: intent || "Intención personalizada creada desde el builder.",
            flowType: editingWorkflowType || "ia",
            matchType: editingWorkflowType === "chatbot" ? editingWorkflowMatchType : undefined,
            keywords: editingWorkflowType === "chatbot" ? editingWorkflowKeywords : [],
          }
        : scenario,
    );

    setScenarios(nextScenarios);
    closeEditWorkflowIntentModal();

    startSaving(async () => {
      try {
        await persistBuilderState({
          selectedScenarioId,
          scenarios: nextScenarios,
          nodesByScenarioId,
          nodePositionsByScenarioId,
          edgesByScenarioId,
          successMessage: "Intención actualizada",
        });
        lastAutoSavedSnapshotRef.current = buildAutoSaveSnapshot({
          selectedScenarioId,
          scenarios: nextScenarios,
          nodesByScenarioId,
          nodePositionsByScenarioId,
          edgesByScenarioId,
          businessHours,
          captureLeadEnabled,
          handoffEnabled,
          fallbackEnabled,
          replyEveryMessageEnabled,
        });
      } catch {
        toast.error("No se pudo guardar", {
          description: "Ocurrio un error al guardar la intención del flujo.",
        });
      }
    });
  }

  function buildAutoSaveSnapshot(input: {
    selectedScenarioId: string;
    scenarios: OfficialApiChatbotScenario[];
    nodesByScenarioId: OfficialApiChatbotNodesByScenarioId;
    nodePositionsByScenarioId: NodePositionsByScenarioId;
    edgesByScenarioId: EdgesByScenarioId;
    businessHours: string;
    captureLeadEnabled: boolean;
    handoffEnabled: boolean;
    fallbackEnabled: boolean;
    replyEveryMessageEnabled: boolean;
  }) {
    return JSON.stringify(input);
  }

  const hasWorkflows = scenarios.length > 0;
  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId);
  const quickResponsesScenario = scenarios.find((scenario) => scenario.id === quickResponsesScenarioId) ?? null;
  const hasSelectedFlow = Boolean(selectedScenario);
  // Muestra el nombre real del flujo en el breadcrumb del header (en vez del id de la URL).
  useSetBreadcrumbLabel(selectedScenario?.title);
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
  const deleteEdgeById = useCallback((edgeId: string) => {
    if (!selectedScenario) {
      return;
    }

    setEdgesByScenarioId((current) => {
      const currentEdges = current[selectedScenario.id] ?? buildSequentialEdges(nodes);
      return {
        ...current,
        [selectedScenario.id]: currentEdges.filter((currentEdge) => currentEdge.id !== edgeId),
      };
    });
  }, [nodes, selectedScenario]);
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
          onDelete: handleDeleteNode,
          onDuplicate: handleDuplicateNode,
          onUpload: handleNodeFileUpload,
          onClearFile: handleClearNodeFile,
          onChangeBody: handleChangeNodeBody,
          replyEveryMessage: replyEveryMessageEnabled,
          aiFollowUp: node.aiFollowUpEnabled !== false,
          onToggleReplyEveryMessage: setReplyEveryMessageEnabled,
          onToggleAiFollowUp: (value: boolean) => updateNode(node.id, { aiFollowUpEnabled: value }),
          onOpenQuickResponses: () => openQuickResponsesModal(selectedScenario?.id ?? ""),
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        type: "chatbotEdge",
        animated: false,
        pathOptions: { curvature: 0.35 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(37,99,235,0.95)" },
        style: { stroke: "rgba(37,99,235,0.82)", strokeWidth: 2.1, strokeLinecap: "round" },
        data: { onDelete: deleteEdgeById },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!newWorkflowType) {
      toast.error("Selecciona el tipo", {
        description: "Haz clic en IA o CHATBOT para mostrar sus campos.",
      });
      return;
    }

    const intent =
      newWorkflowType === "chatbot"
        ? newWorkflowKeywords.length > 0
          ? `Palabras clave: ${newWorkflowKeywords.join(", ")}`
          : "Flujo de chatbot por palabras clave."
        : newWorkflowIntent.trim();
    if (!title) {
      toast.error("Completa el flujo", {
        description: "Agrega el nombre antes de crear el flujo.",
      });
      return;
    }

    const nextScenario: OfficialApiChatbotScenario = {
      id: createWorkflowId(),
      title,
      intent: intent || "Intención personalizada creada desde el builder.",
      flowType: newWorkflowType,
      matchType: newWorkflowType === "chatbot" ? newWorkflowMatchType : undefined,
      keywords: newWorkflowType === "chatbot" ? newWorkflowKeywords : [],
      messages: [],
    };

    setScenarios((current) => [...current, nextScenario]);
    setSelectedScenarioId(nextScenario.id);
    closeCreateWorkflowModal();
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

  function updateSelectedWorkflow(patch: Partial<Pick<OfficialApiChatbotScenario, "title" | "intent">>) {
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
    const normalizedNodesByScenarioId = normalizeBuilderNodesForSave(input.nodesByScenarioId);
    const normalizedScenarios = normalizeBuilderScenariosForSave(input.scenarios);
    const normalizedNodePositionsByScenarioId = normalizeBuilderNodePositionsForSave(input.nodePositionsByScenarioId);
    const normalizedEdgesByScenarioId = normalizeBuilderEdgesForSave(normalizedNodesByScenarioId, input.edgesByScenarioId);
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
        scenarios: normalizedScenarios,
        nodesByScenarioId: normalizedNodesByScenarioId,
        nodePositionsByScenarioId: normalizedNodePositionsByScenarioId,
        edgesByScenarioId: normalizedEdgesByScenarioId,
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
    const nextNodesByScenarioId = {
      ...nodesByScenarioId,
      [quickResponsesScenario.id]: (nodesByScenarioId[quickResponsesScenario.id] ?? []).map((node) =>
        node.id === selectedQuickResponse.id ? { ...node, meta: nextMeta } : node,
      ),
    };

    setNodesByScenarioId(nextNodesByScenarioId);
    setQuickResponseKeywordDraft("");
    setIsQuickResponseKeywordFormOpen(false);
    toast.success("Palabra clave agregada");

    void persistBuilderState({
      selectedScenarioId,
      scenarios,
      nodesByScenarioId: nextNodesByScenarioId,
      nodePositionsByScenarioId,
      edgesByScenarioId,
    }).then(() => {
      lastAutoSavedSnapshotRef.current = buildAutoSaveSnapshot({
        selectedScenarioId,
        scenarios,
        nodesByScenarioId: nextNodesByScenarioId,
        nodePositionsByScenarioId,
        edgesByScenarioId,
        businessHours,
        captureLeadEnabled,
        handoffEnabled,
        fallbackEnabled,
        replyEveryMessageEnabled,
      });
    }).catch(() => {
      toast.error("No se pudo guardar la palabra clave", {
        description: "Revisa tu conexion e intenta nuevamente.",
      });
    });
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

    const nextNodesByScenarioId = {
      ...nodesByScenarioId,
      [quickResponsesScenario.id]: (nodesByScenarioId[quickResponsesScenario.id] ?? []).map((node) =>
        node.id === responseId ? { ...node, meta: nextMeta } : node,
      ),
    };

    setNodesByScenarioId(nextNodesByScenarioId);
    setIsQuickResponseKeywordFormOpen(false);
    setQuickResponseKeywordDraft("");
    toast.success("Palabra clave eliminada");

    void persistBuilderState({
      selectedScenarioId,
      scenarios,
      nodesByScenarioId: nextNodesByScenarioId,
      nodePositionsByScenarioId,
      edgesByScenarioId,
    }).then(() => {
      lastAutoSavedSnapshotRef.current = buildAutoSaveSnapshot({
        selectedScenarioId,
        scenarios,
        nodesByScenarioId: nextNodesByScenarioId,
        nodePositionsByScenarioId,
        edgesByScenarioId,
        businessHours,
        captureLeadEnabled,
        handoffEnabled,
        fallbackEnabled,
        replyEveryMessageEnabled,
      });
    }).catch(() => {
      toast.error("No se pudo guardar la palabra clave", {
        description: "Revisa tu conexion e intenta nuevamente.",
      });
    });
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
    deleteEdgeById(edge.id);
  }, [deleteEdgeById]);

  function handleDeleteNode(nodeId: string) {
    if (!selectedScenario) {
      return;
    }

    const currentNodes = nodesByScenarioId[selectedScenario.id] ?? [];
    const removedNode = currentNodes.find((node) => node.id === nodeId);
    if (removedNode?.kind === "trigger") {
      return;
    }
    if (
      removedNode &&
      isMediaNodeKind(removedNode.kind) &&
      removedNode.meta &&
      !isMediaUrlReferencedByOthers(removedNode.meta, nodeId)
    ) {
      void deleteUploadedMedia(removedNode.meta);
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

  function handleDuplicateNode(nodeId: string) {
    if (!selectedScenario) {
      return;
    }

    const currentNodes = nodesByScenarioId[selectedScenario.id] ?? [];
    const sourceIndex = currentNodes.findIndex((node) => node.id === nodeId);
    const sourceNode = currentNodes[sourceIndex];
    if (!sourceNode || sourceNode.kind === "trigger") {
      return;
    }

    const copyNode: BuilderNode = {
      id: createNodeId(sourceNode.kind),
      kind: sourceNode.kind,
      title: sourceNode.title,
      body: sourceNode.body,
      meta: sourceNode.meta,
    };

    const nextNodes = [
      ...currentNodes.slice(0, sourceIndex + 1),
      copyNode,
      ...currentNodes.slice(sourceIndex + 1),
    ];

    const sourcePosition = getSafePosition(scenarioNodePositions[nodeId], Math.max(0, sourceIndex));
    const copyPosition: NodePosition = {
      x: sourcePosition.x + 40,
      y: sourcePosition.y + 80,
    };

    setNodesByScenarioId((current) => ({
      ...current,
      [selectedScenario.id]: nextNodes,
    }));
    setNodePositionsByScenarioId((current) => ({
      ...current,
      [selectedScenario.id]: {
        ...(current[selectedScenario.id] ?? {}),
        [copyNode.id]: copyPosition,
      },
    }));
    setSelectedNodeId(copyNode.id);
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
        | { ok?: boolean; url?: string; fileName?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.url) {
        throw new Error(payload?.error || `No se pudo subir el ${uploadLabel}.`);
      }

      const nodeUpdates: Record<string, string> = { meta: payload.url };
      if (selectedNode.kind === "document" && payload.fileName) {
        nodeUpdates.title = payload.fileName;
      }
      updateNode(selectedNode.id, nodeUpdates);
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

  function isMediaUrlReferencedByOthers(url: string, excludeNodeId: string) {
    return Object.values(nodesByScenarioId).some((scenarioNodes) =>
      (scenarioNodes ?? []).some((node) => node.id !== excludeNodeId && node.meta === url),
    );
  }

  async function deleteUploadedMedia(url: string) {
    if (!url || !url.includes("/uploads/official-api-chatbot/")) {
      return;
    }
    try {
      await fetch(uploadEndpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
    } catch {
      // Silencioso: no bloquea el borrado del nodo si falla la limpieza del archivo.
    }
  }

  function handleClearNodeFile(nodeId: string) {
    const node = nodes.find((current) => current.id === nodeId);
    if (node?.meta && !isMediaUrlReferencedByOthers(node.meta, nodeId)) {
      void deleteUploadedMedia(node.meta);
    }
    updateNode(nodeId, { meta: "" });
  }

  function handleChangeNodeBody(nodeId: string, value: string) {
    updateNode(nodeId, { body: value });
  }

  async function handleNodeFileUpload(nodeId: string, file: File | null) {
    if (!file || !selectedScenario) {
      return;
    }

    const scenarioNodes = nodesByScenarioId[selectedScenario.id] ?? [];
    const node = scenarioNodes.find((current) => current.id === nodeId);
    if (!node || !isUploadableNodeKind(node.kind)) {
      return;
    }

    const uploadLabel = getUploadLabelByKind(node.kind);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(uploadEndpoint, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; url?: string; fileName?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.url) {
        throw new Error(payload?.error || `No se pudo subir el ${uploadLabel}.`);
      }

      const nodeUpdates: Record<string, string> = { meta: payload.url };
      if (node.kind === "document" && payload.fileName) {
        nodeUpdates.title = payload.fileName;
      }
      updateNode(nodeId, nodeUpdates);
      toast.success(`${uploadLabel[0].toUpperCase()}${uploadLabel.slice(1)} subido`, {
        description: "La URL quedo cargada en el nodo.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `No se pudo subir el ${uploadLabel}.`;
      toast.error(`Error al subir ${uploadLabel}`, {
        description: message,
      });
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

    const snapshot = buildAutoSaveSnapshot({
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
    <section className="space-y-4">
      {hasWorkflows && !hasSelectedFlow ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Workflow className="h-5 w-5" />
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">Flujos</h1>
            </div>
            <Button type="button" size="sm" onClick={openCreateWorkflowModal}>
              <Plus className="h-4 w-4" />
              Crear
            </Button>
          </div>
          <div className="space-y-3">
            {scenarios.map((scenario) => (
              <Card
                key={scenario.id}
                role="button"
                tabIndex={0}
                size="sm"
                onClick={() => router.push(`${basePath}/${scenario.id}${routeQuery}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(`${basePath}/${scenario.id}${routeQuery}`);
                  }
                }}
                className="flex-row items-center justify-between gap-3 px-4 cursor-pointer transition-colors hover:bg-accent/50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="truncate font-medium">{scenario.title}</span>
                  <Badge variant="secondary">{getWorkflowTypeLabel(scenario.flowType)}</Badge>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Opciones del workflow"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation();
                        openQuickResponsesModal(scenario.id);
                      }}
                    >
                      <MessageSquarePlus className="h-4 w-4" />
                      Respuestas rápidas
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditWorkflowIntentModal(scenario);
                      }}
                    >
                      <FileText className="h-4 w-4" />
                      Editar intención
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteRequest(scenario);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Card>
            ))}
          </div>
        </div>

      ) : (
        <Card
          className={cn(
            "overflow-hidden p-0",
            hasSelectedFlow
              ? "h-[calc(100dvh-4rem)]"
              : "h-[calc(100dvh-12rem)] max-h-[760px]",
          )}
        >
        <div className="flex h-full min-h-0">
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
                        className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-input"
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
                <div className="rounded-2xl border border-dashed border-border bg-card/80 px-4 py-3 text-sm leading-6 text-muted-foreground">
                  Haz clic en <span className="font-semibold text-slate-700">+</span> para abrir la libreria de bloques.
                </div>
              )}

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
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
            className={`relative h-full min-h-0 w-full flex-1 overflow-hidden ${
              hasSelectedFlow
                ? "bg-muted"
                : "bg-background"
            }`}
          >
            <div
              className={`relative ${
                hasSelectedFlow
                  ? "h-full overflow-hidden"
                  : "grid h-full min-h-[calc(100dvh-18rem)] place-items-center overflow-hidden"
              }`}
            >
              {selectedScenario ? (
                <div className="relative h-full w-full overflow-hidden bg-transparent">
                  <div className="pointer-events-none absolute left-4 top-4 z-20 flex items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border">
                      <Route className="h-3.5 w-3.5 text-sky-600" />
                      {selectedScenario?.title ?? "Flujo"}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border">
                      <Bot className="h-3.5 w-3.5 text-violet-600" />
                      {nodes.length} bloques
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border">
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
                        className="h-11 w-11 rounded-full border border-blue-600 bg-blue-600 p-0 text-white shadow-lg hover:bg-blue-700"
                      >
                          <Plus className="h-5 w-5 font-bold" strokeWidth={3.2} />
                        </Button>
                      {isBlockLibraryOpen ? (
                        <div
                          ref={blockLibraryPanelRef}
                          className="absolute right-0 top-11 z-20 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-border bg-card py-2 shadow-lg"
                        >
                          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                            Agregar nodo
                          </p>
                          <div className="grid gap-1 px-2">
                            {[...sendBlockLibrary, ...blockLibrary].map((block) => {
                              const Icon = block.icon;
                              const iconColor = block.style.split(" ").find((token) => token.startsWith("text-")) ?? "text-slate-600";
                              return (
                                <button
                                  key={block.id}
                                  type="button"
                                  onClick={() => addBlock(block.id as BuilderNode["kind"])}
                                  className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition hover:border-input hover:bg-muted"
                                >
                                  <Icon className={cn("h-4 w-4 shrink-0", iconColor)} />
                                  <span className="text-sm text-slate-900 dark:text-slate-100">
                                    {block.title}
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
                <div className="flex w-full items-center justify-center bg-background px-6 py-8 sm:px-10">
                  <div className="flex w-full max-w-lg flex-col items-center text-center">
                    <div className="flex items-center justify-center">
                      <Inbox className="h-10 w-10 text-primary" />
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
                <div className="flex w-full items-center justify-center bg-background px-6 py-8 sm:px-10">
                  <div className="flex w-full max-w-lg flex-col items-center text-center">
                    <div className="flex items-center justify-center">
                      <Inbox className="h-10 w-10 text-primary" />
                    </div>

                    <h4 className="mt-6 font-semibold text-slate-950">
                      Aun no has creado ningun flujo
                    </h4>

                    <Button
                      type="button"
                      className="mt-6 h-10 rounded-xl px-5 text-sm text-primary-foreground hover:bg-primary/90"
                      onClick={openCreateWorkflowModal}
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
              <div className="rounded-2xl border border-border bg-muted/70 p-4">
                <p className="text-sm font-semibold text-slate-900">Inspector del flujo</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Edita el flujo y los nodos seleccionados antes de guardar.
                </p>
              </div>

              {selectedNode ? (
                <>
                  {selectedScenario ? (
                    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
                      <p className="text-sm font-semibold text-slate-900">Flujo seleccionado</p>
                      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground">
                        Tipo: {getWorkflowTypeLabel(selectedScenario.flowType)}
                      </div>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-slate-900">Nombre del flujo</span>
                        <Input
                          value={selectedScenario.title}
                          onChange={(event) => updateSelectedWorkflow({ title: event.target.value })}
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Contenido</span>
                        <textarea
                          value={selectedNode.body}
                          onChange={(event) => updateNode(selectedNode.id, { body: event.target.value })}
                          className="field-textarea min-h-28"
                          placeholder="Contenido del nodo"
                        />
                      </label>

                      {selectedNode.kind === "condition" ? (
                        <label className="block space-y-2">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Meta / keywords</span>
                          <Input
                            value={selectedNode.meta}
                            onChange={(event) => updateNode(selectedNode.id, { meta: event.target.value })}
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-[26px] border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm leading-6 text-slate-600">
                      Crea tu primer flujo para desbloquear el lienzo y empezar a agregar nodos.
                    </div>
                  )}
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
            </div>
          </aside>
        </div>
        </Card>
      )}
        {scenarioPendingDelete ? (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/25 p-6 backdrop-blur-[2px]">
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
        {isCreatingWorkflow ? (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/20 p-6 backdrop-blur-[2px]">
            <div className="w-full max-w-md overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_30px_80px_-48px_rgba(15,23,42,0.32)]">
              <div className="relative border-b border-slate-200 px-6 py-7 text-center">
                <button
                  type="button"
                  onClick={closeCreateWorkflowModal}
                  className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar modal"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)]">
                  <Inbox className="h-6 w-6 text-primary" />
                </div>
                <p className="mt-4 text-xl font-semibold text-slate-950">Crear flujo</p>
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

                <div className="space-y-3">
                  <span className="text-sm font-medium text-slate-900">Tipo</span>
                  <p className="text-xs leading-5 text-slate-500">Define como se activa el flujo.</p>
                  {newWorkflowType === "" ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {workflowTypeOptions.map((option) => {
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setNewWorkflowType(option.value)}
                            className={cn(
                              "min-h-[104px] rounded-2xl border px-4 py-4 text-center transition",
                              "border-slate-200 bg-white hover:border-slate-300",
                            )}
                          >
                            <div className="flex flex-col items-center gap-1">
                              <p className="text-sm font-semibold text-slate-950">{option.title}</p>
                              <p className="text-xs leading-5 text-slate-600">{option.description}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-blue-200 bg-blue-50/60 px-4 py-3">
                      {(() => {
                        const selectedOption =
                          workflowTypeOptions.find((option) => option.value === newWorkflowType) ?? workflowTypeOptions[0];

                        return (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-950">{selectedOption.title}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setNewWorkflowType("");
                                setNewWorkflowIntent("");
                                setNewWorkflowMatchType("exacta");
                                setNewWorkflowKeywords([]);
                                setNewWorkflowKeywordDraft("");
                              }}
                              className="text-sm font-medium text-[var(--primary)] transition hover:opacity-80"
                            >
                              Cambiar
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {newWorkflowType === "ia" ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-900">IA</span>
                    <textarea
                      value={newWorkflowIntent}
                      onChange={(event) => setNewWorkflowIntent(event.target.value)}
                      className="field-textarea min-h-24"
                      placeholder="El usuario quiere comprar o pregunta por precios o disponibilidad"
                    />
                    <p className="text-xs leading-5 text-slate-500">Detecta intenciones.</p>
                  </label>
                ) : newWorkflowType === "chatbot" ? (
                  <div className="space-y-4">
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900">CHATBOT</span>
                      <select
                        value={newWorkflowMatchType}
                        onChange={(event) => setNewWorkflowMatchType(event.target.value === "contiene" ? "contiene" : "exacta")}
                        className="field-input h-11"
                      >
                        <option value="exacta">Exacta</option>
                        <option value="contiene">Contiene</option>
                      </select>
                    </label>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-900">Palabras clave (opcional, hasta 20)</span>
                        <span className="text-xs text-slate-500">{newWorkflowKeywords.length}/20</span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={newWorkflowKeywordDraft}
                          onChange={(event) => setNewWorkflowKeywordDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addWorkflowKeyword(newWorkflowKeywordDraft);
                            }
                          }}
                          placeholder="Escribe una palabra o frase y presiona Enter"
                        />
                        <Button
                          type="button"
                          className="h-11 shrink-0 border-[var(--primary)] bg-[var(--primary)] px-4 text-white hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)] hover:text-white"
                          aria-label="Guardar palabra clave"
                          onClick={() => addWorkflowKeyword(newWorkflowKeywordDraft)}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      </div>
                      {newWorkflowKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {newWorkflowKeywords.map((keyword) => (
                            <button
                              type="button"
                              key={keyword}
                              onClick={() => removeWorkflowKeyword(keyword)}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                            >
                              {keyword}
                              <X className="h-3.5 w-3.5" />
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <Button type="button" className="h-11 w-full rounded-xl" onClick={createWorkflow}>
                  Continuar
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {isQuickResponsesModalOpen && quickResponsesScenario ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/25 p-6 backdrop-blur-[2px]">
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
        {isEditingWorkflowIntent ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/25 p-6 backdrop-blur-[2px]">
            <div className="w-full max-w-xl overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_30px_80px_-48px_rgba(15,23,42,0.32)]">
              <div className="relative border-b border-slate-200 px-6 py-5">
                  <button
                    type="button"
                    onClick={closeEditWorkflowIntentModal}
                  className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar editor de intención"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-lg font-semibold text-slate-950">Editar intención</p>
                    <p className="text-sm text-slate-500">
                      {scenarios.find((scenario) => scenario.id === editingWorkflowIntentScenarioId)?.title ?? "Flujo"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div className="space-y-3">
                  <span className="text-sm font-medium text-slate-900">Tipo</span>
                  <p className="text-xs leading-5 text-slate-500">Define como se activa el flujo.</p>
                  {editingWorkflowType === "" ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {workflowTypeOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setEditingWorkflowType(option.value)}
                          className={cn(
                            "min-h-[104px] rounded-2xl border px-4 py-4 text-center transition",
                            "border-slate-200 bg-white hover:border-slate-300",
                          )}
                        >
                          <div className="flex flex-col items-center gap-1">
                            <p className="text-sm font-semibold text-slate-950">{option.title}</p>
                            <p className="text-xs leading-5 text-slate-600">{option.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-blue-200 bg-blue-50/60 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-950">
                            {workflowTypeOptions.find((option) => option.value === editingWorkflowType)?.title ?? "IA"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingWorkflowType("");
                            setEditingWorkflowIntentDraft("");
                            setEditingWorkflowMatchType("exacta");
                            setEditingWorkflowKeywords([]);
                            setEditingWorkflowKeywordDraft("");
                          }}
                          className="text-sm font-medium text-[var(--primary)] transition hover:opacity-80"
                        >
                          Cambiar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {editingWorkflowType === "ia" ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-900">IA</span>
                    <textarea
                      value={editingWorkflowIntentDraft}
                      onChange={(event) => setEditingWorkflowIntentDraft(event.target.value)}
                      className="field-textarea min-h-28"
                      placeholder="Describe qué intención debe detectar el agente y qué debe lograr."
                    />
                    <p className="text-xs leading-5 text-slate-500">
                      Usa una frase concreta que le sirva al agente para reconocer la intención correcta.
                    </p>
                  </label>
                ) : editingWorkflowType === "chatbot" ? (
                  <div className="space-y-4">
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900">CHATBOT</span>
                      <select
                        value={editingWorkflowMatchType}
                        onChange={(event) =>
                          setEditingWorkflowMatchType(event.target.value === "contiene" ? "contiene" : "exacta")
                        }
                        className="field-input h-11"
                      >
                        <option value="exacta">Exacta</option>
                        <option value="contiene">Contiene</option>
                      </select>
                    </label>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-900">Palabras clave (opcional, hasta 20)</span>
                        <span className="text-xs text-slate-500">{editingWorkflowKeywords.length}/20</span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={editingWorkflowKeywordDraft}
                          onChange={(event) => setEditingWorkflowKeywordDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addEditingWorkflowKeyword(editingWorkflowKeywordDraft);
                            }
                          }}
                          placeholder="Escribe una palabra o frase y presiona Enter"
                        />
                        <Button
                          type="button"
                          className="h-11 shrink-0 border-[var(--primary)] bg-[var(--primary)] px-4 text-white hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)] hover:text-white"
                          aria-label="Guardar palabra clave"
                          onClick={() => addEditingWorkflowKeyword(editingWorkflowKeywordDraft)}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      </div>
                      {editingWorkflowKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {editingWorkflowKeywords.map((keyword) => (
                            <button
                              type="button"
                              key={keyword}
                              onClick={() => removeEditingWorkflowKeyword(keyword)}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                            >
                              {keyword}
                              <X className="h-3.5 w-3.5" />
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
                  <Button type="button" variant="outline" onClick={closeEditWorkflowIntentModal}>
                    Cancelar
                  </Button>
                  <Button type="button" onClick={saveWorkflowIntent}>
                    Guardar
                  </Button>
              </div>
            </div>
          </div>
        ) : null}
        {isNodeEditorOpen && selectedNode ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/25 p-6 backdrop-blur-[2px]">
            <div className="w-full max-w-2xl overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_30px_80px_-48px_rgba(15,23,42,0.32)] dark:border-slate-700 dark:bg-slate-900">
              <div className="relative border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsNodeEditorOpen(false)}
                  className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  aria-label="Cerrar editor del nodo"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)] dark:bg-[color-mix(in_srgb,var(--primary)_22%,transparent)]">
                    <Settings2 className="h-4 w-4" />
                  </span>
                  <p className="text-lg font-semibold text-slate-950 dark:text-slate-50">Editar nodo</p>
                </div>
              </div>
              <div className="space-y-4 px-6 py-5">
                {selectedNode.kind === "trigger" ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Modo de respuesta</p>
                          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">
                            Define si el flujo responde solo una vez al iniciar o en cada mensaje entrante.
                          </p>
                        </div>
                        <Switch
                          checked={replyEveryMessageEnabled}
                          onCheckedChange={setReplyEveryMessageEnabled}
                          aria-label="Repetir respuesta en cada mensaje"
                        />
                      </div>
                      <p className="mt-3 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {replyEveryMessageEnabled ? "Repetir: responde en cada mensaje." : "Unico: responde solo al primer mensaje."}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Respuesta con IA</p>
                          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">
                            Después de ejecutar el flujo, la IA genera un mensaje de seguimiento.
                          </p>
                        </div>
                        <Switch
                          checked={selectedNode.aiFollowUpEnabled !== false}
                          onCheckedChange={(checked) => updateNode(selectedNode.id, { aiFollowUpEnabled: checked })}
                          aria-label="Respuesta con IA después del flujo"
                        />
                      </div>
                      <p className="mt-3 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {selectedNode.aiFollowUpEnabled !== false ? "Activo: la IA responde después del flujo." : "Desactivado: el flujo responde sin IA."}
                      </p>
                    </div>
                  </div>
                ) : selectedNode.kind === "image" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">URL de imagen</span>
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
                        <p className="text-xs text-slate-500 dark:text-slate-400">
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
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Texto (opcional)</span>
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
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">URL de audio</span>
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
                    <p className="text-xs text-slate-500 dark:text-slate-400">Usa una URL publica directa del archivo de audio.</p>
                  </>
                ) : selectedNode.kind === "video" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">URL de video</span>
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
                    <p className="text-xs text-slate-500 dark:text-slate-400">Usa una URL publica directa del video.</p>
                  </>
                ) : selectedNode.kind === "document" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">URL de documento</span>
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
                    <p className="text-xs text-slate-500 dark:text-slate-400">Usa una URL publica directa (PDF recomendado).</p>
                  </>
                ) : (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Contenido</span>
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
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Meta / keywords</span>
                    <Input
                      value={selectedNode.meta}
                      onChange={(event) => updateNode(selectedNode.id, { meta: event.target.value })}
                    />
                  </label>
                ) : null}
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-700">
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
    </section>
  );
}
