"use server";

import {
  MATERIALES_BASE,
  codigoRepetido,
  validarCodigo,
  type TipoMaterialDeColor,
} from "@/lib/carta-de-colores";
import { requireClientWorkspaceAccess, type ClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esFotoDeCarta, rehacerImagenesDeMaterial } from "@/lib/imagen-de-carta-de-colores";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

/*
  Carta de colores digital (parte 2 de «Carta de colores digital dentro del CRM»).

  Ver la carta: cualquiera con acceso al CRM. Mandarla en el chat: cualquiera con acceso a Chats (solo lee
  las imágenes ya armadas). Cambiarla: dueño, administradores y supervisoras (`puedeSupervisar`), revisado
  aquí en el servidor en cada acción. Cada cambio de colores vuelve a armar las imágenes del material.
*/

type Fallo = { ok: false; error: string };
type Hecho<T = object> = { ok: true; aviso?: string } & T;

const LARGO_MAXIMO_NOMBRE = 60;
const ORDEN_MAXIMO = 100_000;
const SIN_PERMISO: Fallo = { ok: false, error: "Solo el dueño, los administradores y las supervisoras pueden cambiar la carta." };
const AVISO_IMAGEN = "Se guardó, pero no se pudo armar la imagen de la carta. Toca «Rehacer imagen».";

export type ColorDeCartaParaPantalla = {
  id: string;
  codigo: string;
  nombre: string;
  fotoUrl: string | null;
  oculto: boolean;
  orden: number;
};

export type MaterialDeCartaParaPantalla = {
  id: string;
  nombre: string;
  tipo: TipoMaterialDeColor;
  orden: number;
  imagenesUrl: string[];
  imagenActualizadaEn: string | null;
  colores: ColorDeCartaParaPantalla[];
};

async function accesoDeEditor(): Promise<ClientWorkspaceAccess | null> {
  const access = await requireClientWorkspaceAccess();
  return (await puedeSupervisar(access)) ? access : null;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim().replace(/\s+/g, " ") : "";
}

function validarNombre(valor: unknown, que: string): { ok: true; nombre: string } | Fallo {
  const nombre = texto(valor);
  if (!nombre) return { ok: false, error: `Escribe el nombre del ${que}.` };
  if (nombre.length > LARGO_MAXIMO_NOMBRE) {
    return { ok: false, error: `El nombre puede tener máximo ${LARGO_MAXIMO_NOMBRE} caracteres.` };
  }
  return { ok: true, nombre };
}

function validarOrden(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= ORDEN_MAXIMO ? valor : null;
}

/** null = sin foto. Solo se aceptan fotos subidas por la ruta de la carta (nada de rutas o sitios ajenos). */
function validarFoto(valor: unknown): { ok: true; fotoUrl: string | null } | Fallo {
  if (valor === null || valor === undefined || valor === "") return { ok: true, fotoUrl: null };
  if (typeof valor === "string" && esFotoDeCarta(valor.trim())) return { ok: true, fotoUrl: valor.trim() };
  return { ok: false, error: "La foto no es válida. Súbela de nuevo." };
}

function esCodigoRepetidoEnBase(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** Arma de nuevo las imágenes. Si falla, el cambio ya quedó guardado: se avisa en vez de dar error. */
async function rehacerConAviso(materialId: string): Promise<string | undefined> {
  try {
    await rehacerImagenesDeMaterial(prisma, materialId);
    return undefined;
  } catch (error) {
    console.error("[carta-de-colores] no se pudo armar la imagen", materialId, error);
    return AVISO_IMAGEN;
  }
}

/** La carta completa del negocio. La primera vez crea los 4 materiales base, sin colores. */
export async function listarCartaDeColoresAction(): Promise<
  Hecho<{ materiales: MaterialDeCartaParaPantalla[]; puedeEditar: boolean }> | Fallo
> {
  const access = await requireClientWorkspaceAccess("crm");
  const workspaceId = access.workspaceId;

  if ((await prisma.materialDeColores.count({ where: { workspaceId } })) === 0) {
    // upsert: si dos personas abren la carta a la vez, ninguna choca con la otra.
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

  return {
    ok: true,
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
}): Promise<Hecho<{ id: string }> | Fallo> {
  const access = await accesoDeEditor();
  if (!access) return SIN_PERMISO;

  const nombre = validarNombre(input?.nombre, "material");
  if (!nombre.ok) return nombre;
  if (input?.tipo !== "CUERO" && input?.tipo !== "TELA") return { ok: false, error: "Elige si es cuero o tela." };

  const ultimo = await prisma.materialDeColores.findFirst({
    where: { workspaceId: access.workspaceId },
    orderBy: { orden: "desc" },
    select: { orden: true },
  });
  try {
    const creado = await prisma.materialDeColores.create({
      data: {
        workspaceId: access.workspaceId,
        nombre: nombre.nombre,
        tipo: input.tipo,
        orden: (ultimo?.orden ?? -1) + 1,
      },
      select: { id: true },
    });
    return { ok: true, id: creado.id };
  } catch (error) {
    if (esCodigoRepetidoEnBase(error)) return { ok: false, error: "Ya hay un material con ese nombre." };
    throw error;
  }
}

export async function crearColorAction(input: {
  materialId: string;
  codigo: string;
  nombre: string;
  fotoUrl?: string | null;
  orden?: number;
}): Promise<Hecho<{ id: string }> | Fallo> {
  const access = await accesoDeEditor();
  if (!access) return SIN_PERMISO;

  const material = await prisma.materialDeColores.findFirst({
    where: { id: texto(input?.materialId), workspaceId: access.workspaceId },
    select: { id: true, colores: { select: { id: true, codigo: true, orden: true } } },
  });
  if (!material) return { ok: false, error: "No se encontró el material." };

  const codigo = validarCodigo(input?.codigo);
  if (!codigo.ok) return codigo;
  if (codigoRepetido(material.colores, codigo.codigo)) {
    return { ok: false, error: "Ya hay un color con ese código en este material." };
  }
  const nombre = validarNombre(input?.nombre, "color");
  if (!nombre.ok) return nombre;
  const foto = validarFoto(input?.fotoUrl);
  if (!foto.ok) return foto;
  let orden = material.colores.reduce((mayor, color) => Math.max(mayor, color.orden), -1) + 1;
  if (input?.orden !== undefined) {
    const pedido = validarOrden(input.orden);
    if (pedido === null) return { ok: false, error: "El orden tiene que ser un número entero desde 0." };
    orden = pedido;
  }

  let id: string;
  try {
    const creado = await prisma.colorDeCarta.create({
      data: {
        workspaceId: access.workspaceId,
        materialId: material.id,
        codigo: codigo.codigo,
        nombre: nombre.nombre,
        fotoUrl: foto.fotoUrl,
        orden,
      },
      select: { id: true },
    });
    id = creado.id;
  } catch (error) {
    if (esCodigoRepetidoEnBase(error)) return { ok: false, error: "Ya hay un color con ese código en este material." };
    throw error;
  }

  return { ok: true, id, aviso: await rehacerConAviso(material.id) };
}

export async function editarColorAction(input: {
  id: string;
  codigo?: string;
  nombre?: string;
  fotoUrl?: string | null;
  orden?: number;
}): Promise<Hecho | Fallo> {
  const access = await accesoDeEditor();
  if (!access) return SIN_PERMISO;

  const color = await prisma.colorDeCarta.findFirst({
    where: { id: texto(input?.id), workspaceId: access.workspaceId },
    select: { id: true, materialId: true },
  });
  if (!color) return { ok: false, error: "No se encontró el color." };

  const cambios: { codigo?: string; nombre?: string; fotoUrl?: string | null; orden?: number } = {};
  if (input.codigo !== undefined) {
    const codigo = validarCodigo(input.codigo);
    if (!codigo.ok) return codigo;
    const hermanos = await prisma.colorDeCarta.findMany({
      where: { materialId: color.materialId },
      select: { id: true, codigo: true },
    });
    if (codigoRepetido(hermanos, codigo.codigo, color.id)) {
      return { ok: false, error: "Ya hay un color con ese código en este material." };
    }
    cambios.codigo = codigo.codigo;
  }
  if (input.nombre !== undefined) {
    const nombre = validarNombre(input.nombre, "color");
    if (!nombre.ok) return nombre;
    cambios.nombre = nombre.nombre;
  }
  if (input.fotoUrl !== undefined) {
    const foto = validarFoto(input.fotoUrl);
    if (!foto.ok) return foto;
    cambios.fotoUrl = foto.fotoUrl;
  }
  if (input.orden !== undefined) {
    const orden = validarOrden(input.orden);
    if (orden === null) return { ok: false, error: "El orden tiene que ser un número entero desde 0." };
    cambios.orden = orden;
  }
  if (Object.keys(cambios).length === 0) return { ok: true };

  try {
    await prisma.colorDeCarta.update({ where: { id: color.id }, data: cambios });
  } catch (error) {
    if (esCodigoRepetidoEnBase(error)) return { ok: false, error: "Ya hay un color con ese código en este material." };
    throw error;
  }

  return { ok: true, aviso: await rehacerConAviso(color.materialId) };
}

/** Oculto = no sale en la carta que se manda (p. ej. agotado), pero no se borra. */
export async function ocultarColorAction(id: string, oculto: boolean): Promise<Hecho | Fallo> {
  const access = await accesoDeEditor();
  if (!access) return SIN_PERMISO;
  if (typeof oculto !== "boolean") return { ok: false, error: "Falta decir si se oculta o se muestra." };

  const color = await prisma.colorDeCarta.findFirst({
    where: { id: texto(id), workspaceId: access.workspaceId },
    select: { id: true, materialId: true },
  });
  if (!color) return { ok: false, error: "No se encontró el color." };

  await prisma.colorDeCarta.update({ where: { id: color.id }, data: { oculto } });
  return { ok: true, aviso: await rehacerConAviso(color.materialId) };
}

/** Vuelve a armar las imágenes de un material a mano (p. ej. si antes falló). */
export async function rehacerImagenAction(materialId: string): Promise<Hecho<{ imagenesUrl: string[] }> | Fallo> {
  const access = await accesoDeEditor();
  if (!access) return SIN_PERMISO;

  const material = await prisma.materialDeColores.findFirst({
    where: { id: texto(materialId), workspaceId: access.workspaceId },
    select: { id: true },
  });
  if (!material) return { ok: false, error: "No se encontró el material." };

  try {
    return { ok: true, imagenesUrl: await rehacerImagenesDeMaterial(prisma, material.id) };
  } catch (error) {
    console.error("[carta-de-colores] no se pudo armar la imagen", material.id, error);
    return { ok: false, error: "No se pudo armar la imagen de la carta. Inténtalo de nuevo." };
  }
}

/** Lo que el botón del chat puede mandar: solo los materiales que ya tienen imágenes, en orden. */
export async function listarCartaParaChatAction(): Promise<
  Hecho<{ materiales: { id: string; nombre: string; imagenesUrl: string[] }[] }> | Fallo
> {
  const access = await requireClientWorkspaceAccess("chats");
  const materiales = await prisma.materialDeColores.findMany({
    where: { workspaceId: access.workspaceId, NOT: { imagenesUrl: { isEmpty: true } } },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, imagenesUrl: true },
  });
  return { ok: true, materiales };
}
