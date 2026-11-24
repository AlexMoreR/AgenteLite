import { prisma } from "@/lib/prisma";
import { driveDelNegocio } from "./conexion";
import {
  armarArbol,
  bloqueDelCerebroParaLaTarjeta,
  esLegible,
  ordenarPorRelevancia,
  palabrasDeLaConsulta,
  recortarTexto,
  sePuedeEscribir,
  seIgnora,
  type PedazoDelCerebro,
} from "./reglas";

/* CEREBRO: lo que se lee. Casi todo sale de la copia en la base (rápido); leer un documento puede ir directo al Drive. */

/* ── Sincronización rápida: antes de listar o buscar, si la copia está vieja, se baja lo que cambió en el Drive ── */

/** Con la copia más vieja que esto, listar o buscar primero sincroniza. */
export const COPIA_VIEJA_MS = 2 * 60_000;
/** Lo máximo que se espera a la sincronización; pasado esto se contesta con la copia (la sincronización sigue sola). */
export const TOPE_SINCRONIZACION_RAPIDA_MS = 20_000;

export type ResultadoRapido = {
  /** true si esta llamada esperó una sincronización (la suya o la que ya corría). */
  sincronizo: boolean;
  /** Si no se pudo traer lo último del Drive: por qué, para decirlo en la respuesta. null = la copia está al día. */
  aviso: string | null;
};

export type DependenciasRapidas = {
  /** La carpeta elegida y cuándo se sincronizó por última vez (null si no hay cerebro). */
  conexion(workspaceId: string): Promise<{ carpetaId: string | null; ultimaSincronizacion: Date | null } | null>;
  sincronizar(workspaceId: string): Promise<{ ok: boolean; error?: string }>;
  ahora(): number;
  tope: number;
};

const avisoDeCopia = (motivo: string) => `El Drive no respondió (${motivo}); esto es la copia de la última sincronización y puede faltar lo más nuevo.`;

/**
 * Arma la sincronización rápida. Un candado en memoria por negocio: si ya corre una, las demás llamadas la esperan
 * en vez de arrancar otra. Si el Drive falla, no se reintenta hasta que pasen COPIA_VIEJA_MS (se repite el aviso).
 * Nunca falla: cualquier error queda en `aviso` y se sigue con la copia.
 */
export function crearSincronizacionRapida(deps: DependenciasRapidas) {
  const estados = new Map<string, { enCurso: Promise<string | null> | null; intentoEn: number; aviso: string | null }>();

  const esperar = async (enCurso: Promise<string | null>): Promise<ResultadoRapido> => {
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const tope = new Promise<string>((listo) => {
      reloj = setTimeout(() => listo(avisoDeCopia(`tardó más de ${Math.max(1, Math.ceil(deps.tope / 1000))} segundos`)), deps.tope);
    });
    try {
      return { sincronizo: true, aviso: await Promise.race([enCurso, tope]) };
    } finally {
      clearTimeout(reloj);
    }
  };

  return async function sincronizacionRapida(workspaceId: string): Promise<ResultadoRapido> {
    const previo = estados.get(workspaceId);
    if (previo?.enCurso) return esperar(previo.enCurso);
    if (previo?.aviso && deps.ahora() - previo.intentoEn < COPIA_VIEJA_MS) return { sincronizo: false, aviso: previo.aviso };
    try {
      const conexion = await deps.conexion(workspaceId);
      if (!conexion?.carpetaId) return { sincronizo: false, aviso: null };
      const ultima = conexion.ultimaSincronizacion?.getTime() ?? 0;
      if (deps.ahora() - ultima < COPIA_VIEJA_MS) return { sincronizo: false, aviso: null };
    } catch (fallo) {
      return { sincronizo: false, aviso: avisoDeCopia(fallo instanceof Error ? fallo.message : "error") };
    }
    // Pudo arrancar otra mientras se leía la conexión: se espera esa.
    const otra = estados.get(workspaceId)?.enCurso;
    if (otra) return esperar(otra);
    const estado = { enCurso: null as Promise<string | null> | null, intentoEn: deps.ahora(), aviso: null as string | null };
    estado.enCurso = Promise.resolve()
      .then(() => deps.sincronizar(workspaceId))
      .then((resultado) => (resultado.ok ? null : avisoDeCopia(resultado.error || "error")))
      .catch((fallo: unknown) => avisoDeCopia(fallo instanceof Error ? fallo.message : "error"))
      .then((aviso) => {
        estado.aviso = aviso;
        estado.enCurso = null;
        return aviso;
      });
    estados.set(workspaceId, estado);
    return esperar(estado.enCurso);
  };
}

/** La de verdad: la copia de la base y sincronizarElCerebro (solo baja lo que cambió). */
export const sincronizacionRapida = crearSincronizacionRapida({
  conexion: (workspaceId) => prisma.cerebroConexion.findUnique({ where: { workspaceId }, select: { carpetaId: true, ultimaSincronizacion: true } }),
  sincronizar: async (workspaceId) => {
    // Se carga al usarla: sincronizar-negocio trae el Drive y el almacén, que listar y buscar no necesitan si la copia está al día.
    const { sincronizarElCerebro } = await import("./sincronizar-negocio");
    return sincronizarElCerebro(workspaceId);
  },
  ahora: () => Date.now(),
  tope: TOPE_SINCRONIZACION_RAPIDA_MS,
});

export type FilaDelCerebro = {
  driveId: string;
  padreId: string | null;
  nombre: string;
  ruta: string;
  tipo: string;
  esCarpeta: boolean;
  modificadoEnDrive: string | null;
  linkDrive: string | null;
  enDrive: boolean;
  legible: boolean;
  escribible: boolean;
};

export async function filasDelCerebro(workspaceId: string): Promise<FilaDelCerebro[]> {
  // Si la copia está vieja, primero baja lo que cambió (tope de 20 s); si el Drive falla, sigue con la copia.
  await sincronizacionRapida(workspaceId);
  const filas = await prisma.cerebroDocumento.findMany({
    where: { workspaceId },
    orderBy: { ruta: "asc" },
    select: {
      driveId: true,
      padreId: true,
      nombre: true,
      ruta: true,
      tipo: true,
      esCarpeta: true,
      modificadoEnDrive: true,
      linkDrive: true,
      enDrive: true,
    },
  });
  // Red de seguridad: lo ignorado (.git, .obsidian, export-dudas, .png) no se muestra aunque la próxima sincronización aún no lo haya marcado.
  const delCerebro = filas.filter((fila) => !seIgnora(fila.ruta, fila.nombre, fila.tipo));
  return delCerebro.map((fila) => ({
    ...fila,
    modificadoEnDrive: fila.modificadoEnDrive ? fila.modificadoEnDrive.toISOString() : null,
    legible: !fila.esCarpeta && esLegible(fila.nombre, fila.tipo),
    escribible: !fila.esCarpeta && sePuedeEscribir(fila.nombre, fila.tipo),
  }));
}

export async function arbolDelCerebro(workspaceId: string) {
  const conexion = await prisma.cerebroConexion.findUnique({ where: { workspaceId }, select: { carpetaId: true } });
  const filas = await filasDelCerebro(workspaceId);
  return armarArbol(
    filas.filter((fila) => fila.enDrive),
    conexion?.carpetaId ?? "",
  );
}

export type DocumentoLeido = {
  driveId: string;
  nombre: string;
  ruta: string;
  tipo: string;
  texto: string | null;
  textoTruncado: boolean;
  /** Número de versión de Drive: se manda de vuelta al escribir para saber que nadie lo cambió. */
  version: string | null;
  modificadoEnDrive: string | null;
  linkDrive: string | null;
  enDrive: boolean;
  /** "drive" = se leyó ahora del Drive; "copia" = de la copia de la base. */
  leidoDe: "drive" | "copia";
  explicacion?: string;
};

/**
 * Lee un documento. Con `enVivo` va directo al Drive (la versión más fresca) y deja la copia al día;
 * si el Drive no responde, devuelve la copia y lo dice. Sin `enVivo`, la copia.
 */
export async function leerDocumentoDelCerebro(workspaceId: string, driveId: string, enVivo: boolean): Promise<DocumentoLeido> {
  const fila = await prisma.cerebroDocumento.findUnique({ where: { workspaceId_driveId: { workspaceId, driveId } } });
  if (!fila || seIgnora(fila.ruta, fila.nombre, fila.tipo)) throw new Error("Ese documento no está en el cerebro. Usa cerebro_listar o cerebro_buscar para ver los ids.");
  const desdeLaCopia = (explicacion?: string): DocumentoLeido => ({
    driveId: fila.driveId,
    nombre: fila.nombre,
    ruta: fila.ruta,
    tipo: fila.tipo,
    texto: fila.texto,
    textoTruncado: fila.textoTruncado,
    version: fila.versionDrive,
    modificadoEnDrive: fila.modificadoEnDrive ? fila.modificadoEnDrive.toISOString() : null,
    linkDrive: fila.linkDrive,
    enDrive: fila.enDrive,
    leidoDe: "copia",
    ...(explicacion ? { explicacion } : {}),
  });
  if (!enVivo || fila.esCarpeta || !fila.enDrive || !esLegible(fila.nombre, fila.tipo)) return desdeLaCopia();
  try {
    const { drive } = await driveDelNegocio(workspaceId);
    const [meta, bajado] = await Promise.all([drive.metadatos(driveId), drive.leerTexto(driveId, fila.nombre, fila.tipo)]);
    const { texto, truncado } = recortarTexto(bajado ?? "");
    await prisma.cerebroDocumento.update({
      where: { id: fila.id },
      data: {
        texto,
        textoTruncado: truncado,
        versionDrive: meta.versionDrive,
        modificadoEnDrive: meta.modificadoEnDrive ? new Date(meta.modificadoEnDrive) : null,
        nombre: meta.nombre,
        sincronizadoEn: new Date(),
      },
    });
    return {
      ...desdeLaCopia(),
      texto,
      textoTruncado: truncado,
      version: meta.versionDrive,
      modificadoEnDrive: meta.modificadoEnDrive,
      nombre: meta.nombre,
      leidoDe: "drive",
    };
  } catch (fallo) {
    return desdeLaCopia(`No se pudo leer del Drive ahora (${fallo instanceof Error ? fallo.message : "error"}); esta es la copia de la última sincronización.`);
  }
}

/** Buscar por texto en el nombre/ruta y en el contenido de la copia. */
export async function buscarEnElCerebro(workspaceId: string, consulta: string, maximo = 10): Promise<PedazoDelCerebro[]> {
  const palabras = palabrasDeLaConsulta(consulta);
  if (!palabras.length) return [];
  await sincronizacionRapida(workspaceId);
  const candidatos = await prisma.cerebroDocumento.findMany({
    where: {
      workspaceId,
      enDrive: true,
      esCarpeta: false,
      OR: palabras.flatMap((palabra) => [
        { ruta: { contains: palabra, mode: "insensitive" as const } },
        { texto: { contains: palabra, mode: "insensitive" as const } },
      ]),
    },
    select: { driveId: true, nombre: true, ruta: true, tipo: true, texto: true },
    take: 200,
  });
  // Red de seguridad: lo ignorado no aparece aunque la próxima sincronización aún no lo haya marcado.
  const delCerebro = candidatos.filter((fila) => !seIgnora(fila.ruta, fila.nombre, fila.tipo));
  return ordenarPorRelevancia(delCerebro, consulta, maximo);
}

/**
 * Lo del cerebro que toca una tarjeta, para el trabajador del Tablero IA. Nunca falla: sin cerebro
 * conectado, sin copia o con un error devuelve "" y el trabajador sigue como siempre.
 */
export async function cerebroParaLaTarjeta(workspaceId: string, tarjeta: { titulo: string; detalle?: string | null }): Promise<string> {
  try {
    const conexion = await prisma.cerebroConexion.findUnique({ where: { workspaceId }, select: { carpetaId: true } });
    if (!conexion?.carpetaId) return "";
    const pedazos = await buscarEnElCerebro(workspaceId, `${tarjeta.titulo} ${(tarjeta.detalle ?? "").slice(0, 400)}`, 5);
    return bloqueDelCerebroParaLaTarjeta(pedazos);
  } catch (fallo) {
    console.error("[cerebro] contexto para la tarjeta", fallo);
    return "";
  }
}

/**
 * Las políticas, reglas y precios del cerebro para el coach de ventas (una línea por documento). Si el
 * cerebro no responde, devuelve [] y el coach usa las reglas de siempre.
 */
export async function reglasDelCerebroParaElCoach(workspaceId: string): Promise<string[]> {
  try {
    const conexion = await prisma.cerebroConexion.findUnique({ where: { workspaceId }, select: { carpetaId: true } });
    if (!conexion?.carpetaId) return [];
    const documentos = await prisma.cerebroDocumento.findMany({
      where: {
        workspaceId,
        enDrive: true,
        esCarpeta: false,
        texto: { not: null },
        OR: ["politica", "política", "regla", "precio", "tarifa", "envio", "envío"].map((palabra) => ({
          ruta: { contains: palabra, mode: "insensitive" as const },
        })),
      },
      orderBy: { modificadoEnDrive: "desc" },
      select: { ruta: true, nombre: true, tipo: true, texto: true },
      take: 4,
    });
    return documentos
      .filter((documento) => !seIgnora(documento.ruta, documento.nombre, documento.tipo))
      .map((documento) => `Del cerebro (${documento.ruta}): ${(documento.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 1500)}`);
  } catch (fallo) {
    console.error("[cerebro] reglas para el coach", fallo);
    return [];
  }
}
