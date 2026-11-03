"use client";

import { useMemo, useState, type DragEvent } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { EstadoTarjetaTablero } from "../services/reglas";
import type { TipoVista } from "../services/tableros";
import {
  COLUMNAS_KANBAN,
  COLUMNA_COORDINADOR,
  filasPorColumnaKanban,
  motivoParaSoltar,
  nombreDeColumnaKanban,
  type ColumnaKanban,
  type FilaDeTabla,
} from "../services/vistas-de-tabla";
import { COLOR_DEL_ESTADO } from "./colores";
import { IconoDeTipo } from "./IconoDeTipo";
import { CeldaEstado, PastillaDeEstado, useCambioDeEstado } from "./VistaTabla";

/*
  La vista TABLERO (kanban) del Tablero IA: una columna por estado. Arrastrar una tarjeta a otra columna
  cambia su estado con la MISMA regla del servidor; si la regla no lo deja, la tarjeta se queda en su
  lugar y sale el motivo. Los estados del Coordinador (Planeando, Plan listo, Subiendo...) van juntos en
  "Con el Coordinador": ahí no se suelta nada. Antes de soltar en "Por aprobar" se pide confirmación.
  Usa el arrastre propio del navegador (sin librerías); en el celular, donde no se arrastra, cada
  tarjeta trae su menú de estado. Las carpetas (como Área) no tienen estado y no salen acá.
*/

const TIPO_ARRASTRE = "application/x-tablero-ia-tarjeta";

type Props = {
  filas: FilaDeTabla[];
  tipos: ReadonlyMap<string, TipoVista>;
  editable: boolean;
  alAbrir: (id: string) => void;
  alCambiar: () => Promise<void> | void;
};

export function VistaKanban({ filas, tipos, editable, alAbrir, alCambiar }: Props) {
  const { cambiar, dialogo } = useCambioDeEstado(alCambiar);
  // Lo que se movió y espera la respuesta del servidor: se ve ya en su columna nueva.
  const [movidas, setMovidas] = useState<ReadonlyMap<string, EstadoTarjetaTablero>>(new Map());
  const [arrastrada, setArrastrada] = useState<string | null>(null);
  const [encima, setEncima] = useState<ColumnaKanban | null>(null);

  const conMovidas = useMemo(
    () => filas.map((fila) => (movidas.has(fila.id) ? { ...fila, estado: movidas.get(fila.id)! } : fila)),
    [filas, movidas],
  );
  const columnas = useMemo(() => filasPorColumnaKanban(conMovidas), [conMovidas]);
  const porId = useMemo(() => new Map(filas.map((fila) => [fila.id, fila])), [filas]);
  const sinEstado = filas.filter((fila) => !fila.estado).length;

  const mover = async (fila: FilaDeTabla, destino: EstadoTarjetaTablero) => {
    setMovidas((previas) => new Map(previas).set(fila.id, destino));
    await cambiar(fila, destino);
    // Ya llegó lo nuevo (o volvió a su lugar si falló o se canceló).
    setMovidas((previas) => {
      const siguientes = new Map(previas);
      siguientes.delete(fila.id);
      return siguientes;
    });
  };

  const alSoltar = (evento: DragEvent<HTMLElement>, destino: ColumnaKanban) => {
    evento.preventDefault();
    setEncima(null);
    setArrastrada(null);
    const id = evento.dataTransfer.getData(TIPO_ARRASTRE);
    const fila = porId.get(id);
    if (!fila || !fila.estado || !editable) return;
    if (destino !== COLUMNA_COORDINADOR && destino === fila.estado) return;
    const motivo = motivoParaSoltar(fila, destino);
    if (motivo || destino === COLUMNA_COORDINADOR) {
      // La regla no lo deja: la tarjeta se queda donde estaba.
      toast.error(motivo ?? "Esa columna es del Coordinador.");
      return;
    }
    void mover(fila, destino);
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {sinEstado ? (
        <p className="px-3 pt-2 text-xs text-muted-foreground">
          {sinEstado === 1 ? "1 carpeta (como Área) no sale acá" : `${sinEstado} carpetas (como Área) no salen acá`}: no tienen estado.
        </p>
      ) : null}
      <div className="flex min-h-full gap-3 p-3">
        {COLUMNAS_KANBAN.map((columna) => {
          const lista = columnas.get(columna) ?? [];
          const delCoordinador = columna === COLUMNA_COORDINADOR;
          const fila = arrastrada ? porId.get(arrastrada) : undefined;
          const sePuede = fila ? !delCoordinador && fila.estado !== columna && motivoParaSoltar(fila, columna) === null : false;
          return (
            <section
              key={columna}
              aria-label={nombreDeColumnaKanban(columna)}
              onDragOver={(evento) => {
                if (!editable) return;
                // Se deja soltar en todas para poder decir el motivo de la regla cuando no se puede.
                evento.preventDefault();
                setEncima(columna);
              }}
              onDragLeave={() => setEncima((actual) => (actual === columna ? null : actual))}
              onDrop={(evento) => alSoltar(evento, columna)}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/30",
                encima === columna && (sePuede ? "ring-2 ring-primary/50" : "ring-2 ring-destructive/40"),
              )}
            >
              <header className="flex items-center gap-2 px-3 py-2">
                {delCoordinador ? (
                  <span className="flex items-center gap-1 text-sm font-semibold">
                    <Lock className="size-3.5 text-muted-foreground" aria-hidden />
                    {nombreDeColumnaKanban(columna)}
                  </span>
                ) : (
                  <PastillaDeEstado estado={columna} className="text-sm" />
                )}
                <span className="text-xs text-muted-foreground tabular-nums">{lista.length}</span>
              </header>
              <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {lista.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                    {delCoordinador ? "Nada en manos del Coordinador" : "Sin tarjetas"}
                  </p>
                ) : null}
                {lista.map((tarjeta) => {
                  const tipo = tipos.get(tarjeta.tipoId);
                  const real = porId.get(tarjeta.id) ?? tarjeta;
                  return (
                    <article
                      key={tarjeta.id}
                      draggable={editable && !delCoordinador}
                      onDragStart={(evento) => {
                        evento.dataTransfer.setData(TIPO_ARRASTRE, tarjeta.id);
                        evento.dataTransfer.effectAllowed = "move";
                        setArrastrada(tarjeta.id);
                      }}
                      onDragEnd={() => {
                        setArrastrada(null);
                        setEncima(null);
                      }}
                      onClick={() => alAbrir(tarjeta.id)}
                      className={cn(
                        "cursor-pointer space-y-1.5 rounded-lg border bg-card p-2.5 text-sm shadow-xs hover:bg-muted/50",
                        tarjeta.estado ? COLOR_DEL_ESTADO[tarjeta.estado].tarjeta : "",
                        movidas.has(tarjeta.id) && "opacity-60",
                        arrastrada === tarjeta.id && "opacity-40",
                      )}
                    >
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {tipo ? <IconoDeTipo icono={tipo.icono} color={tipo.color} className="size-3.5" /> : null}
                        <span className="tabular-nums">{tarjeta.codigo}</span>
                        {delCoordinador && tarjeta.estado ? <PastillaDeEstado estado={tarjeta.estado} className="ml-auto" /> : null}
                        {tarjeta.prioridad === "Urgente" ? (
                          <span className="ml-auto font-medium text-red-700 dark:text-red-300">Urgente</span>
                        ) : null}
                      </div>
                      <p className="line-clamp-3 font-medium leading-snug">{tarjeta.titulo}</p>
                      {tarjeta.area || tarjeta.responsable ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {[tarjeta.area, tarjeta.responsable].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {/* En el celular no se arrastra: el menú de estado hace lo mismo. */}
                      {editable ? (
                        <div className="md:hidden">
                          <CeldaEstado fila={real} editable={editable} cambiar={(f, e) => mover(f, e).then(() => true)} />
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {dialogo}
    </div>
  );
}
