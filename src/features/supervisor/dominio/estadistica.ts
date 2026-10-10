/**
 * ESTADÍSTICA SIMPLE Y BARATA del Supervisor.
 *
 * Nada de modelos pesados: proporciones con intervalo de Wilson, prueba de dos proporciones,
 * EWMA y CUSUM sobre tasas, y la distancia de Jensen-Shannon entre dos distribuciones (para ver si
 * cambió la regla que gana el primer mensaje). Todo es código puro: se prueba con
 * `npm run test:supervisor` y corre igual en vivo, en la simulación y en las pruebas.
 *
 * La regla de oro es NO GRITAR EN FALSO: una herramienta que da falsas alarmas deja de leerse.
 * Por eso cada comparación exige un tamaño mínimo de muestra y un efecto mínimo en puntos, además
 * de la significancia.
 */

export type Proporcion = { exitos: number; total: number };

/** Proporción (0..1) o null si no hay muestra. */
export function tasa(p: Proporcion): number | null {
  return p.total > 0 ? p.exitos / p.total : null;
}

/** Intervalo de Wilson (por defecto al 95 %). Devuelve [0, 1] si no hay muestra. */
export function wilson(p: Proporcion, z = 1.96): { centro: number; bajo: number; alto: number } {
  const { exitos, total } = p;
  if (total <= 0) return { centro: 0, bajo: 0, alto: 1 };
  const phat = exitos / total;
  const z2 = z * z;
  const denominador = 1 + z2 / total;
  const centro = (phat + z2 / (2 * total)) / denominador;
  const margen = (z * Math.sqrt((phat * (1 - phat)) / total + z2 / (4 * total * total))) / denominador;
  return { centro, bajo: Math.max(0, centro - margen), alto: Math.min(1, centro + margen) };
}

/** Función de distribución normal estándar (aproximación de Abramowitz y Stegun 7.1.26). */
export function normalAcumulada(x: number): number {
  const signo = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + signo * y);
}

/**
 * Prueba de dos proporciones (observado contra esperado), con varianza combinada.
 * z > 0 = lo observado está POR ENCIMA de lo esperado. `p` es de dos colas.
 */
export function dosProporciones(observado: Proporcion, esperado: Proporcion): { z: number; p: number; diferencia: number } {
  if (observado.total <= 0 || esperado.total <= 0) return { z: 0, p: 1, diferencia: 0 };
  const p1 = observado.exitos / observado.total;
  const p2 = esperado.exitos / esperado.total;
  const combinada = (observado.exitos + esperado.exitos) / (observado.total + esperado.total);
  const error = Math.sqrt(combinada * (1 - combinada) * (1 / observado.total + 1 / esperado.total));
  if (error === 0) {
    // Ambas en 0 % o ambas en 100 %: sin diferencia. Si una es 0 % y la otra 100 % el error no es 0.
    return { z: 0, p: 1, diferencia: p1 - p2 };
  }
  const z = (p1 - p2) / error;
  return { z, p: 2 * (1 - normalAcumulada(Math.abs(z))), diferencia: p1 - p2 };
}

export type ReglaDeSignificancia = {
  /** Mínimo de leads en la ventana observada. */
  minimoObservado: number;
  /** Mínimo de leads en la línea base. */
  minimoBase: number;
  /** |z| mínimo (3 ≈ p < 0,003: exigente a propósito, se hacen muchas pruebas por hora). */
  zMinimo: number;
  /** Efecto mínimo en puntos porcentuales (0..100). */
  puntosMinimos: number;
};

export const SIGNIFICANCIA_POR_DEFECTO: ReglaDeSignificancia = {
  minimoObservado: 20,
  minimoBase: 50,
  zMinimo: 3,
  puntosMinimos: 10,
};

export type Comparacion = {
  observado: Proporcion;
  esperado: Proporcion;
  tasaObservada: number | null;
  tasaEsperada: number | null;
  /** Puntos porcentuales (observado − esperado). */
  puntos: number;
  z: number;
  p: number;
  /** Hay muestra suficiente para opinar. */
  conMuestra: boolean;
  /** Cambió de verdad: muestra + |z| + efecto mínimo. */
  significativo: boolean;
  /** "baja" o "sube" (solo si es significativo). */
  direccion: "baja" | "sube" | null;
};

/** Compara una tasa observada con su línea base y dice si el cambio es real. */
export function comparar(observado: Proporcion, esperado: Proporcion, regla = SIGNIFICANCIA_POR_DEFECTO): Comparacion {
  const prueba = dosProporciones(observado, esperado);
  const conMuestra = observado.total >= regla.minimoObservado && esperado.total >= regla.minimoBase;
  const puntos = prueba.diferencia * 100;
  const significativo = conMuestra && Math.abs(prueba.z) >= regla.zMinimo && Math.abs(puntos) >= regla.puntosMinimos;
  return {
    observado,
    esperado,
    tasaObservada: tasa(observado),
    tasaEsperada: tasa(esperado),
    puntos,
    z: prueba.z,
    p: prueba.p,
    conMuestra,
    significativo,
    direccion: significativo ? (puntos < 0 ? "baja" : "sube") : null,
  };
}

/** Media móvil exponencial. Devuelve la serie suavizada (misma longitud). */
export function ewma(valores: number[], alfa = 0.3): number[] {
  const salida: number[] = [];
  let previo: number | null = null;
  for (const valor of valores) {
    previo = previo === null ? valor : alfa * valor + (1 - alfa) * previo;
    salida.push(previo);
  }
  return salida;
}

/**
 * CUSUM de una cola para detectar una BAJA en una tasa de éxito (por ejemplo, la respuesta del
 * cliente), lead por lead. Acumula (p0 − x − k) y alarma cuando pasa h.
 *
 * - p0: tasa esperada (línea base).
 * - k: holgura (la mitad del cambio que se quiere detectar, en proporción: 0,075 = 15 pts / 2).
 * - h: umbral de alarma (en "leads equivalentes"; 4 es un valor habitual).
 *
 * Devuelve el índice del primer lead donde alarma (o null) y el valor final.
 */
export function cusumBaja(exitos: Array<0 | 1 | boolean>, p0: number, k = 0.075, h = 4): { alarmaEn: number | null; valor: number; serie: number[] } {
  let s = 0;
  let alarmaEn: number | null = null;
  const serie: number[] = [];
  exitos.forEach((x, indice) => {
    s = Math.max(0, s + (p0 - (x ? 1 : 0) - k));
    serie.push(s);
    if (alarmaEn === null && s >= h) alarmaEn = indice;
  });
  return { alarmaEn, valor: s, serie };
}

/** Normaliza un conteo {clave: n} en una distribución de probabilidad. */
export function distribucion(conteo: Record<string, number>): Record<string, number> {
  const total = Object.values(conteo).reduce((a, b) => a + b, 0);
  if (total <= 0) return {};
  return Object.fromEntries(Object.entries(conteo).map(([clave, n]) => [clave, n / total]));
}

/**
 * Divergencia de Jensen-Shannon (base 2) entre dos conteos: 0 = iguales, 1 = sin nada en común.
 * Simétrica y acotada, a diferencia de Kullback-Leibler: no explota cuando una regla nueva aparece.
 */
export function jensenShannon(a: Record<string, number>, b: Record<string, number>): number {
  const pa = distribucion(a);
  const pb = distribucion(b);
  const claves = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  if (claves.size === 0) return 0;
  let js = 0;
  for (const clave of claves) {
    const x = pa[clave] ?? 0;
    const y = pb[clave] ?? 0;
    const m = (x + y) / 2;
    if (x > 0) js += 0.5 * x * Math.log2(x / m);
    if (y > 0) js += 0.5 * y * Math.log2(y / m);
  }
  return Math.max(0, Math.min(1, js));
}

/** La clave más frecuente de un conteo y su participación (0..1). */
export function moda(conteo: Record<string, number>): { clave: string | null; participacion: number; total: number } {
  const total = Object.values(conteo).reduce((a, b) => a + b, 0);
  let mejor: string | null = null;
  let n = -1;
  for (const [clave, valor] of Object.entries(conteo)) {
    if (valor > n || (valor === n && mejor !== null && clave < mejor)) {
      mejor = clave;
      n = valor;
    }
  }
  return { clave: mejor, participacion: total > 0 ? Math.max(0, n) / total : 0, total };
}

/** Mediana de una lista de números (null si está vacía). */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

/** Redondea a 1 decimal para mostrar porcentajes. */
export function pct(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  return `${(Math.round(valor * 1000) / 10).toLocaleString("es-CO")} %`;
}
