import { NextResponse } from "next/server";

import { enviarAvisoDelTrabajador } from "@/features/tableros-inteligentes/services/aviso-del-trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../tablero/autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/aviso — el trabajador del Tablero IA le manda un WhatsApp al dueño desde la línea
  Admin del negocio (p. ej. "el plan de Claude pasó el 80 %"). Misma clave que /api/trabajador/tablero/*
  (Bearer aizen_trab_...). Cuerpo `{ texto }` (hasta 500 caracteres). El número sale de la AppSetting
  `trabajador:aviso-telefono:<workspaceId>`: sin él, 412. Como mucho 1 por minuto (429).
  Ver services/aviso-del-trabajador.ts.
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const cuerpo = await request.json().catch(() => null);
    const enviado = await enviarAvisoDelTrabajador(contexto, cuerpo);
    return NextResponse.json({ ok: true, ...enviado }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
