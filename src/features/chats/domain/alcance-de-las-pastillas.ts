/**
 * Que cuentan las pastillas "No leido" y "Sin responder" (Alex, 11-11-2026).
 *
 * El numero de la pastilla tiene que coincidir con la lista: si la asesora tiene puesta "Mias" y
 * enciende "No leido", ve SUS chats no leidos, asi que el numero tambien tiene que ser el de ella.
 * Antes los jefes contaban siempre todo el negocio y el numero no coincidia con lo que veian.
 *
 * Lee `assigned` con la MISMA regla que /list (src/app/api/cliente/chats/list/route.ts):
 * - `mine`, `unassigned` o `user:<id>[,<id>...]` se respetan; cualquier otra cosa (o nada) es "all".
 * - La asesora que no es monitora queda siempre en "mine": no hay forma de contar chats ajenos
 *   desde la URL.
 * - La monitora filtra igual que un jefe, pero siempre dentro de SUS lineas.
 *
 * Sin `assigned` cuenta como antes (todo lo que ve): asi una pestaña abierta antes del despliegue,
 * que todavia no lo manda, sigue mostrando los mismos numeros.
 */

/** Quien pide los numeros. "jefe" = dueño, administrador o supervisora. */
export type QuienPideLasPastillas =
  | { tipo: "jefe" }
  | { tipo: "monitora"; lineas: string[] }
  | { tipo: "asesora" };

/** De quien son los chats que cuentan. */
export type AsignacionDeLasPastillas =
  | { tipo: "todo" }
  | { tipo: "mios" }
  | { tipo: "sinAsesora" }
  | { tipo: "asesoras"; ids: string[] };

/** El valor de asignacion que entiende el conteo de la linea oficial. */
export type AsignacionOficialDeLasPastillas = "all" | "mine" | "unassigned" | `user:${string}`;

export type AlcanceDeLasPastillas = {
  asignacion: AsignacionDeLasPastillas;
  /** Solo estas lineas (la monitora), o null si no se recorta por linea. */
  lineas: string[] | null;
  /** Lo mismo, dicho como lo entiende countOfficialConversations. */
  asignacionOficial: AsignacionOficialDeLasPastillas;
};

/** Una o varias asesoras separadas por coma: `user:id1,id2` (la misma expresion que /list). */
const UNA_O_VARIAS_ASESORAS = /^user:[a-z0-9]+(,[a-z0-9]+)*$/i;

export function alcanceDeLasPastillas(
  assigned: string | null | undefined,
  quien: QuienPideLasPastillas,
): AlcanceDeLasPastillas {
  const pedido = assigned?.trim() ?? "";
  const lineas = quien.tipo === "monitora" ? quien.lineas : null;

  // La asesora que no es monitora: siempre los suyos, pida lo que pida.
  if (quien.tipo === "asesora") {
    return { asignacion: { tipo: "mios" }, lineas: null, asignacionOficial: "mine" };
  }

  if (pedido === "mine") {
    return { asignacion: { tipo: "mios" }, lineas, asignacionOficial: "mine" };
  }
  if (pedido === "unassigned") {
    return { asignacion: { tipo: "sinAsesora" }, lineas, asignacionOficial: "unassigned" };
  }
  if (UNA_O_VARIAS_ASESORAS.test(pedido)) {
    const ids = pedido.slice("user:".length).split(",");
    return { asignacion: { tipo: "asesoras", ids }, lineas, asignacionOficial: `user:${ids.join(",")}` };
  }
  // "all", nada o algo que no se entiende: todo lo que ve, como antes.
  return { asignacion: { tipo: "todo" }, lineas, asignacionOficial: "all" };
}
