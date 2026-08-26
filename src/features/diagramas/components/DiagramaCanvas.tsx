"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guardarDiagramaAction } from "@/app/actions/diagram-actions";
import { NodoIdea } from "./NodoIdea";

/**
 * El lienzo de un mapa mental.
 *
 * Se guarda SOLO, sin botón de guardar: es una herramienta para pensar, y pensar no se
 * interrumpe para apretar un botón. El guardado va con retardo —dos segundos sin tocar nada— para
 * no mandar un pedido por cada píxel que se arrastra una caja.
 *
 * Las cajas se crean con doble clic sobre el lienzo, que es donde uno ya está mirando cuando se le
 * ocurre la idea, en vez de tener que ir a buscar un botón a la esquina.
 */

export type DiagramaGuardado = {
  nodes?: Node[];
  edges?: Edge[];
};

const RETARDO_GUARDADO_MS = 2000;

export function DiagramaCanvas({
  id,
  tituloInicial,
  contenidoInicial,
}: {
  id: string;
  tituloInicial: string;
  contenidoInicial: DiagramaGuardado | null;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(contenidoInicial?.nodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(contenidoInicial?.edges ?? []);
  const [titulo, setTitulo] = useState(tituloInicial);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(true);

  const flujoRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lo último que se quiere guardar. Vive en una ref para que el temporizador siempre mande el
  // estado más nuevo, y no el que existía cuando se programó.
  const pendienteRef = useRef<{ titulo: string; data: DiagramaGuardado } | null>(null);

  /**
   * El estado actual, en refs.
   *
   * `programarGuardado` NO puede depender de `nodes`: si dependiera, cambiaria de identidad con
   * cada tecla, y con el los manejadores y el `nodeTypes` de React Flow. React Flow trata un
   * nodeTypes nuevo como tipos nuevos y REMONTA todas las cajas: el textarea se destruia a cada
   * letra y el cursor se perdia. Leyendo de refs, la funcion es estable y el guardado igual manda
   * lo ultimo.
   */
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const tituloRef = useRef(titulo);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  useEffect(() => {
    tituloRef.current = titulo;
  }, [titulo]);

  const guardarAhora = useCallback(async () => {
    const pendiente = pendienteRef.current;
    if (!pendiente) {
      return;
    }
    pendienteRef.current = null;
    setGuardando(true);
    const resultado = await guardarDiagramaAction({
      id,
      titulo: pendiente.titulo,
      data: pendiente.data,
    });
    setGuardando(false);
    if (resultado?.error) {
      toast.error(resultado.error);
      return;
    }
    setGuardado(true);
  }, [id]);

  const programarGuardado = useCallback(
    (siguienteTitulo?: string) => {
      // El contenido se lee al DISPARAR el temporizador, no al programarlo: entre una tecla y la
      // siguiente el mapa sigue cambiando, y guardar la foto vieja perderia las ultimas letras.
      pendienteRef.current = { titulo: siguienteTitulo ?? tituloRef.current, data: { nodes: [], edges: [] } };
      setGuardado(false);
      if (temporizadorRef.current) {
        clearTimeout(temporizadorRef.current);
      }
      temporizadorRef.current = setTimeout(() => {
        pendienteRef.current = {
          titulo: siguienteTitulo ?? tituloRef.current,
          data: { nodes: nodesRef.current, edges: edgesRef.current },
        };
        void guardarAhora();
      }, RETARDO_GUARDADO_MS);
    },
    [guardarAhora],
  );

  /**
   * Guardar lo pendiente al salir.
   *
   * Sin esto, cerrar la pestaña dentro de los dos segundos de gracia se llevaba el último cambio.
   * Es el momento exacto en que uno anota la idea y se va.
   */
  useEffect(() => {
    const alSalir = () => {
      if (pendienteRef.current) {
        void guardarAhora();
      }
    };
    window.addEventListener("pagehide", alSalir);
    return () => {
      window.removeEventListener("pagehide", alSalir);
      alSalir();
    };
  }, [guardarAhora]);

  const alConectar = useCallback(
    (conexion: Connection) => {
      setEdges((actuales) => addEdge({ ...conexion, animated: false }, actuales));
      programarGuardado();
    },
    [programarGuardado, setEdges],
  );

  const agregarIdea = useCallback(
    (posicion?: { x: number; y: number }) => {
      const centro =
        posicion ??
        flujoRef.current?.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }) ?? { x: 0, y: 0 };

      const nuevo: Node = {
        id: `idea-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        type: "idea",
        position: centro,
        data: { texto: "" },
      };
      setNodes((actuales) => [...actuales, nuevo]);
      programarGuardado();
    },
    [programarGuardado, setNodes],
  );

  /** Cambiar el texto de una caja. Va por el `data` del nodo para que se guarde con el resto. */
  const cambiarTexto = useCallback(
    (idNodo: string, texto: string) => {
      setNodes((actuales) =>
        actuales.map((nodo) => (nodo.id === idNodo ? { ...nodo, data: { ...nodo.data, texto } } : nodo)),
      );
      programarGuardado();
    },
    [programarGuardado, setNodes],
  );

  /** El color de una idea. Va en su `data`, asi viaja con el resto del guardado. */
  const cambiarColor = useCallback(
    (idNodo: string, color: string) => {
      setNodes((actuales) =>
        actuales.map((nodo) => (nodo.id === idNodo ? { ...nodo, data: { ...nodo.data, color } } : nodo)),
      );
      programarGuardado();
    },
    [programarGuardado, setNodes],
  );

  const borrarNodo = useCallback(
    (idNodo: string) => {
      setNodes((actuales) => actuales.filter((nodo) => nodo.id !== idNodo));
      setEdges((actuales) =>
        actuales.filter((arista) => arista.source !== idNodo && arista.target !== idNodo),
      );
      programarGuardado();
    },
    [programarGuardado, setEdges, setNodes],
  );

  /**
   * Los manejadores, en una ref.
   *
   * `nodeTypes` tiene que ser SIEMPRE el mismo objeto: React Flow compara por identidad y, si
   * cambia, remonta todas las cajas. Pasando los manejadores por una ref, el memo se crea una
   * sola vez y las cajas nunca se destruyen mientras se escribe.
   */
  const manejadoresRef = useRef({ cambiarTexto, cambiarColor, borrarNodo });
  useEffect(() => {
    manejadoresRef.current = { cambiarTexto, cambiarColor, borrarNodo };
  }, [borrarNodo, cambiarColor, cambiarTexto]);

  const tiposDeNodo = useMemo(
    () => ({
      idea: (props: NodeProps) => (
        <NodoIdea
          {...props}
          onTexto={(idNodo, texto) => manejadoresRef.current.cambiarTexto(idNodo, texto)}
          onColor={(idNodo, color) => manejadoresRef.current.cambiarColor(idNodo, color)}
          onBorrar={(idNodo) => manejadoresRef.current.borrarNodo(idNodo)}
        />
      ),
    }),
    [],
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Input
          value={titulo}
          onChange={(evento) => {
            setTitulo(evento.target.value);
            programarGuardado(evento.target.value);
          }}
          placeholder="Sin título"
          className="h-9 max-w-xs border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0"
        />

        {/* Estado del guardado: es la única forma de confiar en que no hay que apretar nada. */}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {guardando ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Guardando…
            </>
          ) : guardado ? (
            <>
              <Check className="size-3 text-emerald-600" /> Guardado
            </>
          ) : (
            "Sin guardar"
          )}
        </span>

        <Button size="sm" className="ml-auto gap-1.5" onClick={() => agregarIdea()}>
          <Plus className="size-4" />
          Idea
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(cambios) => {
            onNodesChange(cambios);
            // Mover o seleccionar no ensucia el guardado; agregar o borrar sí.
            if (cambios.some((cambio) => cambio.type === "position" && !cambio.dragging)) {
              programarGuardado();
            }
          }}
          onEdgesChange={(cambios) => {
            onEdgesChange(cambios);
            if (cambios.some((cambio) => cambio.type === "remove")) {
              programarGuardado();
            }
          }}
          onConnect={alConectar}
          onInit={(instancia) => {
            flujoRef.current = instancia;
          }}
          onDoubleClick={(evento) => {
            // Doble clic en el lienzo VACIO crea una idea ahi mismo. Si el doble clic cayo sobre
            // una caja, no: ahi lo que uno quiere es escribir.
            const destino = evento.target as HTMLElement;
            if (destino.closest(".react-flow__node")) {
              return;
            }
            const posicion = flujoRef.current?.screenToFlowPosition({
              x: evento.clientX,
              y: evento.clientY,
            });
            agregarIdea(posicion);
          }}
          nodeTypes={tiposDeNodo}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-muted/30"
        >
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {nodes.length === 0 ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-24 text-center text-xs text-muted-foreground">
          Doble clic en el lienzo para poner una idea. Arrastrá de un borde a otro para unirlas.
        </p>
      ) : null}
    </div>
  );
}
