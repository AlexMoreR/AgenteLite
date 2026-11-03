import { calcularPanel } from "@/features/metas/dominio/calculo";
import { mesActualBogota } from "@/features/metas/dominio/metas-guardadas";
import { recortarPanel, type PanelVisible } from "@/features/metas/dominio/panel-visible";
import { leerMetasDelMes } from "@/features/metas/servicios/metas-del-mes";
import { leerVentasDelMes } from "@/features/metas/servicios/ventas-por-asesora";
import { esJefeDelNegocio, type AccesoDelCrm } from "@/lib/permisos-del-crm";

export type { PanelVisible } from "@/features/metas/dominio/panel-visible";

/**
 * El panel "Meta del mes" de quien entra: las metas del mes (AppSetting), las ventas de Gestión y el cálculo.
 * Si el mes no tiene metas, sale "sin metas". Si Gestión no responde, sale el panel con el aviso y sin cifras.
 */
export async function armarPanel(
  access: AccesoDelCrm,
  workspaceId: string,
  userId: string,
  hoy: Date = new Date(),
): Promise<PanelVisible> {
  const mes = mesActualBogota(hoy);
  const esJefe = esJefeDelNegocio(access);
  const metas = await leerMetasDelMes(workspaceId, mes);
  if (!metas || metas.asesoras.length === 0) return { estado: "sin-metas", mes, puedeEditar: esJefe };
  const ventas = await leerVentasDelMes(workspaceId, mes);
  return recortarPanel(calcularPanel(metas, ventas, hoy), mes, { esJefe, userId });
}
