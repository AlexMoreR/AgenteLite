import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BadgeCheck, ImagePlus, Megaphone } from "lucide-react";
import { auth } from "@/auth";
import {
  deleteMarketingBusinessLogoAction,
  saveMarketingBusinessLogoAction,
} from "@/app/actions/marketing-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { getWorkspaceMarketingLogoUrl } from "@/lib/marketing-branding";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MarketingIaPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const businessLogoUrl = membership
    ? await getWorkspaceMarketingLogoUrl(membership.workspace.id)
    : null;
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return (
    <MarketingPageContent
      businessLogoUrl={businessLogoUrl}
      okMessage={okMessage}
      errorMessage={errorMessage}
    />
  );
}

function MarketingPageContent({
  businessLogoUrl,
  okMessage,
  errorMessage,
}: {
  businessLogoUrl: string | null;
  okMessage: string;
  errorMessage: string;
}) {
  return (
    <section className="app-page space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Marketing actualizado"
        errorTitle="No pudimos completar la accion"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
            <BadgeCheck className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Logo del negocio</h2>
            <p className="text-sm text-slate-600">
              Guarda aqui el logo real de tu marca para poder pegarlo encima de los anuncios sin que la IA lo cambie.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-slate-50 p-4">
            {businessLogoUrl ? (
              <div className="space-y-4">
                <div className="relative flex min-h-36 items-center justify-center overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
                  <Image
                    src={businessLogoUrl}
                    alt="Logo del negocio"
                    width={220}
                    height={120}
                    className="h-auto max-h-28 w-auto object-contain"
                    unoptimized
                  />
                </div>

                <form action={saveMarketingBusinessLogoAction} className="space-y-3">
                  <Input name="logo" type="file" accept="image/*" className="h-11 bg-white" required />
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--line)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    Reemplazar logo
                  </button>
                </form>

                <form action={deleteMarketingBusinessLogoAction}>
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-4 text-sm font-medium text-red-600 transition hover:bg-red-50"
                  >
                    Eliminar logo
                  </button>
                </form>
              </div>
            ) : (
              <form action={saveMarketingBusinessLogoAction} className="space-y-4">
                <div className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line-strong)] bg-white p-5 text-center">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                    <ImagePlus className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-sm font-medium text-slate-800">Sube el logo de tu negocio</p>
                  <p className="mt-1 text-xs text-slate-500">
                    PNG o JPG. Se usara como logo real encima del anuncio cuando actives el checkbox.
                  </p>
                </div>
                <Input name="logo" type="file" accept="image/*" className="h-11 bg-white" required />
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  Guardar logo
                </button>
              </form>
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Facebook Ads</h2>
            <p className="text-sm text-slate-600">
              Sube una foto del producto y genera 3 imagenes cuadradas con texto
              publicitario integrado para vender mejor.
            </p>
            <p className="text-xs text-slate-500">
              {businessLogoUrl
                ? "Tu logo ya esta listo. Dentro del generador podras activar la opcion para agregarlo."
                : "Si quieres que los anuncios salgan con tu marca, primero sube el logo del negocio en la tarjeta de la izquierda."}
            </p>
          </div>
          <Link
            href="/cliente/marketing-ia/facebook-ads"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Abrir modulo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      </div>
    </section>
  );
}
