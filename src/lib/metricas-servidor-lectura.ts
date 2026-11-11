import { prisma } from "@/lib/prisma";
import { CAMPOS_PANEL, armarPanelServidor, inicioDelPanel, type FotoPanel } from "@/lib/metricas-servidor";

/**
 * Lee las fotos del servidor de las últimas 24 h para Dirección → Servidor (la usan la página y la ruta GET).
 * Solo lee. Las fotos van ordenadas de la más vieja a la más nueva y sin `contenedores`; los contenedores se leen
 * aparte, solo de la última foto, para que la respuesta no cargue 1.440 listas.
 */
export async function leerPanelServidor(ahora = new Date()): Promise<FotoPanel[]> {
  const desde = inicioDelPanel(ahora);
  const [filas, ultima] = await Promise.all([
    prisma.metricaServidor.findMany({
      where: { tomadaEn: { gte: desde } },
      orderBy: { tomadaEn: "asc" },
      select: CAMPOS_PANEL,
    }),
    prisma.metricaServidor.findFirst({
      where: { tomadaEn: { gte: desde } },
      orderBy: { tomadaEn: "desc" },
      select: { contenedores: true },
    }),
  ]);
  return armarPanelServidor(filas, ultima?.contenedores ?? null);
}
