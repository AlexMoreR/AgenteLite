import { prisma } from "@/lib/prisma";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { enfriarUnLead } from "@/features/crm/services/lead-temperature";

import { cumpleLasCondiciones } from "../motor/decidir";
import { leerEstado } from "../motor/estado";
import { leerLibro } from "./almacen";
import { avisarAsesorPorWhatsApp } from "./avisos";
import { redactarSeguimiento, type LineaDeCharla } from "./redactar-seguimiento";

/**
 * LOS SEGUIMIENTOS INTELIGENTES: los que se escriben leyendo la conversación.
 *
 * El reloj de al lado (seguimientos.ts) manda los textos fijos del libro mientras el agente lleva
 * la charla por el embudo, y eso funciona. El hueco está después: el agente manda las fotos, avisa
 * a la asesora, la asesora contesta — y ahí la conversación se sale del embudo. Ningún texto fijo
 * corresponde ya, la IA queda en pausa, y el chat se queda sin un solo seguimiento hasta que
 * alguien se acuerda a mano. "Se están quedando sin seguimiento los chats" (Alex, 27-09-2026).
 *
 * Esto cubre ese hueco con cuatro escalones —15 minutos, 1 hora, 1 día y 3 días— y un texto que
 * escribe la IA con la conversación entera a la vista, no una plantilla.
 *
 * Las cuatro decisiones de alcance, que son de Alex y no mías:
 *
 * 1. En un chat que ya atiende una asesora, el agente escribe SOLO si la asesora tampoco escribió.
 *    Como el escalón exige que el último mensaje sea nuestro y más viejo que el plazo, si ella
 *    está atendiendo el reloj nunca llega a disparar. Nadie le escribe por encima.
 * 2. Si el último que habló fue el CLIENTE y nadie le contestó, NO se le escribe: se le avisa a la
 *    asesora. Mandarle un "¿sigues interesado?" a quien hizo una pregunta sin responder es peor
 *    que el silencio.
 * 3. Los textos fijos mandan dentro del embudo. El inteligente solo entra donde hoy no hay nada.
 * 4. Después del de 3 días para, y el lead se enfría a Frío. Nunca GANADO ni PERDIDO: cerrar es
 *    decisión humana.
 */

/** Minutos de silencio de cada escalón. En orden, del más corto al más largo. */
const ESCALONES = [15, 60, 24 * 60, 3 * 24 * 60];

const ULTIMO_ESCALON = ESCALONES[ESCALONES.length - 1];

/**
 * Hasta dónde mira hacia atrás.
 *
 * El escalón más largo es de 3 días, así que la ventana tiene que pasar de eso o nunca se
 * alcanzaría. El tope existe igual para que el día que esto se prenda no salga a escribirle de
 * golpe a todos los chats muertos del último semestre.
 */
const VENTANA_MAXIMA_DIAS = 5;

/** Por vuelta y por línea. El cron corre cada minuto; si hay atraso, se drena de a poco. */
const CUANTOS_POR_VUELTA = 8;

/** Cuánta conversación se le lee a la IA. */
const MENSAJES_DE_CONTEXTO = 40;

/**
 * El aviso de "el cliente está esperando" solo mira el rato reciente.
 *
 * Un cliente que preguntó hace tres días y nadie contestó no se arregla despertándole el teléfono
 * a la asesora: eso es un lead frío, y para eso está el tablero. El aviso sirve cuando todavía se
 * puede contestar a tiempo.
 */
const AVISO_HASTA_MINUTOS = 3 * 60;

const CLAVE = "agente-v3:seguimiento-ia:";

/**
 * Desde cuándo trabaja este reloj.
 *
 * Sin esto, la primera vuelta saldría a escribirle de golpe a TODOS los chats callados de los
 * últimos cinco días — cientos de mensajes a gente que ya estaba fría, que es exactamente lo que
 * nadie pidió. Se guarda la hora del primer arranque y solo se atienden los silencios que
 * empezaron después.
 */
const CLAVE_ARRANQUE = "agente-v3:seguimiento-ia:arranque";

async function desdeCuandoTrabaja(ahora: Date): Promise<Date> {
  const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_ARRANQUE } });
  const guardado = fila?.value ? Date.parse(fila.value) : Number.NaN;
  if (Number.isFinite(guardado)) {
    return new Date(guardado);
  }
  const valor = ahora.toISOString();
  await prisma.appSetting
    .upsert({ where: { key: CLAVE_ARRANQUE }, create: { key: CLAVE_ARRANQUE, value: valor }, update: { value: valor } })
    .catch(() => {});
  return ahora;
}

/**
 * Lo que se recuerda de cada chat, atado al silencio que lo originó.
 *
 * `desde` es la hora del último mensaje cuando se marcó. Si el chat se movió, la marca es de otro
 * silencio y se descarta sola. Es lo que hace que el contador se reinicie cuando el cliente
 * contesta, SIN depender de que el motor corra: en un chat pausado el motor no corre nunca.
 */
type MarcaDeSeguimiento = { desde: string; escalones: number[] };

async function leerMarca(conversationId: string): Promise<MarcaDeSeguimiento | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE}${conversationId}` } });
  if (!fila?.value) {
    return null;
  }
  try {
    const guardado = JSON.parse(fila.value) as Partial<MarcaDeSeguimiento>;
    if (typeof guardado.desde !== "string") {
      return null;
    }
    return {
      desde: guardado.desde,
      escalones: Array.isArray(guardado.escalones)
        ? guardado.escalones.filter((minutos): minutos is number => typeof minutos === "number")
        : [],
    };
  } catch {
    return null;
  }
}

async function guardarMarca(conversationId: string, marca: MarcaDeSeguimiento): Promise<void> {
  const key = `${CLAVE}${conversationId}`;
  // Sin repetidos: los escalones vencidos se vuelven a sumar en cada vuelta y la fila crecería sola.
  const value = JSON.stringify({ desde: marca.desde, escalones: [...new Set(marca.escalones)] });
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function ejecutarSeguimientosInteligentes(
  ahora = new Date(),
): Promise<{ enviados: number; avisados: number; revisados: number }> {
  const canales = await prisma.whatsAppChannel.findMany({
    where: { metadata: { path: ["agenteV3"], equals: true } },
    select: { id: true, workspaceId: true, evolutionInstanceName: true },
  });

  let enviados = 0;
  let avisados = 0;
  let revisados = 0;

  const arranque = await desdeCuandoTrabaja(ahora);

  for (const canal of canales) {
    if (!canal.evolutionInstanceName) {
      continue;
    }

    const libro = await leerLibro(canal.workspaceId);
    if (!libro.comoHablamos.trim()) {
      // Sin la voz del negocio la IA inventaría el tono. Mejor no escribir.
      continue;
    }

    /*
      A diferencia del reloj de los textos fijos, acá NO se filtra por `automationPaused`: los
      chats pausados —los que ya atiende una asesora— son justamente el hueco que esto viene a
      tapar.
    */
    const conversaciones = await prisma.conversation.findMany({
      where: {
        channelId: canal.id,
        lastMessageAt: {
          lte: new Date(ahora.getTime() - ESCALONES[0] * 60_000),
          gte: new Date(ahora.getTime() - VENTANA_MAXIMA_DIAS * 24 * 3_600_000),
        },
      },
      select: {
        id: true,
        automationPaused: true,
        contactId: true,
        contact: { select: { phoneNumber: true, name: true, crmStage: true, excludedFromCrm: true } },
      },
      orderBy: { lastMessageAt: "desc" },
      take: CUANTOS_POR_VUELTA * 4,
    });

    for (const conversacion of conversaciones) {
      if (enviados + avisados >= CUANTOS_POR_VUELTA) {
        break;
      }

      const telefono = conversacion.contact?.phoneNumber?.trim();
      if (!telefono) {
        continue;
      }

      /*
        Un lead cerrado no recibe seguimientos.

        A quien ya compró preguntarle "¿sigues interesado?" lo hace dudar, y a quien una persona
        descartó, perseguirlo es exactamente lo que esa persona decidió que no.
      */
      const etapa = conversacion.contact?.crmStage;
      if (etapa === "GANADO" || etapa === "PERDIDO") {
        continue;
      }

      revisados += 1;

      /*
        Las notas del sistema no cuentan como hablar: el V3 deja una después de cada respuesta, y
        si contaran, el último mensaje del chat sería casi siempre una nota nuestra.
      */
      const ultimos = await prisma.message.findMany({
        where: { conversationId: conversacion.id, type: { not: "SYSTEM" } },
        orderBy: { createdAt: "desc" },
        take: MENSAJES_DE_CONTEXTO,
        select: { direction: true, createdAt: true, content: true },
      });
      const ultimo = ultimos[0];
      if (!ultimo) {
        continue;
      }

      const minutosCallado = Math.floor((ahora.getTime() - ultimo.createdAt.getTime()) / 60_000);
      if (minutosCallado < ESCALONES[0]) {
        continue;
      }

      // Silencio que ya venía de antes de prender esto: no se persigue historia vieja.
      if (ultimo.createdAt < arranque) {
        continue;
      }

      const marcaGuardada = await leerMarca(conversacion.id);
      const desde = ultimo.createdAt.toISOString();
      // Si el chat se movió, la marca era de otro silencio: el contador vuelve a empezar.
      const marca: MarcaDeSeguimiento =
        marcaGuardada && marcaGuardada.desde === desde ? marcaGuardada : { desde, escalones: [] };

      /*
        EL CLIENTE HABLÓ ÚLTIMO Y NADIE LE CONTESTÓ.

        Acá no va un seguimiento: va un aviso a la asesora. El aviso tiene su propia
        antirrepetición de 10 minutos, así que no se convierte en un log en su teléfono.
      */
      if (ultimo.direction === "INBOUND") {
        if (marca.escalones.includes(-1) || minutosCallado > AVISO_HASTA_MINUTOS) {
          continue;
        }
        const cuantos = await avisarAsesorPorWhatsApp({
          workspaceId: canal.workspaceId,
          conversationId: conversacion.id,
          motivo: `El cliente escribió hace ${minutosCallado} minutos y nadie le ha respondido`,
          cliente: conversacion.contact?.name?.trim() || telefono,
          telefonoDelCliente: telefono,
        });
        // Se marca aunque no haya salido: si no hay a quién avisar, insistir cada minuto no ayuda.
        await guardarMarca(conversacion.id, { desde, escalones: [...marca.escalones, -1] });
        if (cuantos > 0) {
          avisados += 1;
        }
        continue;
      }

      // El escalón más avanzado que ya venció y todavía no salió.
      const vencidos = ESCALONES.filter((minutos) => minutos <= minutosCallado);
      const toca = [...vencidos].reverse().find((minutos) => !marca.escalones.includes(minutos));
      if (toca === undefined) {
        continue;
      }

      /*
        DENTRO DEL EMBUDO MANDAN LOS TEXTOS FIJOS.

        Si el libro tiene una regla de "sin respuesta" que corresponde al paso en el que va la
        charla y todavía no salió, el que escribe es el otro reloj. El inteligente solo entra donde
        no hay nada escrito — que es el caso que Alex vino a resolver.

        En un chat pausado esto no aplica: el reloj de los textos fijos ni siquiera lo mira.
      */
      if (!conversacion.automationPaused) {
        const estado = await leerEstado(conversacion.id);
        const yaSalieron = estado.seguimientosEnviados ?? [];
        const hayTextoFijoPendiente = libro.reglas
          .filter((regla) => regla.activa && regla.cuando.tipo === "sin_respuesta")
          .filter((regla) => cumpleLasCondiciones(regla, estado))
          .some(
            (regla) =>
              regla.cuando.tipo === "sin_respuesta" &&
              regla.cuando.minutos > 0 &&
              regla.cuando.minutos <= minutosCallado &&
              !yaSalieron.includes(regla.cuando.minutos),
          );
        if (hayTextoFijoPendiente) {
          continue;
        }
      }

      const historial: LineaDeCharla[] = ultimos
        .slice()
        .reverse()
        .filter((mensaje) => (mensaje.content ?? "").trim())
        .map((mensaje) => ({
          de: mensaje.direction === "INBOUND" ? ("cliente" as const) : ("negocio" as const),
          texto: (mensaje.content ?? "").trim(),
        }));

      const redactado = await redactarSeguimiento({
        historial,
        escalon: toca,
        comoHablamos: libro.comoHablamos,
        nombreDelCliente: conversacion.contact?.name?.trim() || null,
      });

      /*
        La charla está cerrada: se apagan TODOS los escalones, no solo el de ahora.

        Si el cliente ya compró, eso no cambia porque pase otro día. Apagarlos todos de una es
        además lo que tapa el único escape que quedaba: el modelo acierta "ya compró" en los
        primeros escalones y se le escapa en el último, así que basta con que lo acierte una vez.
      */
      if (redactado.cerrado) {
        await guardarMarca(conversacion.id, { desde, escalones: [...marca.escalones, ...ESCALONES] });
        continue;
      }

      /*
        Sin texto: la IA falló, tardó o no está configurada. Se quema ESTE escalón y nada más.

        Ni se reintenta cada dos minutos —serían cientos de llamadas por un chat— ni se cancela la
        cadena entera por una llamada que se cayó: al escalón siguiente se vuelve a intentar.
      */
      const texto = redactado.texto;
      if (!texto) {
        await guardarMarca(conversacion.id, { desde, escalones: [...marca.escalones, toca] });
        continue;
      }

      try {
        const resultado = await sendEvolutionTextMessageWithReconnect({
          instanceName: canal.evolutionInstanceName,
          phoneNumber: telefono,
          text: texto,
        });

        await prisma.message.create({
          data: {
            workspaceId: canal.workspaceId,
            conversationId: conversacion.id,
            channelId: canal.id,
            contactId: conversacion.contactId,
            direction: "OUTBOUND",
            type: "TEXT",
            status: "SENT",
            content: texto,
            sentAt: new Date(),
            rawPayload: { source: "agente-v3-seguimiento-ia", escalon: toca, evolution: resultado } as never,
          },
        });

        // Los vencidos quedan marcados aunque haya salido solo el último: no se persigue hacia atrás.
        await guardarMarca(conversacion.id, { desde, escalones: [...marca.escalones, ...vencidos] });
        enviados += 1;

        console.log("[agente-v3] seguimiento inteligente enviado", {
          conversationId: conversacion.id,
          escalon: toca,
          pausado: conversacion.automationPaused,
        });

        /*
          Era el último: el lead se enfría y no se le escribe más.

          Enfriar es reversible —apenas el cliente conteste vuelve a la etapa que tenía— y por eso
          se puede automatizar. Descartar no, y por eso no se hace acá.
        */
        if (toca === ULTIMO_ESCALON && conversacion.contactId && !conversacion.contact?.excludedFromCrm) {
          await enfriarUnLead({
            workspaceId: canal.workspaceId,
            contactId: conversacion.contactId,
            motivo: "3 días sin respuesta después del último seguimiento.",
          }).catch(() => {});
        }
      } catch (error) {
        console.error("[agente-v3] no se pudo enviar el seguimiento inteligente", {
          conversationId: conversacion.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { enviados, avisados, revisados };
}
