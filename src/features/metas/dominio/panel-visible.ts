import type { FilaDeAsesora, FilaDelEquipo, PanelDeMetas, VentaDeGestion } from "@/features/metas/dominio/calculo";

/**
 * Partes puras del panel "Meta del mes" (sin base ni Gestión, para probarlas): leer la respuesta de Gestión y
 * recortar el panel a lo que puede ver cada persona.
 */

const textoOpcional = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

const numeroOpcional = (valor: unknown) => {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
};

/**
 * Lee `{ ventas: [...] }` de `GET /api/ventas/pagadas`. `vendedora`, `ganancia` y `ganancia_confiable` son
 * opcionales: si no vienen, la venta igual cuenta y el cálculo avisa que faltan. Una venta sin id o sin monto no se
 * puede contar y se salta. La de fecha dañada se deja pasar para que el cálculo la avise; la de otra fecha se quita.
 * `null` si la respuesta no trae la lista.
 */
export function leerVentasDeLaRespuesta(
  datos: unknown,
  rango: { desdeFecha: Date; hastaFecha: Date },
): VentaDeGestion[] | null {
  const lista = (datos as { ventas?: unknown } | null)?.ventas;
  if (!Array.isArray(lista)) return null;
  const ventas: VentaDeGestion[] = [];
  for (const crudo of lista) {
    if (!crudo || typeof crudo !== "object") continue;
    const v = crudo as Record<string, unknown>;
    const id = v.id === undefined || v.id === null ? "" : String(v.id);
    const monto = numeroOpcional(v.monto);
    if (!id || monto === null) continue;
    const fechaPago = String(v.pagadaEn ?? "");
    const instante = new Date(fechaPago).getTime();
    if (Number.isFinite(instante) && (instante < rango.desdeFecha.getTime() || instante >= rango.hastaFecha.getTime())) {
      continue;
    }
    ventas.push({
      id,
      monto,
      fechaPago,
      vendedora: textoOpcional(v.vendedora),
      ganancia: numeroOpcional(v.ganancia),
      ...(typeof v.ganancia_confiable === "boolean" ? { gananciaConfiable: v.ganancia_confiable } : {}),
    });
  }
  return ventas;
}

export type SinAsignar = { cuantas: number; monto: number; vendedoras: string[] };

export type PanelVisible =
  | { estado: "sin-metas"; mes: string; puedeEditar: boolean }
  | {
      estado: "listo";
      mes: string;
      /** Jefe: todas. Asesora: solo la suya (o ninguna si no tiene meta este mes). */
      asesoras: FilaDeAsesora[];
      equipo: FilaDelEquipo;
      avisos: string[];
      /** Solo para el jefe. */
      sinAsignar: SinAsignar | null;
      puedeEditar: boolean;
    };

/**
 * Lo que ve cada quien. El jefe: todo. La asesora: su fila (por userId) y la del equipo; nunca la comisión ni las
 * cifras de las demás, ni las ventas sin asignar (traen nombres y montos de otras).
 */
export function recortarPanel(
  panel: PanelDeMetas,
  mes: string,
  quien: { esJefe: boolean; userId: string },
): PanelVisible {
  if (quien.esJefe) {
    const vendedoras = [...new Set(panel.sinAsignar.map((venta) => venta.vendedora?.trim()).filter(Boolean) as string[])];
    return {
      estado: "listo",
      mes,
      asesoras: panel.asesoras,
      equipo: panel.equipo,
      avisos: panel.avisos,
      sinAsignar: panel.sinAsignar.length
        ? {
            cuantas: panel.sinAsignar.length,
            monto: panel.sinAsignar.reduce((suma, venta) => suma + venta.monto, 0),
            vendedoras,
          }
        : null,
      puedeEditar: true,
    };
  }
  return {
    estado: "listo",
    mes,
    asesoras: panel.asesoras.filter((fila) => fila.userId !== null && fila.userId === quien.userId).slice(0, 1),
    equipo: panel.equipo,
    avisos: panel.avisos,
    sinAsignar: null,
    puedeEditar: false,
  };
}
