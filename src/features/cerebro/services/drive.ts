import {
  MAXIMO_ARCHIVOS,
  MAXIMO_NIVELES,
  MIME_CARPETA,
  MIME_DOCUMENTO_GOOGLE,
  rutaDe,
  tipoDeLectura,
  type ArchivoDeDrive,
} from "./reglas";

/*
  CEREBRO: llamadas a Google Drive con fetch (como src/lib/google-sheets.ts, sin librerías nuevas).

  REGLA DEL PROYECTO: este archivo NO tiene ninguna función que borre, mueva a la papelera o cambie quién
  comparte un archivo. Solo lee, crea y reemplaza el contenido de un texto. Hay una prueba
  (scripts/check-cerebro.mjs) que revisa que aquí no aparezca ninguna llamada de borrar.
*/

const API = "https://www.googleapis.com/drive/v3";
const SUBIDA = "https://www.googleapis.com/upload/drive/v3";
const CAMPOS = "id,name,mimeType,modifiedTime,version,webViewLink,parents";

export type FetchDeDrive = (url: string, init?: RequestInit) => Promise<Response>;

export class ErrorDeDrive extends Error {
  constructor(
    mensaje: string,
    readonly estado: number,
    /** true = Google no deja crear porque la cuenta (de servicio) no tiene espacio propio: la nota la crea aizen1. */
    readonly sinEspacio = false,
  ) {
    super(mensaje);
    this.name = "ErrorDeDrive";
  }
}

/** ¿Este error es el 403 storageQuotaExceeded al crear con la cuenta de servicio? */
export const esErrorSinEspacio = (fallo: unknown) =>
  fallo instanceof Error && ((fallo as Partial<ErrorDeDrive>).sinEspacio === true || /storageQuotaExceeded/i.test(fallo.message));

type ArchivoCrudo = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  version?: string;
  webViewLink?: string;
  parents?: string[];
};

export type MetadatosDeArchivo = {
  driveId: string;
  nombre: string;
  tipo: string;
  modificadoEnDrive: string | null;
  versionDrive: string | null;
  linkDrive: string | null;
  padreId: string | null;
};

const aMetadatos = (archivo: ArchivoCrudo): MetadatosDeArchivo => ({
  driveId: archivo.id,
  nombre: archivo.name,
  tipo: archivo.mimeType,
  modificadoEnDrive: archivo.modifiedTime ?? null,
  versionDrive: archivo.version ?? null,
  linkDrive: archivo.webViewLink ?? null,
  padreId: archivo.parents?.[0] ?? null,
});

export function crearClienteDeDrive(token: string, fetchFn: FetchDeDrive = fetch) {
  const pedir = async (url: string, init: RequestInit = {}) => {
    const respuesta = await fetchFn(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
    });
    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => "");
      const sinEspacio = /storageQuotaExceeded/i.test(cuerpo);
      const motivo =
        respuesta.status === 401
          ? "Google ya no acepta el permiso: hay que reconectar el Drive."
          : sinEspacio
            ? "Google no deja que la cuenta de servicio cree archivos nuevos en un Drive personal (no tiene espacio propio). Agregar o reemplazar en un documento .md que ya existe sí funciona; o crea el archivo vacío en la carpeta y luego se escribe"
            : `Drive respondió ${respuesta.status}`;
      throw new ErrorDeDrive(`${motivo}${cuerpo ? `: ${cuerpo.slice(0, 200)}` : ""}`, respuesta.status, sinEspacio);
    }
    return respuesta;
  };

  const opcionesComunes = "supportsAllDrives=true&includeItemsFromAllDrives=true";

  async function listar(consulta: string): Promise<MetadatosDeArchivo[]> {
    const filas: MetadatosDeArchivo[] = [];
    let pagina: string | undefined;
    do {
      const url = `${API}/files?q=${encodeURIComponent(consulta)}&fields=${encodeURIComponent(`nextPageToken,files(${CAMPOS})`)}&pageSize=1000&${opcionesComunes}${
        pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""
      }`;
      const cuerpo = (await (await pedir(url)).json()) as { files?: ArchivoCrudo[]; nextPageToken?: string };
      filas.push(...(cuerpo.files ?? []).map(aMetadatos));
      pagina = cuerpo.nextPageToken;
    } while (pagina && filas.length < MAXIMO_ARCHIVOS);
    return filas;
  }

  return {
    /** Las carpetas del Drive para que el dueño elija la del cerebro (con filtro opcional por nombre). */
    async listarCarpetas(texto?: string, opciones: { soloCompartidas?: boolean } = {}) {
      const filtro = texto?.trim() ? ` and name contains '${texto.trim().replace(/['\\]/g, " ")}'` : "";
      // Con la cuenta de servicio: solo las carpetas que el dueño compartió con ella (no sus subcarpetas).
      const compartidas = opciones.soloCompartidas ? " and sharedWithMe" : "";
      return listar(`mimeType='${MIME_CARPETA}' and trashed=false${compartidas}${filtro}`);
    },

    async metadatos(driveId: string): Promise<MetadatosDeArchivo> {
      const url = `${API}/files/${encodeURIComponent(driveId)}?fields=${encodeURIComponent(CAMPOS)}&supportsAllDrives=true`;
      return aMetadatos((await (await pedir(url)).json()) as ArchivoCrudo);
    },

    /** Todo lo que cuelga de la carpeta (carpetas y archivos), con su ruta. Tope de archivos y de niveles. */
    async recorrer(raizId: string): Promise<{ archivos: ArchivoDeDrive[]; truncado: boolean }> {
      const archivos: ArchivoDeDrive[] = [];
      let truncado = false;
      let nivel: Array<{ id: string; ruta: string }> = [{ id: raizId, ruta: "" }];
      for (let profundidad = 0; nivel.length && profundidad < MAXIMO_NIVELES; profundidad += 1) {
        const siguiente: Array<{ id: string; ruta: string }> = [];
        for (const carpeta of nivel) {
          const hijos = await listar(`'${carpeta.id}' in parents and trashed=false`);
          for (const hijo of hijos) {
            if (archivos.length >= MAXIMO_ARCHIVOS) {
              truncado = true;
              break;
            }
            // Los atajos a otros archivos no se siguen: serían copias de algo que está en otro lado.
            if (hijo.tipo === "application/vnd.google-apps.shortcut") continue;
            const ruta = rutaDe(carpeta.ruta, hijo.nombre);
            const esCarpeta = hijo.tipo === MIME_CARPETA;
            archivos.push({
              driveId: hijo.driveId,
              padreId: carpeta.id,
              nombre: hijo.nombre,
              ruta,
              tipo: hijo.tipo,
              esCarpeta,
              modificadoEnDrive: hijo.modificadoEnDrive,
              versionDrive: hijo.versionDrive,
              linkDrive: hijo.linkDrive,
            });
            if (esCarpeta) siguiente.push({ id: hijo.driveId, ruta });
          }
        }
        nivel = siguiente;
      }
      if (nivel.length) truncado = true;
      return { archivos, truncado };
    },

    /** El texto de un documento: Google Docs se exporta a texto; .md y .txt se bajan tal cual. null si no es legible. */
    async leerTexto(driveId: string, nombre: string, tipo: string): Promise<string | null> {
      const como = tipoDeLectura(nombre, tipo);
      if (como === "otro") return null;
      const url =
        como === "documento"
          ? `${API}/files/${encodeURIComponent(driveId)}/export?mimeType=${encodeURIComponent("text/plain")}`
          : `${API}/files/${encodeURIComponent(driveId)}?alt=media&supportsAllDrives=true`;
      return (await pedir(url)).text();
    },

    /** Crea un texto (.md) nuevo dentro de una carpeta. No toca nada que ya exista. */
    async crearTexto(carpetaId: string, nombre: string, contenido: string): Promise<MetadatosDeArchivo> {
      const limite = `cerebro-${Math.random().toString(36).slice(2)}`;
      const cuerpo = [
        `--${limite}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify({ name: nombre, parents: [carpetaId], mimeType: "text/markdown" }),
        `--${limite}`,
        "Content-Type: text/markdown; charset=UTF-8",
        "",
        contenido,
        `--${limite}--`,
      ].join("\r\n");
      const url = `${SUBIDA}/files?uploadType=multipart&fields=${encodeURIComponent(CAMPOS)}&supportsAllDrives=true`;
      const respuesta = await pedir(url, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${limite}` },
        body: cuerpo,
      });
      return aMetadatos((await respuesta.json()) as ArchivoCrudo);
    },

    /** Reemplaza el contenido de un texto (.md o .txt). Drive guarda la versión anterior en su historial. */
    async reemplazarTexto(driveId: string, contenido: string, tipo: string): Promise<MetadatosDeArchivo> {
      if (tipo === MIME_DOCUMENTO_GOOGLE || tipo === MIME_CARPETA) {
        throw new ErrorDeDrive("Solo se escriben textos .md o .txt; un Google Doc o una carpeta no.", 400);
      }
      const url = `${SUBIDA}/files/${encodeURIComponent(driveId)}?uploadType=media&fields=${encodeURIComponent(CAMPOS)}&supportsAllDrives=true`;
      const respuesta = await pedir(url, {
        method: "PATCH",
        headers: { "Content-Type": `${tipo.startsWith("text/") ? tipo : "text/plain"}; charset=UTF-8` },
        body: contenido,
      });
      return aMetadatos((await respuesta.json()) as ArchivoCrudo);
    },
  };
}

export type ClienteDeDrive = ReturnType<typeof crearClienteDeDrive>;
