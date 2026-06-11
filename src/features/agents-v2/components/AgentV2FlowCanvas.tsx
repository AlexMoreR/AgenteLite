"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Bot,
  Filter,
  Megaphone,
  MessageSquare,
  Plus,
  Rocket,
  ShoppingBag,
  Split,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MarkerType,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodeConnections,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
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
import { Switch } from "@/components/ui/switch";
import { saveAgentV2BusinessConfigAction } from "@/app/actions/agent-v2-actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const AGENT_NODE_ID = "agent-root";

type EntradaKind = "general" | "keyword";

type MatchType = "exacta" | "contiene" | "ia";

type NodeDataPatch = Partial<{
  welcome: string;
  keywords: string;
  prompt: string;
  fixedWelcome: boolean;
  consultProducts: boolean;
  consultFlows: boolean;
  startOnMatch: boolean;
  useFunnel: boolean;
  useBusiness: boolean;
  name: string;
  funnel: string;
  matchType: MatchType;
  text: string;
  productId: string;
  flowId: string;
}>;

export type AgentV2Product = { id: string; name: string };
export type AgentV2Flow = { id: string; name: string };

export type BusinessData = {
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

const EMPTY_BUSINESS: BusinessData = {
  name: "",
  sector: "",
  location: "",
  website: "",
  phone: "",
  email: "",
  instagram: "",
  facebook: "",
  tiktok: "",
  youtube: "",
};

const BUSINESS_FIELDS: { key: keyof BusinessData; label: string; placeholder: string }[] = [
  { key: "name", label: "Nombre del negocio", placeholder: "Ej. Magilus" },
  { key: "sector", label: "Sector / Rubro", placeholder: "Ej. Mobiliario" },
  { key: "location", label: "Ubicacion / Direccion", placeholder: "Ciudad, direccion" },
  { key: "website", label: "Sitio web", placeholder: "https://..." },
  { key: "phone", label: "Numero de contacto", placeholder: "+57..." },
  { key: "email", label: "Correo", placeholder: "correo@..." },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/..." },
  { key: "facebook", label: "Facebook", placeholder: "@minegocio" },
  { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@..." },
  { key: "youtube", label: "YouTube", placeholder: "@minegocio" },
];

function BusinessPopover({
  initial,
  onSubmit,
  trigger,
}: {
  initial: BusinessData;
  onSubmit: (business: BusinessData) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BusinessData>(initial);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initial);
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="nodrag max-h-[440px] w-96 space-y-3 overflow-y-auto rounded-2xl border border-border bg-background p-4 text-foreground"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm font-semibold text-foreground">Datos del negocio</p>
        <div className="grid grid-cols-2 gap-2">
          {BUSINESS_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <label className="text-[11px] font-medium text-foreground">{field.label}</label>
              <input
                value={form[field.key]}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
                placeholder={field.placeholder}
                className="block w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-950"
              />
            </div>
          ))}
        </div>
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            onSubmit(form);
            setOpen(false);
          }}
        >
          Guardar
        </Button>
      </PopoverContent>
    </Popover>
  );
}

type EntradaData = {
  kind: EntradaKind;
  welcome: string;
  keywords: string;
  useBusiness: boolean;
  business?: BusinessData;
  onChange?: (id: string, patch: NodeDataPatch) => void;
  onSaveBusiness?: (business: BusinessData) => void;
  onDelete?: (id: string) => void;
};

type AgentData = {
  name: string;
  welcome: string;
  prompt: string;
  fixedWelcome: boolean;
  consultProducts: boolean;
  consultFlows: boolean;
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

          {!isKeyword ? (
            <>
              <div
                className="nodrag flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="text-sm text-foreground">Datos del negocio</span>
                <Switch
                  checked={nodeData.useBusiness}
                  onCheckedChange={(checked) => nodeData.onChange?.(id, { useBusiness: checked })}
                  aria-label="Datos del negocio"
                />
              </div>
              {nodeData.useBusiness ? (
                <BusinessPopover
                  initial={nodeData.business ?? EMPTY_BUSINESS}
                  onSubmit={(business) => nodeData.onSaveBusiness?.(business)}
                  trigger={
                    <button
                      type="button"
                      className="nodrag flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      Editar datos del negocio
                    </button>
                  }
                />
              ) : null}
            </>
          ) : null}

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
  const welcomeRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    for (const el of [welcomeRef.current, promptRef.current]) {
      if (el) {
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }
    }
  }, [nodeData.welcome, nodeData.prompt, nodeData.fixedWelcome]);

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
          <div
            className="nodrag flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="text-sm text-foreground">Bienvenida fija</span>
            <Switch
              checked={nodeData.fixedWelcome}
              onCheckedChange={(checked) => nodeData.onChange?.(id, { fixedWelcome: checked })}
              aria-label="Bienvenida fija"
            />
          </div>

          {nodeData.fixedWelcome ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Mensaje de bienvenida</label>
              <textarea
                ref={welcomeRef}
                value={nodeData.welcome}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => nodeData.onChange?.(id, { welcome: event.target.value })}
                placeholder="Hola, bienvenido a..."
                className="nodrag block min-h-[64px] w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-950"
              />
            </div>
          ) : (
            <p className="text-[11px] leading-4 text-muted-foreground">
              La bienvenida la genera la IA segun el prompt principal.
            </p>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Prompt principal</label>
            <textarea
              ref={promptRef}
              value={nodeData.prompt}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => nodeData.onChange?.(id, { prompt: event.target.value })}
              placeholder="Eres el asistente de... Tu objetivo es..."
              className="nodrag block min-h-[88px] w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-950"
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              Instruccion base de la IA. Desde aqui conectaras conocimiento, productos y flujos.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Herramientas</p>
            <div
              className="nodrag relative flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="text-sm text-foreground">Consultar productos</span>
              <Switch
                checked={nodeData.consultProducts}
                onCheckedChange={(checked) => nodeData.onChange?.(id, { consultProducts: checked })}
                aria-label="Consultar productos"
              />
              <Handle
                id="tool-products"
                type="source"
                position={Position.Right}
                className="!-right-4 !h-4 !w-4 !border-2 !border-white !bg-emerald-500"
              />
            </div>
            <div
              className="nodrag relative flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="text-sm text-foreground">Consultar flujos</span>
              <Switch
                checked={nodeData.consultFlows}
                onCheckedChange={(checked) => nodeData.onChange?.(id, { consultFlows: checked })}
                aria-label="Consultar flujos"
              />
              <Handle
                id="tool-flows"
                type="source"
                position={Position.Right}
                className="!-right-4 !h-4 !w-4 !border-2 !border-white !bg-sky-500"
              />
            </div>
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

const PRODUCT_STAGES = [
  { key: "empresa", label: "1. Presentacion empresa" },
  { key: "necesidad", label: "2. Identificacion (dolor / necesidad)" },
  { key: "producto", label: "3. Presentacion (producto / solucion)" },
  { key: "dudas", label: "4. Aclarar dudas y objeciones" },
  { key: "cierre", label: "5. Cierre / toma del pedido" },
] as const;

type ProductoData = {
  productId: string;
  startOnMatch: boolean;
  matchType: MatchType;
  matchKeywords: string[];
  intent: string;
  useFunnel: boolean;
  products?: AgentV2Product[];
  onChange?: (id: string, patch: NodeDataPatch) => void;
  onUpdateMatch?: (nodeId: string, matchType: MatchType, keywords: string[], intent: string) => void;
  onDelete?: (id: string) => void;
};

function ProductoNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ProductoData;
  const products = nodeData.products ?? [];

  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top} align="end" offset={8}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            nodeData.onDelete?.(id);
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
          aria-label="Eliminar producto"
          title="Eliminar producto"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </NodeToolbar>

      <Handle
        id="target"
        type="target"
        position={Position.Left}
        className="!h-4 !w-4 !border-2 !border-white !bg-emerald-600"
      />
      <BaseNode className="w-[340px]">
        <BaseNodeHeader className="items-center justify-start gap-2.5">
          <span className="inline-flex shrink-0 items-center justify-center">
            <ShoppingBag className="h-4 w-4 text-emerald-600" />
          </span>
          <BaseNodeHeaderTitle className="truncate">Producto</BaseNodeHeaderTitle>
        </BaseNodeHeader>
        <BaseNodeContent className="space-y-3">
          <div className="nodrag space-y-1" onClick={(event) => event.stopPropagation()}>
            <label className="text-xs font-medium text-foreground">Producto</label>
            <Select
              value={nodeData.productId}
              onValueChange={(value) => nodeData.onChange?.(id, { productId: value ?? "" })}
            >
              <SelectTrigger className="h-9 w-full text-xs">
                <SelectValue placeholder="Selecciona un producto" />
              </SelectTrigger>
              <SelectContent className="p-1" alignItemWithTrigger={false} side="bottom">
                {products.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No hay productos en el catalogo
                  </div>
                ) : (
                  products.map((product) => (
                    <SelectItem key={product.id} value={product.id} className="text-xs">
                      {product.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div
            className="nodrag flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="text-sm text-foreground">Iniciar con coincidencia</span>
            <Switch
              checked={nodeData.startOnMatch}
              onCheckedChange={(checked) => nodeData.onChange?.(id, { startOnMatch: checked })}
              aria-label="Iniciar con coincidencia"
            />
          </div>

          {nodeData.startOnMatch ? (
            <RulePopover
              initialMatchType={nodeData.matchType}
              initialKeywords={nodeData.matchKeywords}
              initialIntent={nodeData.intent}
              submitLabel="Guardar"
              onSubmit={(matchType, keywords, intent) =>
                nodeData.onUpdateMatch?.(id, matchType, keywords, intent)
              }
              trigger={
                <button
                  type="button"
                  className="nodrag w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-left transition hover:bg-muted/60"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Coincidencia
                  </span>
                  <p className="break-words text-sm text-foreground">
                    <span>{MATCH_LABELS[nodeData.matchType]}</span>
                    {" · "}
                    {nodeData.matchType === "ia"
                      ? nodeData.intent.trim()
                        ? nodeData.intent
                        : "sin intencion"
                      : nodeData.matchKeywords.length
                        ? nodeData.matchKeywords.join(", ")
                        : "sin palabras"}
                  </p>
                </button>
              }
            />
          ) : null}

          <div
            className="nodrag flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="text-sm text-foreground">Embudo</span>
            <Switch
              checked={nodeData.useFunnel}
              onCheckedChange={(checked) => nodeData.onChange?.(id, { useFunnel: checked })}
              aria-label="Embudo"
            />
          </div>

          {nodeData.useFunnel ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">Etapas del embudo</p>
              {PRODUCT_STAGES.map((stage) => (
                <div
                  key={stage.key}
                  className="relative rounded-xl border border-border bg-muted/30 px-3 py-2.5"
                >
                  <span className="text-xs font-medium text-foreground">{stage.label}</span>
                  <Handle
                    id={stage.key}
                    type="source"
                    position={Position.Right}
                    className="!-right-4 !h-4 !w-4 !border-2 !border-white !bg-emerald-500"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </BaseNodeContent>
      </BaseNode>
    </>
  );
}

type FlujoData = {
  flowId: string;
  flows?: AgentV2Flow[];
  onChange?: (id: string, patch: NodeDataPatch) => void;
  onDelete?: (id: string) => void;
};

function FlujoNode({ id, data, selected }: NodeProps) {
  const nodeData = data as FlujoData;
  const flows = nodeData.flows ?? [];

  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top} align="end" offset={8}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            nodeData.onDelete?.(id);
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
          aria-label="Eliminar flujo"
          title="Eliminar flujo"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </NodeToolbar>

      <Handle
        id="target"
        type="target"
        position={Position.Left}
        className="!h-4 !w-4 !border-2 !border-white !bg-indigo-600"
      />
      <BaseNode className="w-[300px]">
        <BaseNodeHeader className="items-center justify-start gap-2.5">
          <span className="inline-flex shrink-0 items-center justify-center">
            <Workflow className="h-4 w-4 text-indigo-600" />
          </span>
          <BaseNodeHeaderTitle className="truncate">Flujo</BaseNodeHeaderTitle>
        </BaseNodeHeader>
        <BaseNodeContent>
          <div className="nodrag space-y-1" onClick={(event) => event.stopPropagation()}>
            <label className="text-xs font-medium text-foreground">Flujo a ejecutar</label>
            <Select
              value={nodeData.flowId}
              onValueChange={(value) => nodeData.onChange?.(id, { flowId: value ?? "" })}
            >
              <SelectTrigger className="h-9 w-full text-xs">
                <SelectValue placeholder="Selecciona un flujo" />
              </SelectTrigger>
              <SelectContent className="p-1" alignItemWithTrigger={false} side="bottom">
                {flows.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No hay flujos creados
                  </div>
                ) : (
                  flows.map((flow) => (
                    <SelectItem key={flow.id} value={flow.id} className="text-xs">
                      {flow.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </BaseNodeContent>
        <Handle
          id="source"
          type="source"
          position={Position.Right}
          className="!h-4 !w-4 !border-2 !border-white !bg-indigo-600"
        />
      </BaseNode>
    </>
  );
}

type ConditionRule = {
  id: string;
  matchType: MatchType;
  keywords: string[];
  intent: string;
};

type ConditionData = {
  rules: ConditionRule[];
  onAddRule?: (
    nodeId: string,
    rule: { matchType: MatchType; keywords: string[]; intent: string },
  ) => void;
  onUpdateRule?: (
    nodeId: string,
    ruleId: string,
    patch: Partial<Pick<ConditionRule, "matchType" | "keywords" | "intent">>,
  ) => void;
  onDeleteRule?: (nodeId: string, ruleId: string) => void;
  onDelete?: (nodeId: string) => void;
};

function normalizeKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

const MATCH_OPTIONS: MatchType[] = ["exacta", "contiene", "ia"];
const MATCH_LABELS: Record<MatchType, string> = {
  exacta: "Exacta",
  contiene: "Contiene",
  ia: "IA",
};

function RulePopover({
  initialMatchType,
  initialKeywords,
  initialIntent,
  submitLabel,
  onSubmit,
  trigger,
}: {
  initialMatchType: MatchType;
  initialKeywords: string[];
  initialIntent: string;
  submitLabel: string;
  onSubmit: (matchType: MatchType, keywords: string[], intent: string) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [matchType, setMatchType] = useState<MatchType>(initialMatchType);
  const [keywords, setKeywords] = useState<string[]>(initialKeywords);
  const [draft, setDraft] = useState("");
  const [intent, setIntent] = useState(initialIntent);

  const addDraft = (current: string[]) => {
    const value = draft.trim();
    if (!value || current.includes(value)) {
      return current;
    }
    return [...current, value];
  };

  const commitDraft = () => {
    setKeywords((current) => addDraft(current));
    setDraft("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMatchType(initialMatchType);
          setKeywords(initialKeywords);
          setDraft("");
          setIntent(initialIntent);
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="nodrag w-72 space-y-3 rounded-2xl border border-border bg-background p-4 text-foreground"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Tipo de coincidencia</label>
          <div className="flex gap-0.5 rounded-lg border border-border p-0.5">
            {MATCH_OPTIONS.map((option) => {
              const active = matchType === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMatchType(option)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                    active
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {MATCH_LABELS[option]}
                </button>
              );
            })}
          </div>
        </div>
        {matchType === "ia" ? (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Intencion a detectar</label>
            <textarea
              autoFocus
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              placeholder="Ej. el cliente pregunta por precios o quiere comprar"
              className="block min-h-[72px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:focus:ring-amber-950"
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              La IA decide si el mensaje coincide con esta intencion.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Palabras o frases</label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background p-2 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-100 dark:focus-within:ring-amber-950">
              {keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                >
                  {keyword}
                  <button
                    type="button"
                    onClick={() => setKeywords((current) => current.filter((item) => item !== keyword))}
                    className="text-amber-700/70 transition hover:text-amber-900 dark:text-amber-300/70 dark:hover:text-amber-100"
                    aria-label={`Quitar ${keyword}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    commitDraft();
                  } else if (event.key === "Backspace" && !draft && keywords.length > 0) {
                    setKeywords((current) => current.slice(0, -1));
                  }
                }}
                onBlur={commitDraft}
                placeholder={keywords.length ? "Agregar otra…" : "Escribe y presiona Enter"}
                className="min-w-[90px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">
              Coincide si el texto matchea cualquiera (Enter o coma para agregar).
            </p>
          </div>
        )}
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            onSubmit(matchType, addDraft(keywords), intent);
            setOpen(false);
          }}
        >
          {submitLabel}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function ConditionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ConditionData;
  const rules = nodeData.rules ?? [];
  const elseConnections = useNodeConnections({ id, handleType: "source", handleId: "else" });
  const elseConnected = elseConnections.length > 0;

  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top} align="end" offset={8}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            nodeData.onDelete?.(id);
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
          aria-label="Eliminar condicion"
          title="Eliminar condicion"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </NodeToolbar>

      <Handle
        id="target"
        type="target"
        position={Position.Left}
        className="!h-4 !w-4 !border-2 !border-white !bg-amber-600"
      />
      <BaseNode className="w-[340px]">
        <BaseNodeHeader className="items-center justify-start gap-2.5">
          <span className="inline-flex shrink-0 items-center justify-center">
            <Filter className="h-4 w-4 text-amber-600" />
          </span>
          <BaseNodeHeaderTitle className="truncate">Condicion</BaseNodeHeaderTitle>
        </BaseNodeHeader>
        <BaseNodeContent className="space-y-2">
          {rules.map((rule, index) => (
            <div
              key={rule.id}
              className="nodrag relative flex items-stretch gap-1 rounded-xl border border-border bg-muted/30 pr-2"
              onClick={(event) => event.stopPropagation()}
            >
              <RulePopover
                initialMatchType={rule.matchType}
                initialKeywords={rule.keywords}
                initialIntent={rule.intent}
                submitLabel="Guardar"
                onSubmit={(matchType, keywords, intent) =>
                  nodeData.onUpdateRule?.(id, rule.id, { matchType, keywords, intent })
                }
                trigger={
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-l-xl px-3 py-2.5 text-left transition hover:bg-muted/60"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {index === 0 ? "Si" : "O si"}
                    </span>
                    <p className="text-sm text-foreground break-words">
                      <span>{MATCH_LABELS[rule.matchType]}</span>
                      {" · "}
                      {rule.matchType === "ia"
                        ? rule.intent.trim()
                          ? rule.intent
                          : "sin intencion"
                        : rule.keywords.length
                          ? rule.keywords.join(", ")
                          : "sin palabras"}
                    </p>
                  </button>
                }
              />
              {rules.length > 1 ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    nodeData.onDeleteRule?.(id, rule.id);
                  }}
                  className="my-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="Eliminar regla"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <Handle
                id={rule.id}
                type="source"
                position={Position.Right}
                className="!-right-4 !h-4 !w-4 !border-2 !border-white !bg-amber-500"
              />
            </div>
          ))}

          <RulePopover
            initialMatchType="contiene"
            initialKeywords={[]}
            initialIntent=""
            submitLabel="Agregar"
            onSubmit={(matchType, keywords, intent) =>
              nodeData.onAddRule?.(id, { matchType, keywords, intent })
            }
            trigger={
              <button
                type="button"
                className="nodrag flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar condicion
              </button>
            }
          />

          <div className="relative rounded-xl border border-border bg-muted/30 px-3 py-2.5">
            <span className="text-sm text-foreground">No (sin coincidencia)</span>
            {!elseConnected ? (
              <p className="text-[11px] leading-4 text-muted-foreground">
                Por defecto: responde la IA
              </p>
            ) : null}
            <Handle
              id="else"
              type="source"
              position={Position.Right}
              className="!-right-4 !h-4 !w-4 !border-2 !border-white !bg-slate-400"
            />
          </div>
        </BaseNodeContent>
      </BaseNode>
    </>
  );
}

type TextData = {
  text: string;
  onChange?: (id: string, patch: NodeDataPatch) => void;
  onDelete?: (id: string) => void;
};

function TextNode({ id, data, selected }: NodeProps) {
  const nodeData = data as TextData;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [nodeData.text]);

  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top} align="end" offset={8}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            nodeData.onDelete?.(id);
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
          aria-label="Eliminar texto"
          title="Eliminar texto"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </NodeToolbar>

      <Handle
        id="target"
        type="target"
        position={Position.Left}
        className="!h-4 !w-4 !border-2 !border-white !bg-sky-600"
      />
      <BaseNode className="w-[320px]">
        <BaseNodeHeader className="items-center justify-start gap-2.5">
          <span className="inline-flex shrink-0 items-center justify-center">
            <MessageSquare className="h-4 w-4 text-sky-600" />
          </span>
          <BaseNodeHeaderTitle className="truncate">Texto</BaseNodeHeaderTitle>
        </BaseNodeHeader>
        <BaseNodeContent>
          <textarea
            ref={textareaRef}
            value={nodeData.text}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => nodeData.onChange?.(id, { text: event.target.value })}
            placeholder="Escribe el mensaje a enviar..."
            className="nodrag block min-h-[72px] w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:focus:ring-sky-950"
          />
        </BaseNodeContent>
        <Handle
          id="source"
          type="source"
          position={Position.Right}
          className="!h-4 !w-4 !border-2 !border-white !bg-sky-600"
        />
      </BaseNode>
    </>
  );
}

const nodeTypes = {
  entrada: EntradaNode,
  agent: AgentNode,
  producto: ProductoNode,
  condicion: ConditionNode,
  texto: TextNode,
  flujo: FlujoNode,
};

type FlowEdgeData = {
  onDelete?: (edgeId: string) => void;
};

function AgentEdge({
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
          className="nodrag nopan inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-80 shadow-sm transition hover:bg-muted hover:text-foreground hover:opacity-100"
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

const edgeTypes = { agentEdge: AgentEdge };

type StoredGraph = {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Partial<EntradaData> &
      Partial<AgentData> &
      Partial<ProductoData> &
      Partial<ConditionData> &
      Partial<TextData> &
      Partial<FlujoData>;
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
        data: {
          kind: "general",
          welcome: "",
          keywords: "",
          useBusiness: false,
        } satisfies EntradaData,
      },
      {
        id: AGENT_NODE_ID,
        type: "agent",
        position: { x: 440, y: 80 },
        data: {
          name: agentName,
          welcome: "",
          prompt: "",
          fixedWelcome: false,
          consultProducts: true,
          consultFlows: true,
        } satisfies AgentData,
      },
    ],
    edges: [
      {
        id: "entry-general-agent",
        type: "agentEdge",
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
              fixedWelcome: node.data.fixedWelcome ?? false,
              consultProducts: node.data.consultProducts ?? true,
              consultFlows: node.data.consultFlows ?? true,
            } satisfies AgentData)
          : node.type === "producto"
            ? ({
                productId: node.data.productId ?? "",
                startOnMatch: node.data.startOnMatch ?? false,
                matchType: (node.data.matchType as MatchType) ?? "contiene",
                matchKeywords: normalizeKeywords(node.data.matchKeywords),
                intent: node.data.intent ?? "",
                useFunnel: node.data.useFunnel ?? false,
              } satisfies ProductoData)
            : node.type === "condicion"
              ? ({
                  rules:
                    Array.isArray(node.data.rules) && node.data.rules.length > 0
                      ? node.data.rules.map((rule, ruleIndex) => ({
                          id: rule.id ?? `${node.id}-r${ruleIndex}`,
                          matchType: (rule.matchType as MatchType) ?? "contiene",
                          keywords: normalizeKeywords(rule.keywords),
                          intent: rule.intent ?? "",
                        }))
                      : [
                          {
                            id: `${node.id}-r0`,
                            matchType: "contiene" as MatchType,
                            keywords: [],
                            intent: "",
                          },
                        ],
                } satisfies ConditionData)
              : node.type === "texto"
                ? ({
                    text: node.data.text ?? "",
                  } satisfies TextData)
                : node.type === "flujo"
                  ? ({
                      flowId: node.data.flowId ?? "",
                    } satisfies FlujoData)
                  : ({
                    kind: (node.data.kind as EntradaKind) ?? "general",
                    welcome: node.data.welcome ?? "",
                    keywords: node.data.keywords ?? "",
                    useBusiness: node.data.useBusiness ?? false,
                  } satisfies EntradaData),
      deletable: node.type === "agent" ? false : node.id !== "entry-general",
    }));
    const edges: Edge[] = parsed.edges.map((edge) => ({
      ...edge,
      type: "agentEdge",
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
  products: AgentV2Product[];
  flows: AgentV2Flow[];
  business: BusinessData;
  onBack: () => void;
};

function FlowCanvasInner({
  agentId,
  agentName,
  products,
  flows,
  business,
  onBack,
}: AgentV2FlowCanvasProps) {
  const initial = useMemo(() => loadGraph(agentId, agentName), [agentId, agentName]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const productCount = useRef(initial.nodes.filter((node) => node.type === "producto").length);
  const conditionCount = useRef(initial.nodes.filter((node) => node.type === "condicion").length);
  const textCount = useRef(initial.nodes.filter((node) => node.type === "texto").length);
  const flujoCount = useRef(initial.nodes.filter((node) => node.type === "flujo").length);

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

  const [businessData, setBusinessData] = useState<BusinessData>(business);
  const [, startSaveBusiness] = useTransition();

  const saveBusiness = useCallback((next: BusinessData) => {
    setBusinessData(next);
    startSaveBusiness(() => {
      void saveAgentV2BusinessConfigAction(next);
    });
  }, []);

  const updateProductMatch = useCallback(
    (nodeId: string, matchType: MatchType, keywords: string[], intent: string) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, matchType, matchKeywords: keywords, intent } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const addRule = useCallback(
    (nodeId: string, rule: { matchType: MatchType; keywords: string[]; intent: string }) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          const data = node.data as ConditionData;
          const rules = [...(data.rules ?? []), { id: crypto.randomUUID(), ...rule }];
          return { ...node, data: { ...node.data, rules } };
        }),
      );
    },
    [setNodes],
  );

  const updateRule = useCallback(
    (nodeId: string, ruleId: string, patch: Partial<Pick<ConditionRule, "matchType" | "keywords" | "intent">>) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          const data = node.data as ConditionData;
          const rules = (data.rules ?? []).map((rule) =>
            rule.id === ruleId ? { ...rule, ...patch } : rule,
          );
          return { ...node, data: { ...node.data, rules } };
        }),
      );
    },
    [setNodes],
  );

  const deleteRule = useCallback(
    (nodeId: string, ruleId: string) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          const data = node.data as ConditionData;
          const rules = (data.rules ?? []).filter((rule) => rule.id !== ruleId);
          return { ...node, data: { ...node.data, rules } };
        }),
      );
      setEdges((current) =>
        current.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === ruleId)),
      );
    },
    [setNodes, setEdges],
  );

  // Inyecta callbacks en los nodos de entrada (no se persisten, se re-atan en cada render).
  const nodesWithHandlers = useMemo(
    () =>
      nodes.map((node) => {
        if (node.type === "producto") {
          return {
            ...node,
            data: {
              ...node.data,
              onChange: updateNodeData,
              onUpdateMatch: updateProductMatch,
              onDelete: deleteEntrada,
              products,
            },
          };
        }
        if (node.type === "flujo") {
          return {
            ...node,
            data: { ...node.data, onChange: updateNodeData, onDelete: deleteEntrada, flows },
          };
        }
        if (node.type === "entrada") {
          return {
            ...node,
            data: {
              ...node.data,
              onChange: updateNodeData,
              business: businessData,
              onSaveBusiness: saveBusiness,
              onDelete: deleteEntrada,
            },
          };
        }
        if (node.type === "texto") {
          return { ...node, data: { ...node.data, onChange: updateNodeData, onDelete: deleteEntrada } };
        }
        if (node.type === "condicion") {
          return {
            ...node,
            data: {
              ...node.data,
              onAddRule: addRule,
              onUpdateRule: updateRule,
              onDeleteRule: deleteRule,
              onDelete: deleteEntrada,
            },
          };
        }
        if (node.type === "agent") {
          return { ...node, data: { ...node.data, onChange: updateNodeData } };
        }
        return node;
      }),
    [
      nodes,
      products,
      flows,
      businessData,
      updateNodeData,
      saveBusiness,
      updateProductMatch,
      deleteEntrada,
      addRule,
      updateRule,
      deleteRule,
    ],
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    },
    [setEdges],
  );

  const edgesWithHandlers = useMemo(
    () => edges.map((edge) => ({ ...edge, data: { ...edge.data, onDelete: deleteEdge } })),
    [edges, deleteEdge],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge(
          { ...connection, type: "agentEdge", markerEnd: { type: MarkerType.ArrowClosed } },
          current,
        ),
      );
    },
    [setEdges],
  );

  const addProduct = useCallback(() => {
    productCount.current += 1;
    const index = productCount.current;
    const newId = `producto-${crypto.randomUUID()}`;
    const newNode: Node = {
      id: newId,
      type: "producto",
      position: { x: 900, y: 60 + (index - 1) * 300 },
      data: {
        productId: "",
        startOnMatch: false,
        matchType: "contiene",
        matchKeywords: [],
        intent: "",
        useFunnel: false,
      } satisfies ProductoData,
    };
    setNodes((current) => [...current, newNode]);
    setEdges((current) =>
      addEdge(
        {
          source: AGENT_NODE_ID,
          sourceHandle: "source",
          target: newId,
          targetHandle: "target",
          type: "agentEdge",
          markerEnd: { type: MarkerType.ArrowClosed },
        },
        current,
      ),
    );
  }, [setNodes, setEdges]);

  const addCondition = useCallback(() => {
    conditionCount.current += 1;
    const index = conditionCount.current;
    const newId = `condicion-${crypto.randomUUID()}`;
    const newNode: Node = {
      id: newId,
      type: "condicion",
      position: { x: 900, y: 40 + (index - 1) * 340 },
      data: {
        rules: [{ id: `${newId}-r0`, matchType: "contiene", keywords: [], intent: "" }],
      } satisfies ConditionData,
    };
    setNodes((current) => [...current, newNode]);
    setEdges((current) =>
      addEdge(
        {
          source: AGENT_NODE_ID,
          sourceHandle: "source",
          target: newId,
          targetHandle: "target",
          type: "agentEdge",
          markerEnd: { type: MarkerType.ArrowClosed },
        },
        current,
      ),
    );
  }, [setNodes, setEdges]);

  const addText = useCallback(() => {
    textCount.current += 1;
    const index = textCount.current;
    const newId = `texto-${crypto.randomUUID()}`;
    const newNode: Node = {
      id: newId,
      type: "texto",
      position: { x: 900, y: 460 + (index - 1) * 300 },
      data: { text: "" } satisfies TextData,
    };
    setNodes((current) => [...current, newNode]);
  }, [setNodes]);

  const addFlujo = useCallback(() => {
    flujoCount.current += 1;
    const index = flujoCount.current;
    const newId = `flujo-${crypto.randomUUID()}`;
    const newNode: Node = {
      id: newId,
      type: "flujo",
      position: { x: 1320, y: 60 + (index - 1) * 220 },
      data: { flowId: "" } satisfies FlujoData,
    };
    setNodes((current) => [...current, newNode]);
  }, [setNodes]);

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
                fixedWelcome: (node.data as AgentData).fixedWelcome,
                consultProducts: (node.data as AgentData).consultProducts,
                consultFlows: (node.data as AgentData).consultFlows,
              }
            : node.type === "producto"
              ? {
                  productId: (node.data as ProductoData).productId,
                  startOnMatch: (node.data as ProductoData).startOnMatch,
                  matchType: (node.data as ProductoData).matchType,
                  matchKeywords: (node.data as ProductoData).matchKeywords,
                  intent: (node.data as ProductoData).intent,
                  useFunnel: (node.data as ProductoData).useFunnel,
                }
              : node.type === "condicion"
                ? {
                    rules: (node.data as ConditionData).rules,
                  }
                : node.type === "texto"
                  ? {
                      text: (node.data as TextData).text,
                    }
                  : node.type === "flujo"
                    ? {
                        flowId: (node.data as FlujoData).flowId,
                      }
                    : {
                        kind: (node.data as EntradaData).kind,
                        welcome: (node.data as EntradaData).welcome,
                        keywords: (node.data as EntradaData).keywords,
                        useBusiness: (node.data as EntradaData).useBusiness,
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={addProduct}>
            <ShoppingBag className="h-4 w-4" />
            Agregar producto
          </Button>
          <Button variant="outline" size="sm" onClick={addCondition}>
            <Split className="h-4 w-4" />
            Agregar condicion
          </Button>
          <Button variant="outline" size="sm" onClick={addText}>
            <MessageSquare className="h-4 w-4" />
            Agregar texto
          </Button>
          <Button variant="outline" size="sm" onClick={addFlujo}>
            <Workflow className="h-4 w-4" />
            Agregar flujo
          </Button>
        </div>
      </div>
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodesWithHandlers}
          edges={edgesWithHandlers}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          deleteKeyCode={["Backspace", "Delete"]}
          minZoom={0.05}
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
