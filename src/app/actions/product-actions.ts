"use server";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { slugifyProductSegment } from "@/lib/product-slugs";
import { getSiteUrl } from "@/lib/site";
import { calculateMarginPctFromPrice, calculateRetailPrice, calculateWholesalePrice } from "@/lib/pricing";

const baseProductSchema = z.object({
  code: z.string().trim().max(60, "Codigo demasiado largo").optional(),
  name: z.string().trim().min(2, "Nombre invalido").max(120, "Nombre demasiado largo"),
  description: z.string().trim().max(4000, "Descripcion demasiado larga").optional(),
  baseCost: z.coerce.number().positive("El costo debe ser mayor que 0"),
  retailMarginPct: z.coerce.number().min(0, "El margen detal no puede ser negativo").max(1000),
  retailPrice: z.coerce.number().positive("El precio final debe ser mayor que 0"),
  wholesaleMarginPct: z.coerce.number().min(0, "El margen mayorista no puede ser negativo").max(1000),
  wholesalePrice: z.coerce.number().min(0, "El precio mayorista no puede ser negativo"),
  minWholesaleQty: z.coerce.number().int().min(1, "Cantidad mayorista invalida").max(100000),
  categoryId: z.string().trim().optional(),
  supplierId: z.string().trim().optional(),
});

const createProductSchema = baseProductSchema;

const updateProductSchema = baseProductSchema.extend({
  productId: z.string().trim().min(1, "Producto invalido"),
});

const deleteProductSchema = z.object({
  productId: z.string().trim().min(1, "Producto invalido"),
});

async function requireAdminSession(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }
}

function parseOptionalId(value?: string): string | null {
  const raw = value?.trim();
  return raw ? raw : null;
}

function parseImageList(raw: string): string[] {
  return raw
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolvePublicProductImageUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("/")) {
    return getSiteUrl(normalized);
  }

  return normalized;
}

async function generateUniqueProductSlug(
  name: string,
  code?: string | null,
  excludeProductId?: string,
): Promise<string> {
  const baseSlug = [slugifyProductSegment(name), code ? slugifyProductSegment(code) : ""].filter(Boolean).join("-");
  const normalizedBaseSlug = baseSlug || "producto";

  const existing = await prisma.product.findMany({
    where: {
      slug: {
        startsWith: normalizedBaseSlug,
      },
      ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
    },
    select: { slug: true },
  });

  const usedSlugs = new Set(existing.map((item) => item.slug));
  if (!usedSlugs.has(normalizedBaseSlug)) {
    return normalizedBaseSlug;
  }

  let suffix = 2;
  let candidate = `${normalizedBaseSlug}-${suffix}`;
  while (usedSlugs.has(candidate)) {
    suffix += 1;
    candidate = `${normalizedBaseSlug}-${suffix}`;
  }

  return candidate;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function buildErrorRedirect(pathname: string, message: string): never {
  redirect(`${pathname}?error=${encodeURIComponent(message)}`);
}

function resolveProductMutationError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return "El codigo del producto ya existe";
    }
    if (error.code === "P2003") {
      return "Categoria o proveedor invalido";
    }
    if (error.code === "P2025") {
      return "El producto ya no existe";
    }
  }

  return "No se pudo guardar el producto";
}

function resolveProductDeleteError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      return "No puedes eliminar este producto porque ya fue usado en cotizaciones";
    }
    if (error.code === "P2025") {
      return "El producto ya no existe";
    }
  }

  return "No se pudo eliminar el producto";
}

function assertValidImageList(images: string[]): void {
  if (images.length === 0) {
    throw new Error("Debes agregar al menos una imagen");
  }

  for (const image of images) {
    const isHttpUrl = z.string().url().safeParse(image).success;
    const isLocalUploadPath =
      image.startsWith("/") && !image.includes("..") && image.length <= 500;

    if (!isHttpUrl && !isLocalUploadPath) {
      throw new Error(`URL o ruta de imagen invalida: ${image}`);
    }
  }
}

async function saveUploadedImages(files: File[]): Promise<string[]> {
  if (files.length === 0) {
    throw new Error("Debes subir al menos una imagen");
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "products");
  await mkdir(uploadDir, { recursive: true });

  const savedUrls: string[] = [];

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Solo se permiten archivos de imagen");
    }

    if (file.size <= 0) {
      throw new Error("Archivo de imagen vacio");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Cada imagen debe pesar maximo 5MB");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name)?.toLowerCase() || ".jpg";
    const safeExt = ext.length <= 8 ? ext : ".jpg";
    const fileName = `${Date.now()}-${randomUUID()}${safeExt}`;
    const filePath = path.join(uploadDir, fileName);

    await writeFile(filePath, buffer);
    savedUrls.push(getSiteUrl(`/uploads/products/${fileName}`));
  }

  return savedUrls;
}

export async function adminCreateProductAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = createProductSchema.safeParse({
    code: formData.get("code") || undefined,
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    baseCost: formData.get("baseCost"),
    retailMarginPct: formData.get("retailMarginPct"),
    retailPrice: formData.get("retailPrice"),
    wholesaleMarginPct: formData.get("wholesaleMarginPct"),
    wholesalePrice: formData.get("wholesalePrice"),
    minWholesaleQty: formData.get("minWholesaleQty"),
    categoryId: formData.get("categoryId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
  });

  if (!parsed.success) {
    redirect("/admin/productos?error=Datos+invalidos");
  }

  const files = formData
    .getAll("images")
    .filter((item): item is File => item instanceof File && item.size > 0);

  let imageList: string[];
  try {
    imageList = await saveUploadedImages(files);
  } catch {
    redirect("/admin/productos?error=Las+imagenes+subidas+son+invalidas");
  }

  const thumbnailUrl = imageList[0];
  const categoryId = parseOptionalId(parsed.data.categoryId);
  const supplierId = parseOptionalId(parsed.data.supplierId);
  const slug = await generateUniqueProductSlug(parsed.data.name, parsed.data.code);
  const retailPrice = parsed.data.retailPrice;
  const effectiveRetailMarginPct = calculateMarginPctFromPrice(parsed.data.baseCost, retailPrice);
  const wholesalePrice = parsed.data.wholesalePrice;
  const effectiveWholesaleMarginPct = calculateMarginPctFromPrice(parsed.data.baseCost, wholesalePrice);

  try {
    await prisma.product.create({
      data: {
        name: parsed.data.name,
        code: parsed.data.code || null,
        slug,
        description: parsed.data.description || null,
        baseCost: parsed.data.baseCost,
        retailMarginPct: effectiveRetailMarginPct,
        wholesaleMarginPct: effectiveWholesaleMarginPct,
        minWholesaleQty: parsed.data.minWholesaleQty,
        price: retailPrice,
        wholesalePrice,
        categoryId,
        thumbnailUrl,
        images: {
          create: imageList.map((url, index) => ({
            url,
            order: index,
          })),
        },
        suppliers: supplierId
          ? {
              create: {
                supplierId,
                supplierCost: parsed.data.baseCost,
                isPreferred: true,
              },
            }
          : undefined,
      },
    });
  } catch (error) {
    buildErrorRedirect("/admin/productos", resolveProductMutationError(error));
  }

  revalidatePath("/");
  revalidatePath("/admin/productos");
  redirect("/admin/productos?ok=Producto+creado");
}

export async function adminUpdateProductAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const rawProductId = formData.get("productId");
  const productId = typeof rawProductId === "string" ? rawProductId.trim() : "";
  const redirectBase = productId ? `/admin/productos/${productId}` : "/admin/productos";

  const parsed = updateProductSchema.safeParse({
    productId: rawProductId,
    code: formData.get("code") || undefined,
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    baseCost: formData.get("baseCost"),
    retailMarginPct: formData.get("retailMarginPct"),
    retailPrice: formData.get("retailPrice"),
    wholesaleMarginPct: formData.get("wholesaleMarginPct"),
    wholesalePrice: formData.get("wholesalePrice"),
    minWholesaleQty: formData.get("minWholesaleQty"),
    categoryId: formData.get("categoryId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
  });

  if (!parsed.success) {
    redirect(`${redirectBase}?error=Datos+invalidos`);
  }

  const existingImagesRaw = formData.get("existingImages");
  const existingImages =
    typeof existingImagesRaw === "string" && existingImagesRaw.trim().length > 0
      ? parseImageList(existingImagesRaw)
      : [];

  try {
    if (existingImages.length > 0) {
      assertValidImageList(existingImages);
    }
  } catch {
    redirect(`${redirectBase}?error=Las+imagenes+existentes+son+invalidas`);
  }

  const uploadedFiles = formData
    .getAll("images")
    .filter((item): item is File => item instanceof File && item.size > 0);

  let uploadedImages: string[] = [];
  if (uploadedFiles.length > 0) {
    try {
      uploadedImages = await saveUploadedImages(uploadedFiles);
    } catch {
      redirect(`${redirectBase}?error=Las+imagenes+subidas+son+invalidas`);
    }
  }

  const imageList = [...existingImages, ...uploadedImages];
  if (imageList.length === 0) {
    redirect(`${redirectBase}?error=Debes+mantener+al+menos+una+imagen`);
  }

  const thumbnailUrl = imageList[0];
  const categoryId = parseOptionalId(parsed.data.categoryId);
  const supplierId = parseOptionalId(parsed.data.supplierId);
  const slug = await generateUniqueProductSlug(parsed.data.name, parsed.data.code, parsed.data.productId);
  const retailPrice = parsed.data.retailPrice;
  const effectiveRetailMarginPct = calculateMarginPctFromPrice(parsed.data.baseCost, retailPrice);
  const wholesalePrice = parsed.data.wholesalePrice;
  const effectiveWholesaleMarginPct = calculateMarginPctFromPrice(parsed.data.baseCost, wholesalePrice);

  try {
    await prisma.$transaction([
      prisma.product.update({
        where: { id: parsed.data.productId },
        data: {
          name: parsed.data.name,
          code: parsed.data.code || null,
          slug,
          description: parsed.data.description || null,
          baseCost: parsed.data.baseCost,
          retailMarginPct: effectiveRetailMarginPct,
          wholesaleMarginPct: effectiveWholesaleMarginPct,
          minWholesaleQty: parsed.data.minWholesaleQty,
          price: retailPrice,
          wholesalePrice,
          categoryId,
          thumbnailUrl,
        },
      }),
      prisma.productImage.deleteMany({
        where: { productId: parsed.data.productId },
      }),
      prisma.productImage.createMany({
        data: imageList.map((url, index) => ({
          productId: parsed.data.productId,
          url,
          order: index,
        })),
      }),
      prisma.productSupplier.deleteMany({
        where: { productId: parsed.data.productId },
      }),
      ...(supplierId
        ? [
            prisma.productSupplier.create({
              data: {
                productId: parsed.data.productId,
                supplierId,
                supplierCost: parsed.data.baseCost,
                isPreferred: true,
              },
            }),
          ]
        : []),
    ]);
  } catch (error) {
    buildErrorRedirect(redirectBase, resolveProductMutationError(error));
  }

  revalidatePath("/");
  revalidatePath("/admin/productos");
  revalidatePath(redirectBase);
  redirect(`${redirectBase}?ok=Producto+actualizado`);
}

export async function adminDeleteProductAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = deleteProductSchema.safeParse({
    productId: formData.get("productId"),
  });

  if (!parsed.success) {
    redirect("/admin/productos?error=Producto+invalido");
  }

  try {
    await prisma.product.delete({
      where: { id: parsed.data.productId },
    });
  } catch (error) {
    buildErrorRedirect("/admin/productos", resolveProductDeleteError(error));
  }

  revalidatePath("/");
  revalidatePath("/admin/productos");
  redirect("/admin/productos?ok=Producto+eliminado");
}

export async function adminImportProductsCsvAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    redirect("/admin/productos?error=Selecciona+un+archivo+CSV+valido");
  }

  if (file.size > 5 * 1024 * 1024) {
    redirect("/admin/productos?error=El+CSV+supera+el+limite+de+5MB");
  }

  const text = await file.text();
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    redirect("/admin/productos?error=El+CSV+no+tiene+registros");
  }

  const headers = splitCsvLine(lines[0]).map((header) =>
    header.toLowerCase().replace(/\s+/g, ""),
  );

  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  const nameIndex = indexByHeader.get("nombre") ?? indexByHeader.get("name");
  if (nameIndex === undefined) {
    redirect("/admin/productos?error=El+CSV+debe+incluir+la+columna+Nombre");
  }

  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true } });
  const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category.id]));
  const supplierByName = new Map(suppliers.map((supplier) => [supplier.name.toLowerCase(), supplier.id]));

  const getCell = (row: string[], ...keys: string[]) => {
    for (const key of keys) {
      const index = indexByHeader.get(key);
      if (index !== undefined) {
        return row[index]?.trim() ?? "";
      }
    }
    return "";
  };

  const parseNumber = (value: string, fallback: number) => {
    const normalized = value.replace(",", ".").trim();
    if (!normalized) return fallback;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  let created = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const row = splitCsvLine(lines[i]);
    const name = (row[nameIndex] ?? "").trim();
    if (!name) {
      skipped += 1;
      continue;
    }

    const code = getCell(row, "codigo", "code") || null;
    const description = getCell(row, "descripcion", "description") || null;
    const baseCost = Math.max(0.01, parseNumber(getCell(row, "costo", "basecost"), 1));
    const retailMarginPct = Math.max(
      0,
      parseNumber(getCell(row, "%detal", "margendetal", "retailmarginpct"), 35),
    );
    const wholesaleMarginPct = Math.max(
      0,
      parseNumber(getCell(row, "%mayor", "margenmayor", "wholesalemarginpct"), 20),
    );
    const minWholesaleQty = Math.max(1, Math.floor(parseNumber(getCell(row, "minmayor", "minwholesaleqty"), 6)));
    const thumbnailUrl = resolvePublicProductImageUrl(getCell(row, "imagen", "thumbnailurl") || "/file.svg");
    const categoryName = getCell(row, "categoria", "category").toLowerCase();
    const supplierName = getCell(row, "proveedor", "supplier").toLowerCase();

    const categoryId = categoryName ? categoryByName.get(categoryName) ?? null : null;
    const supplierId = supplierName ? supplierByName.get(supplierName) ?? null : null;
    const slug = await generateUniqueProductSlug(name, code);
    const retailPrice = calculateRetailPrice(baseCost, retailMarginPct);
    const wholesalePrice = calculateWholesalePrice(baseCost, wholesaleMarginPct);

    try {
      await prisma.product.create({
        data: {
          code,
          slug,
          name,
          description,
          baseCost,
          retailMarginPct,
          wholesaleMarginPct,
          minWholesaleQty,
          price: retailPrice,
          wholesalePrice,
          categoryId,
          thumbnailUrl,
          images: {
            create: [{ url: thumbnailUrl, order: 0 }],
          },
          suppliers: supplierId
            ? {
                create: {
                  supplierId,
                  supplierCost: baseCost,
                  isPreferred: true,
                },
              }
            : undefined,
        },
      });
      created += 1;
    } catch {
      skipped += 1;
    }
  }

  revalidatePath("/");
  revalidatePath("/admin/productos");

  if (created === 0) {
    redirect("/admin/productos?error=No+se+pudo+importar+ningun+producto");
  }

  redirect(
    `/admin/productos?ok=${encodeURIComponent(
      `Importacion completada: ${created} creados${skipped ? `, ${skipped} omitidos` : ""}`,
    )}`,
  );
}
