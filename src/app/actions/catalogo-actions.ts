"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";
import { sincronizarConGestion, type ResumenDeSincronizacion } from "@/lib/sincronizacion-gestion";

/**
 * Las dos acciones de la pantalla de Productos (Alex, 03-10-2026): traer el catálogo de Gestión y
 * guardar lo que es del CRM, la descripción de venta para el agente. Los productos ya no se crean
 * ni se editan aquí: nombre, código, precios, categoría y fotos vienen de Gestión.
 */

async function adminConProductos() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return null;
  }
  const puede = await hasAdminModuleAccess(session.user.id, session.user.role, "products");
  return puede ? session.user.id : null;
}

export async function sincronizarCatalogoAction(input: {
  workspaceId: string;
}): Promise<{ ok: true; resumen: ResumenDeSincronizacion } | { error: string }> {
  if (!(await adminConProductos())) {
    return { error: "No autorizado" };
  }
  const workspaceId = typeof input?.workspaceId === "string" ? input.workspaceId.trim() : "";
  if (!workspaceId) {
    return { error: "Elige el negocio a sincronizar" };
  }
  const resumen = await sincronizarConGestion(workspaceId);
  revalidatePath("/admin/productos");
  if (resumen.error) {
    return { error: resumen.error };
  }
  return { ok: true, resumen };
}

export async function guardarDescripcionDeVentaAction(input: {
  productId: string;
  descripcion: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!(await adminConProductos())) {
    return { error: "No autorizado" };
  }
  const productId = typeof input?.productId === "string" ? input.productId.trim() : "";
  const descripcion = typeof input?.descripcion === "string" ? input.descripcion.trim() : "";
  if (!productId) {
    return { error: "Datos inválidos" };
  }
  if (descripcion.length > 4000) {
    return { error: "La descripción es muy larga (máximo 4.000 caracteres)." };
  }
  const actualizado = await prisma.product.updateMany({
    where: { id: productId },
    data: { description: descripcion || null },
  });
  if (actualizado.count === 0) {
    return { error: "Ese producto ya no existe" };
  }
  revalidatePath("/admin/productos");
  return { ok: true };
}
