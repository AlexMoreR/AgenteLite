import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { mandarWhatsAppAlEquipo } from "@/features/agentes-de-area/servicios/envios";
import { destinoWhatsAppCritico, leerConfigGravedad } from "@/features/avisos-gravedad/servicios/enrutador";
import { prisma } from "@/lib/prisma";
import { CLAVE_ESTADO_ALERTA_CPU, recibirMetricaServidor, type ResultadoDelAviso } from "@/lib/recibir-metrica-servidor";
import { autorizadoPorElReloj } from "@/lib/secreto-del-reloj";

export const dynamic = "force-dynamic";

/*
  Monitoreo del servidor (parte 2). El script del VPS (lo instala el orquestador, no esta app) manda aquí una
  "foto" del servidor cada minuto: CPU, carga, memoria, disco y contenedores. Se guarda, se borra lo de más de
  7 días y, si la CPU pasa de 85 % en 5 fotos seguidas, se le avisa al dueño por WhatsApp (línea Admin) con el
  mismo mecanismo del Agente de Sistemas: solo números del equipo, nunca una línea de ventas, nunca un cliente.
  Se llama con cualquiera de los secretos de siempre del reloj. Solo POST.
*/

const PREFIJO_AVISOS = "agente-v3:avisos:";

/**
 * El negocio del dueño: entre los que tienen la configuración de avisos (Mi empresa → Equipo), el primero
 * (orden por clave) que tiene número de administrador y línea interna (Admin).
 */
async function avisarAlDueno(pedido: { titulo: string; texto: string; ahora: Date }): Promise<ResultadoDelAviso> {
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: PREFIJO_AVISOS } },
    select: { key: true },
    orderBy: { key: "asc" },
  });
  for (const fila of filas) {
    const workspaceId = fila.key.slice(PREFIJO_AVISOS.length);
    if (!workspaceId) continue;
    const destino = await destinoWhatsAppCritico(workspaceId, await leerConfigGravedad(workspaceId)).catch(() => null);
    if (!destino) continue;
    const resultado = await mandarWhatsAppAlEquipo({
      workspaceId,
      area: "sistemas",
      ahora: pedido.ahora,
      pedido: {
        tipo: "ALEXANDER",
        numero: destino.numero,
        destinatario: "Alexander",
        prioridad: "URGENTE",
        titulo: pedido.titulo,
        texto: pedido.texto,
      },
    });
    return { mandada: resultado.ok, motivo: resultado.ok ? null : (resultado.motivo ?? "no se mandó") };
  }
  return { mandada: false, motivo: "ningún negocio tiene número del administrador y línea Admin en Mi empresa → Equipo" };
}

export async function POST(request: Request) {
  const { status, cuerpo } = await recibirMetricaServidor(
    { headers: request.headers, leerJson: () => request.json() },
    {
      ahora: () => new Date(),
      autorizado: autorizadoPorElReloj,
      guardar: async (muestra, tomadaEn) => {
        await prisma.metricaServidor.create({
          data: {
            tomadaEn,
            cpuTotal: muestra.cpuTotal,
            load1: muestra.load1,
            nucleos: muestra.nucleos,
            memUsadaMb: muestra.memUsadaMb,
            memTotalMb: muestra.memTotalMb,
            swapUsadoMb: muestra.swapUsadoMb,
            discoUsadoGb: muestra.discoUsadoGb,
            discoTotalGb: muestra.discoTotalGb,
            contenedores: muestra.contenedores as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
      },
      borrarAntesDe: async (fecha) => (await prisma.metricaServidor.deleteMany({ where: { tomadaEn: { lt: fecha } } })).count,
      ultimas: (cuantas) =>
        prisma.metricaServidor.findMany({
          orderBy: { tomadaEn: "desc" },
          take: cuantas,
          select: { cpuTotal: true, load1: true, nucleos: true },
        }),
      leerEstado: async () =>
        (await prisma.appSetting.findUnique({ where: { key: CLAVE_ESTADO_ALERTA_CPU }, select: { value: true } }))?.value ?? null,
      guardarEstado: async (value) => {
        await prisma.appSetting.upsert({
          where: { key: CLAVE_ESTADO_ALERTA_CPU },
          create: { key: CLAVE_ESTADO_ALERTA_CPU, value },
          update: { value },
        });
      },
      avisar: avisarAlDueno,
      registrar: (mensaje) => console.warn(mensaje),
    },
  );
  return NextResponse.json(cuerpo, { status });
}
