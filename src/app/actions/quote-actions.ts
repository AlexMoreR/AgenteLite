"use server";

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { calculateQuoteLineTotal, stringifyQuoteItemMeta } from "@/lib/quote-item-meta";
import { prisma } from "@/lib/prisma";

const createClientSchema = z.object({
  name: z.string().trim().min(2, "Nombre invalido").max(120, "Nombre demasiado largo"),
  document: z.string().trim().min(5, "Documento invalido").max(40, "Documento demasiado largo"),
  email: z.string().trim().email("Correo invalido"),
  phone: z.string().trim().min(7, "Telefono invalido").max(30, "Telefono demasiado largo"),
  address: z.string().trim().min(5, "Direccion invalida").max(180, "Direccion demasiado larga"),
  neighborhood: z.string().trim().min(2, "Barrio invalido").max(120, "Barrio demasiado largo"),
  department: z.string().trim().min(2, "Departamento invalido").max(120, "Departamento demasiado largo"),
  city: z.string().trim().min(2, "Ciudad invalida").max(120, "Ciudad demasiado larga"),
});

const quoteItemSchema = z.object({
  productId: z.string().trim().min(1, "Producto invalido"),
  supplierId: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().int().min(1, "Cantidad invalida").max(10000),
  unitPrice: z.coerce.number().positive("Precio invalido"),
  color: z.string().trim().max(120, "Color demasiado largo").optional().nullable(),
  notes: z.string().trim().max(4000, "Notas demasiado largas").optional().nullable(),
  additionalCost: z.coerce.number().min(0, "Costo adicional invalido").optional().default(0),
  discount: z.coerce.number().min(0, "Descuento invalido").optional().default(0),
});

const createQuoteSchema = z.object({
  clientId: z.string().trim().optional(),
  notes: z.string().trim().max(2000, "Notas demasiado largas").optional(),
  validUntil: z.string().trim().optional(),
  items: z.array(quoteItemSchema).min(1, "Debes agregar al menos un producto"),
});

const updateQuoteMetaSchema = z.object({
  quoteId: z.string().trim().min(1, "Cotizacion invalida"),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]),
  notes: z.string().trim().max(2000, "Notas demasiado largas").optional(),
  validUntil: z.string().trim().optional(),
});

const updateQuoteFullSchema = z.object({
  quoteId: z.string().trim().min(1, "Cotizacion invalida"),
  clientId: z.string().trim().optional(),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]),
  notes: z.string().trim().max(2000, "Notas demasiado largas").optional(),
  validUntil: z.string().trim().optional(),
  items: z.array(quoteItemSchema).min(1, "Debes agregar al menos un producto"),
});

async function requireAdminSession() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN" || !session.user.id) {
    redirect("/unauthorized");
  }
  return session.user.id;
}

function getReturnTo(formData: FormData): string {
  const raw = formData.get("returnTo");
  if (typeof raw !== "string") {
    return "/admin/cotizaciones";
  }
  const value = raw.trim();
  return value || "/admin/cotizaciones";
}

function buildQuoteCode(index: number): string {
  return `COT-${String(index).padStart(5, "0")}`;
}

function isQuoteCodeUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function parseQuoteCodeNumber(code: string): number {
  const match = /^COT-(\d+)$/.exec(code.trim());
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
}

async function upsertClientFromData(data: z.infer<typeof createClientSchema>): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  const clientProfileData = {
    name: data.name,
    document: data.document,
    phone: data.phone,
    address: data.address,
    neighborhood: data.neighborhood,
    department: data.department,
    city: data.city,
  };

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: "CLIENTE",
        ...clientProfileData,
      },
      select: { id: true },
    });
    return updated.id;
  }

  const password = randomUUID().replace(/-/g, "").slice(0, 14);
  const hashedPassword = await bcrypt.hash(password, 12);
  const created = await prisma.user.create({
    data: {
      ...clientProfileData,
      email: data.email,
      role: Role.CLIENTE,
      password: hashedPassword,
    },
    select: { id: true },
  });
  return created.id;
}

export async function adminCreateClientQuickAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const returnTo = getReturnTo(formData);

  const parsed = createClientSchema.safeParse({
    name: formData.get("name"),
    document: formData.get("document"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    neighborhood: formData.get("neighborhood"),
    department: formData.get("department"),
    city: formData.get("city"),
  });

  if (!parsed.success) {
    redirect(`${returnTo}?error=Datos+de+cliente+invalidos`);
  }

  await upsertClientFromData(parsed.data);

  revalidatePath(returnTo);
  redirect(`${returnTo}?ok=Cliente+guardado`);
}

export async function adminResolveClientAction(
  input: z.infer<typeof createClientSchema>,
): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  await requireAdminSession();
  const parsed = createClientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos de cliente invalidos" };
  }

  try {
    const clientId = await upsertClientFromData(parsed.data);
    return { ok: true, clientId };
  } catch {
    return { ok: false, error: "No se pudo guardar el cliente" };
  }
}

export async function adminCreateQuoteAction(formData: FormData): Promise<void> {
  const createdById = await requireAdminSession();
  const returnTo = getReturnTo(formData);

  const rawItems = formData.get("items");
  let parsedItems: unknown[] = [];
  if (typeof rawItems === "string" && rawItems.trim()) {
    try {
      parsedItems = JSON.parse(rawItems) as unknown[];
    } catch {
      redirect(`${returnTo}?error=Productos+de+cotizacion+invalidos`);
    }
  }

  const parsed = createQuoteSchema.safeParse({
    clientId: formData.get("clientId"),
    notes: formData.get("notes") || undefined,
    validUntil: formData.get("validUntil") || undefined,
    items: parsedItems,
  });

  if (!parsed.success) {
    redirect(`${returnTo}?error=Datos+de+cotizacion+invalidos`);
  }

  let resolvedClientId = "";

  const incomingClientId = parsed.data.clientId?.trim() ?? "";
  if (incomingClientId) {
    const existingClient = await prisma.user.findFirst({
      where: { id: incomingClientId, role: "CLIENTE" },
      select: { id: true },
    });

    if (!existingClient) {
      redirect(`${returnTo}?error=Cliente+invalido`);
    }
    resolvedClientId = existingClient.id;
  } else {
    const parsedClient = createClientSchema.safeParse({
      name: formData.get("name"),
      document: formData.get("document"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      address: formData.get("address"),
      neighborhood: formData.get("neighborhood"),
      department: formData.get("department"),
      city: formData.get("city"),
    });

    if (!parsedClient.success) {
      redirect(`${returnTo}?error=Datos+de+cliente+invalidos`);
    }
    resolvedClientId = await upsertClientFromData(parsedClient.data);
  }

  const validUntilDate =
    parsed.data.validUntil && parsed.data.validUntil.length > 0 ? new Date(parsed.data.validUntil) : null;

  if (validUntilDate && Number.isNaN(validUntilDate.getTime())) {
    redirect(`${returnTo}?error=Fecha+de+validez+invalida`);
  }

  const productIds = Array.from(new Set(parsed.data.items.map((item) => item.productId)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      suppliers: {
        include: { supplier: true },
      },
    },
  });

  if (products.length !== productIds.length) {
    redirect(`${returnTo}?error=Uno+o+mas+productos+no+existen`);
  }

  const productMap = new Map(products.map((product) => [product.id, product]));

  const normalizedItems = parsed.data.items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) {
      throw new Error("Producto invalido");
    }

    const supplierId = item.supplierId?.trim() ? item.supplierId.trim() : null;
    if (supplierId) {
      const allowed = product.suppliers.some((relation) => relation.supplierId === supplierId);
      if (!allowed) {
        throw new Error("Proveedor invalido para producto");
      }
    }

    const lineTotal = calculateQuoteLineTotal(
      item.quantity,
      item.unitPrice,
      item.additionalCost ?? 0,
      item.discount ?? 0,
    );
    const notes = stringifyQuoteItemMeta({
      color: item.color ?? "",
      description: item.notes ?? "",
      additionalCost: item.additionalCost ?? 0,
      discount: item.discount ?? 0,
    });

    return {
      productId: item.productId,
      supplierId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal,
      notes,
    };
  });

  const subtotal = Number(normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const total = subtotal;

  try {
    await prisma.$transaction(async (tx) => {
      const lastQuote = await tx.quote.findFirst({
        select: { code: true },
        orderBy: { code: "desc" },
      });
      const baseCodeNumber = lastQuote ? parseQuoteCodeNumber(lastQuote.code) : 0;
      const maxCodeAttempts = 30;

      for (let offset = 0; offset < maxCodeAttempts; offset += 1) {
        const code = buildQuoteCode(baseCodeNumber + 1 + offset);
        const shareToken = randomUUID().replace(/-/g, "");

        try {
          await tx.quote.create({
            data: {
              code,
              clientId: resolvedClientId,
              createdById,
              notes: parsed.data.notes || null,
              validUntil: validUntilDate,
              subtotal: new Prisma.Decimal(subtotal),
              total: new Prisma.Decimal(total),
              shareToken,
              items: {
                create: normalizedItems.map((item) => ({
                  productId: item.productId,
                  supplierId: item.supplierId,
                  quantity: item.quantity,
                  unitPrice: new Prisma.Decimal(item.unitPrice),
                  lineTotal: new Prisma.Decimal(item.lineTotal),
                  notes: item.notes,
                })),
              },
            },
          });
          return;
        } catch (error) {
          if (isQuoteCodeUniqueError(error) && offset < maxCodeAttempts - 1) {
            continue;
          }
          throw error;
        }
      }
    });
  } catch {
    redirect(`${returnTo}?error=No+se+pudo+crear+la+cotizacion`);
  }

  revalidatePath(returnTo);
  revalidatePath("/admin/cotizaciones");
  redirect(`${returnTo}?ok=Cotizacion+creada`);
}

export async function adminUpdateQuoteMetaAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const returnTo = getReturnTo(formData);

  const parsed = updateQuoteMetaSchema.safeParse({
    quoteId: formData.get("quoteId"),
    status: formData.get("status"),
    notes: formData.get("notes") || undefined,
    validUntil: formData.get("validUntil") || undefined,
  });

  if (!parsed.success) {
    redirect(`${returnTo}?error=Datos+de+cotizacion+invalidos`);
  }

  const validUntilDate =
    parsed.data.validUntil && parsed.data.validUntil.length > 0 ? new Date(parsed.data.validUntil) : null;

  if (validUntilDate && Number.isNaN(validUntilDate.getTime())) {
    redirect(`${returnTo}?error=Fecha+de+validez+invalida`);
  }

  await prisma.quote.update({
    where: { id: parsed.data.quoteId },
    data: {
      status: parsed.data.status,
      notes: parsed.data.notes || null,
      validUntil: validUntilDate,
    },
  });

  revalidatePath("/admin/cotizaciones");
  revalidatePath(returnTo);
  redirect(`${returnTo}?ok=Cotizacion+actualizada`);
}

export async function adminUpdateQuoteFullAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const returnTo = getReturnTo(formData);

  const rawItems = formData.get("items");
  let parsedItems: unknown[] = [];
  if (typeof rawItems === "string" && rawItems.trim()) {
    try {
      parsedItems = JSON.parse(rawItems) as unknown[];
    } catch {
      redirect(`${returnTo}?error=Productos+de+cotizacion+invalidos`);
    }
  }

  const parsed = updateQuoteFullSchema.safeParse({
    quoteId: formData.get("quoteId"),
    clientId: formData.get("clientId"),
    status: formData.get("status"),
    notes: formData.get("notes") || undefined,
    validUntil: formData.get("validUntil") || undefined,
    items: parsedItems,
  });

  if (!parsed.success) {
    redirect(`${returnTo}?error=Datos+de+cotizacion+invalidos`);
  }

  let resolvedClientId = "";
  const incomingClientId = parsed.data.clientId?.trim() ?? "";

  if (incomingClientId) {
    const existingClient = await prisma.user.findFirst({
      where: { id: incomingClientId, role: "CLIENTE" },
      select: { id: true },
    });

    if (!existingClient) {
      redirect(`${returnTo}?error=Cliente+invalido`);
    }
    resolvedClientId = existingClient.id;
  } else {
    const parsedClient = createClientSchema.safeParse({
      name: formData.get("name"),
      document: formData.get("document"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      address: formData.get("address"),
      neighborhood: formData.get("neighborhood"),
      department: formData.get("department"),
      city: formData.get("city"),
    });

    if (!parsedClient.success) {
      redirect(`${returnTo}?error=Datos+de+cliente+invalidos`);
    }
    resolvedClientId = await upsertClientFromData(parsedClient.data);
  }

  const validUntilDate =
    parsed.data.validUntil && parsed.data.validUntil.length > 0 ? new Date(parsed.data.validUntil) : null;

  if (validUntilDate && Number.isNaN(validUntilDate.getTime())) {
    redirect(`${returnTo}?error=Fecha+de+validez+invalida`);
  }

  const productIds = Array.from(new Set(parsed.data.items.map((item) => item.productId)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      suppliers: {
        include: { supplier: true },
      },
    },
  });

  if (products.length !== productIds.length) {
    redirect(`${returnTo}?error=Uno+o+mas+productos+no+existen`);
  }

  const productMap = new Map(products.map((product) => [product.id, product]));

  const normalizedItems = parsed.data.items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) {
      throw new Error("Producto invalido");
    }
    const supplierId = item.supplierId?.trim() ? item.supplierId.trim() : null;
    if (supplierId) {
      const allowed = product.suppliers.some((relation) => relation.supplierId === supplierId);
      if (!allowed) {
        throw new Error("Proveedor invalido para producto");
      }
    }
    const lineTotal = calculateQuoteLineTotal(
      item.quantity,
      item.unitPrice,
      item.additionalCost ?? 0,
      item.discount ?? 0,
    );
    const notes = stringifyQuoteItemMeta({
      color: item.color ?? "",
      description: item.notes ?? "",
      additionalCost: item.additionalCost ?? 0,
      discount: item.discount ?? 0,
    });
    return {
      productId: item.productId,
      supplierId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal,
      notes,
    };
  });

  const subtotal = Number(normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const total = subtotal;

  await prisma.quote.update({
    where: { id: parsed.data.quoteId },
    data: {
      clientId: resolvedClientId,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
      validUntil: validUntilDate,
      subtotal: new Prisma.Decimal(subtotal),
      total: new Prisma.Decimal(total),
      items: {
        deleteMany: {},
        create: normalizedItems.map((item) => ({
          productId: item.productId,
          supplierId: item.supplierId,
          quantity: item.quantity,
          unitPrice: new Prisma.Decimal(item.unitPrice),
          lineTotal: new Prisma.Decimal(item.lineTotal),
          notes: item.notes,
        })),
      },
    },
  });

  revalidatePath("/admin/cotizaciones");
  revalidatePath(returnTo);
  redirect(`${returnTo}?ok=Cotizacion+actualizada`);
}

export async function adminDeleteQuoteAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const returnTo = getReturnTo(formData);
  const quoteId = String(formData.get("quoteId") || "").trim();

  if (!quoteId) {
    redirect(`${returnTo}?error=Cotizacion+invalida`);
  }

  await prisma.quote.delete({
    where: { id: quoteId },
  });

  revalidatePath("/admin/cotizaciones");
  revalidatePath(returnTo);
  redirect(`${returnTo}?ok=Cotizacion+eliminada`);
}
