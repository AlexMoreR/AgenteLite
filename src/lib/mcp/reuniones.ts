import { prisma } from "@/lib/prisma";
import { sanitizeClientModuleAccess } from "@/lib/client-workspace-modules";
import { NOMBRE_DEL_ESTADO } from "@/features/reuniones/estados";
import { nombresDeUsuariosPara } from "@/features/reuniones/servicios/nombres-de-usuarios";
import { personasDeLaReunion } from "@/features/reuniones/servicios/nombres-de-participantes";
import { buscarReuniones } from "@/features/reuniones/servicios/buscar-reuniones";

/*
  REUNIONES por el MCP (solo lectura), para que Claude lea las actas.

  - listar_reuniones: las reuniones del negocio, y busca por texto en títulos, transcripciones y actas.
  - ver_reunion: la transcripción con nombres y horas, y el acta.

  Mismo permiso que la pantalla /cliente/reuniones: el dueño, los administradores y quien tenga el
  módulo "Reuniones". Los audios no salen por acá.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_REUNIONES = [
  {
    name: "listar_reuniones",
    title: "Listar reuniones",
    description:
      "Las reuniones del módulo Reuniones (videollamadas propias grabadas y audios subidos), de la más nueva a la más vieja, con su estado (Esperando, En vivo, En cola, Transcribiendo, Haciendo acta, Lista, Error) y el resumen del acta. Con `texto` busca en títulos, transcripciones y actas. Para leer una completa, usa ver_reunion con su id.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Texto a buscar en títulos, transcripciones y actas (opcional)." },
        limite: { type: "number", description: "Cuántas devolver (por defecto 20, máximo 100)." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "ver_reunion",
    title: "Ver una reunión",
    description:
      "Una reunión completa: quiénes entraron, la transcripción con nombre y hora de cada frase, y el acta (resumen, decisiones, tareas con responsable y fecha, mejoras en ventas y qué puede mejorar Alexander como dueño).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "El id de la reunión (sale en listar_reuniones)." } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_REUNIONES.map((herramienta) => herramienta.name));

export function esHerramientaDeReuniones(nombre: string) {
  return NOMBRES.has(nombre);
}

async function puedeVerReunionesPorMcp(contexto: Contexto): Promise<boolean> {
  const miembro = await prisma.workspaceMember.findFirst({
    where: { workspaceId: contexto.workspaceId, userId: contexto.userId, isActive: true },
    select: { role: true, moduleAccess: true, user: { select: { role: true } }, workspace: { select: { ownerId: true } } },
  });
  if (!miembro) {
    return false;
  }
  const rol = miembro.user?.role ?? "";
  const esDueno = rol === "CLIENTE" && (miembro.role === "OWNER" || miembro.workspace?.ownerId === contexto.userId);
  return esDueno || rol === "ADMIN" || sanitizeClientModuleAccess(miembro.moduleAccess).includes("reuniones");
}

const fecha = (valor: Date | null) => valor?.toISOString() ?? null;

async function listarReuniones(args: Argumentos, contexto: Contexto) {
  const texto = typeof args.texto === "string" ? args.texto : null;
  const limite = typeof args.limite === "number" && Number.isFinite(args.limite) ? Math.min(Math.max(Math.floor(args.limite), 1), 100) : 20;
  const reuniones = await buscarReuniones(contexto.workspaceId, texto, limite);
  return {
    texto_buscado: texto?.trim() || null,
    total: reuniones.length,
    reuniones: reuniones.map((reunion) => ({
      id: reunion.id,
      titulo: reunion.titulo,
      estado: NOMBRE_DEL_ESTADO[reunion.estado],
      origen: reunion.origen === "SUBIDA" ? "audio subido (no se separa quién habló)" : "videollamada",
      sin_grabar: reunion.sinGrabar,
      creada_en: fecha(reunion.createdAt),
      empezo_en: fecha(reunion.empezoEn),
      termino_en: fecha(reunion.terminoEn),
      creada_por: reunion.creadaPor,
      personas: reunion.participantes,
      resumen: reunion.resumen,
      ...(reunion.aviso ? { aviso: reunion.aviso } : {}),
      ...(reunion.estado === "ERROR" && reunion.motivoError ? { motivo_error: reunion.motivoError } : {}),
    })),
  };
}

async function verReunion(args: Argumentos, contexto: Contexto) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) {
    throw new Error("Falta el id de la reunión.");
  }
  const reunion = await prisma.reunion.findFirst({
    where: { id, workspaceId: contexto.workspaceId },
    select: {
      id: true,
      titulo: true,
      origen: true,
      sinGrabar: true,
      estado: true,
      aviso: true,
      motivoError: true,
      createdAt: true,
      empezoEn: true,
      terminoEn: true,
      textoTranscripcion: true,
      acta: true,
      creadaPor: { select: { name: true, email: true } },
      participantes: { orderBy: { entroEn: "asc" }, select: { nombre: true, identidad: true, userId: true, entroEn: true, salioEn: true } },
    },
  });
  if (!reunion) {
    throw new Error("No existe esa reunión en este negocio.");
  }
  return {
    id: reunion.id,
    titulo: reunion.titulo,
    estado: NOMBRE_DEL_ESTADO[reunion.estado],
    origen: reunion.origen === "SUBIDA" ? "audio subido (no se separa quién habló)" : "videollamada",
    sin_grabar: reunion.sinGrabar,
    creada_en: fecha(reunion.createdAt),
    empezo_en: fecha(reunion.empezoEn),
    termino_en: fecha(reunion.terminoEn),
    creada_por: reunion.creadaPor?.name?.trim() || reunion.creadaPor?.email || null,
    participantes: personasDeLaReunion(reunion.participantes, await nombresDeUsuariosPara(reunion.participantes)).map((participante) => ({
      nombre: participante.nombreVisible,
      entro_en: fecha(participante.entroEn),
      salio_en: fecha(participante.salioEn),
    })),
    acta: reunion.acta ?? null,
    transcripcion: reunion.textoTranscripcion ?? null,
    ...(reunion.aviso ? { aviso: reunion.aviso } : {}),
    ...(reunion.motivoError ? { motivo_error: reunion.motivoError } : {}),
    ...(reunion.sinGrabar ? { aviso_sin_grabar: "Reunión sin grabar: no hay audio, transcripción ni acta." } : {}),
    nota: "La transcripción va como '[mm:ss] Nombre: frase', con la hora desde que empezó la reunión.",
  };
}

export async function ejecutarHerramientaMcpReuniones(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  if (!(await puedeVerReunionesPorMcp(contexto))) {
    throw new Error("Esta clave no tiene el módulo Reuniones.");
  }
  switch (nombre) {
    case "listar_reuniones":
      return listarReuniones(argumentos, contexto);
    case "ver_reunion":
      return verReunion(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
