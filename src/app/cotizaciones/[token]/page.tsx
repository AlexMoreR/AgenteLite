import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BadgeCheck,
  Clock3,
  LifeBuoy,
  MessageCircleMore,
  ShieldCheck,
  Truck,
  Wrench,
  WalletCards,
} from "lucide-react";
import { DownloadQuotePdfButton } from "@/components/quotes/download-quote-pdf-button";
import { formatMoney } from "@/lib/currency";
import { parseQuoteItemMeta } from "@/lib/quote-item-meta";
import { prisma } from "@/lib/prisma";
import { getSystemCurrency } from "@/lib/system-settings";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function QuotePublicPage({ params }: PageProps) {
  const { token } = await params;

  const [quote, currency] = await Promise.all([
    prisma.quote.findUnique({
      where: { shareToken: token },
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
    getSystemCurrency(),
  ]);

  if (!quote) {
    notFound();
  }

  const issuedDate = quote.createdAt.toLocaleDateString("es-CO", {
    dateStyle: "long",
  });

  const subtotal = Number(
    quote.items.reduce((sum, item) => sum + item.quantity * Number(item.unitPrice), 0).toFixed(2),
  );
  const additionalCost = Number(
    quote.items.reduce((sum, item) => sum + parseQuoteItemMeta(item.notes).additionalCost, 0).toFixed(2),
  );
  const discount = Number(
    quote.items.reduce((sum, item) => sum + parseQuoteItemMeta(item.notes).discount, 0).toFixed(2),
  );
  const total = Number(quote.total);

  const supportHref = `https://wa.me/573046481994?text=${encodeURIComponent(
    `Hola, necesito ayuda con la cotización ${quote.code}.`,
  )}`;
  const approveHref = `https://wa.me/573046481994?text=${encodeURIComponent(
    `Hola, deseo aprobar la cotización ${quote.code}.`,
  )}`;
  const changesHref = `https://wa.me/573046481994?text=${encodeURIComponent(
    `Hola, solicito cambios para la cotización ${quote.code}.`,
  )}`;
  const companyInfo = {
    name: "Magilus",
    nit: "100.61.80.650",
    cityOrigin: "Cali - Bogotá",
    warranty: "1 año",
  };
  const clientDocument = quote.client.document || "Por confirmar";
  const deliveryAddress = quote.client.address || "Por confirmar";
  const clientCity = quote.client.city || "Por confirmar";
  const getItemDescription = (notes: string | null) =>
    parseQuoteItemMeta(notes).description || "Ninguna observación";

  return (
    <section className="app-page quote-print-root px-0 pb-8 pt-1 md:px-7 md:pb-12 md:pt-2">
      <div className="quote-print-stack flex w-full flex-col gap-5 md:gap-6">
        <section className="quote-print-card quote-print-hero relative overflow-hidden rounded-[1.4rem] border border-white/55 bg-gradient-to-br from-[#0f172a] via-[#1e3a8a] to-[#0f766e] p-2.5 shadow-[0_26px_70px_-34px_rgba(15,23,42,0.7)] md:p-4">
          <div className="quote-print-hero-deco pointer-events-none absolute -left-12 -top-16 h-56 w-56 rounded-full bg-cyan-200/25 blur-3xl" />
          <div className="quote-print-hero-deco pointer-events-none absolute -right-20 bottom-0 h-64 w-64 rounded-full bg-emerald-200/20 blur-3xl" />

          <div className="quote-print-hero-layout relative grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="quote-print-hero-main space-y-2">
              <div className="quote-print-hero-header flex items-start justify-between gap-2">
                <div className="inline-flex items-center gap-2 px-0 py-0">
                  <span
                    className="quote-print-logo-mark inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
                    style={{ backgroundImage: "linear-gradient(135deg, var(--primary-strong), var(--primary))" }}
                  >
                    M
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-white">{companyInfo.name}</p>
                    <p className="text-[11px] text-sky-100/80">NIT {companyInfo.nit}</p>
                  </div>
                </div>
                <h1 className="ml-auto text-right text-base font-semibold tracking-tight text-white md:text-3xl">
                  COTIZACIÓN
                </h1>
              </div>

              <div className="quote-print-panel quote-print-client-panel rounded-2xl border border-white/28 bg-white/14 p-2.5 backdrop-blur-md md:p-3">
                <p className="text-[11px] uppercase tracking-[0.1em] text-sky-100/80">Datos cliente</p>
                <p className="mt-0.5 text-base font-semibold tracking-tight text-white md:text-lg">{quote.client.name || "Por confirmar"}</p>
                <div className="quote-print-mobile mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-sky-100 md:hidden">
                  <div className="min-w-0">
                    <span className="block text-sky-100/80">NIT / C.C</span>
                    <span className="block truncate font-medium text-white">{clientDocument}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="block text-sky-100/80">Dirección de entrega</span>
                    <span className="block truncate font-medium text-white">{deliveryAddress}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="block text-sky-100/80">Ciudad</span>
                    <span className="block truncate font-medium text-white">{clientCity}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="block text-sky-100/80">Departamento</span>
                    <span className="block truncate font-medium text-white">{quote.client.department || "Por confirmar"}</span>
                  </div>
                </div>
                <div className="quote-print-client-desktop mt-2 hidden md:grid md:grid-cols-4 md:gap-0 md:text-sm">
                  <div className="border-r border-white/15 pr-3">
                    <p className="text-sky-100/80">NIT / C.C</p>
                    <p className="font-medium text-white">{clientDocument}</p>
                  </div>
                  <div className="border-r border-white/15 px-3">
                    <p className="text-sky-100/80">Dirección de entrega</p>
                    <p className="font-medium text-white">{deliveryAddress}</p>
                  </div>
                  <div className="border-r border-white/15 px-3">
                    <p className="text-sky-100/80">Ciudad</p>
                    <p className="font-medium text-white">{clientCity}</p>
                  </div>
                  <div className="pl-3">
                    <p className="text-sky-100/80">Departamento</p>
                    <p className="font-medium text-white">{quote.client.department || "Por confirmar"}</p>
                  </div>
                </div>
                <div className="quote-print-client-grid hidden">
                  <div className="quote-print-field">
                    <p className="quote-print-field-label">NIT / C.C</p>
                    <p className="quote-print-field-value">{clientDocument}</p>
                  </div>
                  <div className="quote-print-field">
                    <p className="quote-print-field-label">Dirección de entrega</p>
                    <p className="quote-print-field-value">{deliveryAddress}</p>
                  </div>
                  <div className="quote-print-field">
                    <p className="quote-print-field-label">Ciudad</p>
                    <p className="quote-print-field-value">{clientCity}</p>
                  </div>
                  <div className="quote-print-field">
                    <p className="quote-print-field-label">Departamento</p>
                    <p className="quote-print-field-value">{quote.client.department || "Por confirmar"}</p>
                  </div>
                </div>
              </div>

              <div className="quote-print-hide hidden flex-wrap justify-center gap-2 pt-1 md:flex">
                <Link
                  href={approveHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-100 md:h-10 md:text-sm"
                >
                  <BadgeCheck className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  Aprobar
                </Link>
                <Link
                  href={changesHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/35 bg-white/12 px-3.5 text-xs font-semibold text-white transition hover:bg-white/20 md:h-10 md:text-sm"
                >
                  <MessageCircleMore className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  Cambios
                </Link>
              </div>
            </div>

            <aside className="quote-print-panel quote-print-company-panel rounded-2xl border border-white/28 bg-white/15 p-2.5 backdrop-blur-md md:p-3">
              <p className="text-[11px] uppercase tracking-[0.1em] text-sky-100/80">Datos de empresa</p>
              <p className="mt-0.5 text-base font-semibold tracking-tight text-white md:text-lg">{quote.code}</p>
              <div className="quote-print-company-desktop mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-sky-100 md:block md:space-y-2 md:text-sm">
                <div className="min-w-0 md:flex md:items-center md:justify-between md:gap-3 md:border-b md:border-white/15 md:pb-2">
                  <span className="block text-sky-100/80 md:text-inherit">Empresa</span>
                  <span className="block truncate font-medium text-white">{companyInfo.name}</span>
                </div>
                <div className="min-w-0 md:flex md:items-center md:justify-between md:gap-3 md:border-b md:border-white/15 md:pb-2">
                  <span className="block text-sky-100/80 md:text-inherit">Emisión</span>
                  <span className="block truncate font-medium text-white">{issuedDate}</span>
                </div>
                <div className="min-w-0 md:flex md:items-center md:justify-between md:gap-3">
                  <span className="block text-sky-100/80 md:text-inherit">Ciudad de origen</span>
                  <span className="block truncate font-medium text-white">{companyInfo.cityOrigin}</span>
                </div>
                <div className="min-w-0 md:flex md:items-center md:justify-between md:gap-3 md:border-t md:border-white/15 md:pt-2">
                  <span className="block text-sky-100/80 md:text-inherit">Garantía</span>
                  <span className="block truncate font-medium text-white">{companyInfo.warranty}</span>
                </div>
              </div>
              <div className="quote-print-company-grid hidden">
                <div className="quote-print-field">
                  <p className="quote-print-field-label">Empresa</p>
                  <p className="quote-print-field-value">{companyInfo.name}</p>
                </div>
                <div className="quote-print-field">
                  <p className="quote-print-field-label">Emisión</p>
                  <p className="quote-print-field-value">{issuedDate}</p>
                </div>
                <div className="quote-print-field">
                  <p className="quote-print-field-label">Ciudad de origen</p>
                  <p className="quote-print-field-value">{companyInfo.cityOrigin}</p>
                </div>
                <div className="quote-print-field">
                  <p className="quote-print-field-label">Garantía</p>
                  <p className="quote-print-field-value">{companyInfo.warranty}</p>
                </div>
              </div>
            </aside>
          </div>
          <div className="quote-print-hide mt-3 flex flex-wrap justify-center gap-2 md:hidden">
            <Link
              href={approveHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              <BadgeCheck className="h-3.5 w-3.5" />
              Aprobar
            </Link>
            <Link
              href={changesHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/35 bg-white/12 px-3.5 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              <MessageCircleMore className="h-3.5 w-3.5" />
              Cambios
            </Link>
          </div>
        </section>

        <div className="space-y-2">
          <section className="quote-print-card overflow-hidden rounded-2xl border border-slate-200/85 bg-white/92 shadow-[0_20px_45px_-36px_rgba(15,23,42,0.45)] backdrop-blur-sm">
            <div className="border-b border-slate-200/80 bg-slate-50/70 px-4 py-2.5 text-center">
              <h2 className="text-sm font-semibold text-slate-900">DATOS DEL PRODUCTO</h2>
            </div>
            <div className="quote-print-mobile space-y-2 p-3 md:hidden">
              {quote.items.map((item) => (
                <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start gap-3">
                    {item.product.thumbnailUrl ? (
                      <img
                        src={item.product.thumbnailUrl}
                        alt={item.product.name}
                        className="h-12 w-12 rounded-lg border border-slate-200 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-[10px] text-slate-500">
                        Sin img
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{item.product.name}</p>
                      <p className="mt-0.5 text-xs text-slate-600">{getItemDescription(item.notes)}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-[0.75fr_1.15fr_1.15fr] gap-2 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <p className="text-slate-500">CANT</p>
                      <p className="font-semibold text-slate-900">{item.quantity}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <p className="text-slate-500">Precio</p>
                      <p className="font-semibold text-slate-900">{formatMoney(String(item.unitPrice), currency)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <p className="text-slate-500">Subtotal</p>
                      <p className="font-semibold text-slate-900">{formatMoney(String(item.lineTotal), currency)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="quote-print-desktop hidden overflow-x-auto md:block">
              <table className="min-w-full border-collapse text-sm">
                <thead className="text-xs uppercase tracking-[0.08em] text-slate-500">
                  <tr>
                    <th className="border-b border-r border-slate-200 px-4 py-3 text-left">IMG</th>
                    <th className="border-b border-r border-slate-200 px-4 py-3 text-left">Servicio / Producto</th>
                    <th className="border-b border-r border-slate-200 px-4 py-3 text-left">Descripción</th>
                    <th className="border-b border-r border-slate-200 px-4 py-3 text-left">CANT</th>
                    <th className="border-b border-r border-slate-200 px-4 py-3 text-left">Precio</th>
                    <th className="border-b border-slate-200 px-4 py-3 text-left">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.items.map((item) => (
                    <tr key={item.id} className="group transition-colors hover:bg-sky-50/45">
                      <td className="border-r border-slate-200 px-4 py-3">
                        {item.product.thumbnailUrl ? (
                          <img
                            src={item.product.thumbnailUrl}
                            alt={item.product.name}
                            className="h-12 w-12 rounded-lg border border-slate-200 object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-[10px] text-slate-500">
                            Sin img
                          </div>
                        )}
                      </td>
                      <td className="border-r border-slate-200 px-4 py-3">
                        <p className="font-medium text-slate-900">{item.product.name}</p>
                      </td>
                      <td className="border-r border-slate-200 px-4 py-3 text-slate-600">{getItemDescription(item.notes)}</td>
                      <td className="border-r border-slate-200 px-4 py-3 text-slate-700">{item.quantity}</td>
                      <td className="border-r border-slate-200 px-4 py-3 text-slate-700">{formatMoney(String(item.unitPrice), currency)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{formatMoney(String(item.lineTotal), currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="quote-print-card overflow-hidden rounded-2xl border border-slate-200/85 bg-white/92 shadow-[0_20px_45px_-36px_rgba(15,23,42,0.45)] backdrop-blur-sm">
            <div className="quote-print-mobile grid grid-cols-2 gap-2 p-3 md:hidden">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Subtotal</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(String(subtotal), currency)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Descuento</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(String(discount), currency)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Valor adicional</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(String(additionalCost), currency)}</p>
              </div>
              <div className="rounded-xl border border-slate-300 bg-slate-100 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-600">Valor total</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{formatMoney(String(total), currency)}</p>
              </div>
            </div>
            <div className="quote-print-desktop hidden overflow-x-auto md:block">
              <table className="min-w-full border-collapse text-sm">
                <thead className="text-xs uppercase tracking-[0.08em] text-slate-500">
                  <tr>
                    <th className="border-b border-r border-slate-200 px-4 py-3 text-left">Subtotal</th>
                    <th className="border-b border-r border-slate-200 px-4 py-3 text-left">Descuento</th>
                    <th className="border-b border-r border-slate-200 px-4 py-3 text-left">Valor adicional</th>
                    <th className="border-b border-slate-200 px-4 py-3 text-left">Valor total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border-r border-slate-200 px-4 py-3 font-medium text-slate-900">{formatMoney(String(subtotal), currency)}</td>
                    <td className="border-r border-slate-200 px-4 py-3 font-medium text-slate-900">{formatMoney(String(discount), currency)}</td>
                    <td className="border-r border-slate-200 px-4 py-3 font-medium text-slate-900">{formatMoney(String(additionalCost), currency)}</td>
                    <td className="bg-slate-50/60 px-4 py-3 text-sm font-semibold text-slate-900">{formatMoney(String(total), currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="quote-print-card rounded-2xl border border-slate-200/85 bg-white/92 p-4 shadow-[0_20px_45px_-36px_rgba(15,23,42,0.45)] md:p-5">
          <div className="space-y-4 text-sm leading-relaxed text-slate-700">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-slate-900">
                <Truck className="h-4 w-4 text-[var(--primary)]" />
                DESPACHO DE PEDIDOS:
              </p>
              <p className="mt-1.5">
                El producto se despacha por medio de una empresa aliada en el campo del transporte. Los plazos de entrega
                pueden variar por razones ajenas como, por ejemplo: cierre de vías por derrumbes o desastres naturales,
                fallas mecánicas en los vehículos encargados del traslado, o que el cliente haya suministrado los datos
                erróneamente.
              </p>
            </div>

            <div>
              <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-slate-900">
                <ShieldCheck className="h-4 w-4 text-[var(--primary)]" />
                GARANTÍAS POR MANIPULACIÓN:
              </p>
              <p className="mt-1.5">
                Una vez le estén haciendo entrega de su pedido, debe ser revisado en presencia del auxiliar para verificar
                su estado o notificar inmediatamente cualquier novedad a nuestra línea{" "}
                <Link
                  href={supportHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[var(--primary)] underline underline-offset-2"
                >
                  304 6481994
                </Link>{" "}
                vía WhatsApp para allí
                indicarle el paso a seguir, ya que una vez firmada la guía perdería la garantía de nuestra parte y pasaría
                a hacerle el reclamo directamente a la empresa encargada del transporte.
              </p>
              <p className="mt-1.5">Usted, como cliente, tiene 15 minutos para la verificación de su pedido.</p>
            </div>

            <div>
              <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-slate-900">
                <Wrench className="h-4 w-4 text-[var(--primary)]" />
                GARANTÍAS POR DEFECTOS DE FABRICACIÓN:
              </p>
              <p className="mt-1.5">
                Debe enviarnos fotos y videos a la línea{" "}
                <Link
                  href={supportHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[var(--primary)] underline underline-offset-2"
                >
                  304 6481994
                </Link>{" "}
                para verificar si la falla es por defecto de fabricación
                y si son realmente nuestros productos.
              </p>
            </div>
          </div>
        </section>

        <section className="quote-print-card quote-print-feature-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl border border-slate-200/85 bg-white/92 p-4 shadow-[0_16px_34px_-30px_rgba(15,23,42,0.45)]">
            <LifeBuoy className="h-5 w-5 text-sky-600" />
            <p className="mt-2 text-sm font-semibold text-slate-900">Soporte incluido</p>
            <p className="mt-1 text-xs text-slate-600">Acompañamiento de principio a fin en implementación y dudas.</p>
          </article>
          <article className="rounded-2xl border border-slate-200/85 bg-white/92 p-4 shadow-[0_16px_34px_-30px_rgba(15,23,42,0.45)]">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <p className="mt-2 text-sm font-semibold text-slate-900">Garantía del servicio</p>
            <p className="mt-1 text-xs text-slate-600">Cobertura de calidad y respaldo sobre entregables acordados.</p>
          </article>
          <article className="rounded-2xl border border-slate-200/85 bg-white/92 p-4 shadow-[0_16px_34px_-30px_rgba(15,23,42,0.45)]">
            <Clock3 className="h-5 w-5 text-indigo-600" />
            <p className="mt-2 text-sm font-semibold text-slate-900">Tiempo de entrega</p>
            <p className="mt-1 text-xs text-slate-600">Cronograma proyectado y seguimiento transparente por etapa.</p>
          </article>
          <article className="rounded-2xl border border-slate-200/85 bg-white/92 p-4 shadow-[0_16px_34px_-30px_rgba(15,23,42,0.45)]">
            <WalletCards className="h-5 w-5 text-amber-600" />
            <p className="mt-2 text-sm font-semibold text-slate-900">Forma de pago</p>
            <p className="mt-1 text-xs text-slate-600">Pago flexible según avance y condiciones comerciales.</p>
          </article>
        </section>

        <section className="quote-print-actions rounded-2xl border border-slate-200/85 bg-white/92 p-4 shadow-[0_20px_45px_-36px_rgba(15,23,42,0.45)] md:p-5">
          <h2 className="text-sm font-semibold text-slate-900">Acciones</h2>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href={approveHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              <BadgeCheck className="h-4 w-4" />
              Aprobar
            </Link>
            <Link
              href={changesHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-50"
            >
              <MessageCircleMore className="h-4 w-4" />
              Cambios
            </Link>
            <DownloadQuotePdfButton className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70" />
            <Link
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-700 transition hover:-translate-y-0.5 hover:bg-sky-100"
            >
              <MessageCircleMore className="h-4 w-4" />
              Contactar asesor
            </Link>
          </div>
        </section>

        <footer className="quote-print-card rounded-2xl border border-slate-200/85 bg-white/92 p-4 shadow-[0_20px_45px_-36px_rgba(15,23,42,0.45)] md:p-5">
          <div className="flex flex-col gap-3 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <span
                className="quote-print-logo-mark inline-flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white"
                style={{ backgroundImage: "linear-gradient(135deg, var(--primary-strong), var(--primary))" }}
              >
                M
              </span>
              <div>
                <p className="font-semibold text-slate-900">Magilus</p>
                <p className="text-xs text-slate-500">Soluciones empresariales y acompañamiento comercial</p>
              </div>
            </div>
            <div className="grid gap-1 text-xs sm:grid-cols-2 sm:gap-x-5">
              <p>Contacto: +57 304 648 1994</p>
              <p>Correo: comercial@innovacionesmagi.com</p>
              <p>WhatsApp: wa.me/573046481994</p>
              <p>Sitio web: innovacionesmagi.com</p>
            </div>
          </div>
        </footer>
      </div>
    </section>
  );
}
