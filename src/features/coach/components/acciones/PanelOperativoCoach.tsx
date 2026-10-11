import Link from "next/link";

import type { ItemOperativo } from "../../dominio/acciones-de-hoy";
import type { ProblemaDelEquipo } from "../../tipos";
import { AbrirChat, Desplegable, Etiqueta } from "./piezas";

const ORIGEN: Record<ItemOperativo["origen"], string> = {
  falla_del_sistema: "Falla del sistema / bot",
  sin_asesora: "Asignación",
  motivo_sistema: "No cierre por sistema",
  error_reclasificado: "Movido desde una asesora",
  pendiente_operativo: "Pendiente con causa operativa",
};

/**
 * Lo que NO es habilidad de una asesora: fallas del bot, chats sin asignar, reglas de ciudades,
 * etc. Va aparte y plegado, con el enlace al Supervisor, que es quien lo resuelve. Tambien los
 * problemas del equipo (un cambio de politica), que el Coach ya saca del entrenamiento individual.
 */
export function PanelOperativoCoach({
  items,
  problemasDelEquipo,
}: {
  items: ItemOperativo[];
  problemasDelEquipo: ProblemaDelEquipo[];
}) {
  if (!items.length && !problemasDelEquipo.length) return null;
  return (
    <section aria-labelledby="titulo-operativo" className="space-y-2">
      <Desplegable
        testId="panel-operativo"
        className="bg-card"
        titulo={
          <span id="titulo-operativo" className="flex flex-col">
            <span>Problema operativo · corresponde al Supervisor ({items.length})</span>
            <span className="text-xs font-normal text-muted-foreground">No cuenta para el entrenamiento de ninguna asesora.</span>
          </span>
        }
      >
        <Link
          href="/cliente/crm/supervisor"
          data-testid="ir-al-supervisor"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground sm:w-auto"
        >
          Ir al Supervisor
        </Link>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={`${item.origen}-${i}`} className="space-y-1.5 rounded-lg border border-border px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Etiqueta tono="aviso">{ORIGEN[item.origen]}</Etiqueta>
                {item.dudoso ? <Etiqueta tono="peligro">Revisar</Etiqueta> : null}
                {item.asesora ? <span className="text-xs text-muted-foreground">en {item.asesora}</span> : null}
              </div>
              <p className="text-sm text-foreground">{item.texto}</p>
              <p className="text-[11px] text-muted-foreground">Por qué está aquí: {item.regla}</p>
              {item.chats.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.chats.map((c) => (
                    <span key={c.ref} className="inline-flex items-center gap-1.5">
                      <span className="text-xs tabular-nums text-muted-foreground">{c.etiqueta}</span>
                      <AbrirChat chat={c} />
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Desplegable>

      {problemasDelEquipo.length ? (
        <Desplegable testId="problemas-del-equipo" className="bg-card" titulo={`Problema del equipo · una sola vez (${problemasDelEquipo.length})`}>
          <p className="text-xs text-muted-foreground">Lo tuvo el equipo entero o es un cambio de política: no es la habilidad de ninguna asesora.</p>
          <ul className="space-y-2 text-sm">
            {problemasDelEquipo.map((p) => (
              <li key={p.tipo} className="space-y-1 rounded-lg border border-border px-3 py-2.5">
                <p className="font-medium">
                  {p.nombre} ({p.total}: {p.porAsesora.map((a) => `${a.nombre.split(" ")[0]} ${a.casos}`).join(", ")})
                </p>
                <p className="text-muted-foreground">{p.porque}</p>
                <p>{p.queHacer}</p>
              </li>
            ))}
          </ul>
        </Desplegable>
      ) : null}
    </section>
  );
}
