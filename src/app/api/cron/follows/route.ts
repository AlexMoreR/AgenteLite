import { NextResponse } from "next/server";
import { executePendingFollows } from "@/features/seguimientos/services/follows";
import { demoteUnresponsiveStaleLeads } from "@/features/llamadas/services/lead-cooldown";
import { enfriarLeadsSinRespuesta } from "@/features/crm/services/lead-temperature";
import { procesarTandasDeCampanas } from "@/features/campanas/services/campaigns";
import { purgeOldWebhookEventLogs } from "@/lib/webhook-log-retention";
import { ejecutarSeguimientosV3 } from "@/features/agente-v3/servicios/seguimientos";
import { avisarClientesEsperando } from "@/features/agente-v3/servicios/cliente-esperando";
import { rescatarMensajesSinDecidir } from "@/features/agente-v3/servicios/rescate-de-mensajes";
import { rescatarChatsHuerfanos } from "@/lib/rescate-de-chats-huerfanos";

function resolveCronSecret() {
  return process.env.FOLLOW_CRON_SECRET?.trim() || process.env.EVOLUTION_WEBHOOK_SECRET?.trim() || "";
}

function readIncomingSecret(request: Request) {
  return (
    request.headers.get("x-follow-cron-secret") ||
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization") ||
    ""
  ).trim();
}

async function handleCron(request: Request) {
  const expectedSecret = resolveCronSecret();
  const receivedSecret = readIncomingSecret(request);

  if (expectedSecret) {
    const normalizedExpected = expectedSecret.startsWith("Bearer ") ? expectedSecret.slice("Bearer ".length).trim() : expectedSecret;
    const normalizedReceived = receivedSecret.startsWith("Bearer ") ? receivedSecret.slice("Bearer ".length).trim() : receivedSecret;

    if (!normalizedReceived || normalizedReceived !== normalizedExpected) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "FOLLOW_CRON_SECRET no esta configurado" },
      { status: 500 },
    );
  }

  const result = await executePendingFollows({
    limit: 50,
  });

  /*
    Seguimientos del Agente V3. Van acá y no en un cron propio por lo mismo que los de abajo: un
    solo reloj es uno solo que vigilar.

    Corre en cada vuelta (cada 60s) a proposito, sin el throttle de 5 minutos de los de abajo: un
    seguimiento de 15 minutos que sale a los 19 se nota, y la consulta es barata -solo mira chats
    donde el ultimo que hablo fuimos nosotros-. Best-effort: si falla, no tumba los envios.
  */
  let seguimientosV3: { enviados: number; revisados: number } | null = null;
  try {
    seguimientosV3 = await ejecutarSeguimientosV3();
  } catch (error) {
    console.error("[cron/follows] seguimientos v3 error", error);
  }

  /*
    Un cliente que escribio y lleva 15 minutos sin respuesta: se le avisa a la asesora.

    Es lo que quedo de los seguimientos inteligentes. La version que ademas le ESCRIBIA al cliente
    (15 min, 1 h, 1 dia, 3 dias) se quito el 28-09-2026: lo que servia era el aviso, no que el
    agente insistiera solo. Aca el agente no le manda nada al cliente, solo levanta la mano.

    Con throttle de 2 minutos: el umbral es de 15, asi que mirar cada minuto no adelanta nada.
  */
  let clientesEsperando: { avisados: number; revisados: number } | null = null;
  if (new Date().getMinutes() % 2 === 0) {
    try {
      clientesEsperando = await avisarClientesEsperando();
    } catch (error) {
      console.error("[cron/follows] aviso de cliente esperando error", error);
    }
  }

  /*
    El mensaje que nadie miro: se lo vuelve a pasar al motor.

    Es para los mensajes que se pierden cuando el proceso se cae o lo reemplaza un despliegue:
    WhatsApp no reintenta, asi que sin esto ese lead se queda sin respuesta para siempre. Solo toca
    lo que el motor NUNCA decidio, y nunca un chat con asesora o con la IA pausada.

    Corre en cada vuelta (cada 60s) y no cada 2 minutos como los avisos: aca cada minuto de retraso
    es un minuto que el cliente lleva esperando una respuesta que deberia haber llegado en diez
    segundos. La consulta es barata -solo chats sin dueño y sin pausa de los ultimos 30 minutos-.
  */
  let mensajesRescatados: { rescatados: number; revisados: number } | null = null;
  try {
    mensajesRescatados = await rescatarMensajesSinDecidir();
  } catch (error) {
    console.error("[cron/follows] rescate de mensajes error", error);
  }

  /*
    La red del reparto: un cliente esperando media hora y sin nadie a cargo.

    Desde que los leads se reparten cuando el agente levanta la mano, un chat donde el agente NO
    escalo se queda sin dueño. Esto lo rescata. Va en este mismo reloj por lo mismo que los otros:
    uno solo que vigilar. Best-effort: si falla, no tumba los envios.
  */
  let rescatados: { repartidos: number; revisados: number } | null = null;
  try {
    rescatados = await rescatarChatsHuerfanos();
  } catch (error) {
    console.error("[cron/follows] rescate de huerfanos error", error);
  }

  // Enfriamiento de leads (Playbook: 3 intentos + 5 días + cero respuesta → Tibio). Va colgado
  // de este cron para no montar otro. Throttle: solo cada ~5 min (el cron corre cada 60s), porque
  // el cruce de la condición no cambia minuto a minuto. Best-effort: si falla, no rompe los envíos.
  let cooldown: { demoted: number } | null = null;
  if (new Date().getMinutes() % 5 === 0) {
    try {
      cooldown = await demoteUnresponsiveStaleLeads();
    } catch (error) {
      console.error("[cron/follows] cooldown error", error);
    }
  }

  // Temperatura del lead: Tibio sin respuesta del cliente en 2 dias -> Frio. Caliente NO se toca
  // (decision de Alex: si una asesora lo marco asi, el reloj no le pisa la decision). Mismo
  // throttle de 5 min y mismo best-effort que el enfriamiento por llamadas de arriba.
  let temperatura: { enfriados: number } | null = null;
  if (new Date().getMinutes() % 5 === 0) {
    try {
      temperatura = await enfriarLeadsSinRespuesta();
    } catch (error) {
      console.error("[cron/follows] temperatura error", error);
    }
  }

  // Campañas: la siguiente tanda de cada una que ya cumplio su espera. SIN el throttle de 5 min
  // de los de arriba: cada campaña tiene su propia frecuencia y se fija sola si le toca, asi que
  // saltear corridas solo le agregaria un retraso de hasta 5 minutos a una campaña de 5 minutos.
  let campanas: { enviados: number } | null = null;
  try {
    campanas = await procesarTandasDeCampanas();
  } catch (error) {
    console.error("[cron/follows] campanas error", error);
  }

  // Retencion del archivo de webhooks. Va colgado de este cron, como los de arriba, para no
  // montar otro. Throttle de una vez por hora (en el minuto 7): el vencimiento es por dias, no
  // hay nada que ganar mirandolo cada 60 segundos, y cada corrida borra de a 5000.
  let webhookLogs: { deleted: number } | null = null;
  if (new Date().getMinutes() === 7) {
    try {
      webhookLogs = await purgeOldWebhookEventLogs();
    } catch (error) {
      console.error("[cron/follows] purga de webhook logs error", error);
    }
  }

  return NextResponse.json({
    ok: true,
    ...result,
    cooldown,
    temperatura,
    campanas,
    webhookLogs,
    seguimientosV3,
    clientesEsperando,
    mensajesRescatados,
    rescatados,
  });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
