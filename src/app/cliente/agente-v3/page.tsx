import type { Metadata } from "next";
import Link from "next/link";

import { LibroDeReglasView } from "@/features/agente-v3/components/LibroDeReglasView";
import { MapaDelLibro } from "@/features/agente-v3/components/MapaDelLibro";
import { revisarLibro } from "@/features/agente-v3/domain/reglas";
import { leerLibro } from "@/features/agente-v3/servicios/almacen";
import { nombreLegible } from "@/features/agente-v3/servicios/catalogo";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/*
  El libro de reglas del Agente V3, para mirarlo mientras se dicta por Claude.

  Solo dueño o administrador: son las reglas con las que se vende. Es de lectura: editar se hace
  hablando, y esta pantalla es donde se comprueba que quedó lo que se pidió (Alex, 21-sep-2026).

  Aquí vivía el interruptor "Rescatar mensajes perdidos". Se quitó el 11-10-2026 por pedido de Alex:
  el rescate es una protección del sistema y corre siempre (ver servicios/rescate-de-mensajes.ts).

  Dos vistas, por enlace (?vista=mapa): "Reglas" es la lista de siempre; "Mapa" dibuja cómo está
  cableado el bot, solo para mirar (Alex, 13-oct-2026). Los productos y flujos se leen solo para el
  mapa, así la lista —que se refresca sola cada 5 s— no paga esas lecturas.
*/
export default async function AgenteV3Page({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess();
  const esJefe = access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";

  if (!esJefe) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Solo el dueño o un administrador del negocio puede ver el libro de reglas.
      </div>
    );
  }

  const params = await searchParams;
  const vista = params.vista === "mapa" ? "mapa" : "reglas";
  const libro = await leerLibro(access.workspaceId);

  if (vista === "mapa") {
    // Todos los productos, también los inactivos: una regla vieja puede seguir apuntando a uno.
    // Los títulos de flujo se resuelven igual que en el V2; si fallan, queda el título guardado.
    const [productos, flujos] = await Promise.all([
      prisma.product.findMany({ where: { workspaceId: access.workspaceId }, select: { id: true, name: true } }),
      getCreatedFlowItems({ workspaceId: access.workspaceId, includeOfficialApi: true }).catch(() => []),
    ]);
    const nombresDeProductos = Object.fromEntries(productos.map((p) => [p.id, nombreLegible(p.name)]));
    const titulosDeFlujos = Object.fromEntries(flujos.map((f) => [f.id, f.title]));

    return (
      <div className="space-y-3">
        <Pestanas vista="mapa" />
        <MapaDelLibro libro={libro} nombresDeProductos={nombresDeProductos} titulosDeFlujos={titulosDeFlujos} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Pestanas vista="reglas" />
      <LibroDeReglasView libro={libro} problemas={revisarLibro(libro)} />
    </div>
  );
}

function Pestanas({ vista }: { vista: "reglas" | "mapa" }) {
  const pestana = (id: "reglas" | "mapa", texto: string, href: string) => (
    <Link
      href={href}
      aria-current={vista === id ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-[13px] font-medium transition",
        vista === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {texto}
    </Link>
  );
  return (
    <div className={cn("px-4 pt-4", vista === "reglas" && "mx-auto w-full max-w-3xl -mb-4")}>
      <nav className="inline-flex rounded-lg bg-muted p-1" aria-label="Vistas del libro">
        {pestana("reglas", "Reglas", "/cliente/agente-v3")}
        {pestana("mapa", "Mapa", "/cliente/agente-v3?vista=mapa")}
      </nav>
    </div>
  );
}
