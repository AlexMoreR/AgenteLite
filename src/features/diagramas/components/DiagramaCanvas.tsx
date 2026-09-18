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
import { Check, Download, EllipsisVertical, Loader2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const esFondo = (nodo: Node) => nodo.data?.fondo === true;

/**
 * Los fondos van PRIMERO en la lista.
 *
 * React Flow dibuja en ese orden -así un fondo queda detrás de lo que tiene encima- y además exige
 * que el padre aparezca antes que sus hijos. Como un fondo no se mete dentro de otro, ponerlos
 * todos adelante cumple las dos cosas.
 */
function fondosPrimero(lista: Node[]): Node[] {
  return [...lista.filter(esFondo), ...lista.filter((nodo) => !esFondo(nodo))];
}

/** Saca las ideas de un fondo y las deja sueltas donde estaban a la vista. */
function soltarHijos(lista: Node[], idPadre: string): Node[] {
  const padre = lista.find((nodo) => nodo.id === idPadre);
  if (!padre) {
    return lista;
  }
  return lista.map((nodo) =>
    nodo.parentId === idPadre
      ? {
          ...nodo,
          parentId: undefined,
          position: { x: padre.position.x + nodo.position.x, y: padre.position.y + nodo.position.y },
        }
      : nodo,
  );
}

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
            // Si el fondo de donde salió ya no está, la copia queda suelta.
            parentId: actuales.some((nodo) => nodo.id === original.parentId) ? original.parentId : undefined,
            id: `idea-${marca}-${indice}-${Math.round(Math.random() * 1000)}`,
            position: {
              x: original.position.x + corrimiento,
              y: original.position.y + corrimiento,
            },
            data: { ...original.data },
            selected: true,
          })),
        ]);
        setNodes(fondosPrimero);
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
    (posicion?: { x: number; y: number }, idPadre?: string) => {
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
        ...(idPadre ? { parentId: idPadre } : {}),
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
          // La copia no tiene uniones propias: plegada no escondería nada.
          data: { ...original.data, colapsado: false },
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
            // Pegada a la anterior, apenas separada: naciendo lejos obligaba a arrastrarla de
            // vuelta en cada paso, y armar una cadena era mover cajas todo el tiempo.
            position: { x: origen.position.x + anchoOrigen + 40, y: origen.position.y },
            // Nace en el mismo fondo que la anterior: la posicion ya es relativa a el.
            ...(origen.parentId ? { parentId: origen.parentId } : {}),
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
      // Borrar un fondo NO se lleva lo que tenía adentro: esas ideas quedan sueltas.
      setNodes((actuales) => soltarHijos(actuales, idNodo).filter((nodo) => nodo.id !== idNodo));
      setEdges((actuales) =>
        actuales.filter((arista) => arista.source !== idNodo && arista.target !== idNodo),
      );
      programarGuardado();
    },
    [programarGuardado, setEdges, setNodes],
  );

  /**
   * Convertir una caja en fondo, o devolverla a idea.
   *
   * Al volverse fondo crece a un tamaño donde entren cosas, y si estaba dentro de otro fondo sale:
   * un fondo dentro de otro no se admite. Al dejar de serlo suelta lo que tenía adentro.
   */
  const alternarFondo = useCallback(
    (idNodo: string) => {
      setNodes((actuales) => {
        const nodo = actuales.find((actual) => actual.id === idNodo);
        if (!nodo) {
          return actuales;
        }
        if (esFondo(nodo)) {
          return fondosPrimero(
            soltarHijos(actuales, idNodo).map((actual) =>
              actual.id === idNodo ? { ...actual, data: { ...actual.data, fondo: false } } : actual,
            ),
          );
        }
        const padre = nodo.parentId ? actuales.find((actual) => actual.id === nodo.parentId) : undefined;
        const ancho = typeof nodo.style?.width === "number" ? nodo.style.width : (nodo.measured?.width ?? 180);
        const alto = typeof nodo.style?.height === "number" ? nodo.style.height : (nodo.measured?.height ?? 0);
        return fondosPrimero(
          actuales.map((actual) =>
            actual.id === idNodo
              ? {
                  ...actual,
                  parentId: undefined,
                  position: padre
                    ? { x: padre.position.x + actual.position.x, y: padre.position.y + actual.position.y }
                    : actual.position,
                  style: { ...actual.style, width: Math.max(ancho, 360), height: Math.max(alto, 240) },
                  data: { ...actual.data, fondo: true },
                }
              : actual,
          ),
        );
      });
      programarGuardado();
    },
    [programarGuardado, setNodes],
  );

  /**
   * Al soltar una idea, se mete en el fondo que tenga debajo, o sale del que estaba.
   *
   * Cuenta el CENTRO de la caja: una idea grande que roza el borde de un fondo no se mete sola,
   * hay que dejarla adentro de verdad.
   */
  const alSoltarNodos = useCallback(
    (arrastrados: Node[]) => {
      const flujo = flujoRef.current;
      if (!flujo) {
        return;
      }
      const ids = new Set(arrastrados.map((nodo) => nodo.id));
      setNodes((actuales) => {
        const fondos = actuales.filter(esFondo);
        let huboCambio = false;
        const nuevos = actuales.map((nodo) => {
          // Si su fondo tambien se arrastro, viajo con el: sigue adentro.
          if (!ids.has(nodo.id) || esFondo(nodo) || (nodo.parentId && ids.has(nodo.parentId))) {
            return nodo;
          }
          const interno = flujo.getInternalNode(nodo.id);
          if (!interno) {
            return nodo;
          }
          const absoluta = interno.internals.positionAbsolute;
          const centroX = absoluta.x + (interno.measured.width ?? 0) / 2;
          const centroY = absoluta.y + (interno.measured.height ?? 0) / 2;
          const destino = [...fondos].reverse().find((fondo) => {
            const medida = flujo.getInternalNode(fondo.id)?.measured;
            return (
              centroX >= fondo.position.x &&
              centroX <= fondo.position.x + (medida?.width ?? 0) &&
              centroY >= fondo.position.y &&
              centroY <= fondo.position.y + (medida?.height ?? 0)
            );
          });
          if (destino?.id === nodo.parentId) {
            return nodo;
          }
          huboCambio = true;
          return destino
            ? {
                ...nodo,
                parentId: destino.id,
                position: { x: absoluta.x - destino.position.x, y: absoluta.y - destino.position.y },
              }
            : { ...nodo, parentId: undefined, position: { x: absoluta.x, y: absoluta.y } };
        });
        return huboCambio ? fondosPrimero(nuevos) : actuales;
      });
    },
    [setNodes],
  );

  /** Plegar o desplegar la cadena que sigue a una idea. Queda guardado con el diagrama. */
  const alternarColapso = useCallback(
    (idNodo: string) => {
      setNodes((actuales) =>
        actuales.map((nodo) =>
          nodo.id === idNodo ? { ...nodo, data: { ...nodo.data, colapsado: nodo.data?.colapsado !== true } } : nodo,
        ),
      );
      programarGuardado();
    },
    [programarGuardado, setNodes],
  );

  /**
   * Lo que se dibuja: el mapa con las cadenas plegadas escondidas.
   *
   * Se calcula al dibujar y NO se guarda en las cajas: así una unión nueva, o una borrada, cambia
   * al toque lo que queda escondido, y lo guardado sigue siendo el mapa entero.
   */
  const { nodosAMostrar, aristasAMostrar } = useMemo(() => {
    if (!nodes.some((nodo) => nodo.data?.colapsado === true)) {
      return { nodosAMostrar: nodes, aristasAMostrar: edges };
    }
    /*
      Que va "despues" de una caja se decide por POSICION, no por el sentido de la union.

      Primero se seguia la flecha, pero una union trazada a mano desde la caja de la derecha
      hacia la de la izquierda quedaba al reves y esa rama no se escondia (Alex, 18-sep-2026).
      Ahora cuenta como anterior lo que esta a la izquierda (o arriba, si estan alineadas), y todo
      lo demas que cuelga de la caja se esconde, siga la linea para donde siga.
    */
    const vecinos = new Map<string, Set<string>>();
    for (const arista of edges) {
      if (!vecinos.has(arista.source)) vecinos.set(arista.source, new Set());
      if (!vecinos.has(arista.target)) vecinos.set(arista.target, new Set());
      vecinos.get(arista.source)!.add(arista.target);
      vecinos.get(arista.target)!.add(arista.source);
    }
    const porId = new Map(nodes.map((nodo) => [nodo.id, nodo]));
    const centro = (idNodo: string) => {
      const nodo = porId.get(idNodo);
      if (!nodo) return { x: 0, y: 0 };
      const padre = nodo.parentId ? porId.get(nodo.parentId) : undefined;
      const ancho = nodo.measured?.width ?? (typeof nodo.style?.width === "number" ? nodo.style.width : 180);
      const alto = nodo.measured?.height ?? 40;
      return {
        x: nodo.position.x + (padre?.position.x ?? 0) + ancho / 2,
        y: nodo.position.y + (padre?.position.y ?? 0) + alto / 2,
      };
    };
    // Todo lo que se alcanza desde `inicio` por las uniones sin pasar por `excluida`.
    const alcanzables = (inicio: string[], excluida: string) => {
      const vistos = new Set<string>();
      const cola = [...inicio];
      while (cola.length > 0) {
        const actual = cola.shift()!;
        if (actual === excluida || vistos.has(actual)) {
          continue;
        }
        vistos.add(actual);
        cola.push(...(vecinos.get(actual) ?? []));
      }
      return vistos;
    };
    const siguientesDe = (idNodo: string) => {
      const propio = centro(idNodo);
      const anteriores: string[] = [];
      const posteriores: string[] = [];
      for (const vecino of vecinos.get(idNodo) ?? []) {
        const otro = centro(vecino);
        const dx = otro.x - propio.x;
        const esAnterior = dx < -10 || (Math.abs(dx) <= 10 && otro.y < propio.y);
        (esAnterior ? anteriores : posteriores).push(vecino);
      }
      // Si una rama de adelante vuelve a unirse con lo de atras, lo de atras no se esconde.
      const deAtras = alcanzables(anteriores, idNodo);
      const deAdelante = alcanzables(posteriores, idNodo);
      return new Set([...deAdelante].filter((id) => !deAtras.has(id)));
    };
    const ocultos = new Set<string>();
    const cuantas = new Map<string, number>();
    for (const nodo of nodes) {
      if (nodo.data?.colapsado === true) {
        const siguientes = siguientesDe(nodo.id);
        cuantas.set(nodo.id, siguientes.size);
        siguientes.forEach((idOculto) => ocultos.add(idOculto));
      }
    }
    // Un fondo escondido se lleva lo que tiene adentro.
    for (const nodo of nodes) {
      if (nodo.parentId && ocultos.has(nodo.parentId)) {
        ocultos.add(nodo.id);
      }
    }
    return {
      nodosAMostrar: nodes.map((nodo) =>
        ocultos.has(nodo.id)
          ? { ...nodo, hidden: true }
          : cuantas.has(nodo.id)
            ? { ...nodo, data: { ...nodo.data, ocultas: cuantas.get(nodo.id) } }
            : nodo,
      ),
      aristasAMostrar: edges.map((arista) =>
        ocultos.has(arista.source) || ocultos.has(arista.target) ? { ...arista, hidden: true } : arista,
      ),
    };
  }, [edges, nodes]);

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
    alternarFondo,
    alternarColapso,
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
      alternarFondo,
      alternarColapso,
    };
  }, [
    agregarConectada,
    alternarColapso,
    alternarFondo,
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
          onFondo={(idNodo) => manejadoresRef.current.alternarFondo(idNodo)}
          onColapsar={(idNodo) => manejadoresRef.current.alternarColapso(idNodo)}
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

  /**
   * Llevarse el diagrama en un archivo, y traerlo de vuelta.
   *
   * Un mapa mental vive dentro de la cuenta de quien lo hizo y es privado: sin esto, pasarle un
   * esquema a alguien -o guardarse una copia antes de reordenarlo entero- no tiene camino.
   *
   * El archivo es el mismo JSON que se guarda en la base, con el titulo adentro. Asi lo que se
   * exporta se vuelve a importar igual, sin conversiones que puedan perder algo por el medio.
   */
  const entradaArchivoRef = useRef<HTMLInputElement>(null);
  const [porImportar, setPorImportar] = useState<{
    titulo: string;
    nodes: Node[];
    edges: Edge[];
  } | null>(null);

  const exportar = useCallback(() => {
    const contenido = JSON.stringify(
      {
        version: 1,
        titulo: tituloRef.current,
        nodes: nodesRef.current,
        edges: edgesRef.current,
      },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([contenido], { type: "application/json" }));
    const enlace = document.createElement("a");
    enlace.href = url;
    /*
      El nombre del archivo sale del titulo, que es texto libre.

      Se deja pasar solo letras, numeros y separadores simples en vez de listar lo prohibido: los
      caracteres que Windows rechaza (\\ / : * ? " < > |) son justo los dificiles de escribir en
      una expresion regular, y olvidarse de uno da un archivo que no se puede guardar.
    */
    const nombre = (tituloRef.current || "diagrama")
      .replace(/[^\p{L}\p{N} _.-]/gu, "-")
      .trim()
      .slice(0, 60);
    enlace.download = `${nombre || "diagrama"}.json`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
    toast.success("Diagrama exportado");
  }, []);

  const aplicarImportado = useCallback(
    (datos: { titulo: string; nodes: Node[]; edges: Edge[] }) => {
      setNodes(datos.nodes);
      setEdges(datos.edges);
      if (datos.titulo) {
        setTitulo(datos.titulo);
      }
      programarGuardado(datos.titulo || undefined);
      setPorImportar(null);
      // Se encuadra despues de pintar: el mapa que viene puede estar en otras coordenadas y
      // quedaria fuera de la pantalla, pareciendo que la importacion no hizo nada.
      requestAnimationFrame(() => flujoRef.current?.fitView({ padding: 0.2 }));
      toast.success(
        datos.nodes.length === 1 ? "Diagrama importado" : `${datos.nodes.length} ideas importadas`,
      );
    },
    [programarGuardado, setEdges, setNodes],
  );

  const leerArchivo = useCallback(
    async (archivo: File) => {
      try {
        const crudo = JSON.parse(await archivo.text()) as Record<string, unknown>;
        /*
          Se valida antes de tocar el lienzo.

          Un JSON cualquiera -o uno de otra app- dejaria el mapa vacio y encima lo guardaria dos
          segundos despues, borrando lo que habia. Se descarta el archivo entero antes que eso.
        */
        const crudosNodos = Array.isArray(crudo.nodes) ? (crudo.nodes as Node[]) : [];
        const nodos = crudosNodos
          .filter(
            (nodo) =>
              nodo &&
              typeof nodo.id === "string" &&
              nodo.position &&
              typeof nodo.position.x === "number" &&
              typeof nodo.position.y === "number",
          )
          .map((nodo) => ({ ...nodo, type: nodo.type ?? "idea", selected: false }));

        if (nodos.length === 0) {
          toast.error("Ese archivo no tiene ideas adentro");
          return;
        }

        const idsValidos = new Set(nodos.map((nodo) => nodo.id));
        // Una idea que dice estar dentro de un fondo que no vino queda suelta: React Flow falla
        // con un padre que no existe.
        const nodosSanos = fondosPrimero(
          nodos.map((nodo) =>
            nodo.parentId && !idsValidos.has(nodo.parentId) ? { ...nodo, parentId: undefined } : nodo,
          ),
        );
        const crudasAristas = Array.isArray(crudo.edges) ? (crudo.edges as Edge[]) : [];
        const aristas = crudasAristas
          // Una union que apunta a una caja que no vino deja una linea al vacio.
          .filter(
            (arista) =>
              arista &&
              typeof arista.id === "string" &&
              idsValidos.has(arista.source) &&
              idsValidos.has(arista.target),
          )
          .map((arista) => ({ ...arista, type: "borrable" }));

        const datos = {
          titulo: typeof crudo.titulo === "string" ? crudo.titulo : "",
          nodes: nodosSanos,
          edges: aristas,
        };

        // Sobre un lienzo vacio no hay nada que perder: entra directo.
        if (nodesRef.current.length === 0) {
          aplicarImportado(datos);
          return;
        }
        setPorImportar(datos);
      } catch {
        toast.error("No se pudo leer el archivo");
      }
    },
    [aplicarImportado],
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Opciones del diagrama"
              className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <EllipsisVertical className="size-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {/* onClick y no onSelect: este menu es Base UI, y ahi onSelect se ignora en silencio. */}
            <DropdownMenuItem onClick={exportar}>
              <Download className="size-4" /> Exportar diagrama
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => entradaArchivoRef.current?.click()}>
              <Upload className="size-4" /> Importar diagrama
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          ref={entradaArchivoRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(evento) => {
            const archivo = evento.target.files?.[0];
            // Se limpia SIEMPRE: sin esto, elegir el mismo archivo dos veces seguidas no dispara
            // el evento y parece que el boton dejo de funcionar.
            evento.target.value = "";
            if (archivo) {
              void leerArchivo(archivo);
            }
          }}
        />
      </div>

      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodosAMostrar}
          edges={aristasAMostrar}
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
          onNodeDragStop={(_evento, _nodo, arrastrados) => {
            alSoltarNodos(arrastrados);
            programarGuardado();
          }}
          onInit={(instancia) => {
            flujoRef.current = instancia;
          }}
          onDoubleClick={(evento) => {
            // Doble clic en el lienzo VACIO crea una idea ahi mismo. Si el doble clic cayo sobre
            // una caja, no: ahi lo que uno quiere es escribir.
            const destino = evento.target as HTMLElement;
            const posicion = flujoRef.current?.screenToFlowPosition({
              x: evento.clientX,
              y: evento.clientY,
            });
            const cajaTocada = destino.closest<HTMLElement>(".react-flow__node");
            if (cajaTocada) {
              // Sobre el espacio libre de un fondo SI crea una idea, ya metida adentro. Sobre su
              // titulo o sobre otra caja no: ahi lo que uno quiere es escribir.
              const fondo = nodesRef.current.find((nodo) => nodo.id === cajaTocada.dataset.id && esFondo(nodo));
              if (!fondo || !posicion || destino.closest("[data-titulo-fondo]")) {
                return;
              }
              agregarIdea({ x: posicion.x - fondo.position.x, y: posicion.y - fondo.position.y }, fondo.id);
              return;
            }
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

      {/*
        Importar PISA lo que hay, y hay que decirlo antes.

        El guardado es automatico: dos segundos despues de reemplazar el lienzo, lo anterior ya no
        existe en ningun lado. Por eso se avisa cuantas ideas se van y cuantas entran, en vez de
        confiar en que se entienda que "importar" borra.
      */}
      <Dialog open={Boolean(porImportar)} onOpenChange={(abierto) => !abierto && setPorImportar(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reemplazar este diagrama</DialogTitle>
            <DialogDescription>
              Este mapa tiene {nodes.length} {nodes.length === 1 ? "idea" : "ideas"} y se van a
              perder. En su lugar entran las {porImportar?.nodes.length ?? 0} del archivo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setPorImportar(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => porImportar && aplicarImportado(porImportar)}
            >
              Reemplazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
