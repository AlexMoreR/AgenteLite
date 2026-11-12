/**
 * El alcance de los numeros de las pastillas "No leido" y "Sin responder".
 *
 * Esos dos numeros tienen que contar lo MISMO que muestra la lista con la pastilla encendida, y la
 * lista respeta la asignacion puesta (Todas, Mias, Sin asignar o una asesora). Antes /counts le
 * contaba a los jefes siempre "Todas": con Mias puesta la pastilla decia 40 y la lista traia 3.
 *
 * Se lee `assigned` con la MISMA regla que usa /list (src/app/api/cliente/chats/list/route.ts):
 * - `mine`, `unassigned` y `user:<id>[,<id>...]` se respetan;
 * - cualquier otro valor, o nada, es "Todas" (una pestaña vieja que no lo manda cuenta como hoy);
 * - la asesora que no es jefe ni monitora siempre ve "Mias", sin importar lo que pida;
 * - la monitora filtra igual que un jefe, pero siempre dentro de SUS lineas.
 *
 * Es pura (sin base ni Prisma): la ruta arma el `where` con lo que devuelve.
 */

/** Lo mismo que entiende /list en `assigned`. */
export type AsignacionDeLasPastillas = "all" | "mine" | "unassigned" | `user:${string}`;

/** Quien pide los numeros. "jefe" = dueño, administrador o supervisora (isManager). */
export type RolDeQuienCuenta =
  | { tipo: "jefe" }
  | { tipo: "monitora"; lineas: string[] }
  | { tipo: "asesora" };

/** De quien son los chats que cuentan esas dos pastillas. */
export type QuienesCuentan =
  | { tipo: "todo" }
  | { tipo: "mios" }
  | { tipo: "sin_asesora" }
  | { tipo: "asesoras"; ids: string[] };

export type AlcanceDeLasPastillas = {
  /** La asignacion que se aplica, tambien para el conteo de la linea oficial. */
  asignacion: AsignacionDeLasPastillas;
  quienes: QuienesCuentan;
  /** Las lineas de la monitora (null = sin limite de lineas aparte de las visibles). */
  lineas: string[] | null;
};

// Una o varias asesoras, separadas por coma: `user:id1,id2` (igual que /list y la pagina).
const PIDE_ASESORAS = /^user:[a-z0-9]+(,[a-z0-9]+)*$/i;

export function alcanceDeLasPastillas(
  assigned: string | null | undefined,
  rol: RolDeQuienCuenta,
): AlcanceDeLasPastillas {
  const pedido = (assigned ?? "").trim();
  let asignacion: AsignacionDeLasPastillas =
    pedido === "mine" || pedido === "unassigned" || PIDE_ASESORAS.test(pedido)
      ? (pedido as AsignacionDeLasPastillas)
      : "all";

  // La asesora comun solo ve sus chats: nunca "Todas", "Sin asignar" ni la bandeja de otra.
  if (rol.tipo === "asesora") {
    asignacion = "mine";
  }

  return {
    asignacion,
    quienes: quienesDe(asignacion),
    lineas: rol.tipo === "monitora" ? rol.lineas : null,
  };
}

function quienesDe(asignacion: AsignacionDeLasPastillas): QuienesCuentan {
  if (asignacion === "mine") return { tipo: "mios" };
  if (asignacion === "unassigned") return { tipo: "sin_asesora" };
  if (asignacion.startsWith("user:")) {
    return { tipo: "asesoras", ids: asignacion.slice("user:".length).split(",") };
  }
  return { tipo: "todo" };
}
