/*
  PERMISO DE ENVIO INTERNO: para mandar al chat SIN la sesión del navegador (parte 2 de «Flujos: que
  se envíen completos aunque la asesora cambie de chat, y al instante»).

  El flujo ahora lo manda el servidor solo: en after() o en el cron, donde a veces no hay cookie de
  sesión. Quien lo manda (procesarEnvioDeFlujo) revisa UNA vez, con el userId guardado en la fila, el
  rol, el permiso a Chats, el negocio y el modo monitoreo, y recién entonces crea este permiso.

  Por qué un permiso y no un parámetro "userId": las funciones de envío viven en archivos "use server",
  y TODO lo que exporta un archivo así se puede llamar desde el navegador con los argumentos que uno
  quiera. Un `{ userId, workspaceId }` escrito a mano no sirve: el permiso solo vale si lo creó este
  módulo (queda anotado en un WeakSet que no sale del servidor), y un objeto que llega del navegador
  nunca está ahí.

  Este archivo NO es "use server": nada de aquí se puede llamar desde afuera.
*/

export type PermisoDeEnvioInterno = Readonly<{
  userId: string;
  workspaceId: string;
}>;

const EMITIDOS = new WeakSet<object>();

/** Solo se llama DESPUÉS de revisar la sesión guardada, el permiso a Chats y el modo monitoreo. */
export function emitirPermisoDeEnvioInterno(datos: { userId: string; workspaceId: string }): PermisoDeEnvioInterno {
  const permiso = Object.freeze({ userId: datos.userId, workspaceId: datos.workspaceId });
  EMITIDOS.add(permiso);
  return permiso;
}

/** true solo si el permiso lo creó `emitirPermisoDeEnvioInterno` en este mismo servidor. */
export function esPermisoDeEnvioInterno(valor: unknown): valor is PermisoDeEnvioInterno {
  return typeof valor === "object" && valor !== null && EMITIDOS.has(valor);
}
