/**
 * Quién trabaja un canal, y a quién se le reparten los leads nuevos.
 *
 * Son DOS cosas distintas y durante un tiempo fueron una sola: la lista de colaboradores decidía
 * al mismo tiempo quién ve el canal y a quién le caen los leads nuevos. Entonces, para dejar de
 * darle leads a una asesora, había que sacarla de la lista — y eso le escondía el canal entero,
 * incluidos los cientos de chats que ya venía atendiendo. Abría la bandeja y le decía "aún no hay
 * conversaciones", como si el sistema estuviera roto.
 *
 * Ahora:
 *  - `collaboratorIds` = quién TRABAJA el canal. Manda sobre la visibilidad.
 *  - `pausedAssignmentIds` = de esos, a quién NO darle leads nuevos. Sigue viendo todo lo suyo.
 *
 * Pausar es lo que uno quiere el 90% de las veces (se va de vacaciones, está desbordada, se le
 * está pasando a otra persona). Sacar del canal es lo excepcional.
 */

function leerLista(metadata: unknown, clave: string): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  const valor = (metadata as Record<string, unknown>)[clave];
  return Array.isArray(valor) ? valor.filter((id): id is string => typeof id === "string") : [];
}

/** Quiénes trabajan el canal. Lista vacía = lo trabaja (y lo ve) todo el mundo. */
export function leerColaboradores(metadata: unknown): string[] {
  return leerLista(metadata, "collaboratorIds");
}

/** Quiénes están en pausa de reparto. Siempre es un subconjunto de los colaboradores. */
export function leerPausadosDeReparto(metadata: unknown): string[] {
  return leerLista(metadata, "pausedAssignmentIds");
}

/**
 * Los que pueden recibir un lead nuevo: colaboradores menos los pausados.
 *
 * Si quedan cero, el reparto automático no corre y el lead entra sin dueño — que es lo correcto:
 * mejor que quede libre para que lo agarre quien pueda, a asignárselo a alguien que justamente
 * está pausada.
 */
export function calcularReparto(metadata: unknown): string[] {
  const pausados = new Set(leerPausadosDeReparto(metadata));
  return leerColaboradores(metadata).filter((id) => !pausados.has(id));
}
