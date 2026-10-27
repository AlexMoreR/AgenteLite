import type { Metadata } from "next";

import { PaginaDeAgenteDeArea } from "@/features/agentes-de-area/components/PaginaDeAgenteDeArea";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** AGENTE DE MARKETING: el mismo panel que el de Ventas, más la tabla por campaña y por anuncio. Solo lee Meta Ads. */
export default function AgenteDeMarketingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PaginaDeAgenteDeArea area="marketing" searchParams={searchParams} />;
}
