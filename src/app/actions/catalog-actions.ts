"use server";

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const createCategorySchema = z.object({
  name: z.string().trim().min(2, "Nombre invalido").max(80, "Nombre demasiado largo"),
});

const updateCategorySchema = z.object({
  categoryId: z.string().trim().min(1, "Categoria invalida"),
  name: z.string().trim().min(2, "Nombre invalido").max(80, "Nombre demasiado largo"),
});

const deleteCategorySchema = z.object({
  categoryId: z.string().trim().min(1, "Categoria invalida"),
});

const createSupplierSchema = z.object({
  name: z.string().trim().min(2, "Nombre invalido").max(120, "Nombre demasiado largo"),
  email: z
    .string()
    .trim()
    .email("Correo invalido")
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().max(40, "Telefono demasiado largo").optional().or(z.literal("")),
});

const updateSupplierSchema = createSupplierSchema.extend({
  supplierId: z.string().trim().min(1, "Proveedor invalido"),
});

const deleteSupplierSchema = z.object({
  supplierId: z.string().trim().min(1, "Proveedor invalido"),
});

function slugifyCategory(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

async function requireAdminSession(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }
}

function getCategoryReturnTo(formData: FormData): string {
  const raw = formData.get("returnTo");
  if (typeof raw !== "string") {
    return "/admin/configuracion";
  }

  const value = raw.trim();
  return value === "/admin/categorias" ? value : "/admin/configuracion";
}

async function saveCategoryLogo(file: File | null): Promise<string | null> {
  if (!file || file.size <= 0) {
    return null;
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Logo invalido");
  }

  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Logo invalido");
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "categories");
  await mkdir(uploadDir, { recursive: true });

  const ext = path.extname(file.name)?.toLowerCase() || ".jpg";
  const safeExt = ext.length <= 8 ? ext : ".jpg";
  const fileName = `${Date.now()}-${randomUUID()}${safeExt}`;
  const filePath = path.join(uploadDir, fileName);

  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  return `/uploads/categories/${fileName}`;
}

async function deleteCategoryLogoFile(logoUrl: string | null | undefined): Promise<void> {
  if (!logoUrl || !logoUrl.startsWith("/uploads/categories/")) {
    return;
  }

  const normalizedPath = path.normalize(logoUrl).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(process.cwd(), "public", normalizedPath);

  try {
    await unlink(filePath);
  } catch {
    // Ignore missing files; the DB cleanup is the primary concern.
  }
}

export async function adminCreateCategoryAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const returnTo = getCategoryReturnTo(formData);

  const parsed = createCategorySchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    redirect(`${returnTo}?error=Categoria+invalida`);
  }

  const slugBase = slugifyCategory(parsed.data.name);
  if (!slugBase) {
    redirect(`${returnTo}?error=Categoria+invalida`);
  }

  const existingBySlug = await prisma.category.count({
    where: {
      slug: {
        startsWith: slugBase,
      },
    },
  });
  const slug = existingBySlug > 0 ? `${slugBase}-${existingBySlug + 1}` : slugBase;
  const rawLogo = formData.get("logo");
  const logoFile = rawLogo instanceof File ? rawLogo : null;

  let logoUrl: string | null = null;
  try {
    logoUrl = await saveCategoryLogo(logoFile);
  } catch {
    redirect(`${returnTo}?error=Logo+de+categoria+invalido`);
  }

  try {
    await prisma.category.create({
      data: {
        name: parsed.data.name,
        slug,
        logoUrl,
      },
    });
  } catch {
    await deleteCategoryLogoFile(logoUrl);
    redirect(`${returnTo}?error=No+se+pudo+crear+la+categoria`);
  }

  revalidatePath(returnTo);
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/new");
  redirect(`${returnTo}?ok=Categoria+creada`);
}

export async function adminUpdateCategoryAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const returnTo = getCategoryReturnTo(formData);

  const parsed = updateCategorySchema.safeParse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    redirect(`${returnTo}?error=Categoria+invalida`);
  }

  const slugBase = slugifyCategory(parsed.data.name);
  if (!slugBase) {
    redirect(`${returnTo}?error=Categoria+invalida`);
  }

  const rawLogo = formData.get("logo");
  const logoFile = rawLogo instanceof File ? rawLogo : null;
  const existingCategory = await prisma.category.findUnique({
    where: { id: parsed.data.categoryId },
    select: { logoUrl: true },
  });

  if (!existingCategory) {
    redirect(`${returnTo}?error=Categoria+invalida`);
  }

  let logoUrl: string | null = null;
  try {
    logoUrl = await saveCategoryLogo(logoFile);
  } catch {
    redirect(`${returnTo}?error=Logo+de+categoria+invalido`);
  }

  const siblingSlugs = await prisma.category.findMany({
    where: {
      id: { not: parsed.data.categoryId },
      slug: { startsWith: slugBase },
    },
    select: { slug: true },
  });

  const used = new Set(siblingSlugs.map((item) => item.slug));
  let slug = slugBase;
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${slugBase}-${suffix}`;
    suffix += 1;
  }

  try {
    await prisma.category.update({
      where: { id: parsed.data.categoryId },
      data: {
        name: parsed.data.name,
        slug,
        ...(logoUrl ? { logoUrl } : {}),
      },
    });
  } catch {
    await deleteCategoryLogoFile(logoUrl);
    redirect(`${returnTo}?error=No+se+pudo+actualizar+la+categoria`);
  }

  if (logoUrl && existingCategory.logoUrl && existingCategory.logoUrl !== logoUrl) {
    await deleteCategoryLogoFile(existingCategory.logoUrl);
  }

  revalidatePath("/");
  revalidatePath(returnTo);
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/new");
  redirect(`${returnTo}?ok=Categoria+actualizada`);
}

export async function adminDeleteCategoryAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const returnTo = getCategoryReturnTo(formData);

  const parsed = deleteCategorySchema.safeParse({
    categoryId: formData.get("categoryId"),
  });

  if (!parsed.success) {
    redirect(`${returnTo}?error=Categoria+invalida`);
  }

  const existingCategory = await prisma.category.findUnique({
    where: { id: parsed.data.categoryId },
    select: { logoUrl: true },
  });

  if (!existingCategory) {
    redirect(`${returnTo}?error=Categoria+invalida`);
  }

  try {
    await prisma.category.delete({
      where: { id: parsed.data.categoryId },
    });
  } catch {
    redirect(`${returnTo}?error=No+se+pudo+eliminar+la+categoria`);
  }

  await deleteCategoryLogoFile(existingCategory.logoUrl);

  revalidatePath("/");
  revalidatePath(returnTo);
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/new");
  redirect(`${returnTo}?ok=Categoria+eliminada`);
}

export async function adminCreateSupplierAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = createSupplierSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
  });

  if (!parsed.success) {
    redirect("/admin/proveedores?error=Proveedor+invalido");
  }

  const existingSupplier = await prisma.supplier.findFirst({
    where: {
      name: {
        equals: parsed.data.name,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (existingSupplier) {
    redirect("/admin/proveedores?error=Ya+existe+un+proveedor+con+ese+nombre");
  }

  try {
    await prisma.supplier.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
      },
    });
  } catch {
    redirect("/admin/proveedores?error=No+se+pudo+crear+el+proveedor");
  }

  revalidatePath("/admin/proveedores");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/new");
  redirect("/admin/proveedores?ok=Proveedor+creado");
}

export async function adminUpdateSupplierAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = updateSupplierSchema.safeParse({
    supplierId: formData.get("supplierId"),
    name: formData.get("name"),
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
  });

  if (!parsed.success) {
    redirect("/admin/proveedores?error=Proveedor+invalido");
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id: parsed.data.supplierId },
    select: { id: true },
  });

  if (!supplier) {
    redirect("/admin/proveedores?error=Proveedor+invalido");
  }

  const existingSupplier = await prisma.supplier.findFirst({
    where: {
      NOT: { id: parsed.data.supplierId },
      name: {
        equals: parsed.data.name,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (existingSupplier) {
    redirect("/admin/proveedores?error=Ya+existe+un+proveedor+con+ese+nombre");
  }

  try {
    await prisma.supplier.update({
      where: { id: parsed.data.supplierId },
      data: {
        name: parsed.data.name,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
      },
    });
  } catch {
    redirect("/admin/proveedores?error=No+se+pudo+actualizar+el+proveedor");
  }

  revalidatePath("/admin/proveedores");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/new");
  redirect("/admin/proveedores?ok=Proveedor+actualizado");
}

export async function adminDeleteSupplierAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = deleteSupplierSchema.safeParse({
    supplierId: formData.get("supplierId"),
  });

  if (!parsed.success) {
    redirect("/admin/proveedores?error=Proveedor+invalido");
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id: parsed.data.supplierId },
    select: { id: true },
  });

  if (!supplier) {
    redirect("/admin/proveedores?error=Proveedor+invalido");
  }

  try {
    await prisma.supplier.delete({
      where: { id: parsed.data.supplierId },
    });
  } catch {
    redirect("/admin/proveedores?error=No+se+pudo+eliminar+el+proveedor");
  }

  revalidatePath("/admin/proveedores");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/new");
  redirect("/admin/proveedores?ok=Proveedor+eliminado");
}
