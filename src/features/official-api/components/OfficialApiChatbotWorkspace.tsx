"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  MessageCircleReply,
  MessageSquarePlus,
  Play,
  Plus,
  Route,
  Save,
  Settings2,
  Sparkles,
  Split,
  UserRound,
  Workflow,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type {
  OfficialApiChatbotBuilderNode,
  OfficialApiChatbotData,
} from "@/features/official-api/types/official-api";
import { toast } from "sonner";

type OfficialApiChatbotWorkspaceProps = {
  data: OfficialApiChatbotData;
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

function applyScenarioPreset(nodes: BuilderNode[], scenario: OfficialApiChatbotData["scenarios"][number] | undefined) {
  if (!scenario) {
    return nodes;
  }

  return nodes.map((node) => {
    if (node.id === "router") {
      return {
        ...node,
        body: scenario.summary,
      };
    }

    if (node.id === "reply") {
      const botMessage = scenario.messages.find((message) => message.direction === "bot");
      return {
        ...node,
        body: botMessage?.content || node.body,
      };
    }

    return node;
  });
}

export function OfficialApiChatbotWorkspace({ data }: OfficialApiChatbotWorkspaceProps) {
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    data.defaults.selectedScenarioId || data.scenarios[0]?.id || "",
  );
  const [botEnabled, setBotEnabled] = useState(data.defaults.isBotEnabled);
  const [captureLeadEnabled, setCaptureLeadEnabled] = useState(data.defaults.captureLeadEnabled);
  const [handoffEnabled, setHandoffEnabled] = useState(data.defaults.handoffEnabled);
  const [fallbackEnabled, setFallbackEnabled] = useState(data.defaults.fallbackEnabled);
  const [businessHours, setBusinessHours] = useState(data.defaults.businessHours);
  const [nodes, setNodes] = useState<BuilderNode[]>(
    data.defaults.nodes.length > 0
      ? data.defaults.nodes
      : [
          {
            id: "trigger",
            kind: "trigger",
            title: "Disparador",
            body: "El flujo inicia cuando entra un mensaje nuevo al numero oficial de WhatsApp.",
            meta: "Evento de entrada",
          },
          {
            id: "welcome",
            kind: "message",
            title: "Bienvenida",
            body: data.defaults.welcomeMessage,
            meta: "Mensaje inicial",
          },
          {
            id: "router",
            kind: "condition",
            title: "Router de intencion",
            body: data.scenarios.find((scenario) => scenario.id === selectedScenarioId)?.summary || "Clasifica la intencion del usuario.",
            meta: `precio, cotizar, soporte | ${data.defaults.businessHours}`,
          },
          {
            id: "reply",
            kind: "message",
            title: "Respuesta principal",
            body: data.scenarios.find((scenario) => scenario.id === selectedScenarioId)?.messages.find((message) => message.direction === "bot")?.content || "Te ayudo con tu solicitud.",
            meta: "Salida del bot",
          },
          {
            id: "capture",
            kind: "input",
            title: "Captura de lead",
            body: "Solicita nombre, ciudad, producto y presupuesto antes de cerrar.",
            meta: "Datos del contacto",
          },
          {
            id: "handoff",
            kind: "action",
            title: "Transferencia humana",
            body: "Si el usuario quiere avanzar, deriva a un asesor humano con el contexto completo.",
            meta: "Accion interna",
          },
          {
            id: "fallback",
            kind: "message",
            title: "Fallback seguro",
            body: data.defaults.fallbackMessage,
            meta: "Proteccion del bot",
          },
        ],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    data.defaults.nodes[1]?.id || data.defaults.nodes[0]?.id || "welcome",
  );
  const [copiedTemplateId, setCopiedTemplateId] = useState("");
  const [isSaving, startSaving] = useTransition();
  const [isBlockLibraryOpen, setIsBlockLibraryOpen] = useState(false);

  const selectedScenario = data.scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? data.scenarios[0];
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null,
    [nodes, selectedNodeId],
  );

  function updateNode(nodeId: string, patch: Partial<BuilderNode>) {
    setNodes((current) =>
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

    setNodes((current) => [...current, nextNode]);
    setSelectedNodeId(nextNode.id);
    setIsBlockLibraryOpen(false);
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

  function handleSaveBuilder() {
    startSaving(async () => {
      try {
        const response = await fetch("/api/cliente/api-oficial/chatbot", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            isBotEnabled: botEnabled,
            welcomeMessage: nodes.find((node) => node.id === "welcome")?.body || data.defaults.welcomeMessage,
            fallbackMessage: nodes.find((node) => node.id === "fallback")?.body || data.defaults.fallbackMessage,
            businessHours,
            captureLeadEnabled,
            handoffEnabled,
            fallbackEnabled,
            selectedScenarioId,
            nodes,
          }),
        });

        const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

        if (!response.ok || !payload?.ok) {
          toast.error("No se pudo guardar", {
            description: payload?.error || "No pudimos guardar la configuracion del chatbot.",
          });
          return;
        }

        toast.success("Chatbot guardado", {
          description: "Las reglas quedaron activas para la API oficial.",
        });
      } catch {
        toast.error("No se pudo guardar", {
          description: "Ocurrio un error al guardar el flujo.",
        });
      }
    });
  }

  return (
    <section className="space-y-4">
      <Card className="overflow-hidden border border-[rgba(15,23,42,0.1)] bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(255,255,255,0.99)_100%)] p-0 shadow-[0_30px_90px_-54px_rgba(15,23,42,0.3)]">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#111827_0%,#1d4ed8_100%)] text-white">
              <Workflow className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-slate-950">Builder de chatbot</p>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  Inspirado en Typebot
                </span>
              </div>
              <p className="text-sm leading-6 text-slate-600">
                Constructor visual para {data.workspaceName} dentro de WhatsApp oficial.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              Phone: {data.phoneNumberIdLabel}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              WABA: {data.wabaIdLabel}
            </span>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2">
              <span className="text-xs font-medium text-slate-600">Bot activo</span>
              <Switch checked={botEnabled} onCheckedChange={setBotEnabled} aria-label="Activar chatbot" />
            </div>
            <Button type="button" variant="outline" size="sm">
              <Play className="h-3.5 w-3.5" />
              Probar
            </Button>
            <Button type="button" size="sm" onClick={handleSaveBuilder} disabled={isSaving}>
              <Save className="h-3.5 w-3.5" />
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>

        <div className="grid min-h-[76vh] xl:grid-cols-[280px_minmax(0,1fr)_330px]">
          <aside className="border-b border-slate-200 bg-slate-50/80 xl:border-r xl:border-b-0">
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

              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-900">Flujos</p>
                <div className="grid gap-2">
                  {data.scenarios.map((scenario) => (
                    <button
                      key={scenario.id}
                      type="button"
                      onClick={() => {
                        setSelectedScenarioId(scenario.id);
                        setNodes((current) => applyScenarioPreset(current, scenario));
                      }}
                      className={`rounded-[22px] border px-4 py-3 text-left transition ${
                        selectedScenarioId === scenario.id
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{scenario.title}</p>
                          <p className={`mt-1 text-sm leading-6 ${selectedScenarioId === scenario.id ? "text-slate-300" : "text-slate-600"}`}>
                            {scenario.summary}
                          </p>
                        </div>
                        <ChevronRight className={`mt-1 h-4 w-4 ${selectedScenarioId === scenario.id ? "text-slate-300" : "text-slate-400"}`} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

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

          <main className="relative overflow-hidden bg-[radial-gradient(circle_at_top,rgba(226,232,240,0.75),transparent_34%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
            <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-3">
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

            <div className="relative min-h-[calc(76vh-57px)] overflow-auto p-5">
              <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(to_right,rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.16)_1px,transparent_1px)] [background-size:36px_36px]" />
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
            </div>
          </main>

          <aside className="border-t border-slate-200 bg-white xl:border-l xl:border-t-0">
            <div className="space-y-5 p-4">
              <div className="rounded-[26px] border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-900">Inspector</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Edita el nodo seleccionado y guarda el flujo real del builder.
                </p>
              </div>

              {selectedNode ? (
                <>
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
              ) : null}

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
      </Card>
    </section>
  );
}
