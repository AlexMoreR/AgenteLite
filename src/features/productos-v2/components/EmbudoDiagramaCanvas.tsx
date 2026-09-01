"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { saveProductFunnelAction } from "@/app/actions/product-playbook-actions";
import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";

export type EtapaDelEmbudo = {
  stage: string;
  goal: string;
  script: string;
};

type DatosDeEtapa = {
  numero: number;
  titulo: string;
  ayuda: string;
  goal: string;
  script: string;
  perdidos?: { valor: number; pct: number };
  onChange: (stage: string, campo: "goal" | "script", valor: string) => void;
  stage: string;
};

const ANCHO = 320;
const PASO_HORIZONTAL = 420;

/**
 * Una etapa del embudo, como caja del lienzo.
 *
 * Las cinco son FIJAS: no se agregan, no se borran, no cambian de orden. El embudo es el recorrido
 * de una venta y esas cinco etapas son el recorrido; poder agregar una sexta convertiria esto en
 * un lienzo libre donde cada producto inventa su propio embudo y despues no se pueden comparar.
 *
 * Lo unico que se toca son los dos campos: que hay que lograr, y que decir para lograrlo.
 */
function EtapaNode({ data }: NodeProps) {
  const d = data as unknown as DatosDeEtapa;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-emerald-600"
      />
      <div
        className="rounded-2xl border border-border bg-card shadow-sm"
        style={{ width: ANCHO }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
              d.goal || d.script
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {d.numero}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {d.titulo}
          </span>
          {/* Cuanta gente se va sin pasar de aca: es lo que convierte el dibujo en un diagnostico. */}
          {d.perdidos ? (
            <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium leading-none text-amber-700 tabular-nums dark:bg-amber-950 dark:text-amber-300">
              {d.perdidos.valor} · {d.perdidos.pct}%
            </span>
          ) : null}
        </div>

        <div className="space-y-2.5 px-3 py-3">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Qué hay que lograr
            </p>
            <textarea
              className="nodrag w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] leading-5 text-foreground outline-none focus:border-[var(--primary)]"
              rows={2}
              value={d.goal}
              placeholder={d.ayuda}
              onChange={(evento) => d.onChange(d.stage, "goal", evento.target.value)}
            />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Qué decir
            </p>
            <textarea
              className="nodrag w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] leading-5 text-foreground outline-none focus:border-[var(--primary)]"
              rows={6}
              value={d.script}
              placeholder="El mensaje que le llega al cliente en esta etapa."
              onChange={(evento) => d.onChange(d.stage, "script", evento.target.value)}
            />
          </div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-emerald-600"
      />
    </>
  );
}

const nodeTypes = { etapa: EtapaNode };

function Lienzo({
  productId,
  productName,
  etapasIniciales,
  perdidosEnEtapa,
  volverA,
}: {
  productId: string;
  productName: string;
  etapasIniciales: EtapaDelEmbudo[];
  perdidosEnEtapa: Record<string, { valor: number; pct: number } | undefined>;
  volverA: string;
}) {
  const [etapas, setEtapas] = useState<EtapaDelEmbudo[]>(() =>
    PRODUCT_FUNNEL_STAGES.map((meta) => {
      const guardada = etapasIniciales.find((item) => item.stage === meta.stage);
      return {
        stage: meta.stage,
        goal: guardada?.goal ?? "",
        script: guardada?.script ?? "",
      };
    }),
  );
  const [guardando, setGuardando] = useState(false);
  const [hayCambios, setHayCambios] = useState(false);

  /*
    Los campos viven en una ref ademas del estado.

    El `data` de un nodo de React Flow se arma una sola vez; si el manejador leyera del estado,
    escribiria siempre sobre el valor que existia al montar y se perderia todo menos la ultima
    tecla. Es el mismo problema que ya aparecio en el lienzo de ideas.
  */
  const etapasRef = useRef(etapas);
  etapasRef.current = etapas;

  const cambiar = useCallback((stage: string, campo: "goal" | "script", valor: string) => {
    setHayCambios(true);
    setEtapas(
      etapasRef.current.map((item) => (item.stage === stage ? { ...item, [campo]: valor } : item)),
    );
  }, []);

  const nodosIniciales = useMemo<Node[]>(
    () =>
      PRODUCT_FUNNEL_STAGES.map((meta, indice) => ({
        id: meta.stage,
        type: "etapa",
        position: { x: indice * PASO_HORIZONTAL, y: 0 },
        // Fijas: el embudo es un recorrido, no un lienzo libre.
        deletable: false,
        data: {} as Record<string, unknown>,
      })),
    [],
  );

  const aristasIniciales = useMemo<Edge[]>(
    () =>
      PRODUCT_FUNNEL_STAGES.slice(0, -1).map((meta, indice) => ({
        id: `${meta.stage}-${PRODUCT_FUNNEL_STAGES[indice + 1].stage}`,
        source: meta.stage,
        target: PRODUCT_FUNNEL_STAGES[indice + 1].stage,
        deletable: false,
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    [],
  );

  const [nodes, , onNodesChange] = useNodesState<Node>(nodosIniciales);
  const [edges, , onEdgesChange] = useEdgesState<Edge>(aristasIniciales);

  // Los datos se inyectan en cada pintada: asi la caja siempre muestra lo que hay en el estado.
  const nodosConDatos = useMemo(
    () =>
      nodes.map((nodo) => {
        const meta = PRODUCT_FUNNEL_STAGES.find((item) => item.stage === nodo.id);
        const etapa = etapas.find((item) => item.stage === nodo.id);
        const indice = PRODUCT_FUNNEL_STAGES.findIndex((item) => item.stage === nodo.id);
        return {
          ...nodo,
          data: {
            numero: indice + 1,
            titulo: meta?.label ?? nodo.id,
            ayuda: meta?.ayuda ?? "",
            goal: etapa?.goal ?? "",
            script: etapa?.script ?? "",
            perdidos: perdidosEnEtapa[nodo.id],
            stage: nodo.id,
            onChange: cambiar,
          } satisfies DatosDeEtapa as unknown as Record<string, unknown>,
        };
      }),
    [nodes, etapas, perdidosEnEtapa, cambiar],
  );

  const guardar = async () => {
    setGuardando(true);
    try {
      const resultado = await saveProductFunnelAction({
        productId,
        stages: etapas.map((item) => ({
          stage: item.stage,
          goal: item.goal,
          script: item.script,
        })),
      });
      if (resultado?.error) {
        toast.error(resultado.error);
        return;
      }
      setHayCambios(false);
      toast.success("Embudo guardado");
    } catch {
      toast.error("No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Link
          href={volverA}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Volver"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{productName}</p>
          <p className="text-[12px] text-muted-foreground">Embudo</p>
        </div>
        {hayCambios ? (
          <span className="text-xs text-amber-700 dark:text-amber-300">Sin guardar</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Guardado
          </span>
        )}
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={guardando}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Guardar
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodosConDatos}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          // No se conecta ni se desconecta nada: el recorrido es siempre el mismo.
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function EmbudoDiagramaCanvas(props: {
  productId: string;
  productName: string;
  etapasIniciales: EtapaDelEmbudo[];
  perdidosEnEtapa: Record<string, { valor: number; pct: number } | undefined>;
  volverA: string;
}) {
  return (
    <ReactFlowProvider>
      <Lienzo {...props} />
    </ReactFlowProvider>
  );
}
