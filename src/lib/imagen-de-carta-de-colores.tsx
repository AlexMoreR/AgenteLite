import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";
import type { PrismaClient } from "@prisma/client";

import { COLORES_POR_IMAGEN, huellaDeMaterial, partirEnPaginas, type ColorParaCarta } from "./carta-de-colores";

/*
  Imagen PNG de la carta de colores (parte 2 de «Carta de colores digital dentro del CRM»).

  Se dibuja con `ImageResponse` de next/og (satori + resvg, ya vienen con Next): sin sharp ni canvas.
  Una imagen por cada 12 colores visibles. Las imágenes quedan en public/uploads/carta-colores y sus
  rutas en MaterialDeColores.imagenesUrl, listas para mandarlas en el chat.
*/

/** Carpeta pública (en disco) donde quedan las imágenes armadas y las fotos de los colores. */
export const RUTA_PUBLICA_CARTA = "/uploads/carta-colores";
export const RUTA_PUBLICA_FOTOS = `${RUTA_PUBLICA_CARTA}/fotos`;

/** Una foto de color guardada por la ruta de subida: /uploads/carta-colores/fotos/<id>.jpg|png. */
const PATRON_FOTO = /^\/uploads\/carta-colores\/fotos\/[A-Za-z0-9-]{1,80}\.(jpg|png)$/;
/** Una imagen armada por rehacerImagenesDeMaterial. */
const PATRON_IMAGEN = /^\/uploads\/carta-colores\/[a-z0-9-]{1,120}\.png$/;

export function esFotoDeCarta(url: string): boolean {
  return PATRON_FOTO.test(url);
}

const ANCHO = 1080;
const ALTO = 1700;
const LADO_MUESTRA = 300;
/** Alto fijo de cada muestra (foto, código y hasta dos líneas de nombre): todas las filas quedan iguales. */
const ALTO_MUESTRA = 320;

export type LeerArchivoPublico = (rutaPublica: string) => Promise<Buffer | null>;

/** Lee un archivo de public/ por su ruta pública ("/uploads/..."). Fuera de public/ o si no existe: null. */
export async function leerArchivoDePublic(rutaPublica: string): Promise<Buffer | null> {
  const carpetaPublic = path.join(process.cwd(), "public");
  const relativa = String(rutaPublica ?? "").split("?")[0].replace(/^\/+/, "");
  const completa = path.resolve(carpetaPublic, relativa);
  if (!relativa || !completa.startsWith(carpetaPublic + path.sep)) {
    return null;
  }
  try {
    return await readFile(completa);
  } catch {
    return null;
  }
}

/** Tipo de imagen por sus primeros bytes (no por el nombre): solo JPG, PNG y SVG. */
function tipoDeImagen(datos: Buffer): string | null {
  if (datos.length >= 3 && datos[0] === 0xff && datos[1] === 0xd8 && datos[2] === 0xff) return "image/jpeg";
  if (datos.length >= 8 && datos.subarray(0, 8).equals(FIRMA_PNG)) return "image/png";
  const inicio = datos.subarray(0, 512).toString("utf8").trimStart();
  if (inicio.startsWith("<svg") || (inicio.startsWith("<?xml") && inicio.includes("<svg"))) return "image/svg+xml";
  return null;
}

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function comoDataUri(leerArchivo: LeerArchivoPublico, rutaPublica: string | null): Promise<string | null> {
  if (!rutaPublica) return null;
  const datos = await leerArchivo(rutaPublica).catch(() => null);
  if (!datos || datos.length === 0) return null;
  const tipo = tipoDeImagen(datos);
  return tipo ? `data:${tipo};base64,${datos.toString("base64")}` : null;
}

export type EntradaDePagina = {
  material: { nombre: string };
  colores: readonly Pick<ColorParaCarta, "codigo" | "nombre" | "fotoUrl">[];
  /** Página que se dibuja, desde 1. */
  pagina: number;
  totalPaginas: number;
  leerArchivo: LeerArchivoPublico;
};

/**
  Dibuja una página de la carta: logo arriba, el nombre del material (con "1/2" si hay varias páginas) y
  una cuadrícula de 3×4 con la foto, el código y el nombre de cada color. Devuelve el PNG.
*/
export async function dibujarPaginaDeCarta({
  material,
  colores,
  pagina,
  totalPaginas,
  leerArchivo,
}: EntradaDePagina): Promise<Buffer> {
  const muestras = colores.slice(0, COLORES_POR_IMAGEN);
  const [logo, fotos] = await Promise.all([
    comoDataUri(leerArchivo, "/magilus-logo.svg"),
    Promise.all(muestras.map((color) => comoDataUri(leerArchivo, color.fotoUrl))),
  ]);
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
          padding: "40px 60px",
          fontFamily: "sans-serif",
          color: "#1f2937",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} width={250} height={90} alt="" style={{ objectFit: "contain" }} />
          ) : null}
          <div style={{ display: "flex", fontSize: 52, fontWeight: 700, marginTop: 12 }}>{titulo}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-start", gap: 30 }}>
          {muestras.map((color, indice) => (
            <div
              key={`${color.codigo}-${indice}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: LADO_MUESTRA,
                height: ALTO_MUESTRA,
                overflow: "hidden",
              }}
            >
              {fotos[indice] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fotos[indice] as string}
                  width={LADO_MUESTRA}
                  height={200}
                  alt=""
                  style={{ objectFit: "cover", borderRadius: 16 }}
                />
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: LADO_MUESTRA,
                    height: 200,
                    borderRadius: 16,
                    background: "#e5e7eb",
                    color: "#6b7280",
                    fontSize: 24,
                  }}
                >
                  Sin foto
                </div>
              )}
              <div style={{ display: "flex", fontSize: 34, fontWeight: 700, marginTop: 10 }}>{color.codigo}</div>
              <div
                style={{
                  display: "flex",
                  fontSize: 24,
                  color: "#4b5563",
                  maxWidth: LADO_MUESTRA,
                  textAlign: "center",
                  overflow: "hidden",
                  maxHeight: 64,
                }}
              >
                {color.nombre}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    { width: ANCHO, height: ALTO },
  );
  return Buffer.from(await respuesta.arrayBuffer());
}

/** El nombre del material en el nombre del archivo: sin tildes, en minúsculas y con guiones. */
export function slugDeMaterial(nombre: string): string {
  const slug = String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "material";
}

type PrismaDeCarta = Pick<PrismaClient, "materialDeColores">;

/**
  Vuelve a armar las imágenes de un material con sus colores visibles (12 por imagen), guarda las rutas en
  imagenesUrl y borra las imágenes viejas de ESE material (las que tenía guardadas). Sin colores visibles,
  imagenesUrl queda vacío. Devuelve las rutas nuevas.
*/
export async function rehacerImagenesDeMaterial(
  prisma: PrismaDeCarta,
  materialId: string,
  leerArchivo: LeerArchivoPublico = leerArchivoDePublic,
): Promise<string[]> {
  const material = await prisma.materialDeColores.findUnique({
    where: { id: materialId },
    select: {
      id: true,
      nombre: true,
      imagenesUrl: true,
      colores: { select: { id: true, codigo: true, nombre: true, fotoUrl: true, oculto: true, orden: true } },
    },
  });
  if (!material) {
    return [];
  }

  const paginas = partirEnPaginas(material.colores);
  const nuevas: string[] = [];
  if (paginas.length > 0) {
    const carpeta = path.join(process.cwd(), "public", ...RUTA_PUBLICA_CARTA.split("/").filter(Boolean));
    await mkdir(carpeta, { recursive: true });
    const base = `${slugDeMaterial(material.nombre)}-${huellaDeMaterial(material.colores)}`;
    for (let indice = 0; indice < paginas.length; indice += 1) {
      const png = await dibujarPaginaDeCarta({
        material,
        colores: paginas[indice],
        pagina: indice + 1,
        totalPaginas: paginas.length,
        leerArchivo,
      });
      const nombreArchivo = `${base}-${indice + 1}.png`;
      await writeFile(path.join(carpeta, nombreArchivo), png);
      nuevas.push(`${RUTA_PUBLICA_CARTA}/${nombreArchivo}`);
    }
  }

  await prisma.materialDeColores.update({
    where: { id: material.id },
    data: { imagenesUrl: nuevas, imagenActualizadaEn: new Date() },
  });

  // Se borran después de guardar las nuevas: así nunca queda guardada una ruta a un archivo que ya no existe.
  const viejas = material.imagenesUrl.filter((url) => !nuevas.includes(url) && PATRON_IMAGEN.test(url));
  await Promise.all(
    viejas.map((url) =>
      unlink(path.join(process.cwd(), "public", ...url.split("/").filter(Boolean))).catch(() => undefined),
    ),
  );

  return nuevas;
}
