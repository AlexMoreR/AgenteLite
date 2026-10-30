import { NextResponse } from "next/server";

import { enviarAvisoDelTrabajador } from "@/features/tableros-inteligentes/services/aviso-del-trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../tablero/autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/aviso — el Coordinador del Tablero IA le manda un WhatsApp al dueño desde la línea Admin
  del negocio. Misma clave que /api/trabajador/tablero/* (Bearer aizen_trab_...). Cuerpo `{ texto, tipo, tarjetaId? }`
  (hasta 500 caracteres y 3 líneas). `tarjetaId` (opcional): la tarjeta de la que habla el aviso; si no es de este negocio,
  no existe o está borrada, se ignora sin error. Solo pasan los tipos "limite" (Claude se agotó y todo quedó en pausa) y
  "necesita" (algo que el sistema no puede hacer solo); sin tipo o con otro se descarta con 200 `descartado: true`.
  El número sale de la caja "Avisos de Sistemas por WhatsApp" de Mi empresa → Claude (validado en el servidor).
  Como mucho 1 por minuto (429). Silencio de 9 p. m. a 7 a. m. y interruptor apagado: 200 sin mandar nada
  (`silenciado` / `apagado`). Ver services/aviso-del-trabajador.ts y services/avisos-al-dueno.ts.
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
