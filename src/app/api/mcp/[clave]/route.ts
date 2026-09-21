import { NextResponse } from "next/server";

import { atenderMcp } from "@/app/api/mcp/route";

export const dynamic = "force-dynamic";

/*
  La misma puerta del MCP, con la clave en la direccion.

  Existe por el conector de claude.ai: ahi se elige OAuth o "sin inicio de sesion", y no hay donde
  escribir una clave. Con esta ruta se pega la direccion con la clave adentro y funciona hoy, desde
  el navegador y desde el celular. Cuando este el OAuth, esto queda como atajo.
*/
export async function POST(request: Request, context: { params: Promise<{ clave: string }> }) {
  const { clave } = await context.params;
  return atenderMcp(request, clave);
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
