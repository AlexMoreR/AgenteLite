/**
 * AGENTE DE SISTEMAS: las reglas, en código puro (sin base, sin Next).
 *
 * Es la tercera área del molde de agentes de área. Revisa al día siguiente lo que el trabajador subió a
 * producción: si funciona, si se usa y si movió el número. SOLO LEE. El CRM le da los datos ya cruzados
 * (herramienta `revision_de_sistemas`) y guarda su resumen. Las pruebas están en scripts/check-agente-de-sistemas.mjs.
 */

/** Cuántas horas atrás cuenta una tarjeta "HECHO" para la revisión del día siguiente. */
export const HORAS_DE_REVISION = 24;
/** Una tarjeta más de 2 h en PLANEANDO, EN_CURSO o SUBIENDO se considera atascada. */
export const HORAS_PARA_ATASCADA = 2;
/** Si el trabajador no usó su clave en más de 30 minutos, se dice "sin señal". */
export const MINUTOS_SIN_SENAL = 30;
export const ESTADOS_QUE_SE_ATASCAN = ["PLANEANDO", "EN_CURSO", "SUBIENDO"] as const;

export const RESULTADOS_DE_REVISION = ["FUNCIONA", "FALLA", "NO_SE_PUEDE_PROBAR"] as const;
export type ResultadoDeRevision = (typeof RESULTADOS_DE_REVISION)[number];

export const LINEA_TODO_FUNCIONA = "Sistemas: todo funciona";
export const LINEA_SIN_REVISION = "Sistemas: sin revisión hoy";

const HORA_MS = 3_600_000;
const MINUTO_MS = 60_000;

/* ------------------------------------------------------------------------------------------------
   LO QUE SE REVISA: tarjetas HECHO, atascadas, en ERROR y el trabajador
------------------------------------------------------------------------------------------------ */

export type CambioDeEstado = { tarjetaId: string; estadoNuevo: string; en: Date };

/**
 * Quiénes quedaron HECHO en las últimas `horas` horas, con la hora en que quedaron (sale del historial: no hay
 * columna "terminó en"). Si una tarjeta quedó HECHO dos veces, vale la última. Devuelve tarjetaId → hora.
 */
export function hechasRecientes(cambios: CambioDeEstado[], ahora: Date, horas: number = HORAS_DE_REVISION): Map<string, Date> {
  const desde = ahora.getTime() - horas * HORA_MS;
  const salida = new Map<string, Date>();
  for (const cambio of cambios) {
    if (cambio.estadoNuevo !== "HECHO") continue;
    const t = cambio.en.getTime();
    if (t < desde || t > ahora.getTime()) continue;
    const previo = salida.get(cambio.tarjetaId);
    if (!previo || previo.getTime() < t) salida.set(cambio.tarjetaId, cambio.en);
  }
  return salida;
}

export type TarjetaEnTrabajo = {
  id: string;
  estado: string;
  /** Desde cuándo la tiene el trabajador (candado); si no hay, la última vez que cambió. */
  trabajoIniciadoEn: Date | null;
  actualizadoEn: Date;
};

export type TarjetaAtascada = { id: string; estado: string; minutos: number };

/** Las que llevan MÁS de `horas` horas en PLANEANDO, EN_CURSO o SUBIENDO. Justo en el límite NO cuenta. */
export function tarjetasAtascadas(tarjetas: TarjetaEnTrabajo[], ahora: Date, horas: number = HORAS_PARA_ATASCADA): TarjetaAtascada[] {
  const salida: TarjetaAtascada[] = [];
  for (const tarjeta of tarjetas) {
    if (!(ESTADOS_QUE_SE_ATASCAN as readonly string[]).includes(tarjeta.estado)) continue;
    const desde = tarjeta.trabajoIniciadoEn ?? tarjeta.actualizadoEn;
    const minutos = Math.floor((ahora.getTime() - desde.getTime()) / MINUTO_MS);
    if (minutos > horas * 60) salida.push({ id: tarjeta.id, estado: tarjeta.estado, minutos });
  }
  return salida.sort((a, b) => b.minutos - a.minutos);
}

export type EstadoDelTrabajador = { vivo: boolean; minutosSinUso: number | null; texto: string };

/** ¿El trabajador está vivo? Lo dice la última vez que usó su clave ("aizen1"). */
export function estadoDelTrabajador(ultimoUsoEn: Date | null | undefined, ahora: Date): EstadoDelTrabajador {
  if (!ultimoUsoEn) return { vivo: false, minutosSinUso: null, texto: "sin señal: la clave del trabajador nunca se ha usado" };
  const minutos = Math.max(0, Math.floor((ahora.getTime() - ultimoUsoEn.getTime()) / MINUTO_MS));
  if (minutos > MINUTOS_SIN_SENAL) return { vivo: false, minutosSinUso: minutos, texto: `sin señal desde ${ultimoUsoEn.toISOString()} (hace ${minutos} min)` };
  return { vivo: true, minutosSinUso: minutos, texto: `vivo: usó su clave hace ${minutos} min` };
}

/** El motivo de un ERROR, leído del resultado que guarda el trabajador ({ error?: string | { mensaje } }). */
export function motivoDeError(resultado: unknown): string | null {
  const datos = resultado && typeof resultado === "object" && !Array.isArray(resultado) ? (resultado as Record<string, unknown>) : {};
  const error = datos.error;
  if (typeof error === "string" && error.trim()) return error.trim().slice(0, 600);
  if (error && typeof error === "object") {
    const mensaje = (error as Record<string, unknown>).mensaje ?? (error as Record<string, unknown>).causa;
    if (typeof mensaje === "string" && mensaje.trim()) return mensaje.trim().slice(0, 600);
  }
  return null;
}

/** El commit y la rama de lo que subió el trabajador, leídos de su resultado. */
export function commitYRama(resultado: unknown): { commit: string | null; rama: string | null } {
  const datos = resultado && typeof resultado === "object" && !Array.isArray(resultado) ? (resultado as Record<string, unknown>) : {};
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
  const subida = datos.subida && typeof datos.subida === "object" ? (datos.subida as Record<string, unknown>) : {};
  return { commit: texto(datos.commit) ?? texto(subida.commit), rama: texto(datos.rama) };
}

/* ------------------------------------------------------------------------------------------------
   QUÉ SE CONSTRUYÓ Y SI SE USA
------------------------------------------------------------------------------------------------ */

const RUTA_DE_PANTALLA = /\/cliente\/[a-z0-9][a-z0-9\-_/]*/gi;

/** Las pantallas (/cliente/...) que nombra el texto de una tarjeta. */
export function rutasDeTexto(texto: string): string[] {
  const vistas = new Set<string>();
  for (const hallada of texto.match(RUTA_DE_PANTALLA) ?? []) vistas.add(hallada.replace(/[/\-_]+$/, ""));
  return [...vistas];
}

/** Los nombres de herramientas del MCP (snake_case entre comillas invertidas) que nombra el texto. */
export function herramientasDeTexto(texto: string): string[] {
  const vistas = new Set<string>();
  for (const [, nombre] of texto.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) vistas.add(nombre);
  return [...vistas];
}

export type FilaDeUso = { fecha: string; tipo: string; clave: string; quien: string; veces: number };

export type UsoDeUnaCosa = { clave: string; veces: number; personas: number };

/** Cuánto se usó lo que nombra la tarjeta: pantallas (la ruta o sus hijas) y herramientas. Suma desde `desdeFecha`. */
export function usoDeLaTarjeta(texto: string, filas: FilaDeUso[], desdeFecha: string): { pantallas: UsoDeUnaCosa[]; herramientas: UsoDeUnaCosa[] } {
  const rutas = rutasDeTexto(texto);
  const herramientas = new Set(herramientasDeTexto(texto));
  const pantallas = new Map<string, { veces: number; quienes: Set<string> }>();
  const llamadas = new Map<string, { veces: number; quienes: Set<string> }>();
  const sumar = (mapa: typeof pantallas, clave: string, fila: FilaDeUso) => {
    const actual = mapa.get(clave) ?? { veces: 0, quienes: new Set<string>() };
    actual.veces += fila.veces;
    actual.quienes.add(fila.quien);
    mapa.set(clave, actual);
  };
  for (const fila of filas) {
    if (fila.fecha < desdeFecha) continue;
    if (fila.tipo === "PANTALLA") {
      const ruta = rutas.find((r) => fila.clave === r || fila.clave.startsWith(`${r}/`));
      if (ruta) sumar(pantallas, ruta, fila);
    } else if (fila.tipo === "HERRAMIENTA" && herramientas.has(fila.clave)) {
      sumar(llamadas, fila.clave, fila);
    }
  }
  const lista = (mapa: typeof pantallas, nombres: string[]) =>
    nombres.map((clave) => ({ clave, veces: mapa.get(clave)?.veces ?? 0, personas: mapa.get(clave)?.quienes.size ?? 0 }));
  return { pantallas: lista(pantallas, rutas), herramientas: lista(llamadas, [...herramientas]) };
}

/* ------------------------------------------------------------------------------------------------
   LA TARJETA DE ARREGLO Y LA LÍNEA PARA ALEXANDER
------------------------------------------------------------------------------------------------ */

/** La marca del título de una tarjeta de arreglo: `[sistemas:<commit>]`. Evita crear la misma todos los días. */
export function marcaDeArreglo(commit: string | null | undefined): string | null {
  const limpio = (commit ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return limpio.length >= 7 ? `[sistemas:${limpio}]` : null;
}

export function tieneMarcaDeArreglo(titulo: string): boolean {
  return /\[sistemas:[a-z0-9]{7,12}\]/i.test(titulo);
}

export type RevisionDeTarjeta = {
  tarjetaId: string | null;
  titulo: string;
  repo: string | null;
  commit: string | null;
  resultado: ResultadoDeRevision;
  /** FALLA: el error exacto. NO_SE_PUEDE_PROBAR: el porqué. FUNCIONA: lo que se comprobó (opcional). */
  detalle: string | null;
};

export type ArregloDeSistemas = {
  titulo: string;
  commit: string | null;
  /** true = se creó la tarjeta POR_APROBAR; false = solo "se crearía" (interruptor apagado o prueba). */
  creada: boolean;
  tarjetaId: string | null;
};

export type SaludDeSistemas = {
  trabajadorVivo: boolean | null;
  atascadas: number;
  enError: number;
  respaldos: string | null;
  recursos: string | null;
  vps: string | null;
  texto: string | null;
};

const esObjeto = (valor: unknown): valor is Record<string, unknown> => Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
const textoCorto = (valor: unknown, max: number): string | null => (typeof valor === "string" && valor.trim() ? valor.trim().slice(0, max) : null);

/** Valida la lista de revisiones que entrega el Revisor de producción. Lanza un error legible si no sirve. */
export function leerRevisiones(valor: unknown): RevisionDeTarjeta[] {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) throw new Error('"revisiones" tiene que ser una lista: una por tarjeta con titulo, commit, resultado y detalle.');
  const salida: RevisionDeTarjeta[] = [];
  for (const crudo of valor.slice(0, 100)) {
    if (!esObjeto(crudo)) continue;
    const titulo = textoCorto(crudo.titulo, 300);
    if (!titulo) continue;
    const resultado = typeof crudo.resultado === "string" ? crudo.resultado.trim().toUpperCase().replace(/[\s-]+/g, "_") : "";
    if (!(RESULTADOS_DE_REVISION as readonly string[]).includes(resultado)) {
      throw new Error(`El resultado de "${titulo}" tiene que ser FUNCIONA, FALLA o NO SE PUEDE PROBAR.`);
    }
    const detalle = textoCorto(crudo.detalle, 2000);
    if (resultado !== "FUNCIONA" && !detalle) {
      throw new Error(`"${titulo}": ${resultado === "FALLA" ? "FALLA necesita el error exacto" : "NO SE PUEDE PROBAR necesita el porqué"} en "detalle".`);
    }
    salida.push({
      tarjetaId: textoCorto(crudo.tarjetaId, 64),
      titulo,
      repo: textoCorto(crudo.repo, 40),
      commit: textoCorto(crudo.commit, 80),
      resultado: resultado as ResultadoDeRevision,
      detalle,
    });
  }
  return salida;
}

export function leerArreglos(valor: unknown): ArregloDeSistemas[] {
  if (!Array.isArray(valor)) return [];
  const salida: ArregloDeSistemas[] = [];
  for (const crudo of valor.slice(0, 50)) {
    if (!esObjeto(crudo)) continue;
    const titulo = textoCorto(crudo.titulo, 300);
    if (!titulo) continue;
    salida.push({ titulo, commit: textoCorto(crudo.commit, 80), creada: crudo.creada === true, tarjetaId: textoCorto(crudo.tarjetaId, 64) });
  }
  return salida;
}

export function leerSalud(valor: unknown): SaludDeSistemas | null {
  if (!esObjeto(valor)) return null;
  const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    trabajadorVivo: typeof valor.trabajadorVivo === "boolean" ? valor.trabajadorVivo : null,
    atascadas: numero(valor.atascadas),
    enError: numero(valor.enError),
    respaldos: textoCorto(valor.respaldos, 600),
    recursos: textoCorto(valor.recursos, 600),
    vps: textoCorto(valor.vps, 300),
    texto: textoCorto(valor.texto, 2000),
  };
}

/**
 * La línea única de Sistemas (decisión del dueño): "Sistemas: todo funciona" si nada está roto ni atascado; si no,
 * dice qué. Las cosas que NO SE PUEDEN PROBAR no son una falla: no rompen la línea.
 */
export function construirLineaDeSistemas(revisiones: RevisionDeTarjeta[], salud: SaludDeSistemas | null): string {
  const piezas: string[] = [];
  const fallas = revisiones.filter((r) => r.resultado === "FALLA");
  if (fallas.length) piezas.push(`falla ${fallas.length === 1 ? `“${fallas[0].titulo}”` : `${fallas.length} cosas subidas (${fallas.map((f) => `“${f.titulo}”`).join(", ")})`}`);
  if (salud) {
    if (salud.trabajadorVivo === false) piezas.push("el trabajador no da señal");
    if (salud.atascadas > 0) piezas.push(`${salud.atascadas} tarjeta${salud.atascadas === 1 ? "" : "s"} atascada${salud.atascadas === 1 ? "" : "s"}`);
    if (salud.enError > 0) piezas.push(`${salud.enError} en ERROR`);
    if (salud.respaldos && /\b(falta|falla|fall[oó]|no corri[oó]|0 bytes|vac[ií]o)\b/i.test(salud.respaldos)) piezas.push(`respaldo: ${salud.respaldos}`);
    if (salud.vps && /\b(no responde|caído|caido|falla)\b/i.test(salud.vps)) piezas.push("el VPS no responde");
  }
  return piezas.length ? `Sistemas: ${piezas.join("; ")}` : LINEA_TODO_FUNCIONA;
}

/**
 * La línea de Sistemas que va en el mensaje de las 7:30 a Alexander. Null = no va nada (interruptor apagado).
 * Prendido: la línea del agente; si no corrió, "Sistemas: sin revisión hoy".
 */
export function lineaDeSistemasParaAlexander(entrada: {
  interruptorPrendido: boolean;
  resumen: { linea: string | null; salioTarde: boolean; notaDeRetraso: string | null } | null;
}): string | null {
  if (!entrada.interruptorPrendido) return null;
  const { resumen } = entrada;
  if (!resumen || !resumen.linea) return LINEA_SIN_REVISION;
  const partes = [/^sistemas/i.test(resumen.linea) ? resumen.linea : `Sistemas: ${resumen.linea}`];
  if (resumen.salioTarde) partes.push(`(salió tarde${resumen.notaDeRetraso ? `: ${resumen.notaDeRetraso}` : ""})`);
  return partes.join(" ");
}
