import { prisma } from "@/lib/prisma";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";
import { sendChatPushToWorkspace } from "@/lib/web-push";
import { quienesNoSeEnteran } from "@/lib/quien-se-entera-del-mensaje";
import { sanitizeClientModuleAccess } from "@/lib/client-workspace-modules";
import { buscarCanalDeLaLineaDeLlamadas, buscarFichaDeLaLlamada } from "@/lib/wacalls";

/**
 * Avisar al equipo que un cliente está llamando (parte 1: el servidor).
 *
 * Cuando WaCalls avisa que una llamada ENTRANTE empieza a sonar, el CRM avisa por dos caminos:
 *
 *  - En vivo (realtime, `type: "llamada-entrante"`): para quien tiene el CRM abierto. Cada navegador
 *    mira la lista `noSeEnteran` y, si su usuario está, no timbra.
 *  - Por notificación al celular (Web Push, `tipo: "llamada"`): para quien lo tiene cerrado.
 *
 * Al terminar (o al contestarse) se manda el mismo `type` con otro `estado`, para que deje de timbrar.
 * Si nadie contestó, la notificación de "Te está llamando" se reemplaza (mismo tag) por "Llamada
 * perdida". No se manda nada a clientes y no se crean fichas: un número sin ficha sale como número.
 *
 * Todo es "best-effort": quien lo llama (el webhook de WaCalls) atrapa los errores, y un aviso que
 * falla nunca impide que la llamada se anote.
 */

export type DatosDeLaLlamada = {
  /** El id de la llamada en WaCalls. Con él se arma el tag `llamada:<id>`. */
  llamadaId: string;
  /** La línea de WaCalls por la que entró. Con ella se encuentra el canal del negocio. */
  sessionId?: string | null;
  /** El teléfono del cliente, ya normalizado (solo dígitos). */
  telefono: string;
  /** WACALLS_WORKSPACE_ID, si está puesto: acota la búsqueda a ese negocio. */
  workspaceFijado?: string | null;
};

type Contexto = {
  workspaceId: string;
  /** El nombre de la ficha; null si el número no tiene ficha. */
  nombre: string | null;
  numero: string;
  foto: string | null;
  conversacionId: string | null;
  href: string;
  noSeEnteran: string[];
};

/** Lo que se muestra del cliente: el nombre de su ficha o, si no tiene, el número. */
function clienteVisible(contexto: Pick<Contexto, "nombre" | "numero">) {
  return contexto.nombre || `+${contexto.numero}`;
}

/**
 * Quién puede ver la llamada: el dueño del negocio, un administrador de la plataforma o quien tiene
 * el módulo "llamadas". Es la misma regla de `canAccessClientModule` (client-workspace-access.ts),
 * leída para todo el equipo de una vez.
 */
export function tienePermisoDeLlamadas(miembro: {
  userId: string;
  role: string;
  moduleAccess: unknown;
  rolDelUsuario: string;
  duenoDelNegocioId: string | null;
}) {
  if (miembro.rolDelUsuario === "ADMIN") {
    return true;
  }
  const esDueno =
    miembro.rolDelUsuario === "CLIENTE" &&
    (miembro.role === "OWNER" || miembro.duenoDelNegocioId === miembro.userId);
  return esDueno || sanitizeClientModuleAccess(miembro.moduleAccess).includes("llamadas");
}

/**
 * Los que NO se enteran de la llamada: los que no se enteran del chat (`quienesNoSeEnteran`, la regla
 * de los mensajes) y, de los que sí, los que no tienen permiso de llamadas.
 */
async function quienesNoSeEnteranDeLaLlamada(input: {
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
}): Promise<string[]> {
  const [delChat, miembros, negocio] = await Promise.all([
    quienesNoSeEnteran(input),
    prisma.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId, isActive: true },
      select: { userId: true, role: true, moduleAccess: true, user: { select: { role: true } } },
    }),
    prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { ownerId: true } }),
  ]);

  const sinPermiso = miembros
    .filter(
      (miembro) =>
        !tienePermisoDeLlamadas({
          userId: miembro.userId,
          role: miembro.role,
          moduleAccess: miembro.moduleAccess,
          rolDelUsuario: miembro.user?.role ?? "",
          duenoDelNegocioId: negocio?.ownerId ?? null,
        }),
    )
    .map((miembro) => miembro.userId);

  return [...new Set([...delChat, ...sinPermiso])];
}

/** El canal, la ficha (si hay) y el chat de la llamada, y quiénes no se enteran. */
async function armarContexto(datos: DatosDeLaLlamada): Promise<Contexto | null> {
  const workspaceFijado = datos.workspaceFijado?.trim() || null;
  const canal = await buscarCanalDeLaLineaDeLlamadas({
    sessionId: datos.sessionId,
    workspaceId: workspaceFijado,
  });

  // Si la línea es de un canal, la ficha se busca SOLO en ese negocio: un mismo teléfono puede estar
  // en dos negocios y la llamada entró por la línea de uno.
  const contacto = await buscarFichaDeLaLlamada({
    telefono: datos.telefono,
    workspaceId: canal?.workspaceId ?? workspaceFijado,
  });

  const workspaceId = canal?.workspaceId ?? contacto?.workspaceId ?? workspaceFijado;
  if (!workspaceId) {
    // Sin negocio no hay a quién avisarle.
    return null;
  }

  /*
    El chat de ese cliente. Primero el de la línea por la que llamó; si no hay, el último que tuvo
    movimiento (como cuando se deja la llamada en el chat al terminar).
  */
  let conversacion: { id: string } | null = null;
  if (contacto) {
    const orden = [{ lastMessageAt: "desc" as const }, { updatedAt: "desc" as const }];
    if (canal) {
      conversacion = await prisma.conversation.findFirst({
        where: { workspaceId, contactId: contacto.id, channelId: canal.id },
        orderBy: orden,
        select: { id: true },
      });
    }
    conversacion ??= await prisma.conversation.findFirst({
      where: { workspaceId, contactId: contacto.id },
      orderBy: orden,
      select: { id: true },
    });
  }

  const llamada = encodeURIComponent(datos.llamadaId);
  const href = conversacion
    ? `/cliente/chats?chatKey=agent:${conversacion.id}&assigned=all&llamada=${llamada}`
    : `/cliente/chats?llamada=${llamada}`;

  const noSeEnteran = await quienesNoSeEnteranDeLaLlamada({
    workspaceId,
    channelId: canal?.id ?? null,
    conversationId: conversacion?.id ?? null,
  });

  return {
    workspaceId,
    nombre: contacto?.name?.trim() || null,
    numero: datos.telefono,
    foto: contacto?.avatarUrl?.trim() || null,
    conversacionId: conversacion?.id ?? null,
    href,
    noSeEnteran,
  };
}

function avisoEnVivo(
  contexto: Contexto,
  llamadaId: string,
  estado: "sonando" | "terminada" | "contestada",
) {
  return notifyRealtimeUpdate({
    workspaceId: contexto.workspaceId,
    conversationId: contexto.conversacionId,
    type: "llamada-entrante",
    data: {
      estado,
      llamadaId,
      nombre: contexto.nombre,
      numero: contexto.numero,
      foto: contexto.foto,
      conversacionId: contexto.conversacionId,
      href: contexto.href,
      noSeEnteran: contexto.noSeEnteran,
    },
  });
}

/** Una llamada entrante empezó a sonar: aviso en vivo y notificación al celular. */
export async function avisarLlamadaEntrante(datos: DatosDeLaLlamada): Promise<void> {
  const contexto = await armarContexto(datos);
  if (!contexto) {
    console.info(`[wacalls] llamada entrante de ${datos.telefono}: no se encontró el negocio`);
    return;
  }

  const cliente = clienteVisible(contexto);
  await Promise.all([
    avisoEnVivo(contexto, datos.llamadaId, "sonando"),
    sendChatPushToWorkspace({
      workspaceId: contexto.workspaceId,
      excludeUserIds: contexto.noSeEnteran,
      payload: {
        tipo: "llamada",
        estado: "sonando",
        llamadaId: datos.llamadaId,
        cliente,
        title: `Te está llamando ${cliente}`,
        body: "Llamada de WhatsApp. Toca para abrir el chat.",
        tag: `llamada:${datos.llamadaId}`,
        url: contexto.href,
        ...(contexto.foto ? { icon: contexto.foto } : {}),
        requireInteraction: true,
      },
    }),
  ]);
}

/**
 * La llamada entrante dejó de sonar: porque terminó o porque alguien contestó.
 *
 * El aviso en vivo sale siempre, para que deje de timbrar en las pantallas abiertas. La notificación
 * al celular solo sale si nadie contestó: reemplaza la de "Te está llamando" (mismo tag) por
 * "Llamada perdida". En iPhone todo push tiene que mostrarse (si no, Safari termina dando de baja la
 * suscripción), por eso cuando sí se habló no se manda un push vacío para borrarla.
 */
export async function avisarFinDeLlamada(
  datos: DatosDeLaLlamada & { estado: "terminada" | "contestada"; huboContacto: boolean },
): Promise<void> {
  const contexto = await armarContexto(datos);
  if (!contexto) {
    return;
  }

  const avisos: Promise<unknown>[] = [avisoEnVivo(contexto, datos.llamadaId, datos.estado)];
  if (datos.estado === "terminada" && !datos.huboContacto) {
    const cliente = clienteVisible(contexto);
    avisos.push(
      sendChatPushToWorkspace({
        workspaceId: contexto.workspaceId,
        excludeUserIds: contexto.noSeEnteran,
        payload: {
          tipo: "llamada",
          estado: "perdida",
          llamadaId: datos.llamadaId,
          cliente,
          title: `Llamada perdida de ${cliente}`,
          body: "Toca para abrir el chat.",
          tag: `llamada:${datos.llamadaId}`,
          url: contexto.href,
          ...(contexto.foto ? { icon: contexto.foto } : {}),
          requireInteraction: false,
        },
      }),
    );
  }
  await Promise.all(avisos);
}
