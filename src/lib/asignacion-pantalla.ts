import { leerColaboradores, leerMonitores, leerPausadosDeReparto } from "@/lib/channel-collaborators";
import { CONFIG_DE_ASIGNACION_POR_DEFECTO, type ConfigDeAsignacion } from "@/lib/reparto-cuando-lo-necesita";

/*
  PANTALLA MI EMPRESA > EQUIPO > ASIGNACIÓN (T-772, parte 3), sin base de datos (para poder probarla
  sola). La usan las acciones de `src/app/actions/asignacion-actions.ts`.

  - Las asesoras de una línea de ventas son sus colaboradoras activas en el equipo, menos las que solo
    monitorean (esas nunca reciben chats: no pueden contestar).
  - "Fuera del reparto" es la lista `pausedAssignmentIds` que ya existe en cada línea. Sacar a una
    asesora del reparto NO la saca de la línea: sigue viendo y atendiendo sus chats.
  - Una línea sin colaboradoras la ve todo el equipo: el reparto de esas se arma en Conexión, no aquí.
*/

export const INTERRUPTORES_DE_ASIGNACION = Object.keys(CONFIG_DE_ASIGNACION_POR_DEFECTO) as Array<
  keyof ConfigDeAsignacion
>;

/** Los interruptores que manda el formulario: los cuatro, cada uno true o false. Si no, error. */
export function validarInterruptores(valor: unknown): { ok: true; config: ConfigDeAsignacion } | { error: string } {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return { error: "Faltan los interruptores." };
  }
  const crudo = valor as Record<string, unknown>;
  const config = { ...CONFIG_DE_ASIGNACION_POR_DEFECTO };
  for (const clave of INTERRUPTORES_DE_ASIGNACION) {
    if (typeof crudo[clave] !== "boolean") {
      return { error: "Faltan los interruptores." };
    }
    config[clave] = crudo[clave] as boolean;
  }
  return { ok: true, config };
}

/** Quiénes de la línea se pueden poner o quitar del reparto desde esta pantalla, en el orden de la línea. */
export function asesorasDelReparto(metadata: unknown, miembrosActivos: ReadonlySet<string>): string[] {
  const monitores = new Set(leerMonitores(metadata));
  return leerColaboradores(metadata).filter((id) => miembrosActivos.has(id) && !monitores.has(id));
}

/**
 * La lista `pausedAssignmentIds` nueva de una línea. De las asesoras que muestra la pantalla manda lo
 * pedido (`fuera`); las demás colaboradoras (monitoras, inactivas) quedan como estaban. Ids que no son
 * de la línea se ignoran. Devuelve `null` si no cambia nada (no hay que escribir).
 */
export function pausadosNuevos(
  metadata: unknown,
  miembrosActivos: ReadonlySet<string>,
  fuera: readonly unknown[],
): string[] | null {
  const colaboradores = leerColaboradores(metadata);
  if (colaboradores.length === 0) return null;
  const editables = new Set(asesorasDelReparto(metadata, miembrosActivos));
  const pedidas = new Set(fuera.filter((id): id is string => typeof id === "string" && editables.has(id)));
  const antes = leerPausadosDeReparto(metadata);
  const quedan = new Set([...antes.filter((id) => !editables.has(id)), ...pedidas]);
  const despues = colaboradores.filter((id) => quedan.has(id));
  const igual = despues.length === antes.length && despues.every((id) => antes.includes(id));
  return igual ? null : despues;
}
