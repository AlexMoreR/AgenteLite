/**
 * Quién ve los apartados de jefe del CRM (Alex, 26-10-2026): Tablero, Embudo, Comparar embudos,
 * Pauta, Recuperación, Supervisor, los agentes de área, Informe y Guiones.
 *
 * Solo el dueño y los administradores del negocio (la cuenta Magilus). Las supervisoras (Ingrid,
 * María) y las asesoras ven lo mismo: Chats, Mi día y Kanban de lo suyo. `puedeSupervisar` NO cambia:
 * otras pantallas (llamadas, asignar chats, automatizaciones) siguen dependiendo de ella.
 *
 * Es una función pura y sin base de datos para poder usarla en el menú, en las páginas y en pruebas.
 */
export type AccesoDelCrm = { isOwner: boolean; role: string; membershipRole: string };

export function esJefeDelNegocio(access: AccesoDelCrm): boolean {
  return access.isOwner || access.role === "ADMIN" || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";
}

/** El Registro lo conservan los jefes y la monitora de un canal (si no, se quedaría sin pantalla). */
export function puedeVerRegistro(access: AccesoDelCrm, esMonitora: boolean): boolean {
  return esJefeDelNegocio(access) || esMonitora;
}
