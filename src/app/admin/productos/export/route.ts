import { auth } from "@/auth";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return new Response("Unauthorized", { status: 401 });
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "products");
  if (!canAccess) {
    return new Response("Unauthorized", { status: 401 });
  }

  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
      suppliers: {
        where: { isPreferred: true },
        include: { supplier: true },
        take: 1,
      },
    },
  });

  const header = [
    "Codigo",
    "Nombre",
    "Descripcion",
    "Costo",
    "%Detal",
    "%Mayor",
    "MinMayor",
    "Categoria",
    "Proveedor",
    "Imagen",
  ];

  const rows = products.map((product) => {
    const preferredSupplier = product.suppliers[0]?.supplier?.name ?? "";
    return [
      product.code ?? "",
      product.name,
      product.description ?? "",
      String(product.baseCost),
      String(product.retailMarginPct),
      String(product.wholesaleMarginPct),
      String(product.minWholesaleQty),
      product.category?.name ?? "",
      preferredSupplier,
      product.thumbnailUrl,
    ]
      .map((cell) => escapeCsvCell(cell))
      .join(",");
  });

  const csv = [header.join(","), ...rows].join("\n");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="productos-${stamp}.csv"`,
    },
  });
}
