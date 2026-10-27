import { prisma } from "@/lib/prisma";

import { numeroDeAvisosDeLaPersona } from "@/features/avisos-gravedad/servicios/enrutador";

import { conteoPorAsesora, diaDeBogota, inicioDelDia, type ConteoDeAsesora } from "../dominio/reglas";

/**
 * El registro de avisos y reasignaciones (SupervisorAviso), para la pantalla del Supervisor y para
 * el MCP. Solo lectura.
 */

export type AvisoRegistrado = {
  id: string;
  tipo: string;
  conversationId: string;
  asesoraId: string | null;
  asesoraNuevaId: string | null;
  minutosEsperando: number;
  whatsappEnviado: boolean;
  error: string | null;
  creadoEn: Date;
};

export type RegistroDelDia = {
  dia: string;
  avisos: AvisoRegistrado[];
  conteo: ConteoDeAsesora[];
  total: number;
};

/** Lo anotado en un día de Bogotá (YYYY-MM-DD; por defecto hoy). Lista máx. 200, el conteo sale de todo el día. */
export async function leerRegistroDelDia(workspaceId: string, dia = diaDeBogota(new Date())): Promise<RegistroDelDia> {
  const desde = inicioDelDia(dia);
  const hasta = new Date(desde.getTime() + 24 * 3_600_000);
  const filas = await prisma.supervisorAviso.findMany({
    where: { workspaceId, creadoEn: { gte: desde, lt: hasta } },
    orderBy: { creadoEn: "desc" },
    take: 2000,
  });
  return {
    dia,
    avisos: filas.slice(0, 200),
    conteo: conteoPorAsesora(filas),
    total: filas.length,
  };
}

/** Los nombres de las asesoras que no tienen número de avisos en Mi empresa → Equipo (no les llega el WhatsApp). */
export async function asesorasSinNumeroDeAvisos(workspaceId: string, nombres: Record<string, string>): Promise<string[]> {
  const sin: string[] = [];
  for (const [id, nombre] of Object.entries(nombres)) {
    if (!(await numeroDeAvisosDeLaPersona(workspaceId, id).catch(() => null))) sin.push(nombre);
  }
  return sin;
}
