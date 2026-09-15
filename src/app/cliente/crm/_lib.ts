import { redirect } from "next/navigation";
import { getCrmData, getCrmKanbanData } from "@/features/crm";
import { leerColaboradores, leerMonitores } from "@/lib/channel-collaborators";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { canalesQueMonitorea } from "@/lib/modo-monitoreo";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

export type AsesoraDelFiltro = { id: string; nombre: string };

/**
 * Quien esta mirando el CRM y de quien.
 *
 * Una asesora ve SOLO lo suyo y no puede cambiarlo: los numeros globales no le dicen nada sobre
 * su propio trabajo, y de paso le mostraban las ventas de las compañeras.
 *
 * El jefe ve todo por defecto y puede elegir una asesora con `?userId=`. Ese id se valida contra
 * los miembros del negocio: sin eso alcanzaria con cambiarlo en la direccion para ver los datos
 * de otra empresa.
 */
async function resolverMirada(pedido: string) {
  const access = await requireClientWorkspaceAccess("crm");
  // Dueño, administradores y supervisoras eligen asesora y ven todo (ver permisos-del-equipo.ts).
  const esJefe = await puedeSupervisar(access);

  /*
    La monitora no es jefa, pero tampoco una asesora: a ella nunca se le asigna un lead (el
    reparto la saltea), asi que "solo lo suyo" le dejaba el Registro vacio y sin selector. Ve lo
    del canal que monitorea, con el mismo selector que el jefe y los numeros tapados.
  */
  const canalesMonitoreados = esJefe
    ? []
    : await canalesQueMonitorea({ workspaceId: access.workspaceId, userId: access.userId });
  const esMonitora = canalesMonitoreados.length > 0;

  if (!esJefe && !esMonitora) {
    return {
      access,
      esJefe,
      esMonitora,
      canalIds: null,
      verComoUserId: access.userId,
      asesoras: [] as AsesoraDelFiltro[],
    };
  }

  const miembros = await prisma.workspaceMember.findMany({
    where: { workspaceId: access.workspaceId, isActive: true },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });

  // Para la monitora, solo quienes trabajan esos canales (lista vacia = todo el equipo) y sin
  // las otras monitoras: no tienen leads, elegirlas siempre daria vacio.
  const delCanal = esMonitora ? await quienesTrabajanLosCanales(canalesMonitoreados) : null;

  const asesoras: AsesoraDelFiltro[] = miembros
    .filter((miembro) => !delCanal || delCanal(miembro.userId))
    .map((miembro) => ({
      id: miembro.userId,
      nombre: miembro.user?.name?.trim() || miembro.user?.email || "Sin nombre",
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Vacio = todo el equipo. Un id que no sea del negocio se ignora y se cae a "todo".
  const elegida = pedido && asesoras.some((asesora) => asesora.id === pedido) ? pedido : null;

  return {
    access,
    esJefe,
    esMonitora,
    canalIds: esMonitora ? canalesMonitoreados : null,
    verComoUserId: elegida,
    asesoras,
  };
}

async function quienesTrabajanLosCanales(canalIds: string[]) {
  const canales = await prisma.whatsAppChannel.findMany({
    where: { id: { in: canalIds } },
    select: { metadata: true },
  });

  const monitoras = new Set(canales.flatMap((canal) => leerMonitores(canal.metadata)));
  const colaboradores = canales.map((canal) => leerColaboradores(canal.metadata));
  const abierto = colaboradores.some((lista) => lista.length === 0);
  const trabajan = new Set(colaboradores.flat());

  return (userId: string) => !monitoras.has(userId) && (abierto || trabajan.has(userId));
}

export async function getAuthorizedCrmData(pedido = "") {
  const { access, esJefe, esMonitora, canalIds, verComoUserId, asesoras } = await resolverMirada(pedido);
  const eligeAsesora = esJefe || esMonitora;

  const data = await getCrmData({
    workspaceId: access.workspaceId,
    workspaceName: access.workspaceName,
    assignedToUserId: verComoUserId,
    channelIds: canalIds,
    enmascararTelefonos: esMonitora,
  });

  if (!data) {
    redirect("/cliente");
  }

  return {
    ...data,
    esInformePersonal: !eligeAsesora,
    soloLectura: esMonitora,
    // El selector es del jefe y de la monitora: la asesora no elige, ve lo suyo.
    asesoras: eligeAsesora ? asesoras : [],
    asesoraElegida: eligeAsesora ? (verComoUserId ?? "") : "",
  };
}

export async function getAuthorizedCrmKanbanData(pedido = "") {
  const { access, esJefe, esMonitora, canalIds, verComoUserId, asesoras } = await resolverMirada(pedido);
  const eligeAsesora = esJefe || esMonitora;

  const data = await getCrmKanbanData({
    workspaceId: access.workspaceId,
    workspaceName: access.workspaceName,
    assignedToUserId: verComoUserId,
    channelIds: canalIds,
    enmascararTelefonos: esMonitora,
  });

  if (!data) {
    redirect("/cliente");
  }

  return {
    ...data,
    soloLectura: esMonitora,
    asesoras: eligeAsesora ? asesoras : [],
    asesoraElegida: eligeAsesora ? (verComoUserId ?? "") : "",
  };
}
