/**
 * Lo que se le muestra a cada quien del panel "Meta del mes", y cómo se leen las ventas que manda Gestión.
 * Solo lógica, sin base de datos ni red, para poder probarla.
 *
 * Las comisiones son dinero: el jefe ve todas las filas, pero una asesora solo ve la suya y la del equipo
 * (el total y la meta del equipo, nunca lo vendido ni la comisión de las demás).
 */

import type { FilaDeAsesora, FilaDelEquipo, PanelDeMetas, VentaDeGestion } from "./calculo";

export type PanelVisible =
  | { estado: "sin-metas"; mes: string; puedeEditar: boolean }
  | {
      estado: "listo";
      mes: string;
      puedeEditar: boolean;
      /** Jefe: todas. Asesora: solo la suya (vacía si no tiene meta este mes). */
      asesoras: FilaDeAsesora[];
      equipo: FilaDelEquipo;
      avisos: string[];
      /** Solo para el jefe: las ventas del mes que no se le pudieron dar a nadie. */
      sinAsignar: { cantidad: number; monto: number } | null;
    };

/** Recorta el panel calculado según quién lo mira. */
export function panelPara(
  panel: PanelDeMetas,
  mes: string,
  quien: { esJefe: boolean; userId: string },
): PanelVisible {
  if (quien.esJefe) {
    return {
      estado: "listo",
      mes,
      puedeEditar: true,
      asesoras: panel.asesoras,
      equipo: panel.equipo,
      avisos: panel.avisos,
      sinAsignar: {
        cantidad: panel.sinAsignar.length,
        monto: panel.sinAsignar.reduce((suma, venta) => suma + venta.monto, 0),
      },
    };
  }
  return {
    estado: "listo",
    mes,
    puedeEditar: false,
    // Por userId: una fila sin userId (meta cargada solo con el nombre) no es de nadie y no se muestra.
    asesoras: panel.asesoras.filter((fila) => fila.userId !== null && fila.userId === quien.userId),
    equipo: panel.equipo,
    avisos: panel.avisos,
    sinAsignar: null,
  };
}

const textoOpcional = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

/**
 * Una venta de `GET /api/ventas/pagadas` de Gestión → `VentaDeGestion`. `vendedora`, `ganancia` y
 * `ganancia_confiable` son opcionales: Gestión todavía puede no mandarlos. Sin id o sin monto válido devuelve
 * `null` (no se cuenta). Una fecha de pago dañada se deja pasar: `calcularPanel` la descarta y avisa.
 */
export function ventaDesdeGestion(cruda: unknown): VentaDeGestion | null {
  if (!cruda || typeof cruda !== "object") return null;
  const v = cruda as Record<string, unknown>;
  const id = v.id === undefined || v.id === null ? "" : String(v.id).trim();
  if (!id) return null;
  if (v.monto === null || v.monto === undefined || v.monto === "") return null;
  const monto = Number(v.monto);
  if (!Number.isFinite(monto)) return null;

  const venta: VentaDeGestion = { id, monto, fechaPago: String(v.pagadaEn ?? "") };
  const vendedora = textoOpcional(v.vendedora);
  if (vendedora) venta.vendedora = vendedora;
  if (v.ganancia !== null && v.ganancia !== undefined && v.ganancia !== "") {
    const ganancia = Number(v.ganancia);
    if (Number.isFinite(ganancia)) venta.ganancia = ganancia;
  }
  if (typeof v.ganancia_confiable === "boolean") venta.gananciaConfiable = v.ganancia_confiable;
  return venta;
}
