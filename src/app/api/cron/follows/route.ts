import { NextResponse } from "next/server";
import { executePendingFollows } from "@/features/seguimientos/services/follows";
import { demoteUnresponsiveStaleLeads } from "@/features/llamadas/services/lead-cooldown";
import { enfriarLeadsSinRespuesta } from "@/features/crm/services/lead-temperature";
import { procesarTandasDeCampanas } from "@/features/campanas/services/campaigns";

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

  return NextResponse.json({
    ok: true,
    ...result,
    cooldown,
    temperatura,
    campanas,
  });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
