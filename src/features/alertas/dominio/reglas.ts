/**
 * ALERTAS INTERNAS (reglas puras, sin base ni red). La página /cliente/alertas guarda TODA alerta; por WhatsApp
 * solo salen las URGENTES, con un mensaje de dos líneas y el link a la página (decisión del dueño, 29-oct-2026).
 *
 * La prioridad de cada fuente se decide AQUÍ (un solo archivo, fácil de ajustar): si una alerta importante queda
 * muy baja, se cambia en este mapa y no en cada servicio.
 */

export const PRIORIDADES = ["URGENTE", "ALTA", "MEDIA", "BAJA"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

export const ESTADOS_DE_ALERTA = ["NUEVA", "VISTA", "RESUELTA"] as const;
export type EstadoDeAlerta = (typeof ESTADOS_DE_ALERTA)[number];

export const ETIQUETA_DE_PRIORIDAD: Record<Prioridad, string> = { URGENTE: "Urgente", ALTA: "Alta", MEDIA: "Media", BAJA: "Baja" };
export const ETIQUETA_DE_ESTADO: Record<EstadoDeAlerta, string> = { NUEVA: "Nueva", VISTA: "Vista", RESUELTA: "Resuelta" };

/** 0 = lo más importante. */
export const ORDEN_DE_PRIORIDAD: Record<Prioridad, number> = { URGENTE: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };

export const ENLACE_DE_ALERTAS = "https://app.aizenbot.com/cliente/alertas";
export const MAXIMO_TITULO = 90;

/** El link directo a una alerta: la página la abre y la resalta (?alerta=<id>). */
export const linkDeLaAlerta = (id: string) => `${ENLACE_DE_ALERTAS}?alerta=${encodeURIComponent(id)}`;

/** Los sistemas que generan alertas (lo que se ve en la columna "Sistema"). */
export const ORIGEN_SUPERVISOR = "Supervisor";
export const ORIGEN_COORDINADOR = "Coordinador";
export const ORIGEN_LINEA = "Línea de WhatsApp";
export const ORIGEN_POR_AREA: Record<string, string> = {
  ventas: "Agente de Ventas",
  marketing: "Agente de Marketing",
  sistemas: "Agente de Sistemas",
};

/** `ultimaVez` = la última vez que llegó (sube al repetirse); sin ella (filas de antes) cuenta `creadoEn`. */
export type AlertaOrdenable = { prioridad: string; creadoEn: Date | string; ultimaVez?: Date | string | null };

/** La hora con la que se ordena y se muestra una alerta: la de la ÚLTIMA vez que llegó. */
export const ultimaVezDe = (alerta: Pick<AlertaOrdenable, "creadoEn" | "ultimaVez">): Date => new Date(alerta.ultimaVez ?? alerta.creadoEn);

const ZONA = "America/Bogota";
const diaEnBogota = (fecha: Date) => fecha.toLocaleDateString("en-CA", { timeZone: ZONA });

/**
 * "última vez HH:MM · se repitió N veces" (con el día delante si no fue hoy). Para una alerta que llegó una sola
 * vez no hay nada que decir: "".
 */
export function textoDeRepeticion(veces: number, ultimaVez: Date, ahora = new Date()): string {
  if (!(veces > 1)) return "";
  const hora = ultimaVez.toLocaleTimeString("es-CO", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false });
  const dia = diaEnBogota(ultimaVez) === diaEnBogota(ahora) ? "" : `${ultimaVez.toLocaleDateString("es-CO", { timeZone: ZONA, day: "2-digit", month: "2-digit" })} `;
  return `última vez ${dia}${hora} · se repitió ${veces} veces`;
}

/** Texto → prioridad. Lo que no se reconoce es null (quien llama decide el valor por defecto). */
export function leerPrioridad(valor: unknown): Prioridad | null {
  const texto = String(valor ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return (PRIORIDADES as readonly string[]).includes(texto) ? (texto as Prioridad) : null;
}

/** Por WhatsApp solo salen las URGENTES. */
export const salePorWhatsApp = (prioridad: Prioridad | string): boolean => prioridad === "URGENTE";

/**
 * Por prioridad (Urgente primero) y, dentro de cada una, de la más reciente a la más vieja según la ÚLTIMA vez que
 * llegó: una alerta que se repite sube. No cambia la lista original.
 */
export function ordenarAlertas<T extends AlertaOrdenable>(alertas: readonly T[]): T[] {
  const peso = (alerta: T) => ORDEN_DE_PRIORIDAD[alerta.prioridad as Prioridad] ?? PRIORIDADES.length;
  return [...alertas].sort((a, b) => peso(a) - peso(b) || ultimaVezDe(b).getTime() - ultimaVezDe(a).getTime());
}

/** Un título en una sola línea y de largo acotado. */
export function tituloCorto(valor: string, maximo = MAXIMO_TITULO): string {
  const limpio = String(valor ?? "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio;
}

/** El título sale de la primera línea con contenido del texto. */
export function tituloDelTexto(texto: string, maximo = MAXIMO_TITULO): string {
  const primera = String(texto ?? "")
    .split("\n")
    .find((linea) => linea.trim());
  // Sin el emoji o los símbolos del inicio: el aviso urgente ya trae el suyo.
  return tituloCorto((primera ?? "").replace(/^[^\p{L}\p{N}"¿¡(]+/u, ""), maximo) || "Alerta sin título";
}

/** El WhatsApp de una urgente: DOS líneas, el título corto y el link. Nada de texto largo. */
export function textoDeUrgente(titulo: string): string {
  return `🚨 Urgente: ${tituloCorto(titulo)}\nVer: ${ENLACE_DE_ALERTAS}`;
}

/** Varias urgentes juntas en un solo mensaje (también de dos líneas). */
export function textoDeVariasUrgentes(titulos: readonly string[]): string {
  if (titulos.length <= 1) return textoDeUrgente(titulos[0] ?? "Alerta urgente");
  return `🚨 Urgente: ${titulos.length} alertas (${tituloCorto(titulos[0], 60)} y otras)\nVer: ${ENLACE_DE_ALERTAS}`;
}

/** Gravedad del Supervisor (avisos por gravedad) → prioridad: CRÍTICO = Urgente, IMPORTANTE = Alta, OBSERVACIÓN = Baja. */
export function prioridadDeGravedad(gravedad: string): Prioridad {
  if (gravedad === "CRITICO") return "URGENTE";
  if (gravedad === "OBSERVACION") return "BAJA";
  return "ALTA";
}

/** ¿El motivo habla de dinero, Meta Ads o una clave/permiso? Solo eso hace urgente un "necesita tu decisión". */
export function esDeDineroMetaOClave(texto: string): boolean {
  return /\b(meta ads?|dinero|presupuesto|gasto|pago|pagos|cobro|plata|clave|claves|token|tokens|credencial\w*|contrase\w+|api ?key|secret\w*|acceso|permiso\w*)\b/i.test(String(texto ?? ""));
}

/** La clave de una alerta sin clave propia: el sistema y el título (hash corto, para no guardar textos largos). */
export function claveDeAlerta(origen: string, titulo: string): string {
  const base = `${origen}|${tituloCorto(titulo, 200).toLowerCase()}`;
  let hash = 5381;
  for (let i = 0; i < base.length; i += 1) hash = ((hash << 5) + hash + base.charCodeAt(i)) | 0;
  return `${origen.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${(hash >>> 0).toString(36)}`;
}

/* ───────────── ÁREAS (filtro de la página /cliente/alertas; solo lectura, no cambia a quién se avisa) ───────────── */

/** Las áreas del filtro, en el orden de los botones. Lo que no encaje cae en "General". */
export const AREAS_DE_ALERTA = ["Ventas", "CRM Ventas", "Gestión", "CRM Marketplace", "Coordinador", "General", "Marketing"] as const;
export type AreaDeAlerta = (typeof AREAS_DE_ALERTA)[number];
export const AREA_POR_DEFECTO: AreaDeAlerta = "General";

const sinTildes = (valor: string) =>
  valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Texto libre → área de la lista fija ("gestion" y "Gestión" son la misma). Lo que no está en la lista es null. */
export function leerAreaDeAlerta(valor: unknown): AreaDeAlerta | null {
  const texto = sinTildes(String(valor ?? ""));
  return AREAS_DE_ALERTA.find((area) => sinTildes(area) === texto) ?? null;
}

/** El id de la tarjeta de una clave `auto:trabado:<tarjeta>:<estado>`, `auto:necesita:<tarjeta>:<estado>` o `auto:equipo:<tarjeta>:<motivo>` (aviso al equipo); null si no es de tarjeta. */
export function idDeTarjetaDeLaClave(clave: string): string | null {
  const partes = String(clave ?? "").split(":");
  if (partes[0] !== "auto" || (partes[1] !== "trabado" && partes[1] !== "necesita" && partes[1] !== "equipo")) return null;
  return partes[2]?.trim() || null;
}

/**
 * El área de una tarjeta a partir de sus áreas de arriba hacia abajo (la ruta: la raíz primero, la carpeta Área más
 * cercana al final). Dentro de Tecnología manda la subárea madre (CRM Ventas, Gestión…); en cualquier otra, la primera.
 * Si ninguna encaja con la lista fija, null.
 */
export function areaDeLaRuta(ruta: readonly string[]): AreaDeAlerta | null {
  const enTecnologia = ruta.length > 1 && sinTildes(ruta[0]) === "tecnologia";
  const candidatas = enTecnologia ? ruta.slice(1) : ruta;
  for (const nombre of candidatas) {
    const area = leerAreaDeAlerta(nombre);
    if (area) return area;
  }
  return null;
}

/** Área de una alerta que no viene de una tarjeta, según quién la generó. */
export function areaDelOrigen(origen: string): AreaDeAlerta {
  if (origen === ORIGEN_COORDINADOR) return "Coordinador";
  if (origen === ORIGEN_POR_AREA.ventas) return "Ventas";
  if (origen === ORIGEN_POR_AREA.marketing) return "Marketing";
  return leerAreaDeAlerta(origen) ?? AREA_POR_DEFECTO;
}

/**
 * El área de una alerta. `areasDeTarjetas` trae el área de cada tarjeta que se pudo ubicar (null = borrada o sin área).
 * Sin tarjeta o sin área ubicable: por quién la generó; y si tampoco, "General". Nunca queda una alerta sin área.
 */
export function areaDeAlerta(alerta: { clave: string; origen: string }, areasDeTarjetas: ReadonlyMap<string, AreaDeAlerta | null>): AreaDeAlerta {
  const tarjetaId = idDeTarjetaDeLaClave(alerta.clave);
  if (tarjetaId) return areasDeTarjetas.get(tarjetaId) ?? areaDelOrigen(alerta.origen);
  return areaDelSupervisor(alerta) ?? areaDelOrigen(alerta.origen);
}

/**
 * Los incidentes del Supervisor sobre el libro V3 o el bot son del CRM de Ventas (el bot vive ahí). Se reconocen
 * por la clave `sup:<incidente>`: `INC:libro-v<N>:…` (después de un cambio del libro), `CAMBIO:` (el cambio del libro
 * mismo), `BOT:` (el bot) y `EMBUDO:` (los indicadores del embudo del bot). Los demás del Supervisor (p. ej.
 * `ATENCION:` de asesoras) siguen por quién los generó. null = esta regla no aplica.
 */
const RE_SUPERVISOR_CRM_VENTAS = /^sup:(INC:libro-v\d+:|CAMBIO:|BOT:|EMBUDO:)/;
export function areaDelSupervisor(alerta: { clave: string; origen: string }): AreaDeAlerta | null {
  if (alerta.origen !== ORIGEN_SUPERVISOR) return null;
  return RE_SUPERVISOR_CRM_VENTAS.test(String(alerta.clave ?? "")) ? "CRM Ventas" : null;
}

/** Cuántas alertas ABIERTAS (nuevas o vistas) hay por área; las resueltas no cuentan. */
export function contarAbiertasPorArea(alertas: readonly { estado: string; area: string }[]): Record<AreaDeAlerta, number> {
  const cuenta = Object.fromEntries(AREAS_DE_ALERTA.map((area) => [area, 0])) as Record<AreaDeAlerta, number>;
  for (const alerta of alertas) {
    if (alerta.estado !== "NUEVA" && alerta.estado !== "VISTA") continue;
    cuenta[leerAreaDeAlerta(alerta.area) ?? AREA_POR_DEFECTO] += 1;
  }
  return cuenta;
}

/* ───────────── RESPONSABLE (Sistemas o Negocio; se calcula al leer, no se guarda) ───────────── */

export const RESPONSABLES_DE_ALERTA = ["SISTEMAS", "NEGOCIO"] as const;
export type ResponsableDeAlerta = (typeof RESPONSABLES_DE_ALERTA)[number];
export const ETIQUETA_DE_RESPONSABLE: Record<ResponsableDeAlerta, string> = { SISTEMAS: "Sistemas", NEGOCIO: "Negocio" };

/** Orígenes futuros (aún ninguna fuente los genera): la regla deja su lugar listo. */
export const ORIGEN_MARKETPLACE = "CRM Marketplace";
export const ORIGEN_RUTINAS = "Rutinas";

/** AppSetting con el id de la persona responsable de Sistemas (Emanuel). Sin fila, todo se ve como antes. */
export const claveResponsableDeSistemas = (workspaceId: string) => `alertas:responsable-sistemas:${workspaceId}`;

const ORIGENES_DE_SISTEMAS = new Set<string>([ORIGEN_POR_AREA.sistemas, ORIGEN_LINEA, ORIGEN_MARKETPLACE, ORIGEN_RUTINAS]);
/** Del Coordinador: se cayó, tarjeta trabada o en error, Claude llegó al límite. Las demás (necesita decisión, sin trabajo) son del dueño. */
const RE_COORDINADOR_DE_SISTEMAS = /^(auto:caido$|auto:trabado:|coord:limite:)/;

/**
 * ¿De quién es la alerta? Sistemas (Emanuel) o Negocio (Alexander). Todo lo que no se reconoce es Negocio: así un
 * error de clasificación nunca esconde una alerta (el jefe siempre la ve).
 */
export function responsableDeAlerta(alerta: { origen: string; clave: string }): ResponsableDeAlerta {
  const clave = String(alerta.clave ?? "");
  if (ORIGENES_DE_SISTEMAS.has(alerta.origen) || clave.startsWith("LINEA:caida:")) return "SISTEMAS";
  if (alerta.origen === ORIGEN_COORDINADOR) return RE_COORDINADOR_DE_SISTEMAS.test(clave) ? "SISTEMAS" : "NEGOCIO";
  if (alerta.origen === ORIGEN_SUPERVISOR) return clave.startsWith("sup:CEREBRO:") ? "SISTEMAS" : "NEGOCIO";
  return "NEGOCIO";
}

/**
 * Quién mira la página. `responsableSistemasId` = el ajuste (null = sin configurar). `verTodas` = el jefe pidió ver también las de Sistemas.
 */
export type QuienMira = { userId: string; esJefe: boolean; responsableSistemasId?: string | null; verTodas?: boolean };

/** ¿Esta persona ve esta alerta? Las personales solo las ve su destinatario; las del negocio dependen del responsable. */
export function puedeVerAlerta(alerta: { origen: string; clave: string; destinatarioId: string | null }, mirando: QuienMira): boolean {
  if (alerta.destinatarioId) return alerta.destinatarioId === mirando.userId;
  const responsable = mirando.responsableSistemasId || null;
  if (responsable && mirando.userId === responsable) return responsableDeAlerta(alerta) === "SISTEMAS";
  if (!mirando.esJefe) return false;
  if (!responsable || mirando.verTodas) return true;
  return responsableDeAlerta(alerta) === "NEGOCIO";
}
