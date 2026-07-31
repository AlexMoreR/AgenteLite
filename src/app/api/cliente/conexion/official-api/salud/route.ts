import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import {
  ensureOfficialApiConfigTable,
  getOfficialApiConfigByWorkspaceId,
} from "@/lib/official-api-config";
import { getMetaGraphErrorMessage, type MetaGraphErrorPayload } from "@/lib/official-api-graph";
import { prisma } from "@/lib/prisma";

/**
 * "No llegan los mensajes del canal oficial": ¿es culpa nuestra o Meta dejó de mandarlos?
 *
 * Sin esto la pregunta no se podia responder. Los mensajes que Meta nos entrega quedan
 * registrados en OfficialApiWebhookEvent, pero nada los mostraba, y los logs del servidor se
 * borran cada vez que la app se reinicia (o sea, cada despliegue). Cuando bloquearon la linea de
 * coexistencia no habia forma de distinguir "Meta dejo de entregar" de "nos llega y lo estamos
 * rechazando", que se arreglan de maneras completamente distintas.
 *
 * Esta ruta responde eso en un solo vistazo:
 *  - cuando fue la ULTIMA señal que Meta nos mando (y de que tipo),
 *  - si alguna de esas señales nos llego y fallo al procesarse,
 *  - y que dice Meta del numero: si esta restringido, baneado o con la calidad por el piso.
 *
 * El token nunca sale de aca: se usa del lado del servidor y la respuesta solo trae el estado.
 */

export const dynamic = "force-dynamic";

type PhoneNumberHealth = {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  status?: string;
  name_status?: string;
  platform_type?: string;
  throughput?: { level?: string };
};

type WabaHealth = {
  name?: string;
  account_review_status?: string;
  business_verification_status?: string;
};

async function fetchGraph<T>(url: string, accessToken: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      // Meta a veces se queda colgado. Sin tope, esta pantalla de diagnostico se cuelga tambien
      // justo cuando mas se necesita.
      signal: AbortSignal.timeout(10_000),
    });

    const payload = (await response.json().catch(() => null)) as (T & MetaGraphErrorPayload) | null;

    if (!response.ok) {
      return {
        ok: false as const,
        error: getMetaGraphErrorMessage(payload, "Meta no respondio a la consulta de estado."),
      };
    }

    return { ok: true as const, data: (payload ?? {}) as T };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "No se pudo consultar a Meta.",
    };
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "connection")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  await ensureOfficialApiConfigTable();
  const config = await getOfficialApiConfigByWorkspaceId(access.workspaceId);

  if (!config?.id) {
    return NextResponse.json(
      { ok: false, error: "Este negocio no tiene un canal de API oficial configurado." },
      { status: 404 },
    );
  }

  // Ultimas señales que nos entrego Meta. Lo que importa no es el contenido sino CUANDO llego la
  // ultima: si es de anoche, Meta dejo de entregar y el problema esta del lado de ellos.
  const ultimosEventos = await prisma.$queryRaw<
    Array<{ createdAt: Date; eventType: string; status: string; errorMessage: string | null }>
  >`
    SELECT "createdAt", "eventType", "status", "errorMessage"
    FROM "OfficialApiWebhookEvent"
    WHERE "configId" = ${config.id}
    ORDER BY "createdAt" DESC
    LIMIT 15
  `;

  const porDia = await prisma.$queryRaw<Array<{ dia: Date; total: bigint; fallidos: bigint }>>`
    SELECT
      date_trunc('day', "createdAt") AS dia,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE "status" = 'FAILED') AS fallidos
    FROM "OfficialApiWebhookEvent"
    WHERE "configId" = ${config.id}
      AND "createdAt" > CURRENT_TIMESTAMP - INTERVAL '7 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `;

  const ultimoEntrante = await prisma.$queryRaw<Array<{ createdAt: Date }>>`
    SELECT "createdAt"
    FROM "OfficialApiMessage"
    WHERE "configId" = ${config.id}
      AND "direction" = 'INBOUND'
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;

  // Lo que dice Meta del numero. Aca aparece si lo restringieron o lo dieron de baja, que es
  // exactamente lo que no se ve desde el CRM.
  const accessToken = config.accessToken?.trim();
  const phoneNumberId = config.phoneNumberId?.trim();
  const wabaId = config.wabaId?.trim();

  const [numero, cuenta] = await Promise.all([
    accessToken && phoneNumberId
      ? fetchGraph<PhoneNumberHealth>(
          `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}` +
            "?fields=display_phone_number,verified_name,quality_rating,status,name_status,platform_type,throughput",
          accessToken,
        )
      : Promise.resolve({ ok: false as const, error: "Faltan credenciales guardadas del numero." }),
    accessToken && wabaId
      ? fetchGraph<WabaHealth>(
          `https://graph.facebook.com/v23.0/${encodeURIComponent(wabaId)}` +
            "?fields=name,account_review_status,business_verification_status",
          accessToken,
        )
      : Promise.resolve({ ok: false as const, error: "Faltan credenciales guardadas de la cuenta." }),
  ]);

  return NextResponse.json({
    ok: true,
    configId: config.id,
    estadoGuardado: config.status,
    ultimaSenalDeMeta: ultimosEventos[0]?.createdAt ?? null,
    ultimoMensajeEntrante: ultimoEntrante[0]?.createdAt ?? null,
    ultimosEventos: ultimosEventos.map((evento) => ({
      cuando: evento.createdAt,
      tipo: evento.eventType,
      estado: evento.status,
      error: evento.errorMessage,
    })),
    senalesPorDia: porDia.map((fila) => ({
      dia: fila.dia,
      total: Number(fila.total),
      fallidos: Number(fila.fallidos),
    })),
    numero: numero.ok ? numero.data : { error: numero.error },
    cuenta: cuenta.ok ? cuenta.data : { error: cuenta.error },
  });
}
