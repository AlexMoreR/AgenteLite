/*
  REGLAS PURAS del panel "Coordinador en vivo" (Tablero IA, 24-oct-2026). Sin base ni red: las usan el
  servicio (coordinador-en-vivo.ts), la pantalla y las pruebas (scripts/check-coordinador-en-vivo.mjs).

  El Coordinador (PC aizen1) manda un LATIDO cada 15 s con lo que tiene en las manos y la carga del PC.
  El CRM guarda solo el último. Todo lo que llega es dato de afuera: se recorta y se valida aquí.
*/

/** Si el último latido tiene más de esto, el Coordinador "está apagado o sin conexión". */
export const MINUTOS_SIN_LATIDO = 2;
export const MAXIMO_DE_TAREAS = 10;
export const MAXIMO_DE_ESPERAS = 20;
/** Los mismos límites que usa el Coordinador para no abrir otra tarea (config.limites). */
export const LIMITE_ROJO = 85;
export const LIMITE_AMARILLO = 70;
/** Disco libre (GB): menos de esto es rojo; menos de AMARILLO, amarillo. */
export const DISCO_LIBRE_ROJO_GB = 10;
export const DISCO_LIBRE_AMARILLO_GB = 20;

export const ETAPAS_VISIBLES = ["planeando", "construyendo", "probando", "subiendo"] as const;
export type EtapaVisible = (typeof ETAPAS_VISIBLES)[number];
export const LUGARES = ["aizen1", "nube", "github"] as const;
export type Lugar = (typeof LUGARES)[number];
export const MODELOS = ["opus", "sonnet", "haiku"] as const;
export type Modelo = (typeof MODELOS)[number];
export type Semaforo = "verde" | "amarillo" | "rojo";

export type TareaDelLatido = {
  tarjetaId: string;
  titulo: string;
  etapa: EtapaVisible;
  lugar: Lugar;
  modelo: Modelo | null;
  /** "claude" | "codex": quién la hace (el modelo solo aplica a Claude). */
  motor: string | null;
  inicioEn: string | null;
  intento: number | null;
  reparacion: number | null;
  reparacionDe: number | null;
  linkSesion: string | null;
  linkWorkflow: string | null;
};

export type CargaDelLatido = {
  cpu: number | null;
  memoriaPorciento: number | null;
  memoriaUsadaGb: number | null;
  memoriaTotalGb: number | null;
  discoLibreGb: number | null;
  discoTotalGb: number | null;
  esperandoPc: boolean;
  motivoEspera: string | null;
};

export type UsoDelLatido = {
  limiteAlcanzado: boolean;
  /** Cuándo se reinicia el cupo (ISO), si se sabe. */
  reiniciaEn: string | null;
  /** Qué motor llegó al límite: "claude" | "codex" | null. */
  motor: string | null;
};

export type EsperaDelLatido = { tarjetaId: string; motivo: string };

export type LatidoGuardado = {
  /** Cuándo lo RECIBIÓ el CRM (el reloj del PC no cuenta: puede estar desfasado). */
  recibidoEn: string;
  nombre: string;
  tareas: TareaDelLatido[];
  carga: CargaDelLatido;
  uso: UsoDelLatido;
  /** Lo que el Coordinador dejó en fila por chocar con lo que corre (tarjeta y motivo). */
  esperas: EsperaDelLatido[];
};

/* ───────────────────────────────────────────────────────────────── validar lo que llega ── */

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);

/** Un texto de una línea, recortado; "" si no es texto. */
export function textoCorto(valor: unknown, maximo: number): string {
  if (typeof valor !== "string") return "";
  const limpio = valor.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio;
}

/** Un número entre `minimo` y `maximo` (redondeado a `decimales`), o null si no es un número. */
export function numeroEnRango(valor: unknown, minimo: number, maximo: number, decimales = 0): number | null {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
  if (!Number.isFinite(numero)) return null;
  const acotado = Math.min(maximo, Math.max(minimo, numero));
  const factor = 10 ** decimales;
  return Math.round(acotado * factor) / factor;
}

function enteroOpcional(valor: unknown, maximo = 1000): number | null {
  const numero = numeroEnRango(valor, 0, maximo, 0);
  return numero;
}

const HOSTS_DE_LINKS = ["claude.ai", "github.com"];

/**
 * Un link https que solo puede ser de claude.ai, github.com o del propio CRM (`hostPropio`); cualquier otro se
 * descarta (el panel pone estos links como botones: no puede llevar a donde diga un dato de afuera).
 */
export function linkPermitido(valor: unknown, hostPropio: string | null = null): string | null {
  if (typeof valor !== "string" || valor.length > 500) return null;
  let url: URL;
  try {
    url = new URL(valor.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const propio = hostPropio ? hostPropio.toLowerCase() : null;
  const esDeLaLista = HOSTS_DE_LINKS.some((permitido) => host === permitido || host.endsWith(`.${permitido}`));
  if (!esDeLaLista && host !== propio) return null;
  return url.toString();
}

function fechaIso(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const milis = Date.parse(valor);
  return Number.isFinite(milis) ? new Date(milis).toISOString() : null;
}

const enLista = <T extends string>(lista: readonly T[], valor: unknown): T | null => {
  const texto = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  return (lista as readonly string[]).includes(texto) ? (texto as T) : null;
};

/** El modelo como lo manda el Coordinador ("opus", "claude-sonnet-4-5"…): solo opus, sonnet o haiku. */
export function modeloDeEntrada(valor: unknown): Modelo | null {
  const familia = typeof valor === "string" ? valor.toLowerCase().match(/opus|sonnet|haiku/)?.[0] : null;
  return (familia as Modelo | undefined) ?? null;
}

function tareaDeEntrada(valor: unknown, hostPropio: string | null): TareaDelLatido | null {
  if (!esObjeto(valor)) return null;
  const tarjetaId = textoCorto(valor.tarjetaId, 60);
  const etapa = enLista(ETAPAS_VISIBLES, valor.etapa);
  if (!tarjetaId || !etapa) return null;
  return {
    tarjetaId,
    titulo: textoCorto(valor.titulo, 140) || "(sin título)",
    etapa,
    lugar: enLista(LUGARES, valor.lugar) ?? "aizen1",
    modelo: modeloDeEntrada(valor.modelo),
    motor: textoCorto(valor.motor, 20).toLowerCase() || null,
    inicioEn: fechaIso(valor.inicioEn),
    intento: enteroOpcional(valor.intento, 99),
    reparacion: enteroOpcional(valor.reparacion, 99),
    reparacionDe: enteroOpcional(valor.reparacionDe, 99),
    linkSesion: linkPermitido(valor.linkSesion, hostPropio),
    linkWorkflow: linkPermitido(valor.linkWorkflow, hostPropio),
  };
}

function cargaDeEntrada(valor: unknown): CargaDelLatido {
  const carga = esObjeto(valor) ? valor : {};
  return {
    cpu: numeroEnRango(carga.cpu, 0, 100),
    memoriaPorciento: numeroEnRango(carga.memoriaPorciento, 0, 100),
    memoriaUsadaGb: numeroEnRango(carga.memoriaUsadaGb, 0, 100_000, 1),
    memoriaTotalGb: numeroEnRango(carga.memoriaTotalGb, 0, 100_000, 1),
    discoLibreGb: numeroEnRango(carga.discoLibreGb, 0, 1_000_000, 1),
    discoTotalGb: numeroEnRango(carga.discoTotalGb, 0, 1_000_000, 1),
    esperandoPc: carga.esperandoPc === true,
    motivoEspera: textoCorto(carga.motivoEspera, 160) || null,
  };
}

function usoDeEntrada(valor: unknown): UsoDelLatido {
  const uso = esObjeto(valor) ? valor : {};
  const limiteAlcanzado = uso.limiteAlcanzado === true;
  return {
    limiteAlcanzado,
    reiniciaEn: limiteAlcanzado ? fechaIso(uso.reiniciaEn) : null,
    motor: limiteAlcanzado ? enLista(["claude", "codex"] as const, uso.motor) : null,
  };
}

/**
 * El latido como queda guardado, o null si el cuerpo no es un objeto. Recorta y valida todo: hasta
 * MAXIMO_DE_TAREAS tareas, textos cortos, porcentajes de 0 a 100 y links solo de claude.ai, github.com o del CRM.
 */
export function latidoDeEntrada(cuerpo: unknown, ahora: Date, hostPropio: string | null = null): LatidoGuardado | null {
  if (!esObjeto(cuerpo)) return null;
  const tareas = (Array.isArray(cuerpo.tareas) ? cuerpo.tareas : [])
    .slice(0, MAXIMO_DE_TAREAS)
    .map((tarea) => tareaDeEntrada(tarea, hostPropio))
    .filter((tarea): tarea is TareaDelLatido => tarea !== null);
  const esperas = (Array.isArray(cuerpo.esperas) ? cuerpo.esperas : [])
    .slice(0, MAXIMO_DE_ESPERAS)
    .map((espera): EsperaDelLatido | null => {
      if (!esObjeto(espera)) return null;
      const tarjetaId = textoCorto(espera.tarjetaId, 60);
      return tarjetaId ? { tarjetaId, motivo: textoCorto(espera.motivo, 160) } : null;
    })
    .filter((espera): espera is EsperaDelLatido => espera !== null);
  return {
    recibidoEn: ahora.toISOString(),
    nombre: textoCorto(cuerpo.nombre, 40) || "aizen1",
    tareas,
    carga: cargaDeEntrada(cuerpo.carga),
    uso: usoDeEntrada(cuerpo.uso),
    esperas,
  };
}

/** El JSON guardado en la AppSetting, de vuelta a un latido (null si está dañado). */
export function latidoGuardado(texto: string | null | undefined, hostPropio: string | null = null): LatidoGuardado | null {
  if (!texto) return null;
  try {
    const dato: unknown = JSON.parse(texto);
    if (!esObjeto(dato)) return null;
    const recibido = fechaIso(dato.recibidoEn);
    if (!recibido) return null;
    return latidoDeEntrada(dato, new Date(recibido), hostPropio);
  } catch {
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────── apagado, semáforo, palabras ── */

/** ¿El Coordinador está apagado o sin conexión? Sin latido, o con el último de hace más de 2 minutos. */
export function estaApagado(recibidoEn: string | null | undefined, ahora: Date): boolean {
  if (!recibidoEn) return true;
  const milis = Date.parse(recibidoEn);
  if (!Number.isFinite(milis)) return true;
  return ahora.getTime() - milis > MINUTOS_SIN_LATIDO * 60_000;
}

/**
 * Verde si todo está bajo 70 %; amarillo de 70 a 85 % (o si espera que el PC se desocupe, o queda poco
 * disco); rojo si pasa de 85 % o el disco libre es muy poco. Sin datos de carga, null.
 */
export function semaforoDeLaCarga(carga: CargaDelLatido | null): Semaforo | null {
  if (!carga) return null;
  const medidas = [carga.cpu, carga.memoriaPorciento].filter((valor): valor is number => valor !== null);
  if (!medidas.length && carga.discoLibreGb === null) return null;
  const peor = medidas.length ? Math.max(...medidas) : 0;
  const disco = carga.discoLibreGb;
  if (peor > LIMITE_ROJO || (disco !== null && disco < DISCO_LIBRE_ROJO_GB)) return "rojo";
  if (peor >= LIMITE_AMARILLO || carga.esperandoPc || (disco !== null && disco < DISCO_LIBRE_AMARILLO_GB)) return "amarillo";
  return "verde";
}

export const NOMBRE_DE_LA_ETAPA: Record<EtapaVisible, string> = {
  planeando: "Planeando",
  construyendo: "Construyendo",
  probando: "Probando",
  subiendo: "Subiendo",
};

export const NOMBRE_DEL_LUGAR: Record<Lugar, string> = {
  aizen1: "aizen1",
  nube: "Nube de Claude",
  github: "GitHub Actions",
};

export const NOMBRE_DEL_MODELO: Record<Modelo, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

/** La etapa que se ve según el estado de la tarjeta, cuando el latido no dice nada de ella. */
export function etapaDelEstado(estado: string): EtapaVisible | null {
  if (estado === "PLANEANDO") return "planeando";
  if (estado === "EN_CURSO") return "construyendo";
  if (estado === "SUBIENDO") return "subiendo";
  return null;
}

/** "hace 14 min", "hace 2 h 5 min", "hace un momento". */
export function haceTexto(milisegundos: number): string {
  const minutos = Math.floor(Math.max(0, milisegundos) / 60_000);
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `hace ${horas} h ${resto} min` : `hace ${horas} h`;
}

/** "14 min", "1 h 5 min", "menos de 1 min": cuánto duró algo. */
export function duracionTexto(minutos: number | null): string {
  if (minutos === null) return "—";
  if (minutos < 1) return "menos de 1 min";
  const redondo = Math.round(minutos);
  if (redondo < 60) return `${redondo} min`;
  const horas = Math.floor(redondo / 60);
  const resto = redondo % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** "intento 2" o "reparación 1 de 3" (la reparación va primero: es lo más importante). */
export function enQueVa(tarea: Pick<TareaDelLatido, "intento" | "reparacion" | "reparacionDe">): string {
  if (tarea.reparacion && tarea.reparacion > 0) {
    return `reparación ${tarea.reparacion}${tarea.reparacionDe ? ` de ${tarea.reparacionDe}` : ""}`;
  }
  return `intento ${Math.max(1, tarea.intento ?? 1)}`;
}

const HORA_BOGOTA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: true });

/** "3:00 p. m." (hora de Bogotá). */
export function horaDeBogotaTexto(iso: string | null): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return HORA_BOGOTA.format(new Date(iso));
}

/** "Sin límite" o "Límite alcanzado, se reinicia a las 3:00 p. m.". */
export function textoDelUso(uso: UsoDelLatido | null, ahora: Date): string {
  if (!uso || !uso.limiteAlcanzado) return "Sin límite";
  const quien = uso.motor === "codex" ? "Codex" : "Claude";
  const reinicio = uso.reiniciaEn && Date.parse(uso.reiniciaEn) > ahora.getTime() ? horaDeBogotaTexto(uso.reiniciaEn) : null;
  return reinicio ? `Límite de ${quien} alcanzado, se reinicia a las ${reinicio}` : `Límite de ${quien} alcanzado`;
}

/* ───────────────────────────────────────────────────────────────────────────── lo de HOY ── */

export type FilaDeHistorial = { tarjetaId: string; titulo: string; creadoEn: Date; despues: unknown };
export type FilaDeReparacion = { tarjetaId: string; creadoEn: Date };

export type TrabajoDeHoy = {
  tarjetaId: string;
  titulo: string;
  resultado: "terminada" | "fallo";
  /** Desde que la tomó el Coordinador hasta que terminó o falló (minutos), o null si no se sabe. */
  duracionMinutos: number | null;
  /** Cuántas veces se reparó en el día. */
  reparaciones: number;
  cuando: string;
};

export type HoyVista = {
  terminadas: number;
  falladas: number;
  reparadas: number;
  trabajos: TrabajoDeHoy[];
};

const comoObjeto = (valor: unknown): Record<string, unknown> => (esObjeto(valor) ? valor : {});

/**
 * Lo de hoy con el historial de las tarjetas (filas del Coordinador, desde unas horas antes de hoy para saber
 * cuándo empezó cada una) y las reparaciones de hoy. Cada tarjeta cuenta su ÚLTIMO resultado del día
 * (terminada o falló); `reparadas` son las veces que el Coordinador reparó algo hoy.
 */
export function armarHoy(desde: Date, hasta: Date, filas: readonly FilaDeHistorial[], reparaciones: readonly FilaDeReparacion[]): HoyVista {
  const ordenadas = [...filas].sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime());
  const primera = new Map<string, number>();
  const ultimo = new Map<string, { resultado: "terminada" | "fallo"; fila: FilaDeHistorial }>();
  for (const fila of ordenadas) {
    const tiempo = fila.creadoEn.getTime();
    const despues = comoObjeto(fila.despues);
    const esSubida = Object.keys(comoObjeto(despues.subida)).length > 0;
    const esError = despues.estado === "ERROR";
    if (!esSubida && !esError) {
      // Un paso más del trabajo: sirve para saber cuándo empezó.
      if (!primera.has(fila.tarjetaId)) primera.set(fila.tarjetaId, tiempo);
      continue;
    }
    if (tiempo < desde.getTime() || tiempo >= hasta.getTime()) continue;
    if (!primera.has(fila.tarjetaId)) primera.set(fila.tarjetaId, tiempo);
    ultimo.set(fila.tarjetaId, { resultado: esSubida ? "terminada" : "fallo", fila });
  }
  const reparadasPorTarjeta = new Map<string, number>();
  let reparadas = 0;
  for (const reparacion of reparaciones) {
    const tiempo = reparacion.creadoEn.getTime();
    if (tiempo < desde.getTime() || tiempo >= hasta.getTime()) continue;
    reparadas += 1;
    reparadasPorTarjeta.set(reparacion.tarjetaId, (reparadasPorTarjeta.get(reparacion.tarjetaId) ?? 0) + 1);
  }
  const trabajos: TrabajoDeHoy[] = [...ultimo.entries()]
    .map(([tarjetaId, { resultado, fila }]) => {
      const inicio = primera.get(tarjetaId);
      const minutos = inicio === undefined ? null : Math.max(0, (fila.creadoEn.getTime() - inicio) / 60_000);
      return {
        tarjetaId,
        titulo: fila.titulo,
        resultado,
        duracionMinutos: minutos === null ? null : Math.round(minutos * 10) / 10,
        reparaciones: reparadasPorTarjeta.get(tarjetaId) ?? 0,
        cuando: fila.creadoEn.toISOString(),
      };
    })
    .sort((a, b) => Date.parse(b.cuando) - Date.parse(a.cuando));
  return {
    terminadas: trabajos.filter((trabajo) => trabajo.resultado === "terminada").length,
    falladas: trabajos.filter((trabajo) => trabajo.resultado === "fallo").length,
    reparadas,
    trabajos,
  };
}

/** Desde (incluido) y hasta (sin incluir) del día de hoy en Bogotá (UTC-5, sin horario de verano), en UTC. */
export function rangoDeHoyEnBogota(ahora: Date): { desde: Date; hasta: Date } {
  const CINCO_HORAS = 5 * 3_600_000;
  const DIA = 24 * 3_600_000;
  const local = ahora.getTime() - CINCO_HORAS;
  const desde = new Date(local - (((local % DIA) + DIA) % DIA) + CINCO_HORAS);
  return { desde, hasta: new Date(desde.getTime() + DIA) };
}
