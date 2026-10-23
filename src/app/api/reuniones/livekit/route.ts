import { NextResponse } from "next/server";

import { procesarAvisoDeLivekit, type AvisoDeLivekit } from "@/features/reuniones/servicios/avisos-de-livekit";
import { leerConfigLivekit, verificarAvisoDeLivekit } from "@/features/reuniones/servicios/livekit";

export const dynamic = "force-dynamic";

/*
  LOS AVISOS DE LIVEKIT para el módulo Reuniones (webhook en livekit.yaml).

  Va acá y no en /api/webhooks, que es la zona de los chats. Cada aviso trae la firma de LiveKit
  (un JWT con el sha256 del cuerpo, firmado con LIVEKIT_API_SECRET): sin firma válida, 401.
*/

export async function POST(request: Request) {
  const config = leerConfigLivekit();
  if (!config) {
    return NextResponse.json({ ok: false, error: "LiveKit no está configurado" }, { status: 503 });
  }

  const cuerpo = await request.text();
  if (!verificarAvisoDeLivekit(cuerpo, request.headers.get("authorization"), config)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let aviso: AvisoDeLivekit;
  try {
    aviso = JSON.parse(cuerpo) as AvisoDeLivekit;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    await procesarAvisoDeLivekit(aviso, config);
  } catch (error) {
    // 500 para que LiveKit lo vuelva a mandar: todo lo del aviso aguanta repetirse.
    console.error("[reuniones] aviso de LiveKit", aviso.event, error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
