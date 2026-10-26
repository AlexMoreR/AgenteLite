import { prisma } from "@/lib/prisma";
import { buscarEnElCerebro, filasDelCerebro, leerDocumentoDelCerebro } from "@/features/cerebro/services/consultas";
import { escribirEnElCerebro } from "@/features/cerebro/services/escribir";
import { MAXIMO_ESCRITURA } from "@/features/cerebro/services/reglas";

/*
  CEREBRO por el MCP: cerebro_listar, cerebro_leer, cerebro_buscar y cerebro_escribir.

  El cerebro es una carpeta de Google Drive (la copia en la base se sincroniza cada hora y con el botón).
  Las tres primeras solo leen. cerebro_escribir es la única que modifica el Drive y SOLO cuando el dueño lo
  pidió con sus palabras en esta conversación; nunca borra nada. Ver features/cerebro/services/escribir.ts.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

const NO_CONECTADO = "El cerebro no está conectado a Google Drive (Mi empresa → Cerebro). No inventes nada: avísale al dueño.";

export const HERRAMIENTAS_MCP_CEREBRO = [
  {
    name: "cerebro_listar",
    title: "Listar el cerebro",
    description:
      "El cerebro es la base de conocimiento del negocio: lo que ya está decidido (decisiones, políticas, reglas, precios, aprendizajes), en una carpeta de Google Drive. Esto lista sus carpetas y documentos con el id de cada uno, la ruta, la fecha de la última modificación en el Drive y cuándo se sincronizó por última vez. Consúltalo antes de preguntar o suponer algo que quizá ya esté decidido.",
    inputSchema: {
      type: "object",
      properties: {
        carpeta: { type: "string", description: "Opcional: solo lo que cuelga de esta ruta (por ejemplo 'Precios')." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "cerebro_leer",
    title: "Leer un documento del cerebro",
    description:
      "Lee un documento del cerebro (Google Docs, .md y .txt; los PDF e imágenes solo se ven por nombre). Por defecto lo lee directo del Drive para tener la versión más fresca; si el Drive no responde, devuelve la copia y lo explica. Devuelve `version`: hay que pasarla a cerebro_escribir para que no se escriba encima de un cambio.",
    inputSchema: {
      type: "object",
      properties: {
        documento_id: { type: "string", description: "El id de Drive del documento (ver cerebro_listar o cerebro_buscar)." },
        desde_drive: { type: "boolean", description: "true (por defecto): leer ahora del Drive. false: la copia de la última sincronización." },
      },
      required: ["documento_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "cerebro_buscar",
    title: "Buscar en el cerebro",
    description: "Busca por texto en los nombres y en el contenido de los documentos del cerebro. Devuelve los mejores con un fragmento de donde coincide.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Qué buscar (palabras sueltas: 'precio camilla', 'contraentrega')." },
        maximo: { type: "number", description: "Cuántos resultados (por defecto 8, máximo 20)." },
      },
      required: ["texto"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "cerebro_escribir",
    title: "Escribir en el cerebro",
    description:
      "Crea un documento de decisión nuevo (.md) o le agrega una parte al final a uno que ya existe, DIRECTO EN EL DRIVE. Solo cuando Alexander lo pide explícitamente: antes, léele lo que vas a escribir y espera que diga 'sí, escríbelo en el cerebro'; texto_confirmacion es lo que dijo, tal cual. La cuenta de la clave de Claude tiene que ser la dueña del negocio. Nunca lo hagas por tu cuenta. " +
      "Antes de escribir se revisa que el documento no haya cambiado en el Drive desde que lo leíste (pasa `version_leida`, la `version` de cerebro_leer); si cambió, no escribe y avisa. Solo se modifican textos .md y .txt (un Google Doc no). Nunca borra nada; Drive guarda su historial de versiones y el CRM anota quién, cuándo, el antes y el después. Escribe solo la conclusión, no una conversación entera.",
    inputSchema: {
      type: "object",
      properties: {
        modo: { type: "string", enum: ["crear", "agregar", "reemplazar"], description: "crear = documento nuevo; agregar = al final de uno existente (lo normal); reemplazar = todo el contenido (solo si el dueño lo pidió así)." },
        documento_id: { type: "string", description: "agregar/reemplazar: el id de Drive del documento." },
        carpeta_id: { type: "string", description: "crear: el id de la carpeta (por defecto la principal del cerebro)." },
        nombre: { type: "string", description: "crear: el nombre del documento nuevo (se le pone .md si falta)." },
        contenido: { type: "string", description: `El texto a escribir (máximo ${MAXIMO_ESCRITURA} letras).` },
        version_leida: { type: "string", description: "agregar/reemplazar: la `version` que devolvió cerebro_leer." },
        texto_confirmacion: {
          type: "string",
          description: "Lo que dijo la persona para escribir, tal cual, por ejemplo 'sí, escríbelo en el cerebro'. Obligatorio. Mínimo 8 caracteres.",
        },
      },
      required: ["modo", "contenido", "texto_confirmacion"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_CEREBRO.map((herramienta) => herramienta.name));

export const esHerramientaDelCerebro = (nombre: string) => NOMBRES.has(nombre);

const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");

async function conectado(workspaceId: string) {
  const conexion = await prisma.cerebroConexion.findUnique({
    where: { workspaceId },
    select: { carpetaId: true, carpetaNombre: true, tokenCifrado: true, ultimaSincronizacion: true, ultimoError: true },
  });
  return conexion?.carpetaId && conexion.tokenCifrado ? conexion : null;
}

export async function ejecutarHerramientaMcpCerebro(nombre: string, args: Argumentos, contexto: Contexto): Promise<unknown> {
  const conexion = await conectado(contexto.workspaceId);
  if (!conexion) return { conectado: false, aviso: NO_CONECTADO };

  switch (nombre) {
    case "cerebro_listar": {
      const carpeta = texto(args.carpeta).toLowerCase();
      const filas = (await filasDelCerebro(contexto.workspaceId)).filter(
        (fila) => fila.enDrive && (!carpeta || fila.ruta.toLowerCase().startsWith(carpeta)),
      );
      return {
        conectado: true,
        carpeta_del_cerebro: conexion.carpetaNombre,
        ultima_sincronizacion: conexion.ultimaSincronizacion?.toISOString() ?? null,
        ...(conexion.ultimoError ? { ultimo_error: conexion.ultimoError } : {}),
        total: filas.length,
        documentos: filas.slice(0, 400).map((fila) => ({
          id: fila.driveId,
          ruta: fila.ruta,
          es_carpeta: fila.esCarpeta,
          se_lee_por_dentro: fila.legible,
          se_puede_escribir: fila.escribible,
          modificado_en_drive: fila.modificadoEnDrive,
          link: fila.linkDrive,
        })),
        ...(filas.length > 400 ? { aviso: "Hay más de 400: pasa `carpeta` para ver una parte." } : {}),
      };
    }
    case "cerebro_leer": {
      const id = texto(args.documento_id);
      if (!id) throw new Error("Falta documento_id.");
      const documento = await leerDocumentoDelCerebro(contexto.workspaceId, id, args.desde_drive !== false);
      return {
        id: documento.driveId,
        ruta: documento.ruta,
        leido_de: documento.leidoDe === "drive" ? "el Drive, ahora" : "la copia de la última sincronización",
        ...(documento.explicacion ? { aviso: documento.explicacion } : {}),
        ...(documento.enDrive ? {} : { aviso_borrado: "Este documento ya no está en el Drive; esto es la última copia." }),
        version: documento.version,
        modificado_en_drive: documento.modificadoEnDrive,
        link: documento.linkDrive,
        ...(documento.texto === null
          ? { texto: null, aviso_tipo: "Este tipo de archivo (PDF, imagen…) no se lee por dentro: ábrelo con el link." }
          : { texto: documento.texto, ...(documento.textoTruncado ? { truncado: true } : {}) }),
      };
    }
    case "cerebro_buscar": {
      const consulta = texto(args.texto);
      if (!consulta) throw new Error("Falta texto para buscar.");
      const maximo = Math.min(20, Math.max(1, Number(args.maximo) || 8));
      const resultados = await buscarEnElCerebro(contexto.workspaceId, consulta, maximo);
      return {
        conectado: true,
        ultima_sincronizacion: conexion.ultimaSincronizacion?.toISOString() ?? null,
        total: resultados.length,
        resultados: resultados.map((r) => ({ id: r.driveId, ruta: r.ruta, fragmento: r.fragmento })),
        ...(resultados.length ? {} : { aviso: "No hay nada en el cerebro con esas palabras. No inventes: pregúntale al dueño." }),
      };
    }
    case "cerebro_escribir": {
      const modo = texto(args.modo);
      if (modo !== "crear" && modo !== "agregar" && modo !== "reemplazar") throw new Error('modo tiene que ser "crear", "agregar" o "reemplazar".');
      const resultado = await escribirEnElCerebro({
        workspaceId: contexto.workspaceId,
        userId: contexto.userId,
        origen: "MCP",
        modo,
        contenido: typeof args.contenido === "string" ? args.contenido : "",
        driveId: texto(args.documento_id) || undefined,
        carpetaId: texto(args.carpeta_id) || undefined,
        nombre: texto(args.nombre) || undefined,
        versionLeida: typeof args.version_leida === "string" ? args.version_leida : null,
        textoConfirmacion: typeof args.texto_confirmacion === "string" ? args.texto_confirmacion : undefined,
      });
      return {
        ok: true,
        accion: resultado.accion,
        id: resultado.driveId,
        ruta: resultado.ruta,
        link: resultado.linkDrive,
        version_nueva: resultado.versionNueva,
        aviso: "Escrito en el Drive y anotado en el registro del cerebro (quién, cuándo, antes y después). Drive guarda además su historial de versiones.",
      };
    }
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
