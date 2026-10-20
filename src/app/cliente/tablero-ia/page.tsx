import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import { nivelDeLaTarjeta } from "@/features/tableros-inteligentes/services/niveles";
import {
  RUTA_TABLEROS,
  contenidoDelTablero,
  listarTableros,
  personaQueAprueba,
  porAprobarDe,
} from "@/features/tableros-inteligentes/services/tableros";
import { InicioDeTableros } from "@/features/tableros-inteligentes/components/InicioDeTableros";
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

  Sin parámetros: la página de inicio (el listado de tableros y, para el dueño o el ADMIN, la sección
  Trabajador). Un link a un tablero o tarjeta que no existe vuelve a ella.
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

  const [tableros, persona] = await Promise.all([
    listarTableros(access.workspaceId),
    personaQueAprueba(access.workspaceId, access.userId),
  ]);
  // Crear y renombrar tableros y la sección Trabajador: el dueño o el ADMIN de la plataforma (nunca una asesora).
  const puedeAdministrar = persona.esDueno || persona.esAdminPlataforma;

  // Sin nada en el link: la página de inicio con el listado (el último que cambió va primero).
  if (!pedidoTablero && !pedidaTarjeta && !pedidoNivel) {
    return (
      <InicioDeTableros
        tableros={[...tableros]
          .sort((a, b) => b.actualizadoEn.getTime() - a.actualizadoEn.getTime())
          .map((tablero) => ({
            id: tablero.id,
            nombre: tablero.nombre,
            porAprobar: porAprobarDe(tablero.porEstado),
            tarjetas: tablero.tarjetas,
            contadores: tablero.contadores,
            actualizadoEn: tablero.actualizadoEn.toISOString(),
          }))}
        puedeAdministrar={puedeAdministrar}
      />
    );
  }

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
  // Un link a un tablero (o tarjeta) que ya no existe vuelve al listado.
  const elegido = tableros.find((tablero) => tablero.id === tableroId);
  if (!elegido) redirect(RUTA_TABLEROS);
  const contenido = await contenidoDelTablero(elegido.id);
  // El link a una tarjeta abre el nivel de su madre; si no, el nivel pedido (la vista lo valida).
  const nivelInicial =
    tarjetaInicial && !pedidoNivel ? nivelDeLaTarjeta(contenido.tarjetas, tarjetaInicial) : pedidoNivel;

  return (
    <TablerosInteligentesVista
      key={elegido.id}
      tableros={tableros.map((tablero) => ({
        id: tablero.id,
        nombre: tablero.nombre,
        porAprobar: porAprobarDe(tablero.porEstado),
        tarjetas: tablero.tarjetas,
      }))}
      tableroId={elegido.id}
      tableroNombre={elegido.nombre}
      inicial={{ actualizadoEn: elegido.actualizadoEn.toISOString(), ...contenido }}
      tarjetaInicial={tarjetaInicial}
      nivelInicial={nivelInicial}
      // Los botones de la tarea y el plan: dueño, ADMIN o aprobador (el alcance lo revisa el servidor).
      puedeAprobar={personaPuedeAprobar(access) || persona.esDueno || Boolean(persona.aprobador)}
      puedeEditarTipos={personaPuedeAprobar(access)}
      puedeAdministrar={puedeAdministrar}
      esDueno={persona.esDueno}
    />
  );
}
