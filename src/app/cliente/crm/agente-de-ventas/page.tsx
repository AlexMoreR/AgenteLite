import type { Metadata } from "next";

import { PaginaDeAgenteDeArea } from "@/features/agentes-de-area/components/PaginaDeAgenteDeArea";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** AGENTE DE VENTAS: el resumen del día, los subagentes, los mensajes internos y el historial, con su interruptor. */
export default function AgenteDeVentasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PaginaDeAgenteDeArea area="ventas" searchParams={searchParams} />;
}
