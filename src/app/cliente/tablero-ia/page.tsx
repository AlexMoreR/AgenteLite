import type { Metadata } from "next";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import { contenidoDelTablero, listarTableros } from "@/features/tableros-inteligentes/services/tableros";
import { TablerosInteligentesVista } from "@/features/tableros-inteligentes/components/TablerosInteligentesVista";

export const metadata: Metadata = {
  title: "Tablero IA",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const uno = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor)?.trim() || null;

/*
  TABLERO IA: las ideas que arma Claude por el MCP, dibujadas como un mapa.

  ?tablero=<id> abre ese tablero; ?tarjeta=<id> abre el tablero de esa tarjeta con su ficha a la
  vista (es el link que devuelve el MCP y el que usarán los avisos por WhatsApp de la fase 2).
*/
export default async function TableroIAPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  const parametros = await searchParams;
  const pedidoTablero = uno(parametros.tablero);
  const pedidaTarjeta = uno(parametros.tarjeta);

  const tableros = await listarTableros(access.workspaceId);

  let tableroId = tableros.find((tablero) => tablero.id === pedidoTablero)?.id ?? null;
  let tarjetaInicial: string | null = null;
  if (pedidaTarjeta) {
    const tarjeta = await prisma.tarjetaTablero.findFirst({
      where: { id: pedidaTarjeta, tablero: { workspaceId: access.workspaceId } },
      select: { id: true, tableroId: true },
    });
    if (tarjeta) {
      tableroId = tarjeta.tableroId;
      tarjetaInicial = tarjeta.id;
    }
  }
  // Sin pedido: el último que cambió, que es donde Claude está trabajando.
  if (!tableroId && tableros.length) {
    tableroId = [...tableros].sort((a, b) => b.actualizadoEn.getTime() - a.actualizadoEn.getTime())[0].id;
  }

  const elegido = tableros.find((tablero) => tablero.id === tableroId) ?? null;
  const contenido = elegido ? await contenidoDelTablero(elegido.id) : null;

  return (
    <TablerosInteligentesVista
      key={elegido?.id ?? "vacio"}
      tableros={tableros.map((tablero) => ({
        id: tablero.id,
        nombre: tablero.nombre,
        porAprobar: tablero.porEstado.POR_APROBAR ?? 0,
      }))}
      tableroId={elegido?.id ?? null}
      inicial={
        elegido && contenido
          ? { actualizadoEn: elegido.actualizadoEn.toISOString(), ...contenido }
          : null
      }
      tarjetaInicial={tarjetaInicial}
      puedeAprobar={personaPuedeAprobar(access)}
    />
  );
}
