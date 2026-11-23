import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { getVisibleChannelIds, resolverConexionElegida } from "@/lib/channel-visibility";
import { canalesQueMonitorea } from "@/lib/modo-monitoreo";
import { esSupervisora } from "@/lib/permisos-del-equipo";
import { fragmentosDeFiltrosOficiales } from "@/features/official-api/services/getOfficialApiChatsData";
import {
  grupoQueAplica,
  idsParaLosFiltros,
  leerFiltrosDeBandeja,
  hayFiltrosPuestos,
  whereDeFiltros,
  whereDeGrupo,
  type CondicionDeBandeja,
  type FiltrosDeBandeja,
  type IdsDeLosFiltros,
} from "@/features/chats/services/filtros-de-bandeja";
import { GRUPO_POR_DEFECTO, type GrupoDeBandeja } from "@/features/chats/domain/filtros-de-bandeja";
import { contactosInternos, type ContactosInternos } from "@/features/chats/services/contactos-internos";
import { conServerTiming, type MedidorServerTiming } from "@/lib/server-timing";
import { cacheDeContadores, claveDeContadores } from "@/lib/cache-de-contadores";
import {
  estadoQueAplica,
  hayBusqueda,
  whereDeBusquedaDeChats,
  whereDeBusquedaDeChatsOficiales,
} from "@/lib/busqueda-de-chats";
import { whereEsMio } from "@/lib/chats-asignacion-compartida";
import { canalesDelNegocio } from "@/lib/canales-del-negocio";
import {
  esperaDelNegocio,
  esperaParaPersona,
  type EsperaDeChats,
  type QuienMira,
} from "@/features/chats/services/espera-de-chats";
import {
  alcanceDeLasPastillas,
  type AlcanceDeLasPastillas,
  type AsignacionDeLasPastillas,
} from "@/features/chats/domain/alcance-de-las-pastillas";

export const dynamic = "force-dynamic";

type ChatsStatusFilter = "all" | "open" | "resolved";

// Los contadores tienen que contar LO MISMO que muestra la lista. Sin esto sumaban tambien las
// conversaciones resueltas: la asesora resolvia un chat y su pestaña seguia diciendo "Mias 2".
function buildStatusWhere(statusFilter: ChatsStatusFilter): Prisma.ConversationWhereInput {
  if (statusFilter === "resolved") {
    return { status: { in: ["CLOSED", "ARCHIVED"] } };
  }

  return statusFilter === "all" ? {} : { status: { in: ["OPEN", "PENDING"] } };
}

function buildBaseWhere(input: {
  workspaceId: string;
  searchQuery: string;
  selectedConnectionKey: string;
  statusFilter: ChatsStatusFilter;
  // Contactos con el lead pospuesto: no estan en la lista, asi que tampoco pueden estar en el
  // numero. Si no, la asesora pospone diez chats, la bandeja se vacia y el contador sigue igual.
  snoozedContactIds: string[];
  visibleChannelIds: string[] | null;
  filtros: FiltrosDeBandeja;
  // Los ids de "Sin responder" y "No leido" (null si esa condicion no esta puesta).
  ids: IdsDeLosFiltros;
}): Prisma.ConversationWhereInput {
  const normalizedSearchQuery = input.searchQuery.trim();
  // Con texto en el buscador el estado no filtra y los pospuestos tambien cuentan, igual que la
  // lista (ver estadoQueAplica en lib/busqueda-de-chats). Sin texto, todo como siempre.
  const buscando = hayBusqueda(normalizedSearchQuery);

  return {
    workspaceId: input.workspaceId,
    AND: [
      buildStatusWhere(estadoQueAplica(input.statusFilter, normalizedSearchQuery)),
      // El numero de la pastilla tiene que contar LO MISMO que muestra la lista: si no, la asesora
      // filtra, ve 20 chats y al lado un "Todas 1956" que no le dice nada de lo que esta mirando.
      whereDeFiltros(input.filtros, input.ids),
      // Los contactos bloqueados no aparecen en la bandeja (ver lib/bloqueo-de-contactos).
      { contact: { bloqueadoEn: null } },
      !buscando && input.snoozedContactIds.length ? { contactId: { notIn: input.snoozedContactIds } } : {},
      input.visibleChannelIds ? { channelId: { in: input.visibleChannelIds } } : {},
      input.selectedConnectionKey.startsWith("channel:")
        ? { channelId: input.selectedConnectionKey.slice("channel:".length) }
        : {},
      // Lo mismo que muestra la bandeja buscando: los chats por nombre y numero MAS los que tienen
      // el texto en un mensaje, que llegan en la segunda llamada (ver lib/busqueda-de-chats).
      whereDeBusquedaDeChats(normalizedSearchQuery, new Date(), "todo"),
    ],
  };
}

/**
 * Cuenta los chats del canal de API OFICIAL, que viven en su propia tabla.
 *
 * La lista de chats SI los muestra (la arma la pagina mezclando las dos fuentes), pero los
 * contadores de arriba solo miraban Conversation: al entrar a "Ventas 1" se veian los chats
 * y al lado "Todas 0". Se cuentan igual que los muestra la lista: solo cuando el canal
 * elegido es el oficial (o no hay ninguno elegido).
 *
 * Se reparten igual que las del canal viejo: las que tienen asesora cuentan en "Mias" de esa
 * persona y las que no, en "Sin asignar".
 */
async function countOfficialConversations(input: {
  workspaceId: string;
  searchQuery: string;
  selectedConnectionKey: string;
  userId: string;
  // `user:<id>[,<id>...]` solo lo usan las pastillas No leido y Sin responder (ver alcanceDeLasPastillas).
  assignedTo: AsignacionDeLasPastillas;
  statusFilter: ChatsStatusFilter;
  filtros: FiltrosDeBandeja;
}): Promise<number> {
  if (input.selectedConnectionKey.startsWith("channel:")) {
    const channelId = input.selectedConnectionKey.slice("channel:".length);
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id: channelId, workspaceId: input.workspaceId },
      select: { provider: true },
    });
    if (channel?.provider !== "OFFICIAL_API") {
      return 0;
    }
  } else if (input.selectedConnectionKey) {
    // Hay un filtro de conexion que no es un canal: no aplica.
    return 0;
  }

  const config = await prisma.officialApiClientConfig.findFirst({
    where: { workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!config) {
    return 0;
  }

  const normalizedSearchQuery = input.searchQuery.trim();
  // Buscando, el estado no filtra: lo mismo que hace la lista oficial (getOfficialApiChatsData).
  const estadoAplicado = estadoQueAplica(input.statusFilter, normalizedSearchQuery);

  /**
   * Con los filtros nuevos puestos el conteo va por SQL.
   *
   * La ficha del CRM (donde vive la etapa) cuelga del contacto oficial por un id suelto, sin
   * relacion declarada, asi que Prisma no puede llegar hasta ella. Se usan los MISMOS fragmentos
   * que arma la lista: si el contador se escribiera aparte, terminarian diciendo cosas distintas.
   */
  const asesorasPedidas = input.assignedTo.startsWith("user:")
    ? input.assignedTo.slice("user:".length).split(",")
    : [];

  /*
    El grupo (clientes / equipo / proveedores) tambien va por SQL: la regla vive en los mismos
    fragmentos que la lista. Este camino no aplica el buscador, pero con texto el grupo no filtra
    (grupoQueAplica da "todos") y se sigue por el de Prisma de abajo.
  */
  const aplicaElGrupo = grupoQueAplica(input.filtros, normalizedSearchQuery) !== "todos";
  if (hayFiltrosPuestos(input.filtros) || aplicaElGrupo) {
    const { etapa, sinResponder } = await fragmentosDeFiltrosOficiales(input.filtros, input.workspaceId, undefined, {
      asignacion: input.assignedTo,
      q: normalizedSearchQuery,
    });
    const estado =
      estadoAplicado === "resolved"
        ? Prisma.sql`AND c."status"::text IN ('CLOSED', 'ARCHIVED')`
        : estadoAplicado === "all"
          ? Prisma.empty
          : Prisma.sql`AND c."status"::text IN ('OPEN', 'PENDING')`;
    const asignacion =
      input.assignedTo === "mine"
        ? Prisma.sql`AND c."assignedToUserId" = ${input.userId}`
        : input.assignedTo === "unassigned"
          ? Prisma.sql`AND c."assignedToUserId" IS NULL`
          : asesorasPedidas.length
            ? Prisma.sql`AND c."assignedToUserId" IN (${Prisma.join(asesorasPedidas)})`
            : Prisma.empty;

    const filas = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS "total"
      FROM "OfficialApiConversation" c
      WHERE c."configId" = ${config.id}
        ${estado}
        ${asignacion}
        ${etapa}
        ${sinResponder}
    `;
    return Number(filas[0]?.total ?? 0);
  }

  return prisma.officialApiConversation.count({
    where: {
      configId: config.id,
      ...(estadoAplicado === "resolved"
        ? { status: { in: ["CLOSED", "ARCHIVED"] } }
        : estadoAplicado === "all"
          ? {}
          : { status: { in: ["OPEN", "PENDING"] } }),
      ...(input.assignedTo === "mine"
        ? { assignedToUserId: input.userId }
        : input.assignedTo === "unassigned"
          ? { assignedToUserId: null }
          : asesorasPedidas.length
            ? { assignedToUserId: { in: asesorasPedidas } }
            : {}),
      ...whereDeBusquedaDeChatsOficiales(normalizedSearchQuery),
    },
  });
}

/**
 * "Esperando respuesta" de lo que ve esta persona (ver features/chats/services/espera-de-chats.ts).
 *
 * La lista de todo el negocio sale de la memoria (un minuto) y aca solo se recorta. Respeta la
 * linea elegida -la oficial entra solo si esa conexion la admite, igual que
 * countOfficialConversations- y no mira ni el buscador ni las condiciones de la bandeja.
 *
 * Si falla devuelve null: el error queda en el log y los contadores responden igual.
 */
async function calcularEspera(input: {
  workspaceId: string;
  conexionElegida: string;
  quien: Omit<QuienMira, "canalElegido" | "incluirOficial">;
}): Promise<EsperaDeChats | null> {
  try {
    const canalElegido = input.conexionElegida.startsWith("channel:")
      ? input.conexionElegida.slice("channel:".length)
      : null;
    let incluirOficial = !input.conexionElegida;
    if (canalElegido) {
      const canales = await canalesDelNegocio(input.workspaceId);
      incluirOficial = canales.find((canal) => canal.id === canalElegido)?.provider === "OFFICIAL_API";
    }
    const chats = await esperaDelNegocio(input.workspaceId);
    return esperaParaPersona(chats, { ...input.quien, canalElegido, incluirOficial });
  } catch (error) {
    console.error("[chats/counts] no se pudo calcular la espera", error);
    return null;
  }
}

export const GET = conServerTiming(manejarGet, { log: "chats/counts" });

async function manejarGet(request: Request, t: MedidorServerTiming) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  // Una sola lectura de acceso por pedido, y de la cache del proceso (45 s, se vacia sola al
  // cambiar usuarios, miembros o negocios: ver cache-de-permisos.ts).
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const userId = session.user.id;
  const clave = claveDeContadores({
    workspaceId: access.workspaceId,
    userId,
    busqueda: new URL(request.url).search,
  });
  let calculado = false;
  const cuerpo = await cacheDeContadores.obtener(clave, async () => {
    calculado = true;
    const respuesta = await calcularContadores(request, t, { userId }, access);
    // Solo se guardan las respuestas buenas.
    if (!respuesta.ok) throw new RespuestaNoGuardable(respuesta);
    return respuesta.json();
  }).catch((error: unknown) => {
    if (error instanceof RespuestaNoGuardable) return error.respuesta;
    throw error;
  });
  if (cuerpo instanceof Response) return cuerpo;
  if (!calculado) t.marca("memoria");
  return NextResponse.json(cuerpo);
}

class RespuestaNoGuardable extends Error {
  constructor(readonly respuesta: Response) {
    super("respuesta no guardable");
  }
}

async function calcularContadores(
  request: Request,
  t: MedidorServerTiming,
  session: { userId: string },
  access: NonNullable<Awaited<ReturnType<typeof getClientWorkspaceAccessForUserCached>>>,
): Promise<Response> {

  /*
    Antes aca se volvia a leer la membresia con getPrimaryWorkspaceForUser: la MISMA que ya trae
    `access` (la primera activa por fecha de alta), mas los conteos de agentes, canales y TODAS
    las conversaciones del negocio, que esta ruta no usa. Eran 2-5 consultas mas por pedido.
  */
  const membership = { role: access.membershipRole, workspace: { id: access.workspaceId } };
  t.marca("auth");

  const requestUrl = new URL(request.url);
  const searchQuery = requestUrl.searchParams.get("q")?.trim() || "";
  const selectedConnectionKey = requestUrl.searchParams.get("connection")?.trim() || "";
  // Mismo default que la lista y la pantalla: solo abiertas.
  const requestedStatusRaw = requestUrl.searchParams.get("status")?.trim() || "";
  const statusFilter: ChatsStatusFilter =
    requestedStatusRaw === "all" || requestedStatusRaw === "resolved" ? requestedStatusRaw : "open";

  /*
    Quien ve TODAS las conversaciones de sus lineas: dueño, administrador o supervisora.

    Aca faltaba la supervisora (estaba en la pagina y en /list, no en los contadores): a Maria, ya
    supervisora, la pestaña "Todas" le contaba como a una asesora -sus 35 chats mas 3- en vez de los
    ~830 abiertos de Ventas 1 y 2 (Alex, 03-10-2026). Que LINEAS ve sigue siendo otra cosa: eso lo
    decide `esJefe` (solo dueño y administrador ven todas las lineas).
  */
  const esJefe = membership.role === "OWNER" || membership.role === "ADMIN";

  /*
    Estas cuatro lecturas no dependen una de otra: van a la vez (antes, una tras otra).
    `canalesQueMonitorea` corre aunque sea supervisora (sale de la cache de canales); para quien
    supervisa se ignora igual que antes.
  */
  const [esLaSupervisora, snoozedRows, visibleChannelIds, lineasQueMonitorea] = await Promise.all([
    esJefe ? false : esSupervisora(membership.workspace.id, session.userId),
    /**
     * Los contactos con el lead pospuesto, para descontarlos.
     *
     * Va con SQL directo porque la fecha vive dentro de metadata: como es un texto ISO, compararlo
     * con el ahora funciona tal cual. Son pocos, asi que la lista de ids es corta.
     */
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Contact"
      WHERE "workspaceId" = ${membership.workspace.id}
        AND ("metadata"->>'snoozedUntil') > ${new Date().toISOString()}
    `,
    getVisibleChannelIds({
      workspaceId: membership.workspace.id,
      userId: session.userId,
      esJefe,
    }),
    esJefe ? ([] as string[]) : canalesQueMonitorea({ workspaceId: membership.workspace.id, userId: session.userId }),
  ]);
  const isManager = esJefe || esLaSupervisora;
  /*
    La monitora ve "Todas" y "Sin asignar" de SUS lineas (Alex, 30-09-2026): los numeros de las
    pestañas tienen que contar eso mismo, no sus chats propios -que no tiene-.
  */
  const monitoreados = isManager ? [] : lineasQueMonitorea;
  t.marca("permisos");

  /*
    De quien cuentan "No leido" y "Sin responder": de la asignacion puesta en la bandeja
    (Todas, Mias, Sin asignar o una asesora), igual que la lista con esa pastilla encendida.
    Antes los jefes contaban siempre todo y, con Mias puesta, el numero no coincidia con la lista.
    Sin `assigned` (pestaña vieja) cuenta todo, como antes. Todas, Mias y Sin asignar no cambian.
  */
  const alcance = alcanceDeLasPastillas(
    requestUrl.searchParams.get("assigned"),
    isManager ? { tipo: "jefe" } : monitoreados.length > 0 ? { tipo: "monitora", lineas: monitoreados } : { tipo: "asesora" },
  );
  const alcanceDePastillas = whereDelAlcance(alcance, session.userId);
  const asignacionDeLasPastillas: string = alcance.asignacion;

  /**
   * El contador tiene que contar lo mismo que muestra la lista, incluida la conexion elegida: si
   * la lista descarta una conexion que no es de este negocio, el numero de al lado tambien.
   */
  const conexionElegida = await resolverConexionElegida({
    workspaceId: membership.workspace.id,
    connectionKey: selectedConnectionKey,
    visibleChannelIds,
  });

  /*
    Las pastillas son fijas: no cambian segun el grupo que se este mirando. Por eso el `grupo` de
    la direccion se ignora y Todas, Mias y Sin asignar cuentan con GRUPO_POR_DEFECTO. Equipo y
    Proveedores tienen sus propios numeros (mas abajo).
  */
  const leidos = leerFiltrosDeBandeja((clave) => requestUrl.searchParams.get(clave));
  const filtros: FiltrosDeBandeja = { condiciones: leidos.condiciones, grupo: GRUPO_POR_DEFECTO };
  const conGrupo = (grupo: GrupoDeBandeja): FiltrosDeBandeja => ({ ...filtros, grupo });
  // Con texto en el buscador ningun grupo filtra: Equipo y Proveedores valen 0 sin consultar.
  const grupoDeLasPastillas = grupoQueAplica(filtros, searchQuery);
  const cuentaLosGrupos = !hayBusqueda(searchQuery);
  const quienPideIds = {
    workspaceId: membership.workspace.id,
    visibleChannelIds,
    channelId: conexionElegida.startsWith("channel:") ? conexionElegida.slice("channel:".length) : null,
  };

  /*
    Lo que ve cada persona: la monitora, sus lineas; la asesora, solo sus chats (principal o
    segunda); dueño, administrador y supervisora, las lineas que tienen visibles.
  */
  const quienEspera =
    monitoreados.length > 0
      ? {
          userId: session.userId,
          canales: visibleChannelIds
            ? monitoreados.filter((id) => visibleChannelIds.includes(id))
            : monitoreados,
          soloMios: false,
        }
      : { userId: session.userId, canales: visibleChannelIds, soloMios: !isManager };

  /*
    Los numeros de las pastillas "Sin responder" y "No leido": cuentan con las MISMAS reglas que la
    lista cuando esa pastilla se enciende, sobre lo que ya hay puesto. Se arman igual que los otros
    numeros, con su condicion sumada (`sin_responder:si` o `no_leido:si`), en las DOS fuentes: el
    canal viejo (ids de su SQL, con cache) y la linea oficial (su fragmento en el mismo conteo).
    Si uno falla, el resto de los contadores responde igual y esa pastilla va sin numero.
  */
  const conLaCondicion = async (
    condicion: CondicionDeBandeja,
    nombre: string,
  ): Promise<{ where: Prisma.ConversationWhereInput; oficial: number } | null> => {
    const filtrosConLa: FiltrosDeBandeja = {
      ...filtros,
      condiciones: [...filtros.condiciones.filter((otra) => otra.campo !== condicion.campo), condicion],
    };
    try {
      const [ids, oficial] = await Promise.all([
        idsParaLosFiltros(filtrosConLa, quienPideIds),
        countOfficialConversations({
          workspaceId: membership.workspace.id,
          searchQuery,
          selectedConnectionKey: conexionElegida,
          userId: session.userId,
          // La misma asignacion que el canal viejo (alcanceDePastillas), tambien en la linea oficial.
          assignedTo: alcance.asignacion,
          statusFilter,
          filtros: filtrosConLa,
        }),
      ]);
      return {
        where: buildBaseWhere({
          workspaceId: membership.workspace.id,
          searchQuery,
          selectedConnectionKey: conexionElegida,
          statusFilter,
          snoozedContactIds: snoozedRows.map((fila) => fila.id),
          visibleChannelIds,
          filtros: filtrosConLa,
          ids,
        }),
        oficial,
      };
    } catch (error) {
      console.error(`[chats/counts] no se pudo contar ${nombre}`, error);
      return null;
    }
  };

  /*
    Los ids de los filtros, los tres numeros de la linea oficial, la espera y las dos pastillas no
    dependen uno de otro: van a la vez (antes eran cinco esperas seguidas). Los ids que se piden
    dos veces (por ejemplo Sin responder puesto y su pastilla) los comparte la memoria corta.
  */
  // Los contactos internos (memoria de un minuto), solo si algun numero los necesita. Arrancan ya,
  // a la vez que lo de abajo; si fallan, Equipo y Proveedores van sin numero y el resto responde igual.
  const internosPendientes: Promise<ContactosInternos | null> =
    cuentaLosGrupos || grupoDeLasPastillas !== "todos"
      ? contactosInternos(membership.workspace.id).catch((error) => {
          console.error("[chats/counts] no se pudieron leer los contactos internos", error);
          return null;
        })
      : Promise.resolve(null);
  const [idsDeLosFiltros, officialMine, officialUnassigned, officialAll, espera, conSinResponder, conNoLeido] = await Promise.all([
    idsParaLosFiltros(filtros, quienPideIds),
    countOfficialConversations({
      workspaceId: membership.workspace.id,
      searchQuery,
      selectedConnectionKey: conexionElegida,
      userId: session.userId,
      assignedTo: "mine",
      statusFilter,
      filtros,
    }),
    countOfficialConversations({
      workspaceId: membership.workspace.id,
      searchQuery,
      selectedConnectionKey: conexionElegida,
      userId: session.userId,
      assignedTo: "unassigned",
      statusFilter,
      filtros,
    }),
    countOfficialConversations({
      workspaceId: membership.workspace.id,
      searchQuery,
      selectedConnectionKey: conexionElegida,
      userId: session.userId,
      assignedTo: "all",
      statusFilter,
      filtros,
    }),
    calcularEspera({ workspaceId: membership.workspace.id, conexionElegida, quien: quienEspera }),
    conLaCondicion({ campo: "sin_responder", operador: "si" }, "los sin responder"),
    conLaCondicion({ campo: "no_leido", operador: "si" }, "los no leidos"),
  ]);
  t.marca("filtros_oficial_espera");
  const internos = await internosPendientes;

  const baseWhere = buildBaseWhere({
    workspaceId: membership.workspace.id,
    searchQuery,
    selectedConnectionKey: conexionElegida,
    statusFilter,
    snoozedContactIds: snoozedRows.map((fila) => fila.id),
    visibleChannelIds,
    filtros,
    ids: idsDeLosFiltros,
  });

  /** El grupo por defecto (clientes) con su asignacion: Todas, Mias y Sin asignar no cuentan internos. */
  const delGrupo = (asignacion: string): Prisma.ConversationWhereInput =>
    whereDeGrupo({ grupo: grupoDeLasPastillas, internos, asignacion, filtros });

  /**
   * Los numeros de Equipo y Proveedores: lo mismo que trae la lista con `grupo=equipo` o
   * `grupo=proveedores`, en las DOS fuentes, dentro de `dentro` (lo que ve esta persona). Con texto
   * en el buscador, o sin nadie que pueda entrar en el grupo, valen 0 sin consultar.
   */
  const contarGrupo = async (
    grupo: "equipo" | "proveedores",
    dentro: Prisma.ConversationWhereInput,
    asignacionOficial: "mine" | "all",
  ): Promise<number | undefined> => {
    if (!cuentaLosGrupos) return 0;
    if (!internos) return undefined;
    const ids = grupo === "equipo" ? internos.equipoIds : internos.proveedorIds;
    // La linea oficial reconoce al equipo tambien por el numero (ver sqlDelGrupoOficial).
    const telefonos = grupo === "equipo" ? internos.variantesDeTelefono : [];
    if (!ids.length && !telefonos.length) return 0;
    const filtrosDelGrupo = conGrupo(grupo);
    const [viejo, oficial] = await Promise.all([
      ids.length
        ? prisma.conversation.count({
            where: { AND: [dentro, whereDeGrupo({ grupo, internos, asignacion: asignacionOficial, filtros: filtrosDelGrupo })] },
          })
        : 0,
      countOfficialConversations({
        workspaceId: membership.workspace.id,
        searchQuery,
        selectedConnectionKey: conexionElegida,
        userId: session.userId,
        assignedTo: asignacionOficial,
        statusFilter,
        filtros: filtrosDelGrupo,
      }),
    ]);
    return viejo + oficial;
  };

  /** El numero de una de esas pastillas dentro de lo que ve esta persona (`alcance`). */
  const contarPastilla = async (
    cuenta: { where: Prisma.ConversationWhereInput; oficial: number } | null,
    alcance: Prisma.ConversationWhereInput,
  ): Promise<number | undefined> =>
    cuenta
      ? (await prisma.conversation.count({ where: { AND: [cuenta.where, alcance, delGrupo(asignacionDeLasPastillas)] } })) +
        cuenta.oficial
      : undefined;

  if (monitoreados.length > 0) {
    const deSusLineas: Prisma.ConversationWhereInput = { AND: [baseWhere, { channelId: { in: monitoreados } }] };
    const [mine, unassigned, all, equipo, proveedores] = await Promise.all([
      prisma.conversation.count({ where: { AND: [deSusLineas, whereEsMio(session.userId), delGrupo("mine")] } }),
      prisma.conversation.count({ where: { AND: [deSusLineas, { assignedToUserId: null }, delGrupo("unassigned")] } }),
      prisma.conversation.count({ where: { AND: [deSusLineas, delGrupo("all")] } }),
      contarGrupo("equipo", deSusLineas, "all"),
      contarGrupo("proveedores", deSusLineas, "all"),
    ]);
    const [sinResponder, noLeido] = await Promise.all([
      // Siempre dentro de sus lineas (alcance.lineas), con la asignacion puesta.
      contarPastilla(conSinResponder, alcanceDePastillas),
      contarPastilla(conNoLeido, alcanceDePastillas),
    ]);
    return NextResponse.json({
      ok: true,
      isManager,
      counts: {
        mine: mine + officialMine,
        unassigned: unassigned + officialUnassigned,
        all: all + officialAll,
        sinResponder,
        noLeido,
        equipo,
        proveedores,
      },
      espera,
    });
  }

  // Los empleados solo cuentan sus chats asignados.
  if (!isManager) {
    const soloLosSuyos: Prisma.ConversationWhereInput = { AND: [baseWhere, whereEsMio(session.userId)] };
    const [mine, equipo, proveedores] = await Promise.all([
      prisma.conversation.count({ where: { AND: [soloLosSuyos, delGrupo("mine")] } }),
      // La asesora solo cuenta lo suyo, tambien en Equipo y Proveedores.
      contarGrupo("equipo", soloLosSuyos, "mine"),
      contarGrupo("proveedores", soloLosSuyos, "mine"),
    ]);

    const [sinResponder, noLeido] = await Promise.all([
      // A la asesora el alcance siempre le da los suyos (whereEsMio).
      contarPastilla(conSinResponder, alcanceDePastillas),
      contarPastilla(conNoLeido, alcanceDePastillas),
    ]);
    return NextResponse.json({
      ok: true,
      isManager,
      counts: {
        mine: mine + officialMine,
        unassigned: 0,
        all: mine + officialAll,
        sinResponder,
        noLeido,
        equipo,
        proveedores,
      },
      espera,
    });
  }

  const [mine, unassigned, all, equipo, proveedores] = await Promise.all([
    prisma.conversation.count({ where: { AND: [baseWhere, whereEsMio(session.userId), delGrupo("mine")] } }),
    prisma.conversation.count({ where: { AND: [baseWhere, { assignedToUserId: null }, delGrupo("unassigned")] } }),
    prisma.conversation.count({ where: { AND: [baseWhere, delGrupo("all")] } }),
    contarGrupo("equipo", baseWhere, "all"),
    contarGrupo("proveedores", baseWhere, "all"),
  ]);

  const [sinResponder, noLeido] = await Promise.all([
    contarPastilla(conSinResponder, alcanceDePastillas),
    contarPastilla(conNoLeido, alcanceDePastillas),
  ]);
  return NextResponse.json({
    ok: true,
    isManager,
    counts: {
      mine: mine + officialMine,
      unassigned: unassigned + officialUnassigned,
      all: all + officialAll,
      sinResponder,
      noLeido,
      equipo,
      proveedores,
    },
    espera,
  });
}

/** El `where` del canal viejo para el alcance de "No leido" y "Sin responder". */
function whereDelAlcance(alcance: AlcanceDeLasPastillas, userId: string): Prisma.ConversationWhereInput {
  const deQuien: Prisma.ConversationWhereInput =
    alcance.quienes.tipo === "mios"
      ? whereEsMio(userId)
      : alcance.quienes.tipo === "sin_asesora"
        ? { assignedToUserId: null }
        : alcance.quienes.tipo === "asesoras"
          ? { assignedToUserId: { in: alcance.quienes.ids } }
          : {};
  return alcance.lineas ? { AND: [{ channelId: { in: alcance.lineas } }, deQuien] } : deQuien;
}
