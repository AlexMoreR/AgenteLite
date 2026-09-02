import { NextRequest, NextResponse } from "next/server";

import { POST as recibirEvolution } from "@/app/api/webhooks/evolution/route";
import { prisma } from "@/lib/prisma";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";
import { getEvolutionSettings } from "@/lib/system-settings";
import { readGatewayConnection } from "@/lib/evolution";
import { readLinkedLid } from "@/lib/whatsapp-lid";
import {
  avanzaElEstado,
  descargarMediaWaha,
  idCrudoDeMensaje,
  leerAckWaha,
  leerPresenciaWaha,
  reintentarMediaWaha,
  telefonoDeUnLid,
  traducirEventoWaha,
  type EstadoDeEntrega,
  type PresenciaWaha,
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
  /*
    La presencia se resuelve antes que nada y no toca la base.

    "Esta escribiendo" dura segundos y no es historia: guardarlo seria escribir en la base varias
    veces por cada persona que teclea, para un dato que caduca antes de servir. Va directo al
    navegador por el altavoz.
  */
  const presencia = leerPresenciaWaha(cuerpo);
  if (presencia) {
    await avisarPresencia(presencia.sesion, presencia.presencia);
    return NextResponse.json({ ok: true });
  }

  const ack = leerAckWaha(cuerpo);
  if (ack) {
    /*
      Tambien se avisa por el acuse, no solo por los mensajes.

      Sin esto el check quedaba correcto en la base al instante pero el navegador recien lo veia
      en el refresco de respaldo: hasta 8 segundos mirando un mensaje que ya estaba entregado.
      Solo se avisa cuando el estado AVANZO de verdad, asi que son a lo sumo dos por mensaje.
    */
    const workspaceId = await aplicarAck(ack);
    if (workspaceId) {
      void notifyRealtimeUpdate({ workspaceId, type: "waha-ack" });
    }
    return NextResponse.json({ ok: true });
  }

  const sesion = typeof (cuerpo as { session?: unknown }).session === "string"
    ? ((cuerpo as { session: string }).session)
    : "";
  const canal = sesion
    ? await prisma.whatsAppChannel.findUnique({
        where: { evolutionInstanceName: sesion },
        select: { workspaceId: true, metadata: true },
      })
    : null;

  /*
    Si el lead viene con LID, se traduce a su telefono ANTES de procesarlo.

    Los que entran por un anuncio ocultan su numero: WhatsApp los identifica con un LID y el
    contacto nacia llamandose "37898875334784". Peor que feo: la MISMA persona entraba dos veces,
    una con el LID y otra con su numero, en dos chats distintos. En evogo esto ya estaba resuelto
    por el fork; al pasar a WAHA volvio, porque WAHA no traduce solo -pero tiene la tabla y basta
    con preguntarle-.

    Se hace aca, sobre el evento crudo, para que TODO lo de mas abajo -contacto, conversacion,
    embudo, agente- vea el telefono de verdad sin enterarse de que existe un LID.
  */
  if (canal) {
    const conexion = readGatewayConnection(canal.metadata);
    const de = (cuerpo as { payload?: { from?: unknown } }).payload?.from;
    if (conexion?.apiToken && typeof de === "string" && de.toLowerCase().endsWith("@lid")) {
      const telefono = await telefonoDeUnLid({
        connection: { baseUrl: conexion.baseUrl, apiToken: conexion.apiToken },
        sesion,
        lid: de,
      });
      if (telefono) {
        (cuerpo as { payload: { from: string } }).payload.from = `${telefono}@c.us`;
        console.log("[waha lid] resuelto", { lid: de, telefono });
      }
    }
  }

  let traduccion = traducirEventoWaha(cuerpo);

  /*
    Si el archivo no vino, se pide UNA vez mas antes de darlo por perdido.

    A veces la primera descarga falla por algo pasajero y en el segundo intento entra. Si entra, se
    parchea el evento crudo y se vuelve a traducir: asi el mensaje sigue el mismo camino de siempre,
    con su archivo, en vez de tener un camino aparte para el caso recuperado.
  */
  if (traduccion.mediaFaltante && canal) {
    const conexion = readGatewayConnection(canal.metadata);
    if (conexion?.apiToken) {
      const recuperada = await reintentarMediaWaha({
        connection: { baseUrl: conexion.baseUrl, apiToken: conexion.apiToken },
        sesion,
        chatId: traduccion.mediaFaltante.chatId,
        mensajeId: traduccion.mediaFaltante.mensajeId,
      });
      if (recuperada) {
        const payload = (cuerpo as { payload?: Record<string, unknown> }).payload;
        if (payload) {
          payload.media = {
            url: recuperada.url,
            mimetype: recuperada.mimetype,
            ...(recuperada.filename ? { filename: recuperada.filename } : {}),
          };
          traduccion = traducirEventoWaha(cuerpo);
          console.log("[waha media] recuperada en el reintento");
        }
      } else {
        console.warn("[waha media] no se pudo bajar; el mensaje se guarda sin el archivo", {
          sesion,
          mensajeId: traduccion.mediaFaltante.mensajeId,
        });
      }
    }
  }

  if (!traduccion.evolution) {
    console.log("[waha webhook] evento ignorado:", traduccion.motivo);
    return NextResponse.json({ ok: true, ignorado: traduccion.motivo });
  }

  /*
    La media se baja ACA, antes de procesar el mensaje.

    `/api/files/...` de WAHA exige la clave, asi que el navegador no puede abrir esa URL. Bajandola
    nosotros y dejando el contenido en `data.base64` -donde el resolver de siempre ya lo busca-, la
    persistencia y la burbuja funcionan sin cambiarles una linea.

    Si la descarga falla se sigue igual: queda el mensaje con su texto y sin archivo, que es mejor
    que perder el mensaje entero.
  */
  if (traduccion.media && canal) {
    const conexion = readGatewayConnection(canal.metadata);
    if (conexion?.apiToken) {
      const base64 = await descargarMediaWaha(
        { baseUrl: conexion.baseUrl, apiToken: conexion.apiToken },
        traduccion.media.url,
      );
      if (base64) {
        const datos = traduccion.evolution.data as Record<string, unknown>;
        datos.base64 = base64;
        datos.mimetype = traduccion.media.mimetype;
      }
    }
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
  if (canal) {
    /*
      Si es un mensaje del CLIENTE, el aviso lleva sus datos para que suene la campanita.

      El sonido lo disparaba solo el socket de Evolution; al pasar todo a WAHA ese camino dejo de
      correr y los mensajes entraban en silencio. Los datos viajan EN el aviso -como la presencia-
      porque el navegador necesita distinguir un mensaje entrante del eco de uno nuestro: sin eso
      sonaria tambien al mandar.
    */
    const datos = traduccion.evolution.data as
      | { key?: { fromMe?: unknown; remoteJid?: unknown }; message?: Record<string, unknown>; pushName?: unknown }
      | undefined;
    const esDelCliente = datos?.key?.fromMe !== true;
    const jid = typeof datos?.key?.remoteJid === "string" ? datos.key.remoteJid : "";

    void notifyRealtimeUpdate({
      workspaceId: canal.workspaceId,
      type: esDelCliente ? "waha-incoming" : "waha-update",
      data: esDelCliente
        ? {
            phoneNumber: jid.split("@")[0]?.replace(/[^0-9]/g, "") ?? "",
            senderName: typeof datos?.pushName === "string" ? datos.pushName : null,
            text: textoDelMensaje(datos?.message),
            type: null,
          }
        : null,
    });
  }

  return respuesta;
}

/** WAHA no verifica la URL como Meta, pero tener el GET ayuda a probar que el endpoint existe. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "waha" });
}

/**
 * Marca en el mensaje lo que WhatsApp acaba de contarnos: llego, lo leyeron, o fallo.
 *
 * Devuelve el negocio cuando de verdad cambio algo, para que el que llama avise al altavoz. Si no
 * cambio nada devuelve null y no se molesta a ningun navegador.
 */
async function aplicarAck(ack: {
  sesion: string;
  idMensaje: string;
  estado: EstadoDeEntrega;
}): Promise<string | null> {
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
    select: { id: true, status: true, workspaceId: true },
  });

  if (!mensaje) {
    // Normal para lo que se envia desde el celular, fuera del CRM: ese mensaje no es nuestro.
    console.log(`[waha ack] sin mensaje para ${ack.idMensaje} en ${ack.sesion}`);
    return null;
  }
  if (!avanzaElEstado(mensaje.status, ack.estado)) {
    console.log(`[waha ack] ${ack.estado} no avanza sobre ${mensaje.status}`);
    return null;
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

  return mensaje.workspaceId;
}

/**
 * Le cuenta al navegador que alguien esta escribiendo.
 *
 * El evento identifica al contacto por su LID o por su telefono, segun el caso -es el tercer lugar
 * donde aparece esa dualidad-, asi que se buscan las dos formas. Si se comparara solo por telefono,
 * la burbuja no se mostraria justo en los chats de leads nuevos, que llegan con LID.
 */
async function avisarPresencia(sesion: string, presencia: PresenciaWaha) {
  const canal = await prisma.whatsAppChannel.findUnique({
    where: { evolutionInstanceName: sesion },
    select: { workspaceId: true },
  });
  if (!canal) {
    return;
  }

  const identidad = presencia.identidad;
  const soloDigitos = identidad.split("@")[0]?.replace(/\D/g, "") ?? "";
  if (!soloDigitos) {
    return;
  }

  const contacto = await prisma.contact.findFirst({
    where: {
      workspaceId: canal.workspaceId,
      OR: [
        { phoneNumber: soloDigitos },
        { metadata: { path: ["whatsappLidId"], equals: soloDigitos } },
      ],
    },
    select: { id: true, phoneNumber: true, metadata: true },
  });
  if (!contacto) {
    console.log(`[waha presencia] sin contacto para ${identidad}`);
    return;
  }

  /*
    Se ESPERA el aviso, no se lanza y se olvida.

    En el camino de los mensajes alcanza con lanzarlo porque antes hay trabajo que demora y le da
    tiempo a salir. Aca la respuesta se devuelve enseguida, y un pedido sin esperar se corta
    cuando la funcion termina: el aviso no llegaba nunca. Tiene su propio limite de 1,5s, asi que
    esperarlo no retrasa nada.
  */
  console.log(`[waha presencia] ${contacto.phoneNumber} ${presencia.que ?? "paro"}`);
  await notifyRealtimeUpdate({
    workspaceId: canal.workspaceId,
    type: "presence",
    data: {
      telefono: contacto.phoneNumber,
      lid: readLinkedLid(contacto.metadata),
      activo: presencia.activo,
      que: presencia.que,
    },
  });
}

/**
 * El texto del mensaje, para que la notificacion del sistema muestre algo util.
 *
 * Una foto o un audio no traen "conversation": lo que hay es el epigrafe, si lo escribio.
 */
function textoDelMensaje(mensaje: Record<string, unknown> | undefined): string {
  if (!mensaje) {
    return "";
  }
  const conversacion = mensaje.conversation;
  if (typeof conversacion === "string") {
    return conversacion.slice(0, 160);
  }
  for (const nodo of Object.values(mensaje)) {
    const epigrafe = (nodo as { caption?: unknown } | null)?.caption;
    if (typeof epigrafe === "string" && epigrafe.trim()) {
      return epigrafe.slice(0, 160);
    }
  }
  return "";
}
