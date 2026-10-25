import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { personaPuedeAprobar, puedeAsignarResponsable } from "@/features/tableros-inteligentes/services/reglas";
import { nivelDeLaTarjeta } from "@/features/tableros-inteligentes/services/niveles";
import {
  RUTA_TABLEROS,
  aTableroDelInicio,
  alcanceDe,
  asignadasA,
  contenidoDelTablero,
  firmaDeLaLista,
  listarTableros,
  miembrosDelNegocio,
  personaQueAprueba,
  tarjetaAsignada,
} from "@/features/tableros-inteligentes/services/tableros";
import { FichaDeAsignada } from "@/features/tableros-inteligentes/components/FichaDeAsignada";
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
  Trabajador). Un link a un tablero o tarjeta que no existe, o de un tablero de otra persona, vuelve a
  ella. Tableros por cuenta: cada persona ve los suyos; el dueño del negocio y el ADMIN, todos.
  ?tablero=<id> abre ese tablero; ?area=<tarjetaId> entra a esa tarjeta (ella al centro y sus hijas
  alrededor);
  ?tarjeta=<id> abre el tablero de esa tarjeta, en el nivel de su madre, con su ficha a la vista (es
  el link que devuelve el MCP y el que usarán los avisos por WhatsApp de la fase 2).
  ?vista=coordinador abre la página de inicio en la pestaña "Coordinador en vivo" (solo el dueño o el ADMIN;
  para los demás se ignora).
*/
export default async function TableroIAPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  const parametros = await searchParams;
  const pedidoTablero = uno(parametros.tablero);
  const pedidaTarjeta = uno(parametros.tarjeta);
  const pedidoNivel = uno(parametros.area);

  // Tableros por cuenta: cada persona ve los suyos; el dueño o el ADMIN, todos (con el nombre del dueño).
  const alcance = alcanceDe(access);
  const [tableros, persona, miembros] = await Promise.all([
    listarTableros(alcance),
    personaQueAprueba(access.workspaceId, access.userId),
    // A quién se le puede dar un tablero (el diálogo del dueño o el ADMIN) y a quién se le puede asignar
    // una tarjeta (el selector Responsable de la ficha: lo ve cualquiera que edite un tablero).
    miembrosDelNegocio(access.workspaceId),
  ]);
  // La sección Trabajador: el dueño o el ADMIN de la plataforma (nunca una asesora).
  const puedeAdministrar = persona.esDueno || persona.esAdminPlataforma;
  // Crear y renombrar: cualquiera los suyos; el dueño o el ADMIN, todos, y eligen de quién es cada uno.
  // La lista (inicio y selector) se refresca sola: lleva la firma de lo que se leyó ahora.
  const lista = tableros.map(aTableroDelInicio);
  const firmaDeTableros = firmaDeLaLista(tableros);
  // Quien ve solo lo suyo recibe los nombres para el selector de responsable, no los correos de los demás.
  const cuentas = {
    yo: access.userId,
    verTodos: alcance.soloDe === null,
    miembros: alcance.soloDe ? miembros.map((miembro) => ({ ...miembro, email: "" })) : miembros,
  };

  // Sin nada en el link: la página de inicio con el listado (el último que cambió va primero).
  if (!pedidoTablero && !pedidaTarjeta && !pedidoNivel) {
    return (
      <InicioDeTableros
        tableros={lista}
        firma={firmaDeTableros}
        puedeAdministrar={puedeAdministrar}
        cuentas={cuentas}
        asignadas={await asignadasA(alcance, access.userId)}
        vistaInicial={uno(parametros.vista) === "coordinador" ? "coordinador" : "tableros"}
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
  // Un link a un tablero (o tarjeta) que ya no existe, o que es de otra persona, vuelve al listado:
  // `tableros` ya trae solo los que esta persona ve.
  const elegido = tableros.find((tablero) => tablero.id === tableroId);
  if (!elegido) {
    // Una tarjeta que le asignaron en un tablero que no es suyo: se abre SOLO su ficha, sobre el inicio.
    // Nunca el resto de ese tablero (la condición es que la persona sea la responsable de esa tarjeta).
    const asignada = pedidaTarjeta ? await tarjetaAsignada(access.workspaceId, access.userId, pedidaTarjeta) : null;
    if (!asignada) redirect(RUTA_TABLEROS);
    return (
      <>
        <InicioDeTableros
          tableros={lista}
          firma={firmaDeTableros}
          puedeAdministrar={puedeAdministrar}
          cuentas={cuentas}
          asignadas={await asignadasA(alcance, access.userId)}
        />
        <FichaDeAsignada tarjeta={asignada.tarjeta} tipos={asignada.tipos} />
      </>
    );
  }
  const contenido = await contenidoDelTablero(elegido.id);
  // El link a una tarjeta abre el nivel de su madre; si no, el nivel pedido (la vista lo valida).
  const nivelInicial =
    tarjetaInicial && !pedidoNivel ? nivelDeLaTarjeta(contenido.tarjetas, tarjetaInicial) : pedidoNivel;

  return (
    <TablerosInteligentesVista
      key={elegido.id}
      tableros={lista}
      firmaDeTableros={firmaDeTableros}
      cuentas={cuentas}
      tableroId={elegido.id}
      tableroNombre={elegido.nombre}
      inicial={{ actualizadoEn: elegido.actualizadoEn.toISOString(), ...contenido }}
      tarjetaInicial={tarjetaInicial}
      nivelInicial={nivelInicial}
      // Los botones de la tarea y el plan: dueño, ADMIN o aprobador (el alcance lo revisa el servidor).
      puedeAprobar={personaPuedeAprobar(access) || persona.esDueno || Boolean(persona.aprobador)}
      puedeEditarTipos={personaPuedeAprobar(access)}
      esDueno={persona.esDueno}
      puedeAsignar={puedeAsignarResponsable(alcance.soloDe, elegido.duenoUserId)}
    />
  );
}
