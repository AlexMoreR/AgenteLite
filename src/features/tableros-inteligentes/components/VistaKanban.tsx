"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { cambiarEstadoDesdeVistaAction } from "@/app/actions/tablero-ia-vistas-actions";
import { NOMBRE_DEL_ESTADO, type EstadoTarjetaTablero } from "../services/reglas";
import type { TarjetaVista, TipoVista } from "../services/tableros";
import {
  COLUMNAS_DEL_KANBAN,
  COLUMNA_DEL_COORDINADOR,
  columnaDelKanban,
  destinosDelKanban,
  filasDeTabla,
  pideConfirmacion,
  veredictoDelKanban,
  type FilaDeTabla,
} from "../services/vistas-de-tabla";
import { COLOR_DEL_ESTADO } from "./colores";
import { IconoDeTipo } from "./IconoDeTipo";

/**
 * Una acción del servidor que, si falla la red o la sesión (la promesa se rechaza), responde como un
 * error común: así la vista nunca se queda a medias (tarjeta movida, celda con un valor que no se guardó).
 */
export async function accionSegura<T extends { ok: boolean }>(promesa: Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await promesa;
  } catch {
    return { ok: false, error: "No se pudo guardar: revisa la conexión e inténtalo de nuevo." };
  }
}

type Pedido = {
  fila: FilaDeTabla<TarjetaVista>;
  estado: EstadoTarjetaTablero;
  /** Se llama si no se hizo (la regla lo negó o se canceló la confirmación). */
  alFallar?: () => void;
  /** Se llama cuando el servidor lo guardó. */
  alTerminar?: () => void;
};

/**
 * Cambiar el estado desde la Tabla o el Tablero: la misma acción del servidor (la regla de siempre) y,
 * antes de pasar a "Por aprobar", una confirmación, porque con repo el Coordinador puede aprobarla y
 * arrancar solo (la aprobación automática que ya existe). `alFallar` deshace lo que la vista mostró antes
 * de tiempo (la tarjeta vuelve a su columna, el menú a su valor).
 */
export function useCambioDeEstado(alCambiar: () => void): {
  pedir: (pedido: Pedido) => void;
  cambiando: string | null;
  dialogo: ReactNode;
} {
  const [porConfirmar, setPorConfirmar] = useState<Pedido | null>(null);
  const [cambiando, setCambiando] = useState<string | null>(null);

  const ejecutar = async ({ fila, estado, alFallar, alTerminar }: Pedido) => {
    setCambiando(fila.tarjeta.id);
    const resultado = await accionSegura(cambiarEstadoDesdeVistaAction(fila.tarjeta.id, estado));
    setCambiando(null);
    if (resultado.ok) {
      toast.success(
        "aprobadaSola" in resultado && resultado.aprobadaSola
          ? "Quedó Por aprobar y se aprobó sola por la regla de hoy: el Coordinador ya la puede tomar"
          : `Quedó en ${NOMBRE_DEL_ESTADO[estado]}`,
      );
      alTerminar?.();
    } else {
      toast.error(resultado.error);
      alFallar?.();
    }
    alCambiar();
  };

  const pedir = (pedido: Pedido) => {
    if (pideConfirmacion(pedido.estado)) setPorConfirmar(pedido);
    else void ejecutar(pedido);
  };

  const cancelar = () => {
    porConfirmar?.alFallar?.();
    setPorConfirmar(null);
  };

  const dialogo = (
    <Dialog open={porConfirmar !== null} onOpenChange={(abrir) => (!abrir ? cancelar() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Pasar a Por aprobar?</DialogTitle>
          <DialogDescription>
            {porConfirmar ? `${porConfirmar.fila.tarjeta.codigo} ${porConfirmar.fila.tarjeta.titulo}`.trim() : ""}
            {porConfirmar?.fila.tarjeta.repo
              ? ". Tiene repo: si la regla de aprobación automática la aprueba, el Coordinador arranca solo."
              : ". Queda esperando la aprobación."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancelar}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              const pedido = porConfirmar;
              setPorConfirmar(null);
              if (pedido) void ejecutar(pedido);
            }}
          >
            Sí, pasar a Por aprobar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { pedir, cambiando, dialogo };
}

type Props = {
  tarjetas: TarjetaVista[];
  tipos: TipoVista[];
  alAbrir: (tarjetaId: string) => void;
  alCambiar: () => void;
};

/**
 * La vista Tablero (kanban): una columna por estado. Arrastrar una tarjeta a otra columna le cambia el
 * estado con la regla del servidor; si la regla no lo deja, la tarjeta se queda donde estaba y sale el
 * motivo. Los estados del Coordinador van juntos en "Con el Coordinador", donde no se arrastra. En el
 * celular (donde no se arrastra) cada tarjeta trae el menú "Mover a". Las carpetas (Área) no salen.
 */
export function VistaKanban({ tarjetas, tipos, alAbrir, alCambiar }: Props) {
  const filas = useMemo(() => filasDeTabla(tarjetas, tipos), [tarjetas, tipos]);
  const tipoPorId = useMemo(() => new Map(tipos.map((tipo) => [tipo.id, tipo])), [tipos]);
  // Lo que se movió y espera la respuesta del servidor: se ve ya en su columna nueva.
  const [movidas, setMovidas] = useState<Record<string, string>>({});
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [encima, setEncima] = useState<string | null>(null);
  const { pedir, cambiando, dialogo } = useCambioDeEstado(alCambiar);

  const porColumna = useMemo(() => {
    const mapa = new Map<string, FilaDeTabla<TarjetaVista>[]>(COLUMNAS_DEL_KANBAN.map((columna) => [columna.clave, []]));
    for (const fila of filas) {
      const columna = movidas[fila.tarjeta.id] ?? columnaDelKanban(fila);
      if (columna) mapa.get(columna)?.push(fila);
    }
    return mapa;
  }, [filas, movidas]);
  const filaArrastrada = arrastrando ? filas.find((fila) => fila.tarjeta.id === arrastrando) : undefined;

  const soltarEn = (fila: FilaDeTabla<TarjetaVista>, claveDestino: string) => {
    const columna = COLUMNAS_DEL_KANBAN.find((c) => c.clave === claveDestino);
    if (!columna || columna.clave === columnaDelKanban(fila)) return;
    const veredicto = veredictoDelKanban(fila, columna);
    if (veredicto || !columna.destino) {
      // La tarjeta vuelve a su lugar (nunca se movió) y se dice por qué.
      toast.error(veredicto ?? "Ahí no se puede soltar.");
      return;
    }
    const id = fila.tarjeta.id;
    const quitar = () => setMovidas((actual) => Object.fromEntries(Object.entries(actual).filter(([otra]) => otra !== id)));
    setMovidas((actual) => ({ ...actual, [id]: columna.clave }));
    // Guardado: lo movido se ve en su columna nueva hasta que el refresco trae el dato real (que también
    // puede ser otro: si se aprobó sola, queda Aprobado).
    pedir({ fila, estado: columna.destino, alFallar: quitar, alTerminar: () => window.setTimeout(quitar, 3000) });
  };

  if (!filas.some((fila) => columnaDelKanban(fila))) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No hay tarjetas con estado en este tablero. Las carpetas (como Área) no salen en esta vista.
      </div>
    );
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {COLUMNAS_DEL_KANBAN.map((columna) => {
        const lista = porColumna.get(columna.clave) ?? [];
        const delCoordinador = columna.clave === COLUMNA_DEL_COORDINADOR;
        const sePuede = filaArrastrada ? veredictoDelKanban(filaArrastrada, columna) === null : false;
        return (
          <section
            key={columna.clave}
            aria-label={columna.nombre}
            onDragOver={(evento) => {
              if (!arrastrando) return;
              evento.preventDefault();
              evento.dataTransfer.dropEffect = sePuede ? "move" : "none";
              setEncima(columna.clave);
            }}
            onDragLeave={() => setEncima((actual) => (actual === columna.clave ? null : actual))}
            onDrop={(evento) => {
              evento.preventDefault();
              setEncima(null);
              const id = evento.dataTransfer.getData("text/plain") || arrastrando;
              setArrastrando(null);
              const fila = filas.find((f) => f.tarjeta.id === id);
              if (fila) soltarEn(fila, columna.clave);
            }}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40",
              filaArrastrada && sePuede && "border-primary/60",
              encima === columna.clave && sePuede && "bg-primary/5",
            )}
          >
            <header className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
              {delCoordinador ? <Lock className="size-3.5 text-muted-foreground" aria-hidden /> : null}
              <span className="truncate">{columna.nombre}</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{lista.length}</span>
            </header>
            {delCoordinador ? (
              <p className="px-3 pb-2 text-xs text-muted-foreground">Las tiene el Coordinador: aquí no se arrastra.</p>
            ) : null}
            <ol className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {lista.map((fila) => {
                const { tarjeta } = fila;
                const tipo = tipoPorId.get(tarjeta.tipoId);
                const destinos = destinosDelKanban(fila);
                // Se arrastra a cualquier columna: si la regla no deja, sale el motivo. Las del Coordinador, no.
                const seArrastra = !delCoordinador && columnaDelKanban(fila) !== null;
                return (
                  <li
                    key={tarjeta.id}
                    draggable={seArrastra}
                    onDragStart={(evento) => {
                      evento.dataTransfer.setData("text/plain", tarjeta.id);
                      evento.dataTransfer.effectAllowed = "move";
                      setArrastrando(tarjeta.id);
                    }}
                    onDragEnd={() => {
                      setArrastrando(null);
                      setEncima(null);
                    }}
                    className={cn(
                      "rounded-lg border bg-card p-2.5 text-sm shadow-xs",
                      seArrastra && "cursor-grab active:cursor-grabbing",
                      cambiando === tarjeta.id && "opacity-60",
                    )}
                  >
                    <button type="button" onClick={() => alAbrir(tarjeta.id)} className="block w-full text-left">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {tipo ? <IconoDeTipo icono={tipo.icono} color={tipo.color} className="size-3.5" /> : null}
                        {tarjeta.codigo ? <span className="tabular-nums">{tarjeta.codigo}</span> : null}
                        {delCoordinador ? (
                          <span className={cn("ml-auto rounded-full border px-1.5 text-[11px]", COLOR_DEL_ESTADO[tarjeta.estado].pastilla)}>
                            {NOMBRE_DEL_ESTADO[tarjeta.estado]}
                          </span>
                        ) : tarjeta.urgente ? (
                          <span className="ml-auto font-medium text-rose-600 dark:text-rose-400">Urgente</span>
                        ) : null}
                      </span>
                      <span className="mt-1 line-clamp-3 font-medium leading-snug">{tarjeta.titulo}</span>
                      {tarjeta.responsableNombre ? (
                        <span className="mt-1 block truncate text-xs text-muted-foreground">{tarjeta.responsableNombre}</span>
                      ) : null}
                    </button>
                    {seArrastra && destinos.length ? (
                      <select
                        aria-label={`Mover ${tarjeta.codigo || tarjeta.titulo} a otra columna`}
                        className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-xs text-muted-foreground"
                        value=""
                        disabled={cambiando === tarjeta.id}
                        onChange={(evento) => {
                          if (evento.target.value) soltarEn(fila, evento.target.value);
                        }}
                      >
                        <option value="">Mover a…</option>
                        {destinos.map((destino) => (
                          <option key={destino.clave} value={destino.clave}>
                            {destino.nombre}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                );
              })}
              {lista.length === 0 ? <li className="px-1 py-3 text-center text-xs text-muted-foreground">Sin tarjetas</li> : null}
            </ol>
          </section>
        );
      })}
      {dialogo}
    </div>
  );
}
