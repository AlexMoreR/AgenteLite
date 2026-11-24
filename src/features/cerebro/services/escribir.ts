import { prisma } from "@/lib/prisma";
import { personaQueAprueba } from "@/features/tableros-inteligentes/services/tableros";
import { motivoNoEsDueno, textoDeConfirmacionParaCerebro } from "@/features/tableros-inteligentes/services/reglas-trabajador";
import { ErrorDeDrive, esErrorSinEspacio, type ClienteDeDrive } from "./drive";
import { driveDelNegocio, enlaceParaConectarGoogle } from "./conexion";
import { encolarNotaParaAizen1, notasEnAizen1Prendidas } from "./notas-por-crear";
import { permisosDelCerebro } from "./permisos";
import {
  AVISO_NOTA_EN_AIZEN1,
  agregarAlFinal,
  problemaDeRutaDeNota,
  rutaDeNota,
  conFechaDeDecision,
  MAXIMO_NIVELES,
  MIME_CARPETA,
  nombreDeDocumentoNuevo,
  problemaDeVersion,
  problemaDelContenido,
  sePuedeEscribir,
} from "./reglas";

/*
  CEREBRO: escribir en el Drive. Es lo único que modifica el Drive, y solo de tres maneras: crear un texto
  .md nuevo, agregarle una parte al final a un .md/.txt, o reemplazar su contenido. Nunca borra nada.

  Reglas (las revisa el SERVIDOR, no Claude):
  - Por el MCP (cerebro_escribir): la clave tiene que ser de la cuenta dueña. Crear y agregar NO piden
    la frase del dueño (Claude anota cada decisión apenas se toma); reemplazar todo un documento SÍ pide
    las palabras exactas del dueño ("sí, escríbelo en el cerebro").
  - Desde la pantalla o el tablero: el dueño o quien él autorizó para el cerebro.
  - Antes de escribir se compara la versión del documento en el Drive con la que se leyó. Si cambió, no se escribe.
  - Todo queda en CerebroCambio: quién, cuándo, desde dónde, el antes y el después.
  - Crear: con el permiso OAuth de la cuenta del negocio el archivo se crea en el Drive en el momento, una sola vez.
    Antes de crear se pregunta EN VIVO al Drive si ya hay un archivo con ese nombre en esa carpeta (la copia puede ir
    atrasada) y, si la carpeta no está en la copia, se confirma en vivo que cuelga de la carpeta del cerebro.
  - Crear con la cuenta de servicio en un Drive personal da 403 storageQuotaExceeded (no tiene espacio propio). Desde el
    CRM ya NO se deja nota en espera para aizen1: es un error claro con el link para dar el permiso OAuth
    (enlaceParaConectar). Solo si alguien prende a mano el interruptor `cerebro:notas-en-aizen1` (notas-por-crear.ts,
    apagado por defecto), sin OAuth la nota vuelve a quedar PENDIENTE para aizen1 (encolarNotaNueva), como respaldo.
*/

export type OrigenDeEscritura = "MCP" | "PANTALLA" | "TABLERO";
export type ModoDeEscritura = "crear" | "agregar" | "reemplazar";

export type PedidoDeEscritura = {
  workspaceId: string;
  userId: string;
  origen: OrigenDeEscritura;
  modo: ModoDeEscritura;
  contenido: string;
  /** agregar / reemplazar: el documento. */
  driveId?: string;
  /** crear: la carpeta (por defecto la raíz del cerebro) y el nombre del documento nuevo. */
  carpetaId?: string;
  nombre?: string;
  /** La versión que se leyó (campo `version` de cerebro_leer). Si no viene, la de la última sincronización. */
  versionLeida?: string | null;
  textoConfirmacion?: string;
  tarjetaId?: string;
};

export type DocumentoCopiado = {
  driveId: string;
  nombre: string;
  ruta: string;
  tipo: string;
  esCarpeta: boolean;
  enDrive: boolean;
  versionDrive: string | null;
};

/** Lo que escribir necesita de afuera (se cambia por falsos en las pruebas). */
export type DependenciasDeEscritura = {
  drive: ClienteDeDrive;
  carpetaRaizId: string;
  copiaDe(driveId: string): Promise<DocumentoCopiado | null>;
  hermanoConNombre(carpetaId: string, nombre: string): Promise<boolean>;
  carpetaDelCerebro(carpetaId: string): Promise<{ ruta: string } | null>;
  guardarCopia(datos: {
    driveId: string;
    padreId: string | null;
    nombre: string;
    ruta: string;
    tipo: string;
    texto: string;
    versionDrive: string | null;
    modificadoEnDrive: string | null;
    linkDrive: string | null;
  }): Promise<void>;
  registrar(cambio: {
    driveId: string;
    nombreDocumento: string;
    accion: ModoDeEscritura;
    antes: string | null;
    despues: string;
  }): Promise<void>;
  /**
   * Si Google no deja crear (403 storageQuotaExceeded: la cuenta de servicio no tiene espacio en un Drive personal),
   * se deja el pedido para que lo cree aizen1 en la bóveda local (CerebroNotaPorCrear). Sin esto, el error sube.
   */
  encolarNotaNueva?(nota: { ruta: string; contenido: string }): Promise<{ id: string }>;
  /**
   * Solo cuando se entró SIN el permiso OAuth: el link para darlo. Si Google no deja crear (sin espacio), el error lo
   * lleva tal cual. Sin esto, sube el error de Drive.
   */
  enlaceParaConectar?(): string;
  /**
   * En vivo en el Drive: los archivos con ese nombre en esa carpeta (la copia puede ir atrasada). Si hay alguno, crear
   * no crea otro. Las de verdad (escribirEnElCerebro y los agentes) siempre lo pasan.
   */
  buscarEnVivo?(carpetaId: string, nombre: string): Promise<Array<{ driveId: string }>>;
};

export type ResultadoDeEscritura = {
  driveId: string;
  nombre: string;
  ruta: string;
  accion: ModoDeEscritura;
  linkDrive: string | null;
  versionNueva: string | null;
  /** Solo si la nota nueva quedó para crearse en aizen1: el id del pedido y su estado (PENDIENTE). */
  pendiente?: { id: string; estado: "PENDIENTE"; aviso: string };
};

const TOPE_REGISTRO = 100_000;

/** El error cuando la cuenta de servicio no puede crear y falta el permiso de la cuenta del negocio. */
export const mensajeFaltaPermisoParaCrear = (enlace: string) =>
  `No se creó la nota: la cuenta de servicio no puede crear archivos nuevos en el Drive de Magilus y falta el permiso de la cuenta de Google de Magilus. Entra a ${enlace} con esa cuenta y pulsa Permitir; desde ahí las notas se guardan directo en Drive. No se guardó nada en espera: vuelve a intentarlo después de dar el permiso.`;

/**
 * En vivo: la ruta de una carpeta dentro del cerebro, subiendo por sus padres hasta la carpeta raíz. null si no es una
 * carpeta, si Drive no la encuentra o si no cuelga de la raíz (en MAXIMO_NIVELES niveles).
 */
async function rutaDeCarpetaEnVivo(drive: ClienteDeDrive, carpetaId: string, raizId: string): Promise<string | null> {
  const nombres: string[] = [];
  let actual = carpetaId;
  for (let nivel = 0; nivel < MAXIMO_NIVELES; nivel += 1) {
    let datos;
    try {
      datos = await drive.metadatos(actual);
    } catch (fallo) {
      if (fallo instanceof ErrorDeDrive && (fallo.estado === 404 || fallo.estado === 403)) return null;
      throw fallo;
    }
    if (datos.tipo !== MIME_CARPETA || !datos.padreId) return null;
    nombres.unshift(datos.nombre);
    if (datos.padreId === raizId) return nombres.join("/");
    actual = datos.padreId;
  }
  return null;
}

/** ¿Esta persona puede escribir por esta puerta? Devuelve el motivo de que no, o null. */
export function problemaDeAutorizacion(datos: {
  origen: OrigenDeEscritura;
  modo: ModoDeEscritura;
  textoConfirmacion?: unknown;
  /** Por el MCP: el motivo de que la cuenta de la clave no sea la dueña (null si lo es). */
  motivoCuentaNoDueno: string | null;
  /** Desde la pantalla o el tablero: es el dueño o está autorizada para el cerebro. */
  autorizadaParaElCerebro: boolean;
}): string | null {
  if (datos.origen === "MCP") {
    if (datos.modo === "reemplazar") {
      const texto = textoDeConfirmacionParaCerebro(datos.textoConfirmacion);
      if (texto) return `Reemplazar todo un documento pide la confirmación del dueño: ${texto}`;
    }
    return datos.motivoCuentaNoDueno;
  }
  return datos.autorizadaParaElCerebro ? null : "Solo el dueño o quien él autorizó para el cerebro puede escribir en él.";
}

export async function escribirConDependencias(pedido: PedidoDeEscritura, deps: DependenciasDeEscritura): Promise<ResultadoDeEscritura> {
  const problema = problemaDelContenido(pedido.contenido);
  if (problema) throw new Error(problema);

  if (pedido.modo === "crear") {
    const nombre = nombreDeDocumentoNuevo(pedido.nombre);
    if (!nombre) throw new Error("Falta el nombre del documento nuevo (mínimo 3 letras).");
    const carpetaId = pedido.carpetaId?.trim() || deps.carpetaRaizId;
    let carpeta = carpetaId === deps.carpetaRaizId ? { ruta: "" } : await deps.carpetaDelCerebro(carpetaId);
    if (!carpeta) {
      // No está en la copia (puede ir atrasada): se confirma en vivo que cuelga de la carpeta del cerebro.
      const enVivo = await rutaDeCarpetaEnVivo(deps.drive, carpetaId, deps.carpetaRaizId);
      if (enVivo !== null) carpeta = { ruta: enVivo };
    }
    if (!carpeta) throw new Error("Esa carpeta no está dentro del cerebro. Usa cerebro_listar para ver las carpetas.");
    if (await deps.hermanoConNombre(carpetaId, nombre)) {
      throw new Error(`Ya existe "${nombre}" en esa carpeta. Para sumarle algo usa modo "agregar" con su id.`);
    }
    // En vivo: la copia puede no tener todavía un archivo recién creado. Si ya está en el Drive, no se crea otro.
    const yaEsta = deps.buscarEnVivo ? (await deps.buscarEnVivo(carpetaId, nombre))[0] : undefined;
    if (yaEsta) {
      throw new Error(`Ya existe "${nombre}" en esa carpeta del Drive (id ${yaEsta.driveId}). No se creó otro: para sumarle algo usa modo "agregar" con ese id.`);
    }
    const contenidoNuevo = conFechaDeDecision(nombre, pedido.contenido).trim() + "\n";
    const ruta = rutaDeNota(carpeta.ruta, nombre);
    let creado;
    try {
      creado = await deps.drive.crearTexto(carpetaId, nombre, contenidoNuevo);
    } catch (fallo) {
      if (!esErrorSinEspacio(fallo)) throw fallo;
      // Falta el permiso OAuth: error claro con el link para darlo (no se deja nada en espera).
      if (deps.enlaceParaConectar) throw new Error(mensajeFaltaPermisoParaCrear(deps.enlaceParaConectar()));
      if (!deps.encolarNotaNueva) throw fallo;
      // La cuenta de servicio no puede crear en el Drive personal del dueño: la nota la crea aizen1 (Coordinador).
      const problemaRuta = problemaDeRutaDeNota(ruta);
      if (problemaRuta) throw new Error(`No se puede dejar la nota para aizen1: ${problemaRuta}`);
      const nota = await deps.encolarNotaNueva({ ruta, contenido: contenidoNuevo });
      await deps.registrar({ driveId: `aizen1:${nota.id}`, nombreDocumento: ruta, accion: "crear", antes: null, despues: contenidoNuevo });
      return {
        driveId: "",
        nombre,
        ruta,
        accion: "crear",
        linkDrive: null,
        versionNueva: null,
        pendiente: { id: nota.id, estado: "PENDIENTE", aviso: AVISO_NOTA_EN_AIZEN1 },
      };
    }
    await deps.guardarCopia({
      driveId: creado.driveId,
      padreId: carpetaId,
      nombre: creado.nombre,
      ruta,
      tipo: creado.tipo,
      texto: contenidoNuevo,
      versionDrive: creado.versionDrive,
      modificadoEnDrive: creado.modificadoEnDrive,
      linkDrive: creado.linkDrive,
    });
    await deps.registrar({ driveId: creado.driveId, nombreDocumento: ruta, accion: "crear", antes: null, despues: contenidoNuevo });
    return { driveId: creado.driveId, nombre: creado.nombre, ruta, accion: "crear", linkDrive: creado.linkDrive, versionNueva: creado.versionDrive };
  }

  const driveId = pedido.driveId?.trim();
  if (!driveId) throw new Error("Falta el id del documento (driveId). Usa cerebro_buscar o cerebro_listar.");
  const copia = await deps.copiaDe(driveId);
  if (!copia || copia.esCarpeta || !copia.enDrive) throw new Error("Ese documento no está en el cerebro (o ya no está en el Drive).");
  if (!sePuedeEscribir(copia.nombre, copia.tipo)) {
    throw new Error(
      `"${copia.nombre}" no se puede modificar desde acá: solo los textos .md y .txt (un Google Doc perdería su formato). Crea un documento nuevo en su carpeta.`,
    );
  }

  const enDrive = await deps.drive.metadatos(driveId);
  const versionProblema = problemaDeVersion(pedido.versionLeida ?? copia.versionDrive, enDrive.versionDrive);
  if (versionProblema) throw new Error(versionProblema);

  const antes = (await deps.drive.leerTexto(driveId, copia.nombre, copia.tipo)) ?? "";
  const despues = pedido.modo === "agregar" ? agregarAlFinal(antes, conFechaDeDecision(copia.nombre, pedido.contenido)) : pedido.contenido.trim() + "\n";
  if (despues === antes) throw new Error("No hay nada distinto para escribir.");
  const nuevo = await deps.drive.reemplazarTexto(driveId, despues, copia.tipo);
  await deps.guardarCopia({
    driveId,
    padreId: enDrive.padreId,
    nombre: nuevo.nombre,
    ruta: copia.ruta,
    tipo: nuevo.tipo,
    texto: despues,
    versionDrive: nuevo.versionDrive,
    modificadoEnDrive: nuevo.modificadoEnDrive,
    linkDrive: nuevo.linkDrive,
  });
  await deps.registrar({
    driveId,
    nombreDocumento: copia.ruta,
    accion: pedido.modo,
    antes: antes.slice(0, TOPE_REGISTRO),
    despues: despues.slice(0, TOPE_REGISTRO),
  });
  return { driveId, nombre: nuevo.nombre, ruta: copia.ruta, accion: pedido.modo, linkDrive: nuevo.linkDrive, versionNueva: nuevo.versionDrive };
}

/** Escribir de verdad: revisa quién puede, usa el Drive del negocio y deja el registro en la base. */
export async function escribirEnElCerebro(pedido: PedidoDeEscritura): Promise<ResultadoDeEscritura> {
  const persona = await personaQueAprueba(pedido.workspaceId, pedido.userId);
  let autorizada = false;
  if (pedido.origen !== "MCP") {
    const miembro = await prisma.workspaceMember.findFirst({
      where: { workspaceId: pedido.workspaceId, userId: pedido.userId, isActive: true },
      select: { role: true },
    });
    const permisos = await permisosDelCerebro({
      userId: pedido.userId,
      workspaceId: pedido.workspaceId,
      isOwner: persona.esDueno,
      membershipRole: miembro?.role ?? null,
    });
    autorizada = permisos.ver;
  }
  const veto = problemaDeAutorizacion({
    origen: pedido.origen,
    modo: pedido.modo,
    textoConfirmacion: pedido.textoConfirmacion,
    motivoCuentaNoDueno: persona.cuenta ? motivoNoEsDueno(persona.cuenta, "voz") : "No se pudo verificar la cuenta de la clave.",
    autorizadaParaElCerebro: autorizada,
  });
  if (veto) throw new Error(veto);

  const { drive, buscador, conexion, modo } = await driveDelNegocio(pedido.workspaceId);
  if (!conexion.carpetaId) throw new Error("Falta elegir la carpeta del cerebro en Mi empresa → Cerebro.");
  const carpetaRaizId = conexion.carpetaId;
  const workspaceId = pedido.workspaceId;

  return escribirConDependencias(pedido, {
    drive,
    carpetaRaizId,
    buscarEnVivo: (carpetaId, nombre) => buscador.buscarPorNombre(carpetaId, nombre),
    copiaDe: (driveId) =>
      prisma.cerebroDocumento.findUnique({
        where: { workspaceId_driveId: { workspaceId, driveId } },
        select: { driveId: true, nombre: true, ruta: true, tipo: true, esCarpeta: true, enDrive: true, versionDrive: true },
      }),
    hermanoConNombre: async (carpetaId, nombre) =>
      Boolean(
        await prisma.cerebroDocumento.findFirst({
          where: { workspaceId, padreId: carpetaId, enDrive: true, nombre: { equals: nombre, mode: "insensitive" } },
          select: { id: true },
        }),
      ),
    carpetaDelCerebro: (carpetaId) =>
      prisma.cerebroDocumento.findFirst({
        where: { workspaceId, driveId: carpetaId, esCarpeta: true, enDrive: true },
        select: { ruta: true },
      }),
    guardarCopia: async (datos) => {
      const ficha = {
        padreId: datos.padreId,
        nombre: datos.nombre,
        ruta: datos.ruta,
        tipo: datos.tipo,
        esCarpeta: false,
        texto: datos.texto,
        textoTruncado: false,
        versionDrive: datos.versionDrive,
        modificadoEnDrive: datos.modificadoEnDrive ? new Date(datos.modificadoEnDrive) : null,
        linkDrive: datos.linkDrive,
        enDrive: true,
        sincronizadoEn: new Date(),
      };
      await prisma.cerebroDocumento.upsert({
        where: { workspaceId_driveId: { workspaceId, driveId: datos.driveId } },
        create: { workspaceId, driveId: datos.driveId, ...ficha },
        update: ficha,
      });
    },
    // Sin el permiso OAuth, crear no se deja en espera para aizen1: el error lleva el link para darlo. Solo con el
    // interruptor de aizen1 prendido a mano (respaldo) la nota queda PENDIENTE para que la cree aizen1.
    ...(modo !== "oauth" && (await notasEnAizen1Prendidas())
      ? {
          encolarNotaNueva: (nota: { ruta: string; contenido: string }) =>
            encolarNotaParaAizen1({
              workspaceId,
              ruta: nota.ruta,
              contenido: nota.contenido,
              userId: pedido.userId,
              quienNombre: persona.nombre,
              origen: pedido.origen,
              tarjetaId: pedido.tarjetaId,
            }),
        }
      : modo !== "oauth"
        ? { enlaceParaConectar: () => enlaceParaConectarGoogle() }
        : {}),
    registrar: async (cambio) => {
      try {
        await prisma.cerebroCambio.create({
          data: {
            workspaceId,
            userId: pedido.userId,
            quienNombre: persona.nombre,
            origen: pedido.origen,
            driveId: cambio.driveId,
            nombreDocumento: cambio.nombreDocumento,
            accion: cambio.accion,
            antes: cambio.antes,
            despues: cambio.despues,
            textoConfirmacion: pedido.textoConfirmacion?.trim().slice(0, 500) ?? null,
            tarjetaId: pedido.tarjetaId ?? null,
          },
        });
      } catch (fallo) {
        throw new Error(
          `Se escribió en el Drive, pero NO quedó el registro (${fallo instanceof Error ? fallo.message : "error"}). Avísale al dueño.`,
        );
      }
    },
  });
}
