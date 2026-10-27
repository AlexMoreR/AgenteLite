import type { Metadata } from "next";

import { PaginaDeAgenteDeArea } from "@/features/agentes-de-area/components/PaginaDeAgenteDeArea";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** AGENTE DE SISTEMAS: el mismo panel que el de Ventas, más la tabla de revisiones de lo subido. Solo lee. */
export default function AgenteDeSistemasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PaginaDeAgenteDeArea area="sistemas" searchParams={searchParams} />;
}
