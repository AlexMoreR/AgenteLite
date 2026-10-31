"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { desarchivarTarjetaAction, trabajosTerminadosAction } from "@/app/actions/tableros-inteligentes-actions";
import type { ArchivadaVista } from "../services/archivadas";
import { NOMBRE_DEL_ESTADO, type EstadoTarjetaTablero } from "../services/reglas";

/*
  "Trabajos terminados" de Tablero IA (/cliente/tablero-ia?vista=terminados, 30-oct-2026): las tarjetas archivadas
  (HECHO o FALLIDO de hace más de 3 días, services/archivadas.ts) con su código, título, tablero, la fecha en que se
  terminó, el repo y el link al commit. Buscador por código, título o repo (lo busca el servidor) y el botón
  Desarchivar, que la vuelve a poner en el tablero. Solo el dueño o el ADMIN.
*/

const ESPERA_DEL_BUSCADOR_MS = 350;

const CUANDO = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", year: "numeric" });

type Lista = { tarjetas: ArchivadaVista[]; hayMas: boolean };

function Fila({ tarjeta, ocupada, alDesarchivar }: { tarjeta: ArchivadaVista; ocupada: boolean; alDesarchivar: () => void }) {
  const estado = NOMBRE_DEL_ESTADO[tarjeta.estado as EstadoTarjetaTablero] ?? tarjeta.estado;
  return (
    <li className="flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium" title={tarjeta.titulo}>
          {tarjeta.codigo ? <span className="mr-1.5 text-muted-foreground tabular-nums">{tarjeta.codigo}</span> : null}
          {tarjeta.titulo}
        </p>
        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{estado}</span>
          <span className="max-w-full truncate" title={tarjeta.tableroNombre}>
            · {tarjeta.tableroNombre}
          </span>
          <span>· {tarjeta.terminadaEn ? `terminó el ${CUANDO.format(new Date(tarjeta.terminadaEn))}` : "sin fecha"}</span>
          {tarjeta.repo ? <span>· {tarjeta.repo}</span> : null}
          {tarjeta.linkCommit ? (
            <a
              href={tarjeta.linkCommit}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
            >
              · commit {tarjeta.commit ? tarjeta.commit.slice(0, 7) : ""}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </p>
      </div>
      <Button variant="outline" className="h-11 shrink-0 md:h-8" disabled={ocupada} onClick={alDesarchivar}>
        {ocupada ? <Loader2 className="animate-spin" /> : <Undo2 />}
        Desarchivar
      </Button>
    </li>
  );
}

export function TrabajosTerminados() {
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  // Lee la lista al abrir y cada vez que cambia el buscador (con una pequeña espera mientras se escribe).
  useEffect(() => {
    let vigente = true;
    const reloj = setTimeout(
      () =>
        void trabajosTerminadosAction(buscar).then((respuesta) => {
          if (!vigente) return;
          if (respuesta.ok) {
            setLista({ tarjetas: respuesta.tarjetas, hayMas: respuesta.hayMas });
            setError(null);
          } else setError(respuesta.error);
        }),
      buscar ? ESPERA_DEL_BUSCADOR_MS : 0,
    );
    return () => {
      vigente = false;
      clearTimeout(reloj);
    };
  }, [buscar]);

  const desarchivar = async (tarjeta: ArchivadaVista) => {
    setOcupada(tarjeta.id);
    const respuesta = await desarchivarTarjetaAction(tarjeta.id);
    setOcupada(null);
    if (!respuesta.ok) {
      toast.error(respuesta.error);
      return;
    }
    toast.success(`${tarjeta.codigo || "La tarjeta"} volvió al tablero ${tarjeta.tableroNombre}.`);
    setLista((actual) => (actual ? { ...actual, tarjetas: actual.tarjetas.filter((otra) => otra.id !== tarjeta.id) } : actual));
  };

  return (
    <section aria-labelledby="titulo-terminados" className="space-y-4">
      <div>
        <h1 id="titulo-terminados" className="text-lg font-semibold">
          Trabajos terminados
        </h1>
        <p className="text-sm text-muted-foreground">
          Las tarjetas hechas o fallidas salen solas del tablero a los 3 días y quedan aquí, con todo lo que tenían. No
          cuentan para el máximo de 300.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={buscar}
          onChange={(evento) => setBuscar(evento.target.value)}
          placeholder="Buscar por código (T-123), título o repo"
          aria-label="Buscar trabajos terminados"
          className="h-11 pl-8 md:h-9"
          maxLength={80}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!lista && !error ? <Loader2 className="mx-auto animate-spin text-muted-foreground" aria-label="Cargando" /> : null}

      {lista ? (
        lista.tarjetas.length ? (
          <>
            <ul className="space-y-1.5">
              {lista.tarjetas.map((tarjeta) => (
                <Fila key={tarjeta.id} tarjeta={tarjeta} ocupada={ocupada === tarjeta.id} alDesarchivar={() => void desarchivar(tarjeta)} />
              ))}
            </ul>
            {lista.hayMas ? (
              <p className="text-xs text-muted-foreground">Se ven las 100 más recientes. Usa el buscador para encontrar las demás.</p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {buscar.trim() ? "Ninguna terminada coincide con la búsqueda." : "Todavía no hay trabajos terminados archivados."}
          </p>
        )
      ) : null}
    </section>
  );
}
