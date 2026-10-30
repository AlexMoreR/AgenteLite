import type { RevisionVista } from "../services/coordinador-en-vivo";
import type { EstadoDelRevisor, PasosVista } from "../services/reglas-coordinador-en-vivo";

/*
  La línea de pasos de una tarjeta en "Coordinador en vivo" (29-oct-2026): Plan → Construir → Revisar → Aprobar → Subido.
  Los pasos hechos llevan ✓, el actual va resaltado y, si la tarjeta está parada esperando al dueño, en lugar del paso
  donde se paró sale "Necesita humano" (y no se dibuja lo que sigue). En Revisar, debajo, los 4 revisores con la vuelta
  (R1, R2…): gris = revisando, verde = aprobó, rojo = pidió cambios. Sin estado propio: se prueba con renderToStaticMarkup
  (scripts/check-coordinador-en-vivo.mjs).
*/

export function LineaDePasos({ pasos }: { pasos: PasosVista }) {
  const visibles = pasos.pasos.slice(0, pasos.pasos.findIndex((paso) => paso.estado === "necesita_humano") + 1 || undefined);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Pasos de la tarea">
      {visibles.map((paso, indice) => (
        <li key={paso.clave} className="flex items-center gap-1">
          {indice > 0 ? (
            <span className="text-muted-foreground" aria-hidden>
              →
            </span>
          ) : null}
          {paso.estado === "necesita_humano" ? (
            <span className="rounded-full border border-amber-500/60 bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300" data-paso="necesita_humano">
              Necesita humano
            </span>
          ) : paso.estado === "actual" ? (
            <span className="rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground" aria-current="step" data-paso="actual">
              {paso.nombre}
            </span>
          ) : paso.estado === "hecho" ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300" data-paso="hecho">
              ✓ {paso.nombre}
            </span>
          ) : (
            <span className="rounded-full border px-2 py-0.5 text-muted-foreground" data-paso="pendiente">
              {paso.nombre}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

const ESTILO_DEL_REVISOR: Record<EstadoDelRevisor, { clase: string; texto: string }> = {
  revisando: { clase: "border-muted-foreground/30 bg-muted text-muted-foreground", texto: "revisando" },
  aprobado: { clase: "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", texto: "aprobó" },
  cambios: { clase: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300", texto: "pidió cambios" },
  no_aplica: { clase: "border-emerald-500/30 bg-emerald-500/5 text-muted-foreground", texto: "no aplica" },
};

export function CuadritosDeRevision({ revision }: { revision: RevisionVista }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1 shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums" title={`Vuelta ${revision.vuelta} de la revisión`}>
        R{revision.vuelta}
      </span>
      <ul className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="Revisores">
        {revision.revisores.map((revisor) => {
          const estilo = ESTILO_DEL_REVISOR[revisor.estado];
          return (
            <li key={revisor.clave} className={`rounded-lg border px-2 py-1 text-xs ${estilo.clase}`} data-revisor={revisor.clave} data-estado={revisor.estado}>
              <span className="block truncate font-medium">{revisor.nombre}</span>
              <span className="block">{estilo.texto}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
