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
import { ArrowLeft, Check, Clock, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { saveProductFunnelAction } from "@/app/actions/product-playbook-actions";
import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";

export type SeguimientoDeEmbudo = {
  timeType: string;
  timeValue: number;
  content: string;
};

export type EtapaDelEmbudo = {
  stage: string;
  goal: string;
  script: string;
  followUps: SeguimientoDeEmbudo[];
};

/*
  La escalera de esperas, la misma que en el constructor del agente.

  Insistir a los cinco minutos sirve mientras el cliente todavia tiene el telefono en la mano; a
  los tres dias ya es otra conversacion. Se agregan de a una con el "+", no aparecen las cuatro.
*/
const ESCALERA = [
  { timeType: "MINUTES", timeValue: 5 },
  { timeType: "HOURS", timeValue: 1 },
  { timeType: "DAYS", timeValue: 1 },
  { timeType: "DAYS", timeValue: 3 },
] as const;

/** Como se lee un tiempo de espera. La base guarda MINUTES/HOURS/DAYS y un numero. */
const UNIDAD: Record<string, string> = {
  MINUTES: "minutos",
  HOURS: "horas",
  DAYS: "dias",
};

/**
 * Un campo de texto que crece con lo que se escribe.
 *
 * Con alto fijo, un mensaje de tres renglones se leia por una ventanita con barra al costado, y en
 * el lienzo no hay forma de agrandar la fila: el texto quedaba escondido justo donde uno lo
 * quiere revisar. Creciendo, la caja siempre muestra el mensaje entero.
 */
function CampoQueCrece({
  value,
  placeholder,
  onChange,
  className,
}: {
  value: string;
  placeholder: string;
  onChange: (valor: string) => void;
  className: string;
}) {
  const ajustar = (elemento: HTMLTextAreaElement | null) => {
    if (!elemento) {
      return;
    }
    // Se pone en cero primero: si no, el alto solo crece y nunca se achica al borrar texto.
    elemento.style.height = "0px";
    elemento.style.height = `${elemento.scrollHeight}px`;
  };

  return (
    <textarea
      ref={ajustar}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(evento) => {
        ajustar(evento.currentTarget);
        onChange(evento.target.value);
      }}
      className={className}
    />
  );
}

function comoSeLee(seguimiento: SeguimientoDeEmbudo): string {
  const unidad = UNIDAD[seguimiento.timeType] ?? seguimiento.timeType.toLowerCase();
  // "1 horas" se lee mal y aparece seguido: casi todos los seguimientos empiezan en uno.
  const singular = seguimiento.timeValue === 1 ? unidad.replace(/s$/, "") : unidad;
  return `${seguimiento.timeValue} ${singular} sin responder`;
}

type DatosDeEtapa = {
  numero: number;
  titulo: string;
  ayuda: string;
  goal: string;
  script: string;
  followUps: SeguimientoDeEmbudo[];
  perdidos?: { valor: number; pct: number };
  onChange: (stage: string, campo: "goal" | "script", valor: string) => void;
  onSeguimiento: (stage: string, posicion: number, texto: string) => void;
  onAgregarSeguimiento: (stage: string) => void;
  onBorrarSeguimiento: (stage: string, posicion: number) => void;
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
function EtapaNode({ data, width }: NodeProps) {
  const d = data as unknown as DatosDeEtapa;
  // El ancho lo manda el nodo cuando se lo estiro a mano; si no, el de siempre.
  const ancho = typeof width === "number" && width > 0 ? width : ANCHO;

  return (
    <>
      {/*
        Los conectores van al medio de la CAJA, no del nodo entero.

        Estaban puestos al nivel del nodo, y React Flow los centra sobre TODO lo que el nodo ocupa
        -caja mas esperas-, asi que la linea salia por el borde de abajo de la caja y parecia colgar
        de la nada. Metidos adentro de este envoltorio, que solo contiene la caja, el 50% es el
        medio de la caja.
      */}
      <div className="relative" style={{ width: ancho }}>
        <Handle
          type="target"
          position={Position.Left}
          style={{ top: "50%" }}
          className="!h-3 !w-3 !border-2 !border-white !bg-emerald-600"
        />
        <Handle
          type="source"
          position={Position.Right}
          style={{ top: "50%" }}
          className="!h-3 !w-3 !border-2 !border-white !bg-emerald-600"
        />
        {/*
          La caja se agranda desde su esquina.

          Con `resize` del navegador y no con el redimensionador de React Flow: ese estira el NODO
          entero -caja y esperas juntas-, y lo que hace falta es poder agrandar cada pieza por su
          cuenta. El `nodrag` es imprescindible: sin el, arrastrar la esquina mueve la caja en vez
          de estirarla.
        */}
        <div
          className="nodrag resize overflow-auto rounded-2xl border border-border bg-card shadow-sm"
          style={{ minWidth: 240, minHeight: 140 }}
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
            <CampoQueCrece
              className="nodrag w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] leading-5 text-foreground outline-none focus:border-[var(--primary)]"
              value={d.goal}
              placeholder={d.ayuda}
              onChange={(valor) => d.onChange(d.stage, "goal", valor)}
            />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Qué decir
            </p>
            <CampoQueCrece
              className="nodrag w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] leading-5 text-foreground outline-none focus:border-[var(--primary)]"
              value={d.script}
              placeholder="El mensaje que le llega al cliente en esta etapa."
              onChange={(valor) => d.onChange(d.stage, "script", valor)}
            />
          </div>
        </div>

        </div>
      </div>

      {/*
        Las esperas van PEGADAS abajo de la caja, no adentro.

        Es la misma forma que en el constructor del agente: una fila con su icono y su punto al
        costado. Adentro de la caja se leian como un renglon mas del guion; afuera se leen como lo
        que son, salidas de esta etapa.

        Aca esta la mitad del embudo que faltaba: el guion dice que se manda cuando el cliente
        responde, y esto dice que pasa cuando NO responde, que en este producto es el 100% de los
        que se caen.
      */}
      <div className="mt-1.5 space-y-1.5" style={{ width: ancho }}>
        {d.followUps.map((seguimiento, posicion) => (
          <div
            key={`${d.stage}-${posicion}`}
            className="nodrag flex resize items-start gap-2 overflow-auto rounded-xl border border-border bg-card px-2 py-2 shadow-sm"
            style={{ minHeight: 56 }}
          >
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium text-foreground">
                {comoSeLee(seguimiento)}
              </span>
              {/* Sin marco ni relleno: la fila YA es el contenedor, y un campo con su propio
                  borde adentro era una caja dentro de otra. */}
              <CampoQueCrece
                value={seguimiento.content}
                placeholder="Que se le manda. Sin mensaje no se guarda."
                onChange={(valor) => d.onSeguimiento(d.stage, posicion, valor)}
                className="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[11px] leading-4 text-foreground outline-none focus:ring-0"
              />
            </span>
            <button
              type="button"
              onClick={() => d.onBorrarSeguimiento(d.stage, posicion)}
              aria-label="Quitar esta espera"
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {d.followUps.length < ESCALERA.length ? (
          <button
            type="button"
            onClick={() => d.onAgregarSeguimiento(d.stage)}
            className="nodrag flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground transition hover:border-solid hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-4 w-4 shrink-0" />
            Si no contesta
          </button>
        ) : null}
      </div>
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
        followUps: guardada?.followUps ?? [],
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

  const cambiarSeguimiento = useCallback((stage: string, posicion: number, texto: string) => {
    setHayCambios(true);
    setEtapas(
      etapasRef.current.map((item) =>
        item.stage === stage
          ? {
              ...item,
              followUps: item.followUps.map((seguimiento, indice) =>
                indice === posicion ? { ...seguimiento, content: texto } : seguimiento,
              ),
            }
          : item,
      ),
    );
  }, []);

  /*
    La espera nueva toma el siguiente escalon que falte.

    Se elige por posicion y no se deja escribir cualquier numero: dos productos con "a los 5
    minutos" y "a los 7 minutos" no se pueden comparar entre si, y nadie va a poder decir cual de
    los dos anda mejor.
  */
  const agregarSeguimiento = useCallback((stage: string) => {
    setHayCambios(true);
    setEtapas(
      etapasRef.current.map((item) => {
        if (item.stage !== stage || item.followUps.length >= ESCALERA.length) {
          return item;
        }
        const siguiente = ESCALERA[item.followUps.length];
        return {
          ...item,
          followUps: [
            ...item.followUps,
            { timeType: siguiente.timeType, timeValue: siguiente.timeValue, content: "" },
          ],
        };
      }),
    );
  }, []);

  const borrarSeguimiento = useCallback((stage: string, posicion: number) => {
    setHayCambios(true);
    setEtapas(
      etapasRef.current.map((item) =>
        item.stage === stage
          ? { ...item, followUps: item.followUps.filter((_, indice) => indice !== posicion) }
          : item,
      ),
    );
  }, []);

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
            followUps: etapa?.followUps ?? [],
            perdidos: perdidosEnEtapa[nodo.id],
            stage: nodo.id,
            onChange: cambiar,
            onSeguimiento: cambiarSeguimiento,
            onAgregarSeguimiento: agregarSeguimiento,
            onBorrarSeguimiento: borrarSeguimiento,
          } satisfies DatosDeEtapa as unknown as Record<string, unknown>,
        };
      }),
    [nodes, etapas, perdidosEnEtapa, cambiar, cambiarSeguimiento, agregarSeguimiento, borrarSeguimiento],
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
          /*
            Los seguimientos VUELVEN aunque este lienzo no los edite.

            La accion de guardar los borra y los vuelve a crear con lo que le llega. Mandando solo
            el guion, el primer "Guardar" desde aca le borraba a Alex todos los "si no contesta" de
            las cinco etapas, en silencio y sin manera de recuperarlos.
          */
          followUps: item.followUps.map((seguimiento) => ({
            timeType: seguimiento.timeType,
            timeValue: seguimiento.timeValue,
            content: seguimiento.content,
          })),
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
