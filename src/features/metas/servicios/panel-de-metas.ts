import { calcularPanel } from "@/features/metas/dominio/calculo";
import { mesActualBogota } from "@/features/metas/dominio/metas-guardadas";
import { panelPara, type PanelVisible } from "@/features/metas/dominio/panel-visible";
import { leerMetasDelMes } from "@/features/metas/servicios/metas-del-mes";
import { leerVentasDelMes } from "@/features/metas/servicios/ventas-por-asesora";
import { esJefeDelNegocio, type AccesoDelCrm } from "@/lib/permisos-del-crm";

export type { PanelVisible } from "@/features/metas/dominio/panel-visible";

/**
 * El panel "Meta del mes" de quien mira: las metas del mes (parte 2), las ventas de Gestión y el cálculo
 * (parte 1), recortado según sea jefe o asesora (ver `panelPara`).
 *
 * Sin metas cargadas sale "sin metas" (y el jefe ve el enlace para cargarlas). Si Gestión no responde, el panel
 * sale igual con lo vendido en blanco y el aviso.
 */
export async function armarPanel(
  access: AccesoDelCrm,
  workspaceId: string,
  userId: string,
  hoy: Date,
): Promise<PanelVisible> {
  const esJefe = esJefeDelNegocio(access);
  const mes = mesActualBogota(hoy);
  const metas = await leerMetasDelMes(workspaceId, mes);
  if (!metas || metas.asesoras.length === 0) return { estado: "sin-metas", mes, puedeEditar: esJefe };

  const ventas = await leerVentasDelMes(workspaceId, mes);
  return panelPara(calcularPanel(metas, ventas, hoy), mes, { esJefe, userId });
}
