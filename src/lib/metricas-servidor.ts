// Monitoreo del servidor (parte 1): reglas PURAS de grupos, colores y alerta de CPU.
// No toca la base ni manda nada: la ruta que recibe las fotos y la pantalla vienen en las partes 2 y 3.
// Cada "foto" (muestra) la manda un script del VPS y se guarda en la tabla MetricaServidor.

export type GrupoContenedor = "CRM" | "Marketplace" | "Base" | "WAHA" | "Otros";
export type ColorEstado = "verde" | "amarillo" | "rojo";

export const GRUPOS_CONTENEDOR: readonly GrupoContenedor[] = ["CRM", "Marketplace", "Base", "WAHA", "Otros"];

export type ContenedorMuestra = {
  nombre: string;
  grupo: GrupoContenedor;
  /** CPU del contenedor en % (puede pasar de 100 si usa más de un núcleo). */
  cpu: number;
  memMb: number;
  /** Límite de memoria del contenedor; null si no tiene. */
  memLimiteMb: number | null;
};

export type MuestraServidor = {
  cpuTotal: number;
  load1: number;
  nucleos: number | null;
  memUsadaMb: number;
  memTotalMb: number;
  swapUsadoMb: number;
  discoUsadoGb: number;
  discoTotalGb: number;
  contenedores: ContenedorMuestra[];
};

/** Estado de la alerta de CPU (en la parte 2 se guarda en AppSetting). `ultimoEnvio` en ISO. */
export type EstadoAlertaCpu = { activa: boolean; ultimoEnvio: string | null };

/** CPU por encima de este % cuenta como alta ("pasa de 85 %": 85 exacto no cuenta). */
export const UMBRAL_CPU_ALERTA = 85;
/** Cuántas fotos seguidas tienen que estar altas para avisar. */
export const MUESTRAS_PARA_ALERTA = 5;
/**
 * CPU del contenedor de la base (grupo "Base") por encima de este % cuenta como saturada ("pasa de 200 %": 200
 * exacto no cuenta). Es CPU de Docker: 200 % son dos núcleos llenos.
 */
export const UMBRAL_CPU_BASE_ALERTA = 200;
/** Cuántas fotos seguidas tiene que estar saturada la base para avisar. */
export const MUESTRAS_PARA_ALERTA_BASE = 3;
/** Título del aviso de la base. */
export const TITULO_AVISO_BASE = "Base de datos saturada";
/** Minutos de espera antes de repetir el aviso mientras siga alta. */
export const MINUTOS_ENTRE_ALERTAS = 60;
/** Tope de contenedores por foto, para que un cuerpo roto no llene la tabla. */
export const MAXIMO_CONTENEDORES = 200;
const LARGO_MAXIMO_NOMBRE = 200;
/** Mayor valor que cabe en una columna Int de Postgres (los MB se guardan así). */
const MAXIMO_INT = 2_147_483_647;

// mf7 a mf12 en cualquier parte del nombre, con el número exacto: "mf1" o "mf13" no cuentan.
const MARKETPLACE = /mf(?:[7-9]|1[0-2])(?!\d)/;

/** A qué grupo pertenece un contenedor de Docker según su nombre. */
export function grupoDelContenedor(nombre: string): GrupoContenedor {
  const n = String(nombre ?? "").trim().toLowerCase();
  if (n.startsWith("crm-aizenbot_app") || /realtime|files|crons/.test(n)) return "CRM";
  if (MARKETPLACE.test(n)) return "Marketplace";
  if (n.startsWith("crm-postgres")) return "Base";
  if (n.startsWith("crm-waha") || /^waha2(?!\d)/.test(n)) return "WAHA";
  return "Otros";
}

function colorPorLimites(porcentaje: number, amarilloDesde: number, rojoDesde: number): ColorEstado {
  if (porcentaje > rojoDesde) return "rojo";
  if (porcentaje >= amarilloDesde) return "amarillo";
  return "verde";
}

/** CPU: verde < 60, amarillo 60–85, rojo > 85. */
export function colorCpu(porcentaje: number): ColorEstado {
  return colorPorLimites(porcentaje, 60, 85);
}

/** Memoria: verde < 75, amarillo 75–90, rojo > 90. */
export function colorMemoria(porcentaje: number): ColorEstado {
  return colorPorLimites(porcentaje, 75, 90);
}

/** Disco: verde < 75, amarillo 75–90, rojo > 90. */
export function colorDisco(porcentaje: number): ColorEstado {
  return colorPorLimites(porcentaje, 75, 90);
}

/** Usado sobre total en %; 0 si el total no sirve. */
export function porcentaje(usado: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(usado)) return 0;
  return (usado / total) * 100;
}

/**
 * La CPU que cuenta: el mayor entre la CPU total y la carga repartida en los núcleos (load1/nucleos×100).
 * Si no se sabe cuántos núcleos hay, solo la CPU total.
 */
export function cpuEfectivo(muestra: Pick<MuestraServidor, "cpuTotal" | "load1" | "nucleos">): number {
  const nucleos = muestra.nucleos;
  if (nucleos == null || !(nucleos > 0)) return muestra.cpuTotal;
  return Math.max(muestra.cpuTotal, (muestra.load1 / nucleos) * 100);
}

export type ResultadoValidacion = { ok: true; muestra: MuestraServidor } | { ok: false; error: string };

function numeroValido(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0;
}

function esGrupo(valor: unknown): valor is GrupoContenedor {
  return typeof valor === "string" && (GRUPOS_CONTENEDOR as readonly string[]).includes(valor);
}

const CAMPOS_ENTEROS = ["memUsadaMb", "memTotalMb", "swapUsadoMb"] as const;
const CAMPOS_DECIMALES = ["cpuTotal", "load1", "discoUsadoGb", "discoTotalGb"] as const;

/**
 * Revisa y normaliza el cuerpo que manda el script del servidor. Exige números ≥ 0 y la lista de
 * contenedores; redondea los MB a enteros (la tabla los guarda como Int) y le pone el grupo a cada
 * contenedor que no lo traiga (o que traiga uno que no existe). Lo demás que venga se descarta.
 */
export function validarMuestra(json: unknown): ResultadoValidacion {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, error: "El cuerpo tiene que ser un objeto JSON." };
  }
  const cuerpo = json as Record<string, unknown>;

  for (const campo of [...CAMPOS_DECIMALES, ...CAMPOS_ENTEROS]) {
    if (!numeroValido(cuerpo[campo])) {
      return { ok: false, error: `Falta "${campo}" o no es un número mayor o igual a 0.` };
    }
  }
  for (const campo of CAMPOS_ENTEROS) {
    if ((cuerpo[campo] as number) > MAXIMO_INT) {
      return { ok: false, error: `"${campo}" es demasiado grande.` };
    }
  }

  let nucleos: number | null = null;
  if (cuerpo.nucleos !== undefined && cuerpo.nucleos !== null) {
    if (
      !numeroValido(cuerpo.nucleos) ||
      !Number.isInteger(cuerpo.nucleos) ||
      cuerpo.nucleos < 1 ||
      cuerpo.nucleos > MAXIMO_INT
    ) {
      return { ok: false, error: '"nucleos" tiene que ser un número entero mayor que 0.' };
    }
    nucleos = cuerpo.nucleos;
  }

  if (!Array.isArray(cuerpo.contenedores)) {
    return { ok: false, error: 'Falta la lista "contenedores".' };
  }
  if (cuerpo.contenedores.length > MAXIMO_CONTENEDORES) {
    return { ok: false, error: `La lista "contenedores" pasa de ${MAXIMO_CONTENEDORES}.` };
  }

  const contenedores: ContenedorMuestra[] = [];
  for (const [i, crudo] of cuerpo.contenedores.entries()) {
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
      return { ok: false, error: `El contenedor ${i + 1} no es un objeto.` };
    }
    const c = crudo as Record<string, unknown>;
    const nombre = typeof c.nombre === "string" ? c.nombre.trim() : "";
    if (!nombre || nombre.length > LARGO_MAXIMO_NOMBRE) {
      return { ok: false, error: `El contenedor ${i + 1} no tiene un nombre válido.` };
    }
    if (!numeroValido(c.cpu) || !numeroValido(c.memMb)) {
      return { ok: false, error: `El contenedor "${nombre}" tiene "cpu" o "memMb" inválido.` };
    }
    let memLimiteMb: number | null = null;
    if (c.memLimiteMb !== undefined && c.memLimiteMb !== null) {
      if (!numeroValido(c.memLimiteMb)) {
        return { ok: false, error: `El contenedor "${nombre}" tiene "memLimiteMb" inválido.` };
      }
      memLimiteMb = Math.round(c.memLimiteMb);
    }
    contenedores.push({
      nombre,
      grupo: esGrupo(c.grupo) ? c.grupo : grupoDelContenedor(nombre),
      cpu: c.cpu,
      memMb: Math.round(c.memMb),
      memLimiteMb,
    });
  }

  return {
    ok: true,
    muestra: {
      cpuTotal: cuerpo.cpuTotal as number,
      load1: cuerpo.load1 as number,
      nucleos,
      memUsadaMb: Math.round(cuerpo.memUsadaMb as number),
      memTotalMb: Math.round(cuerpo.memTotalMb as number),
      swapUsadoMb: Math.round(cuerpo.swapUsadoMb as number),
      discoUsadoGb: cuerpo.discoUsadoGb as number,
      discoTotalGb: cuerpo.discoTotalGb as number,
      contenedores,
    },
  };
}

/**
 * Decide si se manda el aviso de CPU alta.
 * - `ultimasCpu`: la CPU de las últimas fotos, de la más nueva a la más vieja.
 * - `umbral` y `muestras`: por defecto 85 % y 5 fotos (la alerta del servidor); la de la base usa 200 % y 3.
 * - Manda cuando las `muestras` últimas pasan del umbral y (no hay alerta activa o pasaron 60 min del último envío).
 * - Si la última no pasa del umbral, la alerta queda inactiva (se recupera) y puede volver a sonar.
 */
export function evaluarAlerta(entrada: {
  ultimasCpu: number[];
  estado: EstadoAlertaCpu;
  ahora: Date;
  umbral?: number;
  muestras?: number;
}): { mandar: boolean; estadoNuevo: EstadoAlertaCpu } {
  const { ultimasCpu, estado, ahora, umbral = UMBRAL_CPU_ALERTA, muestras = MUESTRAS_PARA_ALERTA } = entrada;
  const sinCambio = { mandar: false, estadoNuevo: { ...estado } };

  if (ultimasCpu.length === 0) return sinCambio;
  if (!(ultimasCpu[0] > umbral)) {
    return { mandar: false, estadoNuevo: { activa: false, ultimoEnvio: estado.ultimoEnvio } };
  }

  const recientes = ultimasCpu.slice(0, muestras);
  const todasAltas = recientes.length === muestras && recientes.every((cpu) => cpu > umbral);
  if (!todasAltas) return sinCambio;

  const mandada = { mandar: true, estadoNuevo: { activa: true, ultimoEnvio: ahora.toISOString() } };
  if (!estado.activa || !estado.ultimoEnvio) return mandada;

  const ultimo = new Date(estado.ultimoEnvio).getTime();
  // Fecha rota: mejor avisar que quedarse callado para siempre.
  if (Number.isNaN(ultimo)) return mandada;
  if (ahora.getTime() - ultimo >= MINUTOS_ENTRE_ALERTAS * 60_000) return mandada;
  return sinCambio;
}

function conComa(valor: number, decimales: number): string {
  return valor.toFixed(decimales).replace(".", ",");
}

function gb(mb: number): string {
  return conComa(mb / 1024, 1);
}

/** Mensaje corto para WhatsApp: CPU, top 3 de contenedores por CPU, memoria y disco. */
export function textoDeAlerta(muestra: MuestraServidor): string {
  const top = [...muestra.contenedores].sort((a, b) => b.cpu - a.cpu).slice(0, 3);
  const lineas = [
    `⚠️ Servidor con CPU alta: ${Math.round(cpuEfectivo(muestra))} %`,
    top.length > 0 ? "Los que más usan:" : "Sin datos de contenedores.",
    ...top.map((c, i) => `${i + 1}. ${c.nombre}: ${Math.round(c.cpu)} % (${c.grupo})`),
    `Memoria: ${gb(muestra.memUsadaMb)} de ${gb(muestra.memTotalMb)} GB`,
    `Disco: ${conComa(muestra.discoUsadoGb, 0)} de ${conComa(muestra.discoTotalGb, 0)} GB`,
  ];
  return lineas.join("\n");
}

/** El contenedor del grupo "Base" que más CPU usa; null si la foto no trae ninguno. */
function contenedorDeLaBase(contenedores: readonly ContenedorMuestra[]): ContenedorMuestra | null {
  let mayor: ContenedorMuestra | null = null;
  for (const c of contenedores) {
    if (c.grupo === "Base" && (mayor === null || c.cpu > mayor.cpu)) mayor = c;
  }
  return mayor;
}

/** CPU (en %) del contenedor de la base que más usa (no la suma); null si no hay ninguno del grupo "Base". */
export function cpuDeLaBase(contenedores: readonly ContenedorMuestra[]): number | null {
  return contenedorDeLaBase(contenedores)?.cpu ?? null;
}

/** Mensaje corto del aviso "Base de datos saturada": la CPU y la memoria de la base y la CPU del servidor. */
export function textoDeAlertaBase(muestra: MuestraServidor): string {
  const base = contenedorDeLaBase(muestra.contenedores);
  const lineas = [
    base
      ? `⚠️ ${TITULO_AVISO_BASE}: ${base.nombre} usa ${Math.round(base.cpu)} % de CPU`
      : `⚠️ ${TITULO_AVISO_BASE}`,
    `Lleva ${MUESTRAS_PARA_ALERTA_BASE} fotos seguidas por encima de ${UMBRAL_CPU_BASE_ALERTA} %.`,
  ];
  if (base) {
    lineas.push(
      base.memLimiteMb
        ? `Memoria de la base: ${gb(base.memMb)} de ${gb(base.memLimiteMb)} GB`
        : `Memoria de la base: ${gb(base.memMb)} GB`,
    );
  }
  lineas.push(`CPU del servidor: ${Math.round(cpuEfectivo(muestra))} %`);
  return lineas.join("\n");
}

// ---------------------------------------------------------------------------------------------------------
// Parte 3: la pantalla Dirección → Servidor. Funciones PURAS que usan la ruta GET y la página.
// ---------------------------------------------------------------------------------------------------------

/** Cuántas horas muestra la pantalla. */
export const HORAS_PANEL = 24;

/** Una foto tal como llega a la pantalla. Los contenedores vienen solo en la última (pesaría mucho en todas). */
export type FotoPanel = {
  tomadaEn: string;
  cpuTotal: number;
  load1: number;
  nucleos: number | null;
  memUsadaMb: number;
  memTotalMb: number;
  discoUsadoGb: number;
  discoTotalGb: number;
  contenedores?: ContenedorMuestra[];
};

/** La fila de la base con los campos que se dibujan (sin `contenedores`). */
export type FilaPanel = Omit<FotoPanel, "tomadaEn" | "contenedores"> & { tomadaEn: Date };

/** Los campos que se leen de la base para la gráfica: nunca `contenedores`. */
export const CAMPOS_PANEL = {
  tomadaEn: true,
  cpuTotal: true,
  load1: true,
  nucleos: true,
  memUsadaMb: true,
  memTotalMb: true,
  discoUsadoGb: true,
  discoTotalGb: true,
} as const;

/** Desde cuándo se leen las fotos: ahora menos 24 h. */
export function inicioDelPanel(ahora: Date): Date {
  return new Date(ahora.getTime() - HORAS_PANEL * 60 * 60_000);
}

/** Convierte el JSON guardado en una lista segura de contenedores; salta las entradas rotas. */
export function leerContenedores(json: unknown): ContenedorMuestra[] {
  if (!Array.isArray(json)) return [];
  const lista: ContenedorMuestra[] = [];
  for (const crudo of json) {
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) continue;
    const c = crudo as Record<string, unknown>;
    const nombre = typeof c.nombre === "string" ? c.nombre.trim() : "";
    if (!nombre || !numeroValido(c.cpu) || !numeroValido(c.memMb)) continue;
    lista.push({
      nombre,
      grupo: esGrupo(c.grupo) ? c.grupo : grupoDelContenedor(nombre),
      cpu: c.cpu,
      memMb: c.memMb,
      memLimiteMb: numeroValido(c.memLimiteMb) ? c.memLimiteMb : null,
    });
  }
  return lista;
}

/** Arma lo que viaja a la pantalla: las fotos en orden, con los contenedores solo en la última. */
export function armarPanelServidor(filas: FilaPanel[], contenedoresDeLaUltima: unknown): FotoPanel[] {
  const fotos: FotoPanel[] = filas.map((fila) => ({ ...fila, tomadaEn: fila.tomadaEn.toISOString() }));
  if (fotos.length > 0) {
    fotos[fotos.length - 1].contenedores = leerContenedores(contenedoresDeLaUltima);
  }
  return fotos;
}

/** De mayor a menor CPU; si empatan, por nombre. No cambia la lista original. */
export function ordenarContenedoresPorCpu(contenedores: readonly ContenedorMuestra[]): ContenedorMuestra[] {
  return [...contenedores].sort((a, b) => b.cpu - a.cpu || a.nombre.localeCompare(b.nombre));
}

export type GrupoDelPanel = {
  grupo: GrupoContenedor;
  contenedores: ContenedorMuestra[];
  /** Suma de la CPU de sus contenedores, en %. */
  cpu: number;
  /** Suma de la memoria de sus contenedores, en MB. */
  memMb: number;
};

/** Los contenedores por grupo, en el orden de GRUPOS_CONTENEDOR y sin los grupos vacíos. */
export function agruparContenedores(contenedores: readonly ContenedorMuestra[]): GrupoDelPanel[] {
  return GRUPOS_CONTENEDOR.map((grupo) => {
    const delGrupo = ordenarContenedoresPorCpu(contenedores.filter((c) => c.grupo === grupo));
    return {
      grupo,
      contenedores: delGrupo,
      cpu: delGrupo.reduce((suma, c) => suma + c.cpu, 0),
      memMb: delGrupo.reduce((suma, c) => suma + c.memMb, 0),
    };
  }).filter((g) => g.contenedores.length > 0);
}

export type PuntoPanel = { tomadaEn: string; cpu: number; memoria: number; disco: number };

/** Por cada foto, el % de CPU (efectiva), de memoria y de disco. */
export function seriePanelServidor(fotos: readonly FotoPanel[]): PuntoPanel[] {
  return fotos.map((foto) => ({
    tomadaEn: foto.tomadaEn,
    cpu: cpuEfectivo(foto),
    memoria: porcentaje(foto.memUsadaMb, foto.memTotalMb),
    disco: porcentaje(foto.discoUsadoGb, foto.discoTotalGb),
  }));
}
