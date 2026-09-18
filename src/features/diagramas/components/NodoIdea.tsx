"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Handle,
  NodeResizeControl,
  Position,
  useInternalNode,
  useNodeConnections,
  type NodeProps,
} from "@xyflow/react";
import { Bold, ChevronDown, ChevronUp, Copy, Eye, EyeOff, Group, Plus, X } from "lucide-react";

import { COLORES_DE_IDEA, cajaDelColor, opcionDelColor } from "./colores";
import { ICONOS_DE_IDEA } from "./iconos";
import { TextoConNegrita } from "./TextoConNegrita";

/**
 * Una idea del mapa: una caja con texto que se escribe encima.
 *
 * El texto se edita EN LA CAJA, no en un panel al costado: en un mapa mental uno escribe mientras
 * mira el conjunto, y mandar la escritura a otro lado rompe justo eso.
 *
 * Un toque la SELECCIONA (y ahí se arrastra entera); el doble toque o el lápiz de la barra entran
 * a ESCRIBIR. Están separados porque un campo de texto se traga el dedo: sobre él se escribe o se
 * marcan letras, nunca se arrastra, y con la caja siempre en modo escritura moverla en el celular
 * era imposible salvo agarrándola del borde.
 *
 * Mientras se escribe se ve el texto CRUDO, con sus asteriscos; al salir se ve ya formateado. Es
 * el mismo ida y vuelta de cualquier editor y evita el enredo de escribir encima de texto con
 * formato.
 */
const PUNTOS = [
  { posicion: Position.Top, clave: "arriba" },
  { posicion: Position.Right, clave: "derecha" },
  { posicion: Position.Bottom, clave: "abajo" },
  { posicion: Position.Left, clave: "izquierda" },
] as const;

export function NodoIdea({
  id,
  data,
  selected,
  width,
  height,
  onTexto,
  onColor,
  onIcono,
  onDuplicar,
  onAgregarConectada,
  onBorrar,
  onFondo,
  onColapsar,
}: NodeProps & {
  onTexto: (id: string, texto: string) => void;
  onColor: (id: string, color: string) => void;
  onIcono: (id: string, icono: string) => void;
  onDuplicar: (id: string) => void;
  onAgregarConectada: (id: string) => void;
  onBorrar: (id: string) => void;
  onFondo: (id: string) => void;
  onColapsar: (id: string) => void;
}) {
  /**
   * Qué puntos están realmente en uso.
   *
   * Los cuatro puntitos en cada caja ensuciaban el mapa: en un diagrama de veinte ideas son
   * ochenta lunares compitiendo con el texto. Se muestran solo los que tienen una unión colgando;
   * los demás aparecen al seleccionar la caja, que es cuando uno va a conectar algo.
   */
  const conexiones = useNodeConnections({ id });
  const puntosEnUso = useMemo(() => {
    const usados = new Set<string>();
    for (const conexion of conexiones) {
      if (conexion.source === id && conexion.sourceHandle) {
        usados.add(conexion.sourceHandle.replace(/-(in|out)$/, ""));
      }
      if (conexion.target === id && conexion.targetHandle) {
        usados.add(conexion.targetHandle.replace(/-(in|out)$/, ""));
      }
    }
    return usados;
  }, [conexiones, id]);

  const texto = typeof data?.texto === "string" ? data.texto : "";
  const icono = typeof data?.icono === "string" ? data.icono : "";
  /*
    Una caja "fondo" es un marco: se le meten otras ideas arrastrándolas adentro y se mueven con
    ella (Alex, 18-sep-2026). Su texto pasa a ser el título, arriba, y el resto queda libre para
    lo que se ponga encima.
  */
  const esFondo = data?.fondo === true;
  /*
    Plegar la cadena: esconde todas las ideas que siguen a esta por sus uniones, y en lugar del
    "+" queda un punto con cuántas hay escondidas (Alex, 18-sep-2026). `ocultas` lo calcula el
    lienzo al dibujar; no se guarda.
  */
  const plegada = data?.colapsado === true;
  const ocultas = typeof data?.ocultas === "number" ? data.ocultas : 0;
  // Cualquier union cuenta: que va despues lo decide el lienzo por posicion.
  const tieneSiguientes = conexiones.length > 0;

  /*
    El arco de la esquina para estirar, a la medida de ESTA caja.

    Con un tamaño fijo, en una caja de un renglón el arco era casi la mitad de la caja (Alex,
    18-sep-2026). Ahora sigue el redondeo real de la esquina -que en una caja baja es menor- a
    unos 4 px de aire, cubre solo el tramo del medio de la curva y es más fino en las chicas.
  */
  // La medida REAL: `height` viene vacio en las cajas que crecen con el texto.
  const medida = useInternalNode(id)?.measured;
  const alto = medida?.height ?? height ?? 30;
  const ancho = medida?.width ?? width ?? 180;
  const arcoDeEstirar = useMemo(() => {
    const redondeo = Math.min(12, alto / 2, ancho / 2);
    const grosor = alto < 48 ? 2 : 2.5;
    const radio = redondeo + 4 + grosor / 2;
    // La esquina de la caja cae en el centro del cuadro de 22 px de la manija.
    const centro = 11 - redondeo;
    const punto = (grados: number) => {
      const angulo = (grados * Math.PI) / 180;
      return `${(centro + radio * Math.cos(angulo)).toFixed(2)} ${(centro + radio * Math.sin(angulo)).toFixed(2)}`;
    };
    return { d: `M ${punto(15)} A ${radio.toFixed(2)} ${radio.toFixed(2)} 0 0 1 ${punto(75)}`, grosor };
  }, [alto, ancho]);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Escribir es un modo aparte de estar seleccionado.
   *
   * Antes, seleccionar la caja convertia casi toda su superficie en un campo de texto, y sobre un
   * campo de texto el dedo escribe o marca letras: no arrastra. Mover una caja en el celular se
   * volvia imposible salvo agarrandola del borde.
   *
   * Ahora un toque selecciona -y la caja se puede arrastrar entera- y el doble toque entra a
   * escribir, que es como funcionan las herramientas de diagramas.
   */
  const [editando, setEditando] = useState(false);
  // El color se elige desde un boton tipo selector: los seis puntos sueltos ocupaban media barra.
  const [eligiendoColor, setEligiendoColor] = useState(false);
  const colorActual = opcionDelColor(data?.color);

  const ajustarAlto = () => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };

  useEffect(ajustarAlto, [texto, editando]);

  useEffect(() => {
    // Una caja recién creada llega vacía: entra directo a escribir, sin un toque extra.
    if (!texto) {
      setEditando(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al soltar la caja se sale de escribir: si no, quedaba un cursor titilando en una caja que ya
  // nadie estaba mirando.
  useEffect(() => {
    if (!selected) {
      setEditando(false);
      setEligiendoColor(false);
    }
  }, [selected]);

  useEffect(() => {
    if (editando) {
      areaRef.current?.focus();
    }
  }, [editando]);

  /**
   * Poner en negrita lo seleccionado, envolviéndolo en asteriscos.
   *
   * Se usa la misma marca que WhatsApp (*así*) y no HTML: es la que él escribe todos los días, y
   * deja el contenido como texto plano, sin etiquetas que después haya que limpiar.
   */
  const alternarNegrita = () => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const desde = area.selectionStart;
    const hasta = area.selectionEnd;
    if (desde === hasta) {
      return;
    }
    const elegido = texto.slice(desde, hasta);
    const yaEstaba = elegido.startsWith("*") && elegido.endsWith("*") && elegido.length > 2;
    const nuevo = yaEstaba
      ? `${texto.slice(0, desde)}${elegido.slice(1, -1)}${texto.slice(hasta)}`
      : `${texto.slice(0, desde)}*${elegido}*${texto.slice(hasta)}`;
    onTexto(id, nuevo);
    // Se devuelve el foco con el mismo texto marcado, para poder seguir escribiendo o deshacerlo.
    const fin = yaEstaba ? hasta - 2 : hasta + 2;
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(desde, fin);
    });
  };

  return (
    <div
      /*
        Los minimos son chicos a proposito: la caja tiene que poder achicarse hasta el tamano de
        lo que dice. Un minimo comodo para escribir se logra con el ancho INICIAL de las cajas
        nuevas, no impidiendo que se achiquen despues.
      */
      className={`group relative flex size-full min-h-[30px] min-w-[56px] flex-col rounded-xl border px-2.5 py-1.5 shadow-sm transition ${cajaDelColor(
        data?.color,
      )} ${esFondo ? "border-2 border-dashed" : ""} ${selected ? "ring-1 ring-primary/40" : ""}`}
    >
      {/*
        La barra aparece SOLO con la caja seleccionada. Permanente en cada idea convertía el mapa
        en una grilla de controles y tapaba lo único que importa, que es lo que dice cada caja.
      */}
      {selected ? (
        <div className="nodrag nopan absolute -top-[4.5rem] left-0 flex w-max flex-col gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-md">
          <div className="flex items-center gap-1">
            {ICONOS_DE_IDEA.map((opcion) => (
              <button
                key={opcion}
                type="button"
                onClick={() => onIcono(id, icono === opcion ? "" : opcion)}
                title={icono === opcion ? "Quitar el ícono" : "Poner este ícono"}
                className={`flex size-6 items-center justify-center rounded-md text-sm transition hover:bg-muted ${
                  icono === opcion ? "bg-muted ring-1 ring-foreground/30" : ""
                }`}
              >
                {opcion}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              // Sin esto, tocar la B le quitaba el foco al texto: se salía de escribir y la selección
              // se perdía antes de que el botón actuara, así que nunca ponía nada en negrita.
              onMouseDown={(evento) => evento.preventDefault()}
              onClick={alternarNegrita}
              title="Negrita: seleccioná el texto primero"
              aria-label="Poner en negrita"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Bold className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDuplicar(id)}
              title="Copiar esta idea"
              aria-label="Copiar esta idea"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Copy className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onFondo(id)}
              title={esFondo ? "Dejar de ser fondo" : "Usar como fondo, para meter ideas adentro"}
              aria-label={esFondo ? "Dejar de ser fondo" : "Usar como fondo"}
              aria-pressed={esFondo}
              className={`flex size-6 items-center justify-center rounded-md transition hover:bg-muted hover:text-foreground ${
                esFondo ? "bg-muted text-foreground ring-1 ring-foreground/30" : "text-muted-foreground"
              }`}
            >
              <Group className="size-3.5" />
            </button>
            {tieneSiguientes || plegada ? (
              <button
                type="button"
                onClick={() => onColapsar(id)}
                title={plegada ? "Mostrar las ideas que siguen" : "Ocultar las ideas que siguen"}
                aria-label={plegada ? "Mostrar las ideas que siguen" : "Ocultar las ideas que siguen"}
                aria-pressed={plegada}
                className={`flex size-6 items-center justify-center rounded-md transition hover:bg-muted hover:text-foreground ${
                  plegada ? "bg-muted text-foreground ring-1 ring-foreground/30" : "text-muted-foreground"
                }`}
              >
                {plegada ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </button>
            ) : null}
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
            <div className="relative">
              <button
                type="button"
                onClick={() => setEligiendoColor((abierto) => !abierto)}
                title={`Color: ${colorActual.nombre}`}
                aria-label={`Color: ${colorActual.nombre}`}
                aria-expanded={eligiendoColor}
                className={`flex h-6 items-center gap-1 rounded-md px-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground ${
                  eligiendoColor ? "bg-muted text-foreground" : ""
                }`}
              >
                <span className={`size-3.5 rounded-full border ${colorActual.punto}`} />
                {eligiendoColor ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </button>
              {eligiendoColor ? (
                <div className="absolute left-0 top-full z-10 mt-1.5 flex items-center gap-1.5 rounded-full border border-border bg-popover px-2 py-1.5 shadow-md">
                  {COLORES_DE_IDEA.map((opcion) => (
                    <button
                      key={opcion.valor}
                      type="button"
                      onClick={() => {
                        onColor(id, opcion.valor);
                        setEligiendoColor(false);
                      }}
                      aria-label={opcion.nombre}
                      title={opcion.nombre}
                      className={`size-5 rounded-full border transition hover:scale-110 ${opcion.punto} ${
                        colorActual.valor === opcion.valor ? "ring-2 ring-foreground/40 ring-offset-1 ring-offset-popover" : ""
                      }`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/*
        Los cuatro bordes conectan, y cada uno sirve para SALIR y para ENTRAR.

        Van dos conectores superpuestos por punto porque React Flow le da UN solo rol a cada uno.
        El de salida queda encima para que arrastrar empiece una unión; al soltar, la librería
        busca el conector válido más cercano.
      */}
      {PUNTOS.map(({ posicion, clave }) => {
        /*
          Se esconden con opacidad y NO con display:none: invisible pero presente sigue sirviendo
          para soltarle una union encima. Quitandolo del todo, arrastrar hacia una caja sin
          seleccionar no enganchaba en ningun lado.
        */
        const visible = selected || puntosEnUso.has(clave);
        const estilo = `!size-2.5 !border-0 !bg-muted-foreground/40 transition hover:!bg-primary ${
          visible ? "opacity-100" : "opacity-0"
        }`;
        return (
          <div key={clave}>
            <Handle type="target" id={`${clave}-in`} position={posicion} className={estilo} />
            <Handle type="source" id={`${clave}-out`} position={posicion} className={estilo} />
          </div>
        );
      })}

      {/* overflow-auto: una vez que la caja tiene un tamano fijo puesto a mano, un texto largo
          se desbordaria por fuera del borde. Asi se desplaza adentro. */}
      <div
        // En un fondo, el texto es solo el título de arriba: el resto de la caja es el espacio
        // donde van las ideas, y un doble clic ahí crea una adentro (lo maneja el lienzo).
        data-titulo-fondo={esFondo ? "" : undefined}
        className={esFondo ? "flex min-h-5 shrink-0 gap-1.5" : "flex min-h-0 flex-1 gap-1.5 overflow-auto"}
        onDoubleClick={() => setEditando(true)}
        // Tocar una caja que YA estaba seleccionada entra a escribir. Reemplaza al lápiz: en el
        // celular el doble toque no siempre llega (el navegador lo usa para el zoom).
        onClick={() => {
          if (selected && !editando) {
            setEditando(true);
          }
        }}
        title={editando ? undefined : "Tocá de nuevo para escribir"}
        role="presentation"
      >
        {icono ? (
          <span className="shrink-0 select-none text-base leading-snug" aria-hidden="true">
            {icono}
          </span>
        ) : null}

        {editando ? (
          <textarea
            ref={areaRef}
            value={texto}
            onChange={(evento) => onTexto(id, evento.target.value)}
            onInput={ajustarAlto}
            rows={1}
            placeholder="Escribí acá…"
            onBlur={() => setEditando(false)}
            onKeyDown={(evento) => {
              if (evento.key === "Escape") {
                evento.currentTarget.blur();
              }
            }}
            // nodrag: sin esto, arrastrar para seleccionar texto movía la caja entera.
            className="nodrag min-h-0 w-full flex-1 resize-none bg-transparent text-[13px] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
          />
        ) : (
          <TextoConNegrita
            texto={texto}
            className={`min-h-0 w-full flex-1 whitespace-pre-wrap break-words leading-snug text-foreground ${
              esFondo ? "text-sm font-semibold" : "text-[13px]"
            }`}
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => onBorrar(id)}
        aria-label="Borrar esta idea"
        title="Borrar"
        /* Solo con la caja seleccionada. En el celular estaba siempre visible en TODAS las cajas:
           un mapa lleno de cruces, y una de ellas a un toque de distancia de borrar algo sin
           querer. */
        className={`absolute -right-2 -top-2 size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition hover:text-destructive ${
          selected ? "flex" : "hidden"
        }`}
      >
        <X className="size-3" />
      </button>

      {/*
        El "+" para seguir la cadena. Aparece al seleccionar la caja, a su derecha, que es hacia
        donde crece un flujo, y crea la idea siguiente YA CONECTADA de un toque. Antes abria un
        modal para elegir que agregar, con una sola opcion: un paso de mas en cada eslabon.
      */}
      {/*
        Con la cadena plegada, el "+" se vuelve un punto con cuántas ideas hay escondidas. Se ve
        SIEMPRE, no solo con la caja seleccionada: si no, no quedaría rastro de que ahí hay más.
      */}
      {plegada && ocultas > 0 ? (
        <button
          type="button"
          onClick={() => onColapsar(id)}
          aria-label={`Mostrar ${ocultas} ${ocultas === 1 ? "idea oculta" : "ideas ocultas"}`}
          title={`Mostrar ${ocultas} ${ocultas === 1 ? "idea oculta" : "ideas ocultas"}`}
          className="nodrag nopan absolute -right-8 top-1/2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground shadow-sm transition hover:scale-110"
        >
          {ocultas}
        </button>
      ) : selected ? (
        <button
          type="button"
          onClick={() => onAgregarConectada(id)}
          aria-label="Agregar una idea conectada a esta"
          title="Agregar conectada"
          className="nodrag nopan absolute -right-9 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md border border-dashed border-muted-foreground/50 bg-background text-muted-foreground transition hover:border-solid hover:border-primary hover:text-primary"
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}

      {/*
        La manija para estirar la caja, en la esquina de abajo a la derecha. Solo con la caja
        seleccionada: manijas siempre visibles en cada idea ensucian el mapa, y estirar es algo
        que se hace cuando uno ya eligió esa caja.
      */}
      {selected ? (
        <NodeResizeControl
          position="bottom-right"
          minWidth={esFondo ? 160 : 56}
          minHeight={esFondo ? 100 : 30}
          // 22 px de lado, centrado en la esquina: el area para agarrar es comoda con el dedo.
          style={{ background: "transparent", border: "none", width: 22, height: 22, cursor: "nwse-resize" }}
        >
          {/*
            Un arco que abraza la esquina redondeada por fuera, como en las herramientas de
            diagramas: se entiende de un vistazo que ahi se estira, y el cuadradito de antes se
            confundia con un borde mal dibujado. El centro del arco coincide con el del redondeo
            de la caja (12 px), y el radio deja unos 2 px de aire con el borde.
          */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            overflow="visible"
            aria-hidden="true"
            className="pointer-events-none text-muted-foreground/80"
          >
            <path
              d={arcoDeEstirar.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={arcoDeEstirar.grosor}
              strokeLinecap="round"
            />
          </svg>
        </NodeResizeControl>
      ) : null}
    </div>
  );
}
