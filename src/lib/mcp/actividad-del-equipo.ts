import { leerActividadDelEquipo, nombreDeLaRuta } from "@/lib/actividad-del-equipo";
import { fechaYHoraDeBogota } from "@/lib/hora-de-lista";
import { accesoDelMiembro, normalizar } from "@/lib/mcp/supervisor";
import { prisma } from "@/lib/prisma";
import { MINUTOS_DE_CONECTADA_AHORA } from "@/features/actividad/services/lineas-de-la-persona";

/*
  ACTIVIDAD DEL EQUIPO DESDE CLAUDE (solo lectura).

  Contesta "¿cuándo se conectó Claudia por última vez?" y "¿cuántos chats atendió esta semana?" con
  lo mismo que muestra Mi empresa → Equipo: la última conexión (el último latido de la app, de
  `leerActividadDelEquipo`), si está conectada ahora, y lo que mandó desde el CRM en el periodo.

  "Última conexión" es la última vez que tuvo el CRM abierto y a la vista, NO el inicio de sesión: la
  app anota un latido cada pocos minutos mientras la pantalla está abierta, y solo se guarda el último.

  Lo pueden usar el dueño y los administradores, el mismo candado de Mi empresa → Equipo. El negocio
  sale de la clave, nunca de un argumento. No escribe nada.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

const DIAS_POR_DEFECTO = 7;
const DIAS_MINIMO = 1;
const DIAS_MAXIMO = 90;
const LARGO_DEL_EXTRACTO = 120;

export const HERRAMIENTAS_MCP_ACTIVIDAD_DEL_EQUIPO = [
  {
    name: "actividad_del_equipo",
    title: "Actividad del equipo",
    description:
      "Dice cuando se conecto por ultima vez cada persona del equipo y cuanto trabajo desde el CRM. Por persona: 'ultima_conexion' en hora de Colombia con la pantalla y el aparato (es la ultima vez que tuvo el CRM abierto y a la vista, NO el inicio de sesion; solo se guarda la ultima, no un historial), 'conectada_ahora' (tuvo el CRM a la vista hace menos de 6 minutos), 'ultimo_mensaje_enviado' desde el CRM en el periodo (fecha, cliente y extracto), 'chats_atendidos' (conversaciones distintas donde mando al menos un mensaje desde el CRM) y 'mensajes_enviados'. Lo que la asesora contesta desde el telefono no cuenta. 'persona' filtra por nombre o correo (sin importar mayusculas ni tildes). 'dias' es el periodo hacia atras, 7 por defecto, de 1 a 90. Solo para el dueño y los administradores. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        persona: { type: "string", description: "Nombre o correo, o un pedazo (\"claudia\"). Sin esto, todo el equipo." },
        dias: { type: "number", description: "Dias hacia atras para contar mensajes y chats. 7 por defecto; se ajusta a 1-90." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_ACTIVIDAD_DEL_EQUIPO.map((herramienta) => herramienta.name));

export function esHerramientaDeActividadDelEquipo(nombre: string) {
  return NOMBRES.has(nombre);
}

/** 7 si no se dice; cualquier otro número se redondea y se ajusta a 1–90. */
export function leerDias(valor: unknown): number {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
  if (!Number.isFinite(numero)) return DIAS_POR_DEFECTO;
  return Math.min(DIAS_MAXIMO, Math.max(DIAS_MINIMO, Math.round(numero)));
}

/** El mismo candado de Mi empresa → Equipo (`ownerOnly`): dueño o administrador. */
async function puedeVerAlEquipo(contexto: Contexto): Promise<boolean> {
  const acceso = await accesoDelMiembro(contexto);
  return Boolean(acceso && (acceso.isOwner || acceso.role === "ADMIN"));
}

type FilaDeMensajes = {
  userId: string;
  mensajes: bigint | number;
  chats: bigint | number;
  ultimoEn: Date;
  cliente: string | null;
  extracto: string | null;
};

/**
 * Lo que mandó cada persona desde el CRM en el periodo, para todo el equipo en UNA consulta.
 *
 * "Desde el CRM" = el mensaje lleva `enviadoPorUserId` (lo pone la app al enviar). Acotada por fecha
 * siempre: sin el rango, leer `rawPayload` sobre toda la tabla es la consulta que ya tardó 61 s.
 */
async function mensajesDelEquipo(workspaceId: string, desde: Date): Promise<Map<string, FilaDeMensajes>> {
  const filas = await prisma.$queryRaw<FilaDeMensajes[]>`
    WITH m AS (
      SELECT m."rawPayload"->>'enviadoPorUserId' AS "userId", m."createdAt", m."conversationId", m."contactId", m."content"
      FROM "Message" m
      WHERE m."workspaceId" = ${workspaceId}
        AND m."createdAt" >= ${desde}
        AND m."direction" = 'OUTBOUND' AND m."type" <> 'SYSTEM'
        AND m."rawPayload"->>'enviadoPorUserId' IS NOT NULL
    ),
    conteo AS (
      SELECT "userId", count(*) AS mensajes, count(DISTINCT "conversationId") AS chats FROM m GROUP BY 1
    ),
    ultimo AS (
      SELECT DISTINCT ON ("userId") "userId", "createdAt", "contactId", left("content", ${LARGO_DEL_EXTRACTO}) AS extracto
      FROM m ORDER BY "userId", "createdAt" DESC
    )
    SELECT conteo."userId", conteo.mensajes, conteo.chats, ultimo."createdAt" AS "ultimoEn",
           coalesce(c."name", c."phoneNumber") AS cliente, ultimo.extracto
    FROM conteo
    JOIN ultimo ON ultimo."userId" = conteo."userId"
    LEFT JOIN "Contact" c ON c."id" = ultimo."contactId"
  `;
  return new Map(filas.map((fila) => [fila.userId, fila]));
}

async function actividadDelEquipo(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerAlEquipo(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver la actividad del equipo: es solo del dueño y los administradores.");
  }
  const { workspaceId } = contexto;
  const dias = leerDias(args.dias);
  const persona = typeof args.persona === "string" ? normalizar(args.persona) : "";
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - dias * 24 * 3_600_000);

  // Las mismas personas que lista Mi empresa → Equipo: empleados y administradores del negocio.
  const [miembros, latidos, mensajes] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId, role: { in: ["AGENT", "ADMIN"] }, user: { role: { in: ["EMPLEADO", "ADMIN"] } } },
      orderBy: { createdAt: "asc" },
      select: { isActive: true, user: { select: { id: true, name: true, email: true } } },
    }),
    leerActividadDelEquipo(workspaceId),
    mensajesDelEquipo(workspaceId, desde),
  ]);

  const elegidos = miembros.filter(
    (m) => !persona || normalizar(m.user.name).includes(persona) || normalizar(m.user.email).includes(persona),
  );

  const equipo = elegidos.map((m) => {
    const latido = latidos[m.user.id];
    const cuando = latido ? new Date(latido.cuando) : null;
    const conLatido = latido && cuando && !Number.isNaN(cuando.getTime()) ? { latido, cuando } : null;
    const envios = mensajes.get(m.user.id);
    return {
      nombre: m.user.name?.trim() || m.user.email,
      correo: m.user.email,
      activa: m.isActive,
      ultima_conexion: conLatido
        ? {
            cuando: fechaYHoraDeBogota(conLatido.cuando),
            pantalla: conLatido.latido.donde || nombreDeLaRuta(conLatido.latido.ruta),
            aparato: conLatido.latido.dispositivo,
          }
        : null,
      // Un reloj un poco adelantado da minutos negativos: sigue siendo "ahora".
      conectada_ahora: conLatido ? (ahora.getTime() - conLatido.cuando.getTime()) / 60_000 < MINUTOS_DE_CONECTADA_AHORA : false,
      ultimo_mensaje_enviado: envios
        ? {
            cuando: fechaYHoraDeBogota(new Date(envios.ultimoEn)),
            cliente: envios.cliente,
            extracto: envios.extracto?.trim() || "(sin texto: adjunto)",
          }
        : null,
      chats_atendidos: envios ? Number(envios.chats) : 0,
      mensajes_enviados: envios ? Number(envios.mensajes) : 0,
    };
  });

  return {
    dias,
    desde: fechaYHoraDeBogota(desde),
    persona_buscada: typeof args.persona === "string" && args.persona.trim() ? args.persona.trim() : null,
    equipo,
    nota: "La ultima conexion es la ultima vez que tuvo el CRM abierto y a la vista, no el inicio de sesion. Lo que contesta desde el telefono no cuenta como mensaje enviado desde el CRM.",
    ...(persona && equipo.length === 0 ? { aviso: "No hay nadie del equipo con ese nombre o correo." } : {}),
  };
}

export async function ejecutarHerramientaMcpActividadDelEquipo(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "actividad_del_equipo":
      return actividadDelEquipo(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
