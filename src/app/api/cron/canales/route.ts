import { NextRequest, NextResponse } from "next/server";

import { revisarCanales } from "@/features/monitoreo/services/monitor-de-canales";

/**
 * Le pregunta al gateway, cada minuto, si las lineas siguen vivas.
 *
 * Existe porque `WhatsAppChannel.status` solo cambiaba cuando el gateway avisaba, y un gateway que
 * se muere no alcanza a avisar de su propia muerte: el 28-ago el CRM mostro el puntito verde
 * durante 24 horas mientras no entraba ni salia un mensaje.
 *
 * Se protege con el mismo secreto que el cron de seguimientos, para que no la pueda disparar
 * cualquiera desde afuera.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secreto = process.env.FOLLOW_CRON_SECRET?.trim();
  if (secreto) {
    const entregado =
      request.headers.get("x-follow-cron-secret") ||
      request.nextUrl.searchParams.get("token");
    if (entregado?.trim() !== secreto) {
      return NextResponse.json({ ok: false, message: "No autorizado" }, { status: 401 });
    }
  }

  try {
    const resumen = await revisarCanales();
    return NextResponse.json({ ok: true, ...resumen });
  } catch (error) {
    console.error("[monitor canales] fallo la revision", error);
    return NextResponse.json({ ok: false, message: "Fallo la revision" }, { status: 500 });
  }
}
