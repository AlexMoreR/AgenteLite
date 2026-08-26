"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
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
import { AristaBorrable } from "./AristaBorrable";

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
  /*
    Las conexiones guardadas ANTES de que existiera el boton de quitar no traen tipo, y sin tipo
    se dibujan como una linea pelada. Se les pone al abrir para que todas se puedan borrar igual.
  */
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    (contenidoInicial?.edges ?? []).map((arista) => ({ ...arista, type: "borrable" })),
  );
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

  /**
   * Copiar y pegar con Ctrl+C / Ctrl+V.
   *
   * El portapapeles es propio del diagrama, no el del sistema: lo que se copia es una idea con su
   * texto, ícono, color y tamaño, y eso no entra en el portapapeles del navegador.
   *
   * Se ignora cuando el cursor está dentro de un texto: ahí Ctrl+C tiene que copiar las palabras
   * que uno marcó, no la caja entera.
   */
  const portapapelesRef = useRef<Node[]>([]);
  const pegadasRef = useRef(0);

  useEffect(() => {
    const alTeclado = (evento: KeyboardEvent) => {
      if (!(evento.ctrlKey || evento.metaKey)) {
        return;
      }
      const destino = evento.target as HTMLElement | null;
      if (destino?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }

      const tecla = evento.key.toLowerCase();

      if (tecla === "c") {
        const elegidas = nodesRef.current.filter((nodo) => nodo.selected);
        if (elegidas.length === 0) {
          return;
        }
        portapapelesRef.current = elegidas;
        pegadasRef.current = 0;
        toast.success(elegidas.length === 1 ? "Idea copiada" : `${elegidas.length} ideas copiadas`);
        return;
      }

      if (tecla === "v") {
        const copiadas = portapapelesRef.current;
        if (copiadas.length === 0) {
          return;
        }
        evento.preventDefault();
        // Cada pegada se corre un poco mas: pegar dos veces seguidas dejaba las copias una encima
        // de la otra y parecia que la segunda no habia funcionado.
        pegadasRef.current += 1;
        const corrimiento = 28 * pegadasRef.current;
        const marca = Date.now();

        setNodes((actuales) => [
          ...actuales.map((nodo) => ({ ...nodo, selected: false })),
          ...copiadas.map((original, indice) => ({
            ...original,
            id: `idea-${marca}-${indice}-${Math.round(Math.random() * 1000)}`,
            position: {
              x: original.position.x + corrimiento,
              y: original.position.y + corrimiento,
            },
            data: { ...original.data },
            selected: true,
          })),
        ]);
        programarGuardado();
      }
    };

    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [programarGuardado, setNodes]);

  const alConectar = useCallback(
    (conexion: Connection) => {
      setEdges((actuales) => addEdge({ ...conexion, type: "borrable", animated: false }, actuales));
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
        // Ancho inicial comodo para escribir. Despues se puede achicar hasta el tamano del texto
        // con la manija de la esquina: el minimo del nodo es chico a proposito.
        style: { width: 180 },
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

  /** El ícono de una idea. Vacío = sin ícono. */
  const cambiarIcono = useCallback(
    (idNodo: string, icono: string) => {
      setNodes((actuales) =>
        actuales.map((nodo) => (nodo.id === idNodo ? { ...nodo, data: { ...nodo.data, icono } } : nodo)),
      );
      programarGuardado();
    },
    [programarGuardado, setNodes],
  );

  /**
   * Copiar una idea con todo lo suyo: texto, ícono, color y tamaño.
   *
   * La copia cae corrida y queda SELECCIONADA, así se puede arrastrar o editar de una. Encimada
   * sobre el original parecía que no había pasado nada.
   */
  const duplicarNodo = useCallback(
    (idNodo: string) => {
      setNodes((actuales) => {
        const original = actuales.find((nodo) => nodo.id === idNodo);
        if (!original) {
          return actuales;
        }
        const copia: Node = {
          ...original,
          id: `idea-${Date.now()}-${Math.round(Math.random() * 1000)}`,
          position: { x: original.position.x + 28, y: original.position.y + 28 },
          data: { ...original.data },
          selected: true,
        };
        return [...actuales.map((nodo) => ({ ...nodo, selected: false })), copia];
      });
      programarGuardado();
    },
    [programarGuardado, setNodes],
  );

  /**
   * Agregar una idea YA CONECTADA a la actual, a su derecha.
   *
   * Es el camino rapido para armar una cadena: sin esto habia que crear la caja, arrastrarla al
   * lugar y despues tirar la union a mano, tres pasos para lo que en un diagrama de flujo es uno
   * solo -"y despues pasa esto"-.
   */
  const agregarConectada = useCallback(
    (idOrigen: string) => {
      const marca = Date.now();
      const idNueva = `idea-${marca}-${Math.round(Math.random() * 1000)}`;

      setNodes((actuales) => {
        const origen = actuales.find((nodo) => nodo.id === idOrigen);
        if (!origen) {
          return actuales;
        }
        const anchoOrigen =
          typeof origen.style?.width === "number" ? origen.style.width : (origen.measured?.width ?? 180);
        return [
          ...actuales.map((nodo) => ({ ...nodo, selected: false })),
          {
            id: idNueva,
            type: "idea",
            position: { x: origen.position.x + anchoOrigen + 90, y: origen.position.y },
            style: { width: 180 },
            data: { texto: "" },
            selected: true,
          } satisfies Node,
        ];
      });

      // Sale del punto derecho del original y entra por el izquierdo de la nueva: es el sentido
      // en que se lee un flujo.
      setEdges((actuales) => [
        ...actuales,
        {
          id: `union-${marca}`,
          source: idOrigen,
          sourceHandle: "derecha-out",
          target: idNueva,
          targetHandle: "izquierda-in",
          type: "borrable",
        } satisfies Edge,
      ]);

      programarGuardado();
    },
    [programarGuardado, setEdges, setNodes],
  );

  const borrarArista = useCallback(
    (idArista: string) => {
      setEdges((actuales) => actuales.filter((arista) => arista.id !== idArista));
      programarGuardado();
    },
    [programarGuardado, setEdges],
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
  const manejadoresRef = useRef({
    cambiarTexto,
    cambiarColor,
    cambiarIcono,
    duplicarNodo,
    agregarConectada,
    borrarNodo,
    borrarArista,
  });
  useEffect(() => {
    manejadoresRef.current = {
      cambiarTexto,
      cambiarColor,
      cambiarIcono,
      duplicarNodo,
      agregarConectada,
      borrarNodo,
      borrarArista,
    };
  }, [
    agregarConectada,
    borrarArista,
    borrarNodo,
    cambiarColor,
    cambiarIcono,
    cambiarTexto,
    duplicarNodo,
  ]);

  const tiposDeNodo = useMemo(
    () => ({
      idea: (props: NodeProps) => (
        <NodoIdea
          {...props}
          onTexto={(idNodo, texto) => manejadoresRef.current.cambiarTexto(idNodo, texto)}
          onColor={(idNodo, color) => manejadoresRef.current.cambiarColor(idNodo, color)}
          onIcono={(idNodo, icono) => manejadoresRef.current.cambiarIcono(idNodo, icono)}
          onDuplicar={(idNodo) => manejadoresRef.current.duplicarNodo(idNodo)}
          onAgregarConectada={(idNodo) => manejadoresRef.current.agregarConectada(idNodo)}
          onBorrar={(idNodo) => manejadoresRef.current.borrarNodo(idNodo)}
        />
      ),
    }),
    [],
  );

  // Mismo motivo que nodeTypes: si el objeto cambia, React Flow rehace las lineas.
  const tiposDeArista = useMemo(
    () => ({
      borrable: (props: EdgeProps) => (
        <AristaBorrable {...props} onBorrar={(idArista) => manejadoresRef.current.borrarArista(idArista)} />
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
            // Mover o seleccionar no ensucia el guardado; soltar despues de mover, estirar la
            // caja, agregar o borrar si.
            if (
              cambios.some(
                (cambio) =>
                  (cambio.type === "position" && !cambio.dragging) ||
                  (cambio.type === "dimensions" && cambio.resizing === false) ||
                  cambio.type === "add" ||
                  cambio.type === "remove",
              )
            ) {
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
          edgeTypes={tiposDeArista}
          defaultEdgeOptions={{ type: "borrable" }}
          /*
            Modo suelto: CUALQUIER punto sirve para empezar o terminar una union. Con el modo
            estricto, arriba e izquierda solo recibian y abajo y derecha solo salian, asi que
            unir dos ideas dependia de por donde estuvieran paradas. Ademas no toca los ids de
            los puntos, asi que las conexiones ya hechas siguen funcionando.
          */
          connectionMode={ConnectionMode.Loose}
          /*
            React Flow por defecto no deja alejarse mas alla de la mitad ni acercarse mas del
            doble. Un mapa de treinta ideas no entra en pantalla con ese tope: se llega al limite
            y todavia queda diagrama afuera. Se abre el rango para poder ver el conjunto entero y
            tambien meterse a leer una caja.
          */
          minZoom={0.1}
          maxZoom={3}
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
