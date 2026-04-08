"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowRight,
  Bot,
  X,
  Clock3,
  Copy,
  FileText,
  MessageCircleReply,
  MessageSquarePlus,
  MoreVertical,
  Inbox,
  Play,
  Plus,
  Route,
  Save,
  Settings2,
  Split,
  Trash2,
  UserRound,
  Workflow,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
};

type BuilderNode = OfficialApiChatbotBuilderNode;

const blockLibrary = [
  {
    id: "message",
    title: "Mensaje",
    description: "Texto, saludo o respuesta corta.",
    icon: MessageSquarePlus,
    style: "bg-sky-50 text-sky-700 ring-sky-200",
  },
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

function getNodeStyle(kind: BuilderNode["kind"]) {
  switch (kind) {
    case "trigger":
      return { wrap: "border-sky-300 bg-sky-50", icon: <Play className="h-4 w-4 text-sky-700" /> };
    case "message":
      return { wrap: "border-violet-300 bg-violet-50", icon: <MessageCircleReply className="h-4 w-4 text-violet-700" /> };
    case "input":
      return { wrap: "border-emerald-300 bg-emerald-50", icon: <UserRound className="h-4 w-4 text-emerald-700" /> };
    case "condition":
      return { wrap: "border-amber-300 bg-amber-50", icon: <Split className="h-4 w-4 text-amber-700" /> };
    default:
      return { wrap: "border-slate-300 bg-slate-100", icon: <Zap className="h-4 w-4 text-slate-700" /> };
  }
}

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
      title: "Inicio del flujo",
      body: "El flujo inicia cuando entra un mensaje nuevo al numero oficial de WhatsApp.",
      meta: "Evento de entrada",
    },
  ];
}

export function OfficialApiChatbotWorkspace({ data, initialScenarioId }: OfficialApiChatbotWorkspaceProps) {
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
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
  const [newWorkflowTitle, setNewWorkflowTitle] = useState("");
  const [openMenuScenarioId, setOpenMenuScenarioId] = useState("");
  const [scenarioPendingDelete, setScenarioPendingDelete] = useState<OfficialApiChatbotScenario | null>(null);

  const hasWorkflows = scenarios.length > 0;
  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId);
  const hasSelectedFlow = Boolean(selectedScenario);
  const nodes = useMemo(
    () => (selectedScenario ? (nodesByScenarioId[selectedScenario.id] ?? []) : []),
    [nodesByScenarioId, selectedScenario],
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null,
    [nodes, selectedNodeId],
  );

  function updateNodesForScenario(scenarioId: string, updater: (nodes: BuilderNode[]) => BuilderNode[]) {
    setNodesByScenarioId((current) => ({
      ...current,
      [scenarioId]: updater(current[scenarioId] ?? []),
    }));
  }

  function updateNode(nodeId: string, patch: Partial<BuilderNode>) {
    if (!selectedScenario) {
      return;
    }

    updateNodesForScenario(selectedScenario.id, (current) =>
      current.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    );
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
        title: "Nuevo mensaje",
        body: "Escribe aqui la respuesta del bot.",
        meta: "Salida del bot",
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

    updateNodesForScenario(selectedScenario.id, (current) => [...current, nextNode]);
    setSelectedNodeId(nextNode.id);
    setIsBlockLibraryOpen(false);
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
    setNodesByScenarioId((current) => ({
      ...current,
      [nextScenario.id]: nextNodes,
    }));
    setSelectedNodeId(nextNodes[0]?.id ?? "");
    setIsBlockLibraryOpen(true);

    startSaving(async () => {
      try {
        await persistBuilderState({
          selectedScenarioId: nextScenario.id,
          scenarios: nextScenarios,
          nodesByScenarioId: nextNodesByScenarioId,
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

  async function persistBuilderState(input: {
    selectedScenarioId: string;
    scenarios: OfficialApiChatbotScenario[];
    nodesByScenarioId: OfficialApiChatbotNodesByScenarioId;
    successMessage?: string;
  }) {
    const activeNodes = input.nodesByScenarioId[input.selectedScenarioId] ?? [];
    const response = await fetch("/api/cliente/api-oficial/chatbot", {
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
        selectedScenarioId: input.selectedScenarioId,
        scenarios: input.scenarios,
        nodesByScenarioId: input.nodesByScenarioId,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "No pudimos guardar la configuracion del flujo.");
    }

    if (input.successMessage) {
      toast.success(input.successMessage, {
        description: "La configuracion del flujo quedo lista en la API oficial.",
      });
    }
  }

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

  function confirmDeleteWorkflow() {
    if (!scenarioPendingDelete) {
      return;
    }

    if (scenarios.length <= 1) {
      toast.error("No puedes eliminar el ultimo flujo", {
        description: "Debes mantener al menos un flujo activo en el builder.",
      });
      setScenarioPendingDelete(null);
      return;
    }

    const nextScenarios = scenarios.filter((scenario) => scenario.id !== scenarioPendingDelete.id);
    const nextSelectedScenario = nextScenarios[0];
    const nextNodesByScenarioId = Object.fromEntries(
      Object.entries(nodesByScenarioId).filter(([scenarioId]) => scenarioId !== scenarioPendingDelete.id),
    );

    setScenarios(nextScenarios);
    setNodesByScenarioId(nextNodesByScenarioId);
    setSelectedScenarioId(nextSelectedScenario?.id ?? "");
    setSelectedNodeId(nextNodesByScenarioId[nextSelectedScenario?.id ?? ""]?.[0]?.id ?? "");
    setScenarioPendingDelete(null);

    startSaving(async () => {
      try {
        await persistBuilderState({
          selectedScenarioId: nextSelectedScenario?.id ?? "",
          scenarios: nextScenarios,
          nodesByScenarioId: nextNodesByScenarioId,
          successMessage: "Flujo eliminado",
        });
      } catch {
        toast.error("No se pudo eliminar", {
          description: "Ocurrio un error al eliminar el flujo.",
        });
      }
    });
  }

  return (
    <section className={hasSelectedFlow ? "space-y-4" : "overflow-hidden"}>
      <Card
        className={`overflow-hidden border border-[rgba(15,23,42,0.1)] bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(255,255,255,0.99)_100%)] p-0 shadow-[0_30px_90px_-54px_rgba(15,23,42,0.3)] ${
          hasSelectedFlow ? "" : "h-[calc(100dvh-12rem)] max-h-[760px]"
        }`}
      >
        <div className={hasWorkflows ? "px-5 py-5" : "hidden"}>
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
                onClick={() => router.push(`/cliente/api-oficial/chatbot/${scenario.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(`/cliente/api-oficial/chatbot/${scenario.id}`);
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
                    <div className="absolute right-0 top-11 z-20 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_22px_48px_-30px_rgba(15,23,42,0.35)]">
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

        <div
          className={
            hasSelectedFlow || !hasWorkflows
              ? "grid min-h-[76vh] xl:grid-cols-[280px_minmax(0,1fr)_330px]"
              : "hidden"
          }
        >
          <aside className={hasSelectedFlow ? "border-b border-slate-200 bg-slate-50/80 xl:border-r xl:border-b-0" : "hidden"}>
            <div className="space-y-5 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Bloques</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={isBlockLibraryOpen ? "Cerrar bloques" : "Abrir bloques"}
                  aria-expanded={isBlockLibraryOpen}
                  onClick={() => setIsBlockLibraryOpen((current) => !current)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {isBlockLibraryOpen ? (
                <div className="grid gap-3">
                  {blockLibrary.map((block) => {
                    const Icon = block.icon;
                    return (
                      <button
                        key={block.id}
                        type="button"
                        onClick={() => addBlock(block.id as BuilderNode["kind"])}
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
                ? "bg-[radial-gradient(circle_at_top,rgba(226,232,240,0.75),transparent_34%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]"
                : "bg-white"
            }`}
          >
            <div className={hasSelectedFlow ? "flex items-center justify-between border-b border-slate-200/80 px-5 py-3" : "hidden"}>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                  <Route className="h-3.5 w-3.5 text-sky-600" />
                  {selectedScenario?.title ?? "Flujo"}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                  <Bot className="h-3.5 w-3.5 text-violet-600" />
                  {nodes.length} bloques
                </span>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 ring-1 ring-emerald-200">
                {data.metrics[0]?.value ?? "0%"} automatizado
              </span>
            </div>

            <div
              className={`relative p-5 ${
                hasSelectedFlow
                  ? "min-h-[calc(76vh-57px)] overflow-auto"
                  : "grid min-h-[calc(100dvh-18rem)] place-items-center overflow-hidden"
              }`}
            >
              {hasSelectedFlow ? (
                <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(to_right,rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.16)_1px,transparent_1px)] [background-size:36px_36px]" />
              ) : null}
              {selectedScenario ? (
                <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-4 pb-10 pt-2">
                  {nodes.map((node, index) => {
                    const style = getNodeStyle(node.kind);

                    return (
                      <div key={node.id} className="flex w-full max-w-xl flex-col items-center gap-3">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedNodeId(node.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedNodeId(node.id);
                            }
                          }}
                          className={`w-full rounded-[28px] border bg-white p-5 text-left shadow-[0_24px_60px_-42px_rgba(15,23,42,0.28)] transition ${
                            selectedNodeId === node.id
                              ? "border-[var(--primary)] ring-2 ring-[color-mix(in_srgb,var(--primary)_16%,white)]"
                              : "border-slate-200"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                              <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border ${style.wrap}`}>
                                {style.icon}
                              </span>
                              <div>
                                <p className="text-sm font-semibold text-slate-950">{node.title}</p>
                                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                  {node.meta}
                                </p>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedNodeId(node.id);
                              }}
                            >
                              <Settings2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                            <p className="text-sm leading-6 text-slate-700">{node.body}</p>
                          </div>
                        </div>

                        {index < nodes.length - 1 ? (
                          <div className="flex h-10 items-center justify-center">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white">
                              <ArrowRight className="h-4 w-4 text-slate-400" />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
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

          <aside className={hasSelectedFlow ? "border-t border-slate-200 bg-white xl:border-l xl:border-t-0" : "hidden"}>
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

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-900">Meta / keywords</span>
                    <Input
                      value={selectedNode.meta}
                      onChange={(event) => updateNode(selectedNode.id, { meta: event.target.value })}
                    />
                  </label>
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
                    placeholder="Ej. Bienvenida con video"
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
      </Card>
    </section>
  );
}
