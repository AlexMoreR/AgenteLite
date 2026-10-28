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

export type AlertaOrdenable = { prioridad: string; creadoEn: Date | string };

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

/** Por prioridad (Urgente primero) y, dentro de cada una, de la más nueva a la más vieja. No cambia la lista original. */
export function ordenarAlertas<T extends AlertaOrdenable>(alertas: readonly T[]): T[] {
  const peso = (alerta: T) => ORDEN_DE_PRIORIDAD[alerta.prioridad as Prioridad] ?? PRIORIDADES.length;
  return [...alertas].sort((a, b) => peso(a) - peso(b) || new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime());
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
  return areaDelOrigen(alerta.origen);
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
