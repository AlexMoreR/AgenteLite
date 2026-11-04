import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";
import { ImageResponse } from "next/og";

import { COLORES_POR_IMAGEN, huellaDeMaterial, partirEnPaginas, type ColorParaCarta } from "@/lib/carta-de-colores";

/*
  Imagen PNG de la carta de colores (parte 2 de «Carta de colores digital dentro del CRM»).

  Cada material sale en una o más imágenes de hasta 12 colores: arriba el logo de Magilus y el nombre del
  material, y en cada casilla la foto del color con su código y su nombre debajo. Las columnas dependen de
  cuántos colores tiene la página (1 → 1, 2 a 4 → 2, 5 o más → 3) y el alto sale de las filas que se usan:
  con pocos colores la muestra sale grande (se ve la textura) y no queda una hoja casi vacía.
  Se dibuja con `ImageResponse` de `next/og` (el mismo de los íconos de la app): no hace falta sharp ni canvas.

  Las imágenes quedan en public/uploads/carta-colores/ y las sirve src/app/uploads/[...path]/route.ts,
  igual que las otras subidas.
*/

/** Carpeta pública (dentro de /uploads) donde quedan las imágenes armadas. */
export const CARPETA_CARTA_DE_COLORES = "carta-colores";
/** Carpeta pública donde quedan las fotos de cada color. */
export const CARPETA_FOTOS_DE_COLORES = "carta-colores/fotos";

const RUTA_DEL_LOGO = "/magilus-logo.svg";

/*
  Versión del diseño de la imagen. Va en el nombre del archivo ("cuerotex-<huella>-d2-1.png"): las imágenes
  guardadas con un diseño anterior no la llevan y se rehacen solas al abrir la pantalla de la carta.
  Si se vuelve a cambiar el dibujo, se sube a "d3".
*/
export const VERSION_DEL_DISENO = "d2";

// Medidas de la imagen (pensada para verse bien en el celular del cliente).
const ANCHO = 1080;
const MARGEN = 60;
const ESPACIO_COLUMNAS = 40;
const ESPACIO_FILAS = 28;
// Código y hasta dos líneas de nombre, con letra que se lea en el celular (la imagen se ve a ~1/3).
const ALTO_TEXTO = 136;
const ALTO_ENCABEZADO = 250;

export type MedidasDePagina = {
  ancho: number;
  alto: number;
  columnas: number;
  filas: number;
  /** Lado de la muestra (cuadrada), en px. */
  ladoFoto: number;
};

/** Columnas, lado de la muestra y alto de la imagen según cuántos colores lleva la página. */
export function medidasDePagina(cantidadDeColores: number): MedidasDePagina {
  const cantidad = Math.min(COLORES_POR_IMAGEN, Math.max(1, Math.floor(cantidadDeColores) || 1));
  const columnas = cantidad === 1 ? 1 : cantidad <= 4 ? 2 : 3;
  const filas = Math.ceil(cantidad / columnas);
  const ladoFoto = Math.floor((ANCHO - MARGEN * 2 - ESPACIO_COLUMNAS * (columnas - 1)) / columnas);
  const alto = ALTO_ENCABEZADO + filas * (ladoFoto + ALTO_TEXTO) + (filas - 1) * ESPACIO_FILAS + MARGEN;
  return { ancho: ANCHO, alto, columnas, filas, ladoFoto };
}

/** Lee un archivo de public/ por su ruta pública ("/uploads/..."). Devuelve null si no está. */
export type LeerArchivoPublico = (rutaPublica: string) => Promise<Buffer | null>;

export type DatosDePaginaDeCarta = {
  material: { nombre: string };
  colores: readonly Pick<ColorParaCarta, "codigo" | "nombre" | "fotoUrl">[];
  /** Empieza en 1. */
  pagina: number;
  totalPaginas: number;
  leerArchivo: LeerArchivoPublico;
};

/** Tipo de imagen por sus primeros bytes (no por el nombre del archivo, que puede mentir). */
function tipoDeImagen(datos: Buffer, rutaPublica: string): string | null {
  if (datos.length >= 3 && datos[0] === 0xff && datos[1] === 0xd8 && datos[2] === 0xff) return "image/jpeg";
  if (datos.length >= 8 && datos.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (path.extname(rutaPublica).toLowerCase() === ".svg") return "image/svg+xml";
  return null;
}

async function comoDataUri(leerArchivo: LeerArchivoPublico, rutaPublica: string | null): Promise<string | null> {
  if (!rutaPublica) return null;
  const datos = await leerArchivo(rutaPublica).catch(() => null);
  if (!datos || datos.length === 0) return null;
  const tipo = tipoDeImagen(datos, rutaPublica);
  if (!tipo) return null;
  return `data:${tipo};base64,${datos.toString("base64")}`;
}

/**
  Dibuja una página de la carta y devuelve el PNG. Es pura: todo lo que lee del disco pasa por
  `leerArchivo`, así la prueba la puede correr en memoria.
*/
export async function dibujarPaginaDeCarta({
  material,
  colores,
  pagina,
  totalPaginas,
  leerArchivo,
}: DatosDePaginaDeCarta): Promise<Buffer> {
  const [logo, fotos] = await Promise.all([
    comoDataUri(leerArchivo, RUTA_DEL_LOGO),
    Promise.all(colores.map((color) => comoDataUri(leerArchivo, color.fotoUrl))),
  ]);
  const { ancho, alto, ladoFoto } = medidasDePagina(colores.length);
  const titulo = totalPaginas > 1 ? `${material.nombre} ${pagina}/${totalPaginas}` : material.nombre;

  const respuesta = new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: "#ffffff",
          padding: `0 ${MARGEN}px ${MARGEN}px ${MARGEN}px`,
          fontFamily: "sans-serif",
          color: "#111827",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: ALTO_ENCABEZADO,
          }}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={logo} width={300} height={108} style={{ objectFit: "contain" }} />
          ) : null}
          <div style={{ display: "flex", fontSize: 52, fontWeight: 700, marginTop: 8 }}>{titulo}</div>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            columnGap: ESPACIO_COLUMNAS,
            rowGap: ESPACIO_FILAS,
          }}
        >
          {colores.map((color, indice) => {
            const foto = fotos[indice];
            return (
              <div
                key={`${color.codigo}-${indice}`}
                style={{ display: "flex", flexDirection: "column", width: ladoFoto }}
              >
                {foto ? (
                  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
                  <img
                    src={foto}
                    width={ladoFoto}
                    height={ladoFoto}
                    style={{ objectFit: "cover", borderRadius: 18, border: "1px solid #e5e7eb" }}
                  />
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: ladoFoto,
                      height: ladoFoto,
                      borderRadius: 18,
                      background: "#f3f4f6",
                      color: "#9ca3af",
                      fontSize: 26,
                    }}
                  >
                    Sin foto
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    height: ALTO_TEXTO,
                    paddingTop: 8,
                  }}
                >
                  <div style={{ display: "flex", fontSize: 38, fontWeight: 700 }}>{color.codigo}</div>
                  <div
                    style={{
                      display: "block",
                      fontSize: 30,
                      lineHeight: 1.2,
                      color: "#4b5563",
                      maxWidth: ladoFoto,
                      textAlign: "center",
                      lineClamp: 2,
                    }}
                  >
                    {color.nombre}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ),
    { width: ancho, height: alto },
  );

  return Buffer.from(await respuesta.arrayBuffer());
}

/** Raíz de public/ en el disco. */
function carpetaPublica() {
  return path.join(process.cwd(), "public");
}

/**
  Pasa una ruta pública ("/uploads/carta-colores/fotos/x.jpg") a la ruta en el disco, sin dejar salir de
  public/ (nada de "..").
*/
export function rutaEnDisco(rutaPublica: string): string | null {
  const raiz = carpetaPublica();
  let pathname = String(rutaPublica ?? "").trim();
  if (!pathname) return null;
  try {
    pathname = new URL(pathname, "http://local").pathname;
  } catch {
    return null;
  }
  const candidata = path.resolve(raiz, `.${decodeURIComponent(pathname)}`);
  return candidata.startsWith(raiz + path.sep) ? candidata : null;
}

/** Lector de verdad: lee de public/ en el disco. */
export const leerArchivoPublico: LeerArchivoPublico = async (rutaPublica) => {
  const ruta = rutaEnDisco(rutaPublica);
  if (!ruta) return null;
  try {
    return await readFile(ruta);
  } catch {
    return null;
  }
};

/** Nombre del material listo para un archivo: "Cuerotex" -> "cuerotex", "Telas Lino" -> "telas-lino". */
export function slugDeMaterial(nombre: string): string {
  const slug = String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "material";
}

/** Solo se borran imágenes de la carta: nunca algo fuera de su carpeta. */
export function esImagenDeCarta(rutaPublica: string) {
  return new RegExp(`^/uploads/${CARPETA_CARTA_DE_COLORES}/[a-z0-9-]+\\.png$`).test(rutaPublica);
}

/** true si las imágenes del material ya están armadas con el diseño de hoy (o no tiene ninguna). */
export function imagenesConDisenoActual(imagenesUrl: readonly string[]): boolean {
  return imagenesUrl.every((ruta) => ruta.includes(`-${VERSION_DEL_DISENO}-`));
}

/**
  Vuelve a armar las imágenes de un material con sus colores visibles y guarda las rutas en `imagenesUrl`.
  Si no quedan colores visibles, deja `imagenesUrl = []`. Al final borra los PNG viejos de ese material
  (los que tenía en `imagenesUrl` y ya no usa). Devuelve las rutas nuevas.
*/
export async function rehacerImagenesDeMaterial(
  prisma: Pick<PrismaClient, "materialDeColores">,
  materialId: string,
  leerArchivo: LeerArchivoPublico = leerArchivoPublico,
): Promise<string[]> {
  const material = await prisma.materialDeColores.findUnique({
    where: { id: materialId },
    select: {
      id: true,
      nombre: true,
      imagenesUrl: true,
      colores: {
        select: { id: true, codigo: true, nombre: true, fotoUrl: true, oculto: true, orden: true },
      },
    },
  });
  if (!material) return [];

  const paginas = partirEnPaginas(material.colores);
  const nuevas: string[] = [];

  if (paginas.length > 0) {
    const carpeta = path.join(carpetaPublica(), "uploads", ...CARPETA_CARTA_DE_COLORES.split("/"));
    await mkdir(carpeta, { recursive: true });
    const base = `${slugDeMaterial(material.nombre)}-${huellaDeMaterial(material.colores)}-${VERSION_DEL_DISENO}`;

    for (const [indice, colores] of paginas.entries()) {
      const png = await dibujarPaginaDeCarta({
        material,
        colores,
        pagina: indice + 1,
        totalPaginas: paginas.length,
        leerArchivo,
      });
      const archivo = `${base}-${indice + 1}.png`;
      await writeFile(path.join(carpeta, archivo), png);
      nuevas.push(`/uploads/${CARPETA_CARTA_DE_COLORES}/${archivo}`);
    }
  }

  await prisma.materialDeColores.update({
    where: { id: material.id },
    data: { imagenesUrl: nuevas, imagenActualizadaEn: new Date() },
  });

  // Se borran después de guardar las nuevas: si algo falla antes, la carta vieja sigue sirviendo.
  const viejas = material.imagenesUrl.filter((ruta) => !nuevas.includes(ruta) && esImagenDeCarta(ruta));
  for (const ruta of viejas) {
    const enDisco = rutaEnDisco(ruta);
    if (enDisco) await unlink(enDisco).catch(() => undefined);
  }

  return nuevas;
}
