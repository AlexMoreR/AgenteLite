"use server";

import { Prisma } from "@prisma/client";

import {
  MATERIALES_BASE,
  codigoRepetido,
  validarCodigo,
  type TipoMaterialDeColor,
} from "@/lib/carta-de-colores";
import { requireClientWorkspaceAccess, type ClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { imagenesConDisenoActual, rehacerImagenesDeMaterial } from "@/lib/imagen-de-carta-de-colores";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

/*
  Acciones de la carta de colores (parte 2 de «Carta de colores digital dentro del CRM»).

  Ver la carta: cualquiera con acceso al CRM. Mandarla en el chat: cualquiera con acceso a Chats (solo
  lee las imágenes ya armadas). Cambiarla: dueño, administrador o supervisora (`puedeSupervisar`), y se
  revisa acá, del lado del servidor, aunque la pantalla esconda los botones.

  Todo se busca por `workspaceId` del que pregunta: nadie toca la carta de otro negocio.
*/

export type ResultadoCarta<T extends object = object> =
  | ({ ok: true; aviso?: string } & T)
  | { ok: false; error: string };

const SIN_PERMISO = "Solo el dueño, un administrador o una supervisora pueden cambiar la carta de colores.";
const NO_ENCONTRADO = "No se encontró ese material o color. Recarga la página.";
const AVISO_IMAGEN =
  "Se guardó, pero no se pudo armar la imagen de la carta. Toca «Rehacer imagen» para intentarlo otra vez.";
const LARGO_MAXIMO_NOMBRE = 60;
const RUTA_FOTO = /^\/uploads\/carta-colores\/fotos\/[a-zA-Z0-9-]+\.(jpg|png)$/;

async function accesoParaEditar(): Promise<{ ok: true; access: ClientWorkspaceAccess } | { ok: false; error: string }> {
  const access = await requireClientWorkspaceAccess();
  if (!(await puedeSupervisar(access))) {
    return { ok: false, error: SIN_PERMISO };
  }
  return { ok: true, access };
}

function limpiarNombre(nombre: unknown): string {
  return String(nombre ?? "").trim().replace(/\s+/g, " ");
}

function validarNombre(nombre: unknown, que: string): { ok: true; nombre: string } | { ok: false; error: string } {
  const limpio = limpiarNombre(nombre);
  if (!limpio) return { ok: false, error: `Escribe el nombre del ${que}.` };
  if (limpio.length > LARGO_MAXIMO_NOMBRE) {
    return { ok: false, error: `El nombre puede tener máximo ${LARGO_MAXIMO_NOMBRE} caracteres.` };
  }
  return { ok: true, nombre: limpio };
}

/** La foto solo puede ser una de las subidas por la ruta de la carta (o ninguna). */
function validarFoto(fotoUrl: unknown): { ok: true; fotoUrl: string | null } | { ok: false; error: string } {
  if (fotoUrl === null || fotoUrl === undefined || fotoUrl === "") return { ok: true, fotoUrl: null };
  if (typeof fotoUrl !== "string" || !RUTA_FOTO.test(fotoUrl)) {
    return { ok: false, error: "La foto no es válida. Súbela otra vez." };
  }
  return { ok: true, fotoUrl };
}

function validarOrden(orden: unknown): number | null {
  const numero = Number(orden);
  return Number.isInteger(numero) && numero >= 0 && numero <= 100_000 ? numero : null;
}

function esRepetido(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Arma de nuevo las imágenes; si falla, lo guardado queda y se avisa para reintentar. */
async function rehacerConAviso(materialId: string): Promise<string | undefined> {
  try {
    await rehacerImagenesDeMaterial(prisma, materialId);
    return undefined;
  } catch (error) {
    console.error("[carta-de-colores] no se pudo armar la imagen del material", materialId, error);
    return AVISO_IMAGEN;
  }
}

async function materialDelNegocio(workspaceId: string, materialId: unknown) {
  if (typeof materialId !== "string" || !materialId) return null;
  return prisma.materialDeColores.findFirst({
    where: { id: materialId, workspaceId },
    select: { id: true, colores: { select: { id: true, codigo: true } } },
  });
}

export type ColorDeLaCarta = {
  id: string;
  codigo: string;
  nombre: string;
  fotoUrl: string | null;
  oculto: boolean;
  orden: number;
};

export type MaterialDeLaCarta = {
  id: string;
  nombre: string;
  tipo: TipoMaterialDeColor;
  orden: number;
  imagenesUrl: string[];
  imagenActualizadaEn: string | null;
  colores: ColorDeLaCarta[];
};

/** La carta completa para la pantalla. La primera vez crea los 4 materiales base, sin colores. */
export async function listarCartaDeColoresAction(): Promise<{
  materiales: MaterialDeLaCarta[];
  puedeEditar: boolean;
}> {
  const access = await requireClientWorkspaceAccess("crm");
  const { workspaceId } = access;

  const cuantos = await prisma.materialDeColores.count({ where: { workspaceId } });
  if (cuantos === 0) {
    for (const base of MATERIALES_BASE) {
      await prisma.materialDeColores.upsert({
        where: { workspaceId_nombre: { workspaceId, nombre: base.nombre } },
        create: { workspaceId, nombre: base.nombre, tipo: base.tipo, orden: base.orden },
        update: {},
      });
    }
  }

  const [materiales, puedeEditar] = await Promise.all([
    prisma.materialDeColores.findMany({
      where: { workspaceId },
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      select: {
        id: true,
        nombre: true,
        tipo: true,
        orden: true,
        imagenesUrl: true,
        imagenActualizadaEn: true,
        colores: {
          orderBy: [{ orden: "asc" }, { codigo: "asc" }],
          select: { id: true, codigo: true, nombre: true, fotoUrl: true, oculto: true, orden: true },
        },
      },
    }),
    puedeSupervisar(access),
  ]);

  // Las imágenes armadas con un diseño anterior se rehacen acá, una por una. Si una falla, se anota y la
  // pantalla carga igual con la imagen vieja (se vuelve a intentar la próxima vez que se abra).
  for (const material of materiales) {
    if (imagenesConDisenoActual(material.imagenesUrl)) continue;
    try {
      material.imagenesUrl = await rehacerImagenesDeMaterial(prisma, material.id);
      material.imagenActualizadaEn = new Date();
    } catch (error) {
      console.error("[carta-de-colores] no se pudo rehacer la imagen con el diseño nuevo", material.id, error);
    }
  }

  return {
    puedeEditar,
    materiales: materiales.map((material) => ({
      ...material,
      imagenActualizadaEn: material.imagenActualizadaEn?.toISOString() ?? null,
    })),
  };
}

export async function crearMaterialAction(input: {
  nombre: string;
  tipo: TipoMaterialDeColor;
}): Promise<ResultadoCarta<{ datos: { id: string } }>> {
  const permiso = await accesoParaEditar();
  if (!permiso.ok) return permiso;
  const { workspaceId } = permiso.access;

  const nombre = validarNombre(input?.nombre, "material");
  if (!nombre.ok) return nombre;
  if (input?.tipo !== "CUERO" && input?.tipo !== "TELA") {
    return { ok: false, error: "Elige si el material es cuero o tela." };
  }

  const ultimo = await prisma.materialDeColores.findFirst({
    where: { workspaceId },
    orderBy: { orden: "desc" },
    select: { orden: true },
  });

  try {
    const creado = await prisma.materialDeColores.create({
      data: { workspaceId, nombre: nombre.nombre, tipo: input.tipo, orden: (ultimo?.orden ?? -1) + 1 },
      select: { id: true },
    });
    return { ok: true, datos: { id: creado.id } };
  } catch (error) {
    if (esRepetido(error)) return { ok: false, error: "Ya hay un material con ese nombre." };
    throw error;
  }
}

export async function crearColorAction(input: {
  materialId: string;
  codigo: string;
  nombre: string;
  fotoUrl?: string | null;
}): Promise<ResultadoCarta<{ datos: { id: string } }>> {
  const permiso = await accesoParaEditar();
  if (!permiso.ok) return permiso;
  const { workspaceId } = permiso.access;

  const material = await materialDelNegocio(workspaceId, input?.materialId);
  if (!material) return { ok: false, error: NO_ENCONTRADO };

  const codigo = validarCodigo(input?.codigo);
  if (!codigo.ok) return codigo;
  if (codigoRepetido(material.colores, codigo.codigo)) {
    return { ok: false, error: "Ya hay un color con ese código en este material." };
  }
  const nombre = validarNombre(input?.nombre, "color");
  if (!nombre.ok) return nombre;
  const foto = validarFoto(input?.fotoUrl);
  if (!foto.ok) return foto;

  const ultimo = await prisma.colorDeCarta.findFirst({
    where: { materialId: material.id },
    orderBy: { orden: "desc" },
    select: { orden: true },
  });

  let id: string;
  try {
    const creado = await prisma.colorDeCarta.create({
      data: {
        workspaceId,
        materialId: material.id,
        codigo: codigo.codigo,
        nombre: nombre.nombre,
        fotoUrl: foto.fotoUrl,
        orden: (ultimo?.orden ?? -1) + 1,
      },
      select: { id: true },
    });
    id = creado.id;
  } catch (error) {
    if (esRepetido(error)) return { ok: false, error: "Ya hay un color con ese código en este material." };
    throw error;
  }

  const aviso = await rehacerConAviso(material.id);
  return { ok: true, datos: { id }, ...(aviso ? { aviso } : {}) };
}

export async function editarColorAction(input: {
  id: string;
  codigo: string;
  nombre: string;
  fotoUrl?: string | null;
  orden: number;
}): Promise<ResultadoCarta> {
  const permiso = await accesoParaEditar();
  if (!permiso.ok) return permiso;
  const { workspaceId } = permiso.access;

  if (typeof input?.id !== "string" || !input.id) return { ok: false, error: NO_ENCONTRADO };
  const color = await prisma.colorDeCarta.findFirst({
    where: { id: input.id, workspaceId },
    select: { id: true, materialId: true },
  });
  if (!color) return { ok: false, error: NO_ENCONTRADO };
  const material = await materialDelNegocio(workspaceId, color.materialId);
  if (!material) return { ok: false, error: NO_ENCONTRADO };

  const codigo = validarCodigo(input.codigo);
  if (!codigo.ok) return codigo;
  if (codigoRepetido(material.colores, codigo.codigo, color.id)) {
    return { ok: false, error: "Ya hay un color con ese código en este material." };
  }
  const nombre = validarNombre(input.nombre, "color");
  if (!nombre.ok) return nombre;
  const foto = validarFoto(input.fotoUrl);
  if (!foto.ok) return foto;
  const orden = validarOrden(input.orden);
  if (orden === null) return { ok: false, error: "El orden tiene que ser un número entero, 0 o más." };

  try {
    await prisma.colorDeCarta.update({
      where: { id: color.id },
      data: { codigo: codigo.codigo, nombre: nombre.nombre, fotoUrl: foto.fotoUrl, orden },
    });
  } catch (error) {
    if (esRepetido(error)) return { ok: false, error: "Ya hay un color con ese código en este material." };
    throw error;
  }

  const aviso = await rehacerConAviso(material.id);
  return aviso ? { ok: true, aviso } : { ok: true };
}

/** Oculto = no sale en la carta (p. ej. agotado), pero no se borra. */
export async function ocultarColorAction(id: string, oculto: boolean): Promise<ResultadoCarta> {
  const permiso = await accesoParaEditar();
  if (!permiso.ok) return permiso;
  const { workspaceId } = permiso.access;

  if (typeof id !== "string" || !id || typeof oculto !== "boolean") return { ok: false, error: NO_ENCONTRADO };
  const color = await prisma.colorDeCarta.findFirst({
    where: { id, workspaceId },
    select: { id: true, materialId: true },
  });
  if (!color) return { ok: false, error: NO_ENCONTRADO };

  await prisma.colorDeCarta.update({ where: { id: color.id }, data: { oculto } });

  const aviso = await rehacerConAviso(color.materialId);
  return aviso ? { ok: true, aviso } : { ok: true };
}

/** Vuelve a armar las imágenes de un material (por si una foto cambió o algo falló antes). */
export async function rehacerImagenAction(materialId: string): Promise<ResultadoCarta<{ datos: { imagenesUrl: string[] } }>> {
  const permiso = await accesoParaEditar();
  if (!permiso.ok) return permiso;

  const material = await materialDelNegocio(permiso.access.workspaceId, materialId);
  if (!material) return { ok: false, error: NO_ENCONTRADO };

  try {
    const imagenesUrl = await rehacerImagenesDeMaterial(prisma, material.id);
    return { ok: true, datos: { imagenesUrl } };
  } catch (error) {
    console.error("[carta-de-colores] no se pudo armar la imagen del material", material.id, error);
    return { ok: false, error: "No se pudo armar la imagen de la carta. Intenta de nuevo en un momento." };
  }
}

/** Lo que el chat necesita para mandar la carta: solo los materiales que ya tienen imágenes, en orden. */
export async function listarCartaParaChatAction(): Promise<{ id: string; nombre: string; imagenesUrl: string[] }[]> {
  const { workspaceId } = await requireClientWorkspaceAccess("chats");
  return prisma.materialDeColores.findMany({
    where: { workspaceId, imagenesUrl: { isEmpty: false } },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, imagenesUrl: true },
  });
}
