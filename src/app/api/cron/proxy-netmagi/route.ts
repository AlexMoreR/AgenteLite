import { NextResponse } from "next/server";

import { registrarAlerta, resolverAlertasPorClave } from "@/features/alertas/servicios/alertas";
import { prisma } from "@/lib/prisma";
import { CLAVE_ULTIMO_CHEQUEO_NETMAGI, recibirEstadoProxyNetmagi } from "@/lib/recibir-estado-proxy-netmagi";
import { autorizadoPorElReloj } from "@/lib/secreto-del-reloj";

export const dynamic = "force-dynamic";

/*
  NETMAGI (parte 1). El chequeo de aizen1 (y, más adelante, la extensión NETMAGI) manda aquí el estado del túnel
  SOCKS (puerto 1080) y de cada cuenta mf1 a mf14. Se abren o cierran alertas en /cliente/alertas (Sistemas), una
  por clave, sin WhatsApp. Solo lee y avisa: nunca cambia IPs, proxies ni cuentas.
  Se llama con cualquiera de los secretos de siempre del reloj. Solo POST.
*/

const PREFIJO_AVISOS = "agente-v3:avisos:";

/** El negocio: NETMAGI_WORKSPACE_ID si existe; si no, el primero (orden por clave) con avisos configurados. */
async function buscarNegocio(): Promise<string | null> {
  const delEntorno = process.env.NETMAGI_WORKSPACE_ID?.trim();
  if (delEntorno) return delEntorno;
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: PREFIJO_AVISOS } },
    select: { key: true },
    orderBy: { key: "asc" },
  });
  for (const fila of filas) {
    const workspaceId = fila.key.slice(PREFIJO_AVISOS.length);
    if (workspaceId) return workspaceId;
  }
  return null;
}

export async function POST(request: Request) {
  const { status, cuerpo } = await recibirEstadoProxyNetmagi(
    { headers: request.headers, leerJson: () => request.json() },
    {
      ahora: () => new Date(),
      autorizado: autorizadoPorElReloj,
      buscarNegocio,
      registrarAlerta: (pedido) => registrarAlerta(pedido),
      resolverPorClave: resolverAlertasPorClave,
      leerAjuste: async () =>
        (await prisma.appSetting.findUnique({ where: { key: CLAVE_ULTIMO_CHEQUEO_NETMAGI }, select: { value: true } }))?.value ?? null,
      guardarAjuste: async (value) => {
        await prisma.appSetting.upsert({
          where: { key: CLAVE_ULTIMO_CHEQUEO_NETMAGI },
          create: { key: CLAVE_ULTIMO_CHEQUEO_NETMAGI, value },
          update: { value },
        });
      },
      registrar: (mensaje) => console.warn(mensaje),
    },
  );
  return NextResponse.json(cuerpo, { status });
}
