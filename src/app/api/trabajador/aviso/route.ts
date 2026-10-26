import { NextResponse } from "next/server";

import { enviarAvisoDelTrabajador } from "@/features/tableros-inteligentes/services/aviso-del-trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../tablero/autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/aviso — el Coordinador del Tablero IA le manda un WhatsApp al dueño desde la línea Admin
  (solo cuando se agotó el límite de Claude o necesita algo que no puede hacer solo). Misma clave que
  /api/trabajador/tablero/* (Bearer aizen_trab_...). Cuerpo `{ texto, tipo }` (texto hasta 500 caracteres; tipo
  "limite" | "necesita": sin tipo se descarta sin error). El número sale de Mi empresa → Claude. Responde
  `{ ok, enviado, motivo }`. Ver services/aviso-del-trabajador.ts y services/avisos-al-dueno.ts.
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const cuerpo = await request.json().catch(() => null);
    const enviado = await enviarAvisoDelTrabajador(contexto, cuerpo);
    return NextResponse.json(enviado, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
