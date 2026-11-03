/**
 * Metas y comisiones del mes de cada asesora: solo cálculo, sin pantallas ni base de datos.
 *
 * Las ventas vienen de Gestión (monto, fecha de pago, vendedora y ganancia). La comisión se paga por tramos sobre la
 * ganancia: lo vendido hasta la meta paga `porcentajeHastaMeta` y lo que pasa la meta paga `porcentajeSobreMeta`.
 * Cuando falta un dato (la vendedora o la ganancia) la comisión queda en `null`, nunca en 0: un 0 se leería como
 * "no ganaste nada", y lo cierto es "todavía no se sabe".
 */

export type AsesoraConMeta = {
  /** Id de la asesora en el CRM. Las metas por defecto no lo traen: se cruzan por nombre. */
  userId: string | null;
  /** Nombre en el CRM. */
  nombre: string;
  /** Nombre tal como sale en Gestión, si no es igual al del CRM. */
  nombreEnGestion?: string | null;
  meta: number;
  reto: number;
};

export type MetasDelMes = {
  asesoras: AsesoraConMeta[];
  metaEquipo: number;
  minimoEquipo: number;
  bono: number;
  /** Porcentaje (0,10 = 10 %) de la ganancia de lo vendido hasta la meta. */
  porcentajeHastaMeta: number;
  /** Porcentaje (0,20 = 20 %) de la ganancia de lo vendido por encima de la meta. */
  porcentajeSobreMeta: number;
};

export type VentaDeGestion = {
  id: string;
  monto: number;
  /** Fecha de pago en ISO. */
  fechaPago: string;
  vendedora?: string | null;
  ganancia?: number | null;
  /** `false` si Gestión dice que la ganancia todavía puede cambiar (la comisión sale "por confirmar"). */
  gananciaConfiable?: boolean;
};

export type ColorDeAvance = "verde" | "amarillo" | "rojo";

export const ZONA_DEL_NEGOCIO = "America/Bogota";

/** Desde este avance (vendido ÷ esperado) el color es amarillo; por debajo, rojo. */
export const CORTE_AMARILLO = 0.8;

export const AVISO_SIN_GESTION = "No se pudo leer Gestión";
export const AVISO_FALTA_VENDEDORA_O_GANANCIA = "Gestión todavía no manda la vendedora/ganancia";
export const AVISO_FECHA_INVALIDA = "Hay ventas de Gestión sin fecha de pago válida: no se cuentan";

export const METAS_POR_DEFECTO_NOV_2026: MetasDelMes = {
  asesoras: [
    { userId: null, nombre: "Yair", meta: 25_000_000, reto: 32_500_000 },
    { userId: null, nombre: "Ingrid", meta: 20_000_000, reto: 26_000_000 },
    { userId: null, nombre: "María Camila", meta: 10_000_000, reto: 15_000_000 },
  ],
  metaEquipo: 55_000_000,
  minimoEquipo: 30_000_000,
  bono: 300_000,
  porcentajeHastaMeta: 0.1,
  porcentajeSobreMeta: 0.2,
};

/** Quita tildes, pasa a minúsculas y junta espacios (copia de `sinTildes` de agentes-de-area/dominio/reglas.ts). */
export const limpiarNombre = (texto: string) =>
  texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export type VentasAsignadas = {
  /** Una entrada por asesora, en el mismo orden de `asesoras`. */
  porAsesora: Array<{ asesora: AsesoraConMeta; ventas: VentaDeGestion[] }>;
  /** Ventas sin vendedora o cuya vendedora no coincide (o coincide con dos asesoras a la vez). */
  sinAsignar: VentaDeGestion[];
};

/**
 * Cruza la `vendedora` de cada venta con el `nombreEnGestion` o el `nombre` de cada asesora, con los nombres limpios.
 * Si no coincide con nadie, o el nombre es de dos asesoras, la venta no se le da a nadie: va a `sinAsignar`.
 */
export function asignarVentas(ventas: VentaDeGestion[], asesoras: AsesoraConMeta[]): VentasAsignadas {
  const indicePorNombre = new Map<string, number>();
  const repetidos = new Set<string>();
  asesoras.forEach((asesora, indice) => {
    const nombres = new Set([limpiarNombre(asesora.nombre), limpiarNombre(asesora.nombreEnGestion ?? "")]);
    for (const nombre of nombres) {
      if (!nombre) continue;
      if (indicePorNombre.has(nombre) && indicePorNombre.get(nombre) !== indice) repetidos.add(nombre);
      indicePorNombre.set(nombre, indice);
    }
  });

  const porAsesora = asesoras.map((asesora) => ({ asesora, ventas: [] as VentaDeGestion[] }));
  const sinAsignar: VentaDeGestion[] = [];
  for (const venta of ventas) {
    const nombre = limpiarNombre(venta.vendedora ?? "");
    const indice = nombre && !repetidos.has(nombre) ? indicePorNombre.get(nombre) : undefined;
    if (indice === undefined) sinAsignar.push(venta);
    else porAsesora[indice].ventas.push(venta);
  }
  return { porAsesora, sinAsignar };
}

const tieneGanancia = (venta: VentaDeGestion) => typeof venta.ganancia === "number" && Number.isFinite(venta.ganancia);

/**
 * Comisión por tramos. Las ventas tienen que venir ordenadas por fecha de pago: el monto se va acumulando y se
 * compara con la meta. A la venta que cruza la meta se le reparte la ganancia en proporción al monto: la parte que
 * queda bajo la meta paga `p1` y la que pasa paga `p2`. Si a alguna venta le falta la ganancia, la comisión es `null`.
 */
export function comisionPorTramos(
  ventasOrdenadasPorFechaPago: VentaDeGestion[],
  meta: number,
  p1: number,
  p2: number,
): { comision: number | null; porConfirmar: boolean } {
  const porConfirmar = ventasOrdenadasPorFechaPago.some((venta) => venta.gananciaConfiable === false);
  if (!ventasOrdenadasPorFechaPago.every(tieneGanancia)) return { comision: null, porConfirmar };

  let acumulado = 0;
  let comision = 0;
  for (const venta of ventasOrdenadasPorFechaPago) {
    const ganancia = venta.ganancia as number;
    const antes = acumulado;
    acumulado += venta.monto;
    if (venta.monto <= 0) {
      // Sin monto no hay proporción: va al tramo en que estaba lo acumulado.
      comision += ganancia * (antes < meta ? p1 : p2);
      continue;
    }
    const bajoLaMeta = Math.max(0, Math.min(acumulado, meta) - antes);
    const parteBajo = bajoLaMeta / venta.monto;
    comision += ganancia * parteBajo * p1 + ganancia * (1 - parteBajo) * p2;
  }
  return { comision: Math.round(comision), porConfirmar };
}

/** Año, mes (1-12) y día de una fecha en la zona dada. */
function fechaEnZona(fecha: Date, zona: string) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(fecha);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value);
  return { anio: valor("year"), mes: valor("month"), dia: valor("day") };
}

const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/** Lo que se esperaría llevar vendido hoy: meta × días corridos del mes (contando hoy) ÷ días del mes. */
export function esperadoALaFecha(meta: number, hoy: Date, zona: string = ZONA_DEL_NEGOCIO): number {
  const { anio, mes, dia } = fechaEnZona(hoy, zona);
  return Math.round((meta * dia) / diasDelMes(anio, mes));
}

/** Verde si va al 100 % o más de lo esperado, amarillo desde el 80 %, rojo por debajo. */
export function colorDeAvance(vendido: number, esperado: number): ColorDeAvance {
  if (esperado <= 0 || vendido >= esperado) return "verde";
  if (vendido >= esperado * CORTE_AMARILLO) return "amarillo";
  return "rojo";
}

export const bonoGanado = (totalEquipo: number, metaEquipo: number) => totalEquipo >= metaEquipo;

export type FilaDeAsesora = {
  userId: string | null;
  nombre: string;
  meta: number;
  reto: number;
  /** `null` si no se pudo leer Gestión. */
  vendido: number | null;
  falta: number | null;
  esperado: number;
  color: ColorDeAvance | null;
  /** `null` si no se pudo calcular (falta Gestión, la vendedora o la ganancia). Nunca 0 por falta de datos. */
  comisionEstimada: number | null;
  porConfirmar: boolean;
};

export type FilaDelEquipo = {
  total: number | null;
  meta: number;
  minimo: number;
  metaSemanal: number;
  esperado: number;
  bono: number;
  bonoGanado: boolean | null;
  color: ColorDeAvance | null;
};

export type PanelDeMetas = {
  asesoras: FilaDeAsesora[];
  equipo: FilaDelEquipo;
  avisos: string[];
  /** Ventas del mes que no se pudieron dar a ninguna asesora (cuentan para el total del equipo). */
  sinAsignar: VentaDeGestion[];
};

const fechaDePago = (venta: VentaDeGestion) => new Date(venta.fechaPago).getTime();

/**
 * Arma el panel del mes de `hoy` (en hora de Bogotá): una fila por asesora, la fila del equipo y los avisos.
 * Solo cuentan las ventas pagadas en ese mes. Si `ventas` es `null` (no se pudo leer Gestión), lo vendido, los
 * colores y las comisiones quedan en `null` y sale el aviso.
 */
export function calcularPanel(metas: MetasDelMes, ventas: VentaDeGestion[] | null, hoy: Date): PanelDeMetas {
  const avisos: string[] = [];
  const esperadoEquipo = esperadoALaFecha(metas.metaEquipo, hoy);
  const equipoBase = {
    meta: metas.metaEquipo,
    minimo: metas.minimoEquipo,
    metaSemanal: Math.round(metas.metaEquipo / 4),
    esperado: esperadoEquipo,
    bono: metas.bono,
  };

  if (ventas === null) {
    avisos.push(AVISO_SIN_GESTION);
    return {
      asesoras: metas.asesoras.map((asesora) => ({
        userId: asesora.userId,
        nombre: asesora.nombre,
        meta: asesora.meta,
        reto: asesora.reto,
        vendido: null,
        falta: null,
        esperado: esperadoALaFecha(asesora.meta, hoy),
        color: null,
        comisionEstimada: null,
        porConfirmar: false,
      })),
      equipo: { ...equipoBase, total: null, bonoGanado: null, color: null },
      avisos,
      sinAsignar: [],
    };
  }

  const { anio, mes } = fechaEnZona(hoy, ZONA_DEL_NEGOCIO);
  const conFechaValida = ventas.filter((venta) => Number.isFinite(fechaDePago(venta)));
  if (conFechaValida.length < ventas.length) avisos.push(AVISO_FECHA_INVALIDA);
  const delMes = conFechaValida
    .filter((venta) => {
      const fecha = fechaEnZona(new Date(venta.fechaPago), ZONA_DEL_NEGOCIO);
      return fecha.anio === anio && fecha.mes === mes;
    })
    .sort((a, b) => fechaDePago(a) - fechaDePago(b) || a.id.localeCompare(b.id));

  const faltaVendedora = delMes.some((venta) => !limpiarNombre(venta.vendedora ?? ""));
  const faltaGanancia = delMes.some((venta) => !tieneGanancia(venta));
  if (faltaVendedora || faltaGanancia) avisos.push(AVISO_FALTA_VENDEDORA_O_GANANCIA);

  const { porAsesora, sinAsignar } = asignarVentas(delMes, metas.asesoras);
  const filas = porAsesora.map(({ asesora, ventas: suyas }): FilaDeAsesora => {
    const vendido = suyas.reduce((suma, venta) => suma + venta.monto, 0);
    const esperado = esperadoALaFecha(asesora.meta, hoy);
    const { comision, porConfirmar } = comisionPorTramos(
      suyas,
      asesora.meta,
      metas.porcentajeHastaMeta,
      metas.porcentajeSobreMeta,
    );
    return {
      userId: asesora.userId,
      nombre: asesora.nombre,
      meta: asesora.meta,
      reto: asesora.reto,
      vendido,
      falta: Math.max(0, asesora.meta - vendido),
      esperado,
      color: colorDeAvance(vendido, esperado),
      // Una venta sin vendedora puede ser de cualquiera y mover sus tramos: nadie tiene comisión segura.
      comisionEstimada: faltaVendedora ? null : comision,
      porConfirmar,
    };
  });

  const total = delMes.reduce((suma, venta) => suma + venta.monto, 0);
  return {
    asesoras: filas,
    equipo: {
      ...equipoBase,
      total,
      bonoGanado: bonoGanado(total, metas.metaEquipo),
      color: colorDeAvance(total, esperadoEquipo),
    },
    avisos,
    sinAsignar,
  };
}
