import { prisma } from "@/lib/prisma";
import {
  CAMPOS_PANEL,
  armarPanelServidor,
  estadoTarjetaConsultas,
  inicioDelPanel,
  type EstadoTarjetaConsultas,
  type FotoPanel,
} from "@/lib/metricas-servidor";
import { CLAVE_CONSULTAS_LENTAS } from "@/lib/recibir-metrica-servidor";

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

/**
 * Tarjeta "Consultas de más de 10 s": lee AppSetting `servidor:consultas-lentas` (lo guarda el cron cada minuto).
 * Solo lee. Nunca lanza: si la lectura falla, la tarjeta sale gris "Sin dato reciente" y el resto del panel sigue.
 */
export async function leerTarjetaConsultas(ahora = new Date()): Promise<EstadoTarjetaConsultas> {
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_CONSULTAS_LENTAS }, select: { value: true } });
    return estadoTarjetaConsultas(fila?.value, ahora);
  } catch (error) {
    console.error("[metricas-servidor] no se pudieron leer las consultas lentas para el panel", error);
    return estadoTarjetaConsultas(null, ahora);
  }
}
