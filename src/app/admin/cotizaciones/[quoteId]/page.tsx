import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { EditQuoteWorkspace } from "@/components/admin/edit-quote-workspace";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { parseQuoteItemMeta } from "@/lib/quote-item-meta";
import { prisma } from "@/lib/prisma";
import { getSystemCurrency } from "@/lib/system-settings";

type PageProps = {
  params: Promise<{ quoteId: string }>;
};

export default async function AdminCotizacionDetallePage({ params }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "quotes");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const { quoteId } = await params;

  const [quote, clients, products, currency] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        client: true,
        items: {
          include: {
            product: true,
            supplier: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: "CLIENTE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        document: true,
        phone: true,
        address: true,
        neighborhood: true,
        department: true,
        city: true,
      },
      take: 400,
    }),
    prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        suppliers: {
          include: {
            supplier: true,
          },
        },
      },
      take: 500,
    }),
    getSystemCurrency(),
  ]);

  if (!quote) {
    notFound();
  }

  const validUntilValue = quote.validUntil
    ? new Date(quote.validUntil.getTime() - quote.validUntil.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10)
    : "";

  return (
    <EditQuoteWorkspace
      quote={{
        id: quote.id,
        code: quote.code,
        status: quote.status,
        validUntil: validUntilValue,
        notes: quote.notes ?? "",
        client: {
          id: quote.client.id,
          name: quote.client.name || quote.client.email,
          email: quote.client.email,
          document: quote.client.document ?? "",
          phone: quote.client.phone ?? "",
          address: quote.client.address ?? "",
          neighborhood: quote.client.neighborhood ?? "",
          department: quote.client.department ?? "",
          city: quote.client.city ?? "",
        },
        items: quote.items.map((item) => {
          const meta = parseQuoteItemMeta(item.notes);
          return {
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            description: meta.description,
            color: meta.color,
            additionalCost: meta.additionalCost,
            discount: meta.discount,
          };
        }),
      }}
      clients={clients.map((client) => ({
        id: client.id,
        name: client.name || "Cliente sin nombre",
        email: client.email,
        document: client.document ?? "",
        phone: client.phone ?? "",
        address: client.address ?? "",
        neighborhood: client.neighborhood ?? "",
        department: client.department ?? "",
        city: client.city ?? "",
      }))}
      products={products.map((product) => ({
        id: product.id,
        name: product.name,
        code: product.code,
        retailPrice: Number(product.price),
        thumbnailUrl: product.thumbnailUrl,
      }))}
      currency={currency}
    />
  );
}
