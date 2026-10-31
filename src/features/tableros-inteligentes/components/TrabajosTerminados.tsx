"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { desarchivarTarjetaAction, trabajosTerminadosAction } from "@/app/actions/tableros-inteligentes-actions";
import type { ArchivadaVista } from "../services/archivadas";
import { NOMBRE_DEL_ESTADO } from "../services/reglas";

/*
  La pestaña "Trabajos terminados" de Tablero IA (/cliente/tablero-ia?vista=terminados): las tarjetas ARCHIVADAS de
  todos los tableros (las HECHO y FALLIDO salen solas del tablero 3 días después de terminar; services/archivadas.ts).
  Cada una con su código, título, tablero, la fecha en que terminó, el repo y el link al commit. Buscador por código,
  título o repo, y el botón Desarchivar, que la devuelve a su tablero. Solo el dueño o el ADMIN (como "Hoy").
*/

const ESPERA_BUSQUEDA_MS = 300;

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function Fila({ tarjeta, ocupada, alDesarchivar }: { tarjeta: ArchivadaVista; ocupada: boolean; alDesarchivar: () => void }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium" title={tarjeta.titulo}>
          {tarjeta.codigo ? <span className="mr-1.5 text-muted-foreground tabular-nums">{tarjeta.codigo}</span> : null}
          {tarjeta.titulo}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{NOMBRE_DEL_ESTADO[tarjeta.estado]}</span>
          <span>Terminó el {CUANDO.format(new Date(tarjeta.terminadaEn))}</span>
          <span className="max-w-full truncate" title={tarjeta.tableroNombre}>
            En {tarjeta.tableroNombre}
          </span>
          {tarjeta.repo ? <span>Repo: {tarjeta.repo}</span> : null}
          {tarjeta.linkCommit ? (
            <a
              href={tarjeta.linkCommit}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ver commit{tarjeta.commit ? ` ${tarjeta.commit.slice(0, 7)}` : ""}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </p>
      </div>
      <Button
        variant="outline"
        className="h-11 shrink-0 md:h-9"
        disabled={ocupada}
        onClick={alDesarchivar}
        aria-label={`Desarchivar ${tarjeta.codigo || tarjeta.titulo}`}
      >
        {ocupada ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Desarchivar
      </Button>
    </li>
  );
}

export function TrabajosTerminados() {
  const [buscar, setBuscar] = useState("");
  const [tarjetas, setTarjetas] = useState<ArchivadaVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);

  // Lee la lista (y vuelve a leer al buscar, con una pequeña espera para no pedir con cada letra).
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    const reloj = setTimeout(() => {
      void trabajosTerminadosAction(buscar)
        .then((respuesta) => {
          if (!vigente) return;
          if (respuesta.ok) {
            setTarjetas(respuesta.tarjetas);
            setError(null);
          } else {
            setError(respuesta.error);
          }
        })
        .catch(() => {
          if (vigente) setError("No se pudo leer la lista. Revisa la conexión e intenta otra vez.");
        })
        .finally(() => {
          if (vigente) setCargando(false);
        });
    }, buscar ? ESPERA_BUSQUEDA_MS : 0);
    return () => {
      vigente = false;
      clearTimeout(reloj);
    };
  }, [buscar, vuelta]);

  const desarchivar = useCallback(async (tarjeta: ArchivadaVista) => {
    setOcupada(tarjeta.id);
    try {
      const respuesta = await desarchivarTarjetaAction(tarjeta.id);
      if (!respuesta.ok) {
        toast.error(respuesta.error);
        return;
      }
      setTarjetas((lista) => (lista ? lista.filter((otra) => otra.id !== tarjeta.id) : lista));
      toast.success(`${tarjeta.codigo || "La tarjeta"} volvió al tablero ${tarjeta.tableroNombre}.`);
    } catch {
      toast.error("No se pudo desarchivar. Intenta otra vez.");
    } finally {
      setOcupada(null);
    }
  }, []);

  const busqueda = buscar.trim();

  return (
    <section aria-labelledby="titulo-terminados" className="space-y-4">
      <div>
        <h1 id="titulo-terminados" className="text-lg font-semibold">
          Trabajos terminados
        </h1>
        <p className="text-sm text-muted-foreground">
          Las tarjetas Hechas o Fallidas salen solas del tablero 3 días después de terminar y quedan aquí, con todo su
          historial. Ya no cuentan para el límite de 300.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={buscar}
          onChange={(evento) => setBuscar(evento.target.value)}
          placeholder="Buscar por código (T-123), título o repo"
          aria-label="Buscar trabajos terminados"
          className="h-11 pl-9 md:h-9"
          maxLength={100}
        />
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 px-3 py-2 text-sm">
          <span className="text-destructive">{error}</span>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => setVuelta((n) => n + 1)}>
            Reintentar
          </Button>
        </div>
      ) : null}

      {cargando && !tarjetas ? <Loader2 className="mx-auto animate-spin text-muted-foreground" aria-label="Cargando" /> : null}

      {tarjetas && !error ? (
        tarjetas.length ? (
          <>
            <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {cargando ? "Buscando…" : tarjetas.length === 1 ? "1 trabajo" : `${tarjetas.length} trabajos`}
            </p>
            <ul className="space-y-1.5">
              {tarjetas.map((tarjeta) => (
                <Fila
                  key={tarjeta.id}
                  tarjeta={tarjeta}
                  ocupada={ocupada === tarjeta.id}
                  alDesarchivar={() => void desarchivar(tarjeta)}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {cargando
              ? "Buscando…"
              : busqueda
                ? `No hay trabajos terminados que coincidan con «${busqueda}».`
                : "Todavía no hay trabajos archivados. Las tarjetas terminadas pasan aquí solas a los 3 días."}
          </p>
        )
      ) : null}
    </section>
  );
}
