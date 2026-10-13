/**
 * Una automatización: CONDICIONES (todas) + ACCIONES (en orden). La regla está en dominio/.
 *
 * Nace de un pedido de Alex (14-sep-2026): no había forma de decir "todos los descartados a
 * Genesis" o "20 de los que llevan 3 días quietos a María". El 13-10-2026 pasó a armarse como en
 * Chatwoot (condiciones + acciones); las guardadas con la forma vieja se migran al leerlas.
 */
export * from "./dominio/modelo";
export type { FotoDelLead } from "./dominio/condiciones";
