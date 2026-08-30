import { NextRequest, NextResponse } from "next/server";

import { POST as recibirEvolution } from "@/app/api/webhooks/evolution/route";
import { prisma } from "@/lib/prisma";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";
import { getEvolutionSettings } from "@/lib/system-settings";
import {
  avanzaElEstado,
  idCrudoDeMensaje,
  leerAckWaha,
  traducirEventoWaha,
  type EstadoDeEntrega,
} from "@/lib/waha";

/**
 * Por donde entran los mensajes de WAHA.
 *
 * Traduce el evento al formato de Evolution y se lo pasa al webhook que ya existe, en vez de
 * armar una tuberia nueva. Ese webhook resuelve contacto, conversacion, etapa del embudo, agente
 * y seguimientos: son 3900 lineas que SON el corazon del CRM. Duplicarlas para el tercer gateway
 * garantizaba que las dos copias se fueran separando y que un arreglo en una no llegara a la otra.
 *
 * Lo que no sabemos traducir todavia (media, por ejemplo) se responde 200 con el motivo. Un 500
 * haria que WAHA lo reintente para siempre por algo que ningun reintento va a arreglar.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cuerpo = await request.json().catch(() => null);
  if (!cuerpo) {
    return NextResponse.json({ ok: false, message: "JSON invalido" }, { status: 400 });
  }

  /*
    El secreto se valida ANTES de tocar nada.

    El camino del ack no pasa por el webhook de Evolution, asi que no hereda su validacion: sin
    esto, cualquiera podria mandar acks inventados y pintar de leidos mensajes que nunca llegaron.
  */
  const settings = await getEvolutionSettings();
  if (settings.webhookSecret) {
    const entregado =
      request.headers.get("x-webhook-secret") ||
      request.headers.get("authorization") ||
      request.nextUrl.searchParams.get("token");
    if (entregado?.replace(/^Bearer\s+/i, "").trim() !== settings.webhookSecret) {
      return NextResponse.json({ ok: false, message: "Webhook no autorizado" }, { status: 401 });
    }
  }

  /*
    El doble check se maneja ACA, no se traduce.

    El webhook de Evolution nunca supo de acks: para evogo el doble check jamas funciono. No hay a
    donde traducirlo, asi que se resuelve directo contra la base.
  */
  const ack = leerAckWaha(cuerpo);
  if (ack) {
    await aplicarAck(ack);
    return NextResponse.json({ ok: true });
  }

  const traduccion = traducirEventoWaha(cuerpo);
  if (!traduccion.evolution) {
    console.log("[waha webhook] evento ignorado:", traduccion.motivo);
    return NextResponse.json({ ok: true, ignorado: traduccion.motivo });
  }

  /*
    Se rearma la URL apuntando al webhook de Evolution CONSERVANDO la query.

    Ahi viaja el `token` con el que ese webhook valida que el evento sea nuestro. Perderlo daria
    un 401 silencioso y los mensajes simplemente no aparecerian, sin nada en los logs que lo
    explique.
  */
  const destino = new URL(request.url);
  destino.pathname = "/api/webhooks/evolution";

  const pedido = new NextRequest(destino, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Los headers alternativos que ese webhook acepta para el secreto, por si algun dia el
      // token deja de ir en la query.
      ...(request.headers.get("x-webhook-secret")
        ? { "x-webhook-secret": request.headers.get("x-webhook-secret") as string }
        : {}),
    },
    body: JSON.stringify(traduccion.evolution),
  });

  const respuesta = await recibirEvolution(pedido);

  /*
    Se toca el altavoz para que el chat abierto se entere ya.

    WAHA no tiene socket propio como los otros dos gateways, asi que sin esto un mensaje recien
    llegado -o el eco del que acabamos de enviar- solo aparecia al recargar la pagina.

    Va DESPUES de procesar y sin esperar: si el altavoz esta caido, el mensaje ya quedo guardado y
    el chat se actualiza igual por el refresco de respaldo.
  */
  const sesion = (cuerpo as { session?: unknown }).session;
  if (typeof sesion === "string" && sesion) {
    const canal = await prisma.whatsAppChannel.findUnique({
      where: { evolutionInstanceName: sesion },
      select: { workspaceId: true },
    });
    if (canal) {
      void notifyRealtimeUpdate({ workspaceId: canal.workspaceId, type: "waha-update" });
    }
  }

  return respuesta;
}

/** WAHA no verifica la URL como Meta, pero tener el GET ayuda a probar que el endpoint existe. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "waha" });
}

/** Marca en el mensaje lo que WhatsApp acaba de contarnos: llego, lo leyeron, o fallo. */
async function aplicarAck(ack: { sesion: string; idMensaje: string; estado: EstadoDeEntrega }) {
  /*
    Se busca tambien por el id CRUDO, no solo por la cadena completa.

    Al enviar, WAHA nos devuelve el id compuesto con el numero
    (`true_573001112233@c.us_3EB0...`); en el acuse lo compone con el LID
    (`true_37898875334784@lid_3EB0...`). Son el mismo mensaje y nunca coinciden como texto: por eso
    ningun acuse encontraba a su mensaje y el doble check no aparecia jamas.

    El canal sigue acotando la busqueda: el mismo id podria existir en otra linea, y marcarle el
    acuse al mensaje de otra conversacion seria peor que no marcar nada.
  */
  const crudo = idCrudoDeMensaje(ack.idMensaje);
  const mensaje = await prisma.message.findFirst({
    where: {
      channel: { evolutionInstanceName: ack.sesion },
      OR: [
        { externalId: ack.idMensaje },
        // El minimo de largo evita que un id raro y corto matchee cualquier cosa por casualidad.
        ...(crudo.length >= 8 ? [{ externalId: { endsWith: `_${crudo}` } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });

  if (!mensaje) {
    // Normal para lo que se envia desde el celular, fuera del CRM: ese mensaje no es nuestro.
    console.log(`[waha ack] sin mensaje para ${ack.idMensaje} en ${ack.sesion}`);
    return;
  }
  if (!avanzaElEstado(mensaje.status, ack.estado)) {
    console.log(`[waha ack] ${ack.estado} no avanza sobre ${mensaje.status}`);
    return;
  }

  // Se deja rastro: sin esto, el camino del ack era mudo y averiguar por que un mensaje no
  // mostraba el doble check obligaba a adivinar entre "no llego", "no coincidio" y "no avanzo".
  console.log(`[waha ack] ${ack.sesion} ${mensaje.status} -> ${ack.estado}`);

  const ahora = new Date();
  await prisma.message.update({
    where: { id: mensaje.id },
    data: {
      status: ack.estado,
      ...(ack.estado === "SENT" ? { sentAt: ahora } : {}),
      ...(ack.estado === "DELIVERED" ? { deliveredAt: ahora } : {}),
      ...(ack.estado === "READ" ? { readAt: ahora, deliveredAt: ahora } : {}),
      ...(ack.estado === "FAILED" ? { failedAt: ahora } : {}),
    },
  });
}
