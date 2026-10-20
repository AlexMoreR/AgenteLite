import type { Metadata } from "next";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import { nivelDeLaTarjeta } from "@/features/tableros-inteligentes/services/niveles";
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
  TABLERO IA: las ideas que arma Claude por el MCP, dibujadas como un mapa por niveles.

  ?tablero=<id> abre ese tablero; ?area=<tarjetaId> entra a esa tarjeta (ella al centro y sus hijas
  alrededor);
  ?tarjeta=<id> abre el tablero de esa tarjeta, en el nivel de su madre, con su ficha a la vista (es
  el link que devuelve el MCP y el que usarán los avisos por WhatsApp de la fase 2).
*/
export default async function TableroIAPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  const parametros = await searchParams;
  const pedidoTablero = uno(parametros.tablero);
  const pedidaTarjeta = uno(parametros.tarjeta);
  const pedidoNivel = uno(parametros.area);

  const tableros = await listarTableros(access.workspaceId);

  let tableroId = tableros.find((tablero) => tablero.id === pedidoTablero)?.id ?? null;
  let tarjetaInicial: string | null = null;
  if (pedidaTarjeta || (!tableroId && pedidoNivel)) {
    // Una tarjeta (o un nivel) sin tablero en el link: el tablero sale de la tarjeta.
    const tarjeta = await prisma.tarjetaTablero.findFirst({
      where: { id: pedidaTarjeta ?? pedidoNivel ?? "", tablero: { workspaceId: access.workspaceId }, borradoEn: null },
      select: { id: true, tableroId: true },
    });
    if (tarjeta) {
      tableroId = tarjeta.tableroId;
      if (pedidaTarjeta) tarjetaInicial = tarjeta.id;
    }
  }
  // Sin pedido: el último que cambió, que es donde Claude está trabajando.
  if (!tableroId && tableros.length) {
    tableroId = [...tableros].sort((a, b) => b.actualizadoEn.getTime() - a.actualizadoEn.getTime())[0].id;
  }

  const elegido = tableros.find((tablero) => tablero.id === tableroId) ?? null;
  const contenido = elegido ? await contenidoDelTablero(elegido.id) : null;
  // El link a una tarjeta abre el nivel de su madre; si no, el nivel pedido (la vista lo valida).
  const nivelInicial =
    contenido && tarjetaInicial && !pedidoNivel ? nivelDeLaTarjeta(contenido.tarjetas, tarjetaInicial) : pedidoNivel;

  return (
    <TablerosInteligentesVista
      key={elegido?.id ?? "vacio"}
      tableros={tableros.map((tablero) => ({
        id: tablero.id,
        nombre: tablero.nombre,
        porAprobar: tablero.porEstado.POR_APROBAR ?? 0,
      }))}
      tableroId={elegido?.id ?? null}
      tableroNombre={elegido?.nombre ?? null}
      inicial={
        elegido && contenido
          ? { actualizadoEn: elegido.actualizadoEn.toISOString(), ...contenido }
          : null
      }
      tarjetaInicial={tarjetaInicial}
      nivelInicial={nivelInicial}
      puedeAprobar={personaPuedeAprobar(access)}
    />
  );
}
