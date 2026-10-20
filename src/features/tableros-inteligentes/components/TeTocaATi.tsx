"use client";

import { useTransition } from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { aprobarTarjetaAction } from "@/app/actions/tableros-inteligentes-actions";
import { NOMBRE_DEL_ESTADO } from "../services/reglas";
import type { PendienteVista } from "../services/tableros";
import { COLOR_DEL_ESTADO } from "./colores";
import { IconoDeTipo } from "./IconoDeTipo";

/*
  "Te toca a ti": lo único que espera al dueño, en TODOS los tableros del negocio (no depende del
  nivel ni del tablero abierto). Las POR_APROBAR (de tipos con aprobación), con su botón Aprobar si
  quien mira puede aprobar, y las FALLIDO (decidir qué hacer). De la más vieja a la más nueva,
  agrupadas por tablero.
*/

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function Fila({
  pendiente,
  puedeAprobar,
  alAbrir,
  alAprobar,
}: {
  pendiente: PendienteVista;
  puedeAprobar: boolean;
  alAbrir: () => void;
  alAprobar: () => void;
}) {
  const [aprobando, empezar] = useTransition();
  const aprobar = () =>
    empezar(async () => {
      const resultado = await aprobarTarjetaAction(pendiente.id, pendiente.actualizadoEn);
      if (resultado.ok) toast.success("Aprobada");
      else toast.error(resultado.error);
      alAprobar();
    });
  const color = COLOR_DEL_ESTADO[pendiente.estado];
  return (
    <li className={cn("flex items-center gap-2 rounded-xl border-2 px-3 py-2", color.tarjeta)}>
      <button type="button" onClick={alAbrir} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <IconoDeTipo icono={pendiente.tipoIcono} color={pendiente.tipoColor} className="size-3.5 shrink-0" />
          {pendiente.tipoNombre} · {NOMBRE_DEL_ESTADO[pendiente.estado]} · desde {CUANDO.format(new Date(pendiente.actualizadoEn))}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-sm font-semibold leading-snug">{pendiente.titulo}</span>
      </button>
      {pendiente.estado === "POR_APROBAR" && puedeAprobar ? (
        <Button size="sm" onClick={aprobar} disabled={aprobando} className="shrink-0">
          {aprobando ? <Loader2 className="animate-spin" /> : <Check />}
          Aprobar
        </Button>
      ) : pendiente.estado === "FALLIDO" ? (
        <CircleAlert className="size-4 shrink-0 text-rose-500" aria-label="Falló: decidir qué hacer" />
      ) : null}
    </li>
  );
}

export function TeTocaATi({
  pendientes,
  cargando,
  puedeAprobar,
  alAbrir,
  alAprobar,
}: {
  pendientes: PendienteVista[];
  cargando: boolean;
  puedeAprobar: boolean;
  alAbrir: (pendiente: PendienteVista) => void;
  alAprobar: () => void;
}) {
  const grupos = new Map<string, { nombre: string; filas: PendienteVista[] }>();
  for (const pendiente of pendientes) {
    const grupo = grupos.get(pendiente.tableroId) ?? { nombre: pendiente.tableroNombre, filas: [] };
    grupo.filas.push(pendiente);
    grupos.set(pendiente.tableroId, grupo);
  }
  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="mx-auto max-w-2xl space-y-4">
        {pendientes.length === 0 ? (
          <p className="pt-10 text-center text-sm text-muted-foreground">
            {cargando ? "Buscando…" : "Nada te espera. Cuando Claude deje algo por aprobar o algo falle, aparece acá."}
          </p>
        ) : (
          [...grupos].map(([tableroId, grupo]) => (
            <section key={tableroId} className="space-y-1.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {grupo.nombre} · {grupo.filas.length}
              </h2>
              <ul className="space-y-1.5">
                {grupo.filas.map((pendiente) => (
                  <Fila
                    key={pendiente.id}
                    pendiente={pendiente}
                    puedeAprobar={puedeAprobar}
                    alAbrir={() => alAbrir(pendiente)}
                    alAprobar={alAprobar}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
