import { leerEstado } from "@/features/agente-v3/motor/estado";
import {
  leerConfigDeAvisos,
  normalizarNumeroDeAviso,
  numeroDeAvisosDe,
} from "@/features/agente-v3/servicios/avisos";
import {
  armarAvisoParaElLider,
  decidirMarca,
  HORAS_DE_VIDA_DE_LA_MARCA,
  mensajeDeCierre,
  TITULO_PARA_EL_LIDER,
  type EstadoDeLaMarca,
} from "@/features/listo-para-pagar/dominio/senal";
import { enHorario } from "@/features/supervisor/dominio/detectores-atencion";
import { decidirViaDeAvisos } from "@/lib/anti-bloqueo/reglas";
import { leerConfigAntiBloqueo } from "@/lib/anti-bloqueo/servicio";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { resolverLiderDeVentas } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";
import { ORIGENES_HUMANOS } from "@/lib/turno-de-la-conversacion";
import { sendPushToUser } from "@/lib/web-push";

/**
 * El mensaje de cierre con el 50 % del producto que el cliente está mirando (el `productoActivo`
 * del estado del V3). Si no hay producto o algo falla, sale el mensaje sin cifra. Nunca lanza.
 */
export async function leerMensajeDeCierre(workspaceId: string, conversationId: string): Promise<string> {
  try {
    const estado = await leerEstado(conversationId);
    if (!estado.productoActivo) {
      return mensajeDeCierre(null);
    }
    const producto = await prisma.product.findFirst({
      where: { id: estado.productoActivo, workspaceId },
      select: { price: true },
    });
    return mensajeDeCierre(producto ? Number(producto.price) : null);
  } catch {
    return mensajeDeCierre(null);
  }
}

/* ------------------------------------------------------------------------------------------------
   PARTE 3: si nadie del equipo le escribe al cliente en 5 minutos (en horario), el aviso le llega al
   líder de ventas. Cada aviso "Listo para pagar" deja una marca en su propia fila; el reloj
   (cron/follows, cada minuto) la revisa y decide con `decidirMarca`.
------------------------------------------------------------------------------------------------ */

const PREFIJO_DE_LA_MARCA = "listo-para-pagar:";
/** Máximo de avisos al líder por vuelta: al abrir el horario no sale una ráfaga. */
const MAXIMO_DE_ESCALADOS_POR_VUELTA = 5;

type MarcaListoParaPagar = {
  workspaceId: string;
  conversationId: string;
  asesoraId: string | null;
  avisadoEn: string;
  estado: EstadoDeLaMarca;
};

function leerMarca(valor: string | null | undefined): MarcaListoParaPagar | null {
  if (!valor) {
    return null;
  }
  try {
    const marca = JSON.parse(valor) as Partial<MarcaListoParaPagar>;
    if (
      typeof marca.workspaceId !== "string" ||
      typeof marca.conversationId !== "string" ||
      typeof marca.avisadoEn !== "string" ||
      typeof marca.estado !== "string" ||
      Number.isNaN(Date.parse(marca.avisadoEn))
    ) {
      return null;
    }
    return {
      workspaceId: marca.workspaceId,
      conversationId: marca.conversationId,
      asesoraId: typeof marca.asesoraId === "string" ? marca.asesoraId : null,
      avisadoEn: marca.avisadoEn,
      estado: marca.estado,
    };
  } catch {
    return null;
  }
}

/**
 * Deja la marca "pendiente" de un aviso "Listo para pagar". No pisa una marca "pendiente" ni una
 * "escalado" de menos de 24 h: así una repetición no reinicia el reloj ni le vuelve a avisar al líder.
 */
export async function guardarMarcaListoParaPagar(input: {
  workspaceId: string;
  conversationId: string;
  asesoraId: string | null;
  ahora?: Date;
}): Promise<void> {
  const ahora = input.ahora ?? new Date();
  const key = `${PREFIJO_DE_LA_MARCA}${input.conversationId}`;
  const previa = leerMarca((await prisma.appSetting.findUnique({ where: { key } }))?.value);
  if (
    previa &&
    (previa.estado === "pendiente" || previa.estado === "escalado") &&
    ahora.getTime() - Date.parse(previa.avisadoEn) < HORAS_DE_VIDA_DE_LA_MARCA * 60 * 60_000
  ) {
    return;
  }
  const value = JSON.stringify({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    asesoraId: input.asesoraId,
    avisadoEn: ahora.toISOString(),
    estado: "pendiente",
  } satisfies MarcaListoParaPagar);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/**
 * Cambia el estado de la marca solo si la fila sigue como se leyó. Devuelve true si la cambió: si otra
 * vuelta del reloj ya la tocó, no se cambia ni se manda nada dos veces.
 */
async function cambiarEstado(key: string, valorLeido: string, marca: MarcaListoParaPagar, estado: EstadoDeLaMarca) {
  const { count } = await prisma.appSetting.updateMany({
    where: { key, value: valorLeido },
    data: { value: JSON.stringify({ ...marca, estado }) },
  });
  return count === 1;
}

/** ¿Alguien del equipo (desde el CRM o desde el teléfono) le escribió al cliente después del aviso? */
async function huboRespuestaHumana(conversationId: string, desde: Date): Promise<boolean> {
  const mensaje = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "OUTBOUND",
      type: { not: "SYSTEM" },
      createdAt: { gt: desde },
      OR: ORIGENES_HUMANOS.map((origen) => ({ rawPayload: { path: ["source"], equals: origen } })),
    },
    select: { id: true },
  });
  return Boolean(mensaje);
}

/** Le manda el aviso al líder de ventas: push siempre, y WhatsApp por la línea interna si se puede. */
async function avisarAlLider(marca: MarcaListoParaPagar, liderId: string): Promise<void> {
  const conversacion = await prisma.conversation.findUnique({
    where: { id: marca.conversationId },
    select: { numero: true, contact: { select: { name: true, phoneNumber: true } } },
  });
  const cliente = conversacion?.contact?.name?.trim() || conversacion?.contact?.phoneNumber || "Cliente";
  const asesora = marca.asesoraId
    ? await prisma.user
        .findUnique({ where: { id: marca.asesoraId }, select: { name: true, email: true } })
        .catch(() => null)
    : null;
  const nombreDeLaAsesora = asesora?.name?.trim() || asesora?.email || null;
  // Link corto con el número del chat, como en los avisos de avisos.ts.
  const enlace = conversacion?.numero
    ? `https://app.aizenbot.com/c/${conversacion.numero}`
    : `https://app.aizenbot.com/cliente/chats?chatKey=agent:${marca.conversationId}&assigned=all`;
  const cierre = await leerMensajeDeCierre(marca.workspaceId, marca.conversationId);

  await sendPushToUser({
    userId: liderId,
    payload: {
      title: TITULO_PARA_EL_LIDER,
      body: [`${cliente}: ${cierre}`, `Asignado a: ${nombreDeLaAsesora ?? "nadie todavía"}`].join("\n").slice(0, 300),
      tag: `listo-para-pagar:${marca.conversationId}`,
      url: `/cliente/chats?chatKey=agent:${marca.conversationId}&assigned=all`,
    },
  }).catch(() => 0);

  // WhatsApp: solo por la línea interna (nunca por la de ventas) y solo si el líder tiene número.
  const [config, antiBloqueo] = await Promise.all([
    leerConfigDeAvisos(marca.workspaceId).catch(() => null),
    leerConfigAntiBloqueo(marca.workspaceId),
  ]);
  if (antiBloqueo.avisos.via === "push") {
    return;
  }
  const numero = normalizarNumeroDeAviso(numeroDeAvisosDe(config, liderId));
  const via = decidirViaDeAvisos({
    avisos: { via: "linea_interna", canalInternoId: antiBloqueo.avisos.canalInternoId },
    canalDelChat: null,
    canalDeLaConfig: config?.canalId || null,
  });
  if (!numero || via.tipo !== "whatsapp" || via.canales.length === 0) {
    return;
  }
  const linea = await prisma.whatsAppChannel.findFirst({
    where: { id: via.canales[0], workspaceId: marca.workspaceId },
    select: { evolutionInstanceName: true },
  });
  if (!linea?.evolutionInstanceName) {
    return;
  }
  await sendEvolutionTextMessageWithReconnect({
    instanceName: linea.evolutionInstanceName,
    phoneNumber: numero,
    text: armarAvisoParaElLider({ cliente, asesora: nombreDeLaAsesora, enlace, cierre }),
  });
}

/**
 * La vuelta del reloj: revisa las marcas pendientes y escala al líder las que llevan 5 minutos sin
 * respuesta humana en horario. Máximo 5 escalados por vuelta; el resto queda para la siguiente.
 */
export async function revisarListoParaPagar(ahora: Date = new Date()): Promise<{ revisadas: number; escaladas: number }> {
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: PREFIJO_DE_LA_MARCA }, value: { contains: '"estado":"pendiente"' } },
    orderBy: { updatedAt: "asc" },
    select: { key: true, value: true },
  });
  const horario = enHorario(ahora);
  let escaladas = 0;

  for (const fila of filas) {
    try {
      const marca = leerMarca(fila.value);
      if (!marca) {
        continue;
      }
      const avisadoEn = new Date(marca.avisadoEn);
      const decision = decidirMarca({
        estado: marca.estado,
        avisadoEn,
        ahora,
        huboRespuestaHumana: await huboRespuestaHumana(marca.conversationId, avisadoEn),
        enHorario: horario,
      });
      if (decision === "atendido") {
        await cambiarEstado(fila.key, fila.value, marca, "atendido");
      } else if (decision === "cerrar") {
        await cambiarEstado(fila.key, fila.value, marca, "cerrado");
      } else if (decision === "escalar") {
        if (escaladas >= MAXIMO_DE_ESCALADOS_POR_VUELTA) {
          continue;
        }
        const liderId = await resolverLiderDeVentas(marca.workspaceId);
        if (!liderId) {
          // Sin líder no hay a quién avisar: queda "sin_destino" para no reintentar cada minuto.
          console.warn("[listo-para-pagar] no hay líder de ventas a quien avisar", {
            workspaceId: marca.workspaceId,
            conversationId: marca.conversationId,
          });
          await cambiarEstado(fila.key, fila.value, marca, "sin_destino");
          continue;
        }
        // Primero se guarda "escalado", para que nunca se repita; después se envía.
        if (!(await cambiarEstado(fila.key, fila.value, marca, "escalado"))) {
          continue;
        }
        escaladas += 1;
        await avisarAlLider(marca, liderId);
      }
    } catch (error) {
      console.error("[listo-para-pagar] no se pudo revisar la marca", { key: fila.key, error });
    }
  }

  return { revisadas: filas.length, escaladas };
}
