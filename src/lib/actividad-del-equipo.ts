import { prisma } from "@/lib/prisma";

/**
 * QUIÉN ESTÁ TRABAJANDO AHORA: la última vez que cada persona tocó la app, y en qué.
 *
 * Pedido de Alex (28-09-2026): poder abrir a una persona del equipo y ver qué hizo, más "la última
 * vez que dio click a la app, si fue a un chat o a un módulo", y desde qué aparato.
 *
 * Es UN dato por persona, no un recorrido: se pisa el anterior. Guardar cada pantalla que abre
 * cada una sería seguimiento minuto a minuto y una tabla que crece sola; esto contesta la pregunta
 * que de verdad se hace —"¿está trabajando o no, y en qué?"— con una sola fila por workspace.
 *
 * Vive en AppSetting para no migrar la base de producción, igual que el resto de lo que se agregó
 * mientras el V3 está en prueba.
 */

const CLAVE = "equipo:ultima-actividad:";

export type DispositivoDeTrabajo = "Android" | "iPhone" | "iPad" | "Windows" | "Mac" | "Otro";

export type UltimaActividad = {
  /** ISO. Cuándo fue el último latido. */
  cuando: string;
  /** La ruta donde estaba: "/cliente/chats", "/cliente/crm/tablero"... */
  ruta: string;
  /** En palabras: "Chats · Lilianny Guerrero", "CRM", "Llamadas". */
  donde: string;
  dispositivo: DispositivoDeTrabajo;
};

export type ActividadDelEquipo = Record<string, UltimaActividad>;

/**
 * El aparato, leído de lo que manda el navegador.
 *
 * El orden importa: un iPad dice "Macintosh" en los navegadores nuevos, y muchos Android traen
 * "Linux" adentro. Se pregunta primero por lo específico.
 */
export function leerDispositivo(userAgent: string | null | undefined): DispositivoDeTrabajo {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "Otro";
  if (/android/.test(ua)) return "Android";
  if (/iphone|ipod/.test(ua)) return "iPhone";
  // iPadOS se hace pasar por Mac de escritorio; lo delata que la pantalla sea táctil.
  if (/ipad/.test(ua) || (/macintosh/.test(ua) && /mobile/.test(ua))) return "iPad";
  if (/windows/.test(ua)) return "Windows";
  if (/macintosh|mac os x/.test(ua)) return "Mac";
  return "Otro";
}

/** El nombre del módulo, para no mostrarle una ruta a nadie. */
const NOMBRES_DE_RUTA: Array<[RegExp, string]> = [
  [/^\/cliente\/chats/, "Chats"],
  [/^\/cliente\/crm/, "CRM"],
  [/^\/cliente\/mi-tablero/, "Inicio"],
  [/^\/cliente\/contactos/, "Contactos"],
  [/^\/cliente\/llamadas/, "Llamadas"],
  [/^\/cliente\/seguimientos/, "Seguimientos"],
  [/^\/cliente\/campanas/, "Campañas"],
  [/^\/cliente\/flujos/, "Flujos"],
  [/^\/cliente\/conexion/, "Conexión"],
  [/^\/cliente\/agente-v3/, "Agente V3"],
  [/^\/cliente\/agente-v2/, "Agente V2"],
  [/^\/cliente\/productos/, "Productos"],
  [/^\/cliente\/automatizaciones/, "Automatizaciones"],
  [/^\/cliente\/diagramas/, "Diagramas"],
  [/^\/cliente\/equipo/, "Mi empresa"],
  [/^\/cliente\/claude/, "Claude"],
];

export function nombreDeLaRuta(ruta: string): string {
  const limpia = ruta.split("?")[0];
  return NOMBRES_DE_RUTA.find(([patron]) => patron.test(limpia))?.[1] ?? "La app";
}

export async function leerActividadDelEquipo(workspaceId: string): Promise<ActividadDelEquipo> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE}${workspaceId}` } });
  if (!fila?.value) {
    return {};
  }
  try {
    const datos = JSON.parse(fila.value) as unknown;
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
      return {};
    }
    const salida: ActividadDelEquipo = {};
    for (const [userId, valor] of Object.entries(datos as Record<string, unknown>)) {
      if (!valor || typeof valor !== "object") continue;
      const fila = valor as Partial<UltimaActividad>;
      if (typeof fila.cuando !== "string") continue;
      salida[userId] = {
        cuando: fila.cuando,
        ruta: typeof fila.ruta === "string" ? fila.ruta : "",
        donde: typeof fila.donde === "string" ? fila.donde : "La app",
        dispositivo: (fila.dispositivo as DispositivoDeTrabajo) ?? "Otro",
      };
    }
    return salida;
  } catch {
    return {};
  }
}

/**
 * Anota el latido de una persona.
 *
 * Lee y reescribe la fila entera, así que dos latidos a la vez podrían pisarse. Da igual a
 * propósito: lo que se pisa es "hace 10 segundos" con "hace 12 segundos", y el siguiente latido lo
 * corrige. No vale la pena una tabla ni un bloqueo para eso.
 */
export async function anotarActividad(input: {
  workspaceId: string;
  userId: string;
  ruta: string;
  /** Lo que se está mirando dentro del módulo: el nombre del chat, por ejemplo. */
  etiqueta?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const key = `${CLAVE}${input.workspaceId}`;
  const actual = await leerActividadDelEquipo(input.workspaceId);
  const modulo = nombreDeLaRuta(input.ruta);
  const etiqueta = input.etiqueta?.trim();

  actual[input.userId] = {
    cuando: new Date().toISOString(),
    ruta: input.ruta.split("?")[0].slice(0, 120),
    donde: etiqueta ? `${modulo} · ${etiqueta.slice(0, 60)}` : modulo,
    dispositivo: leerDispositivo(input.userAgent),
  };

  const value = JSON.stringify(actual);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
