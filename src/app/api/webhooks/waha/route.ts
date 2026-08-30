import { NextRequest, NextResponse } from "next/server";

import { POST as recibirEvolution } from "@/app/api/webhooks/evolution/route";
import { traducirEventoWaha } from "@/lib/waha";

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

  const traduccion = traducirEventoWaha(cuerpo);
  if (!traduccion.evolution) {
    console.log("[waha webhook] evento ignorado:", traduccion.motivo);
    return NextResponse.json({ ok: true, ignorado: traduccion.motivo });
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

  return recibirEvolution(pedido);
}

/** WAHA no verifica la URL como Meta, pero tener el GET ayuda a probar que el endpoint existe. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "waha" });
}
