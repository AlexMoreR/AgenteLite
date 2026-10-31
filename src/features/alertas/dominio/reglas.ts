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

/**
 * Dinero y Meta Ads (ampliada el 30-oct-2026 para el límite de Emanuel: abonos, saldos, nómina, comisiones, facturación y
 * campañas). Es la lista que decide qué le toca siempre a Alexander. Ante la duda, de más: pedirle el sí de más es barato.
 */
const DINERO_O_META_ADS =
  /\b(meta ads?|dinero|presupuesto\w*|gasto\w*|pago\w*|pagar\w*|cobro\w*|cobrar|plata|abono\w*|saldo\w*|n[oó]mina\w*|sueldo\w*|salario\w*|comisi[oó]n(?:es)?|factura\w*|facturaci[oó]n|campa[nñ]as?|anuncio\w*|pauta|reembolso\w*)\b/i;

/** ¿El texto toca dinero (de Gestión) o Meta Ads (gasto y campañas)? Sirve para bloquear a Emanuel en esas tarjetas. */
export function tocaDineroOMetaAds(texto: string): boolean {
  return DINERO_O_META_ADS.test(String(texto ?? ""));
}

/** ¿El motivo habla de dinero, Meta Ads o una clave/permiso? Solo eso hace urgente un "necesita tu decisión". */
export function esDeDineroMetaOClave(texto: string): boolean {
  const valor = String(texto ?? "");
  return DINERO_O_META_ADS.test(valor) || /\b(clave|claves|token|tokens|credencial\w*|contrase\w+|api ?key|secret\w*|acceso|permiso\w*)\b/i.test(valor);
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

/** Cómo es el id de una tarjeta dentro de una clave: letras sin tilde, números, `_` o `-`. Un texto con espacios o tildes no es un id. */
const RE_ID_DE_TARJETA = /^[A-Za-z0-9_-]+$/;

/** El tipo de una clave de tarjeta (`auto:trabado`, `auto:necesita`, `auto:equipo` o `coord:necesita`); null si no es de tarjeta. */
function tipoDeClaveDeTarjeta(partes: readonly string[]): string | null {
  const tipo = `${partes[0]}:${partes[1]}`;
  return tipo === "auto:trabado" || tipo === "auto:necesita" || tipo === "auto:equipo" || tipo === "coord:necesita" ? tipo : null;
}

/**
 * El id de la tarjeta de una clave `auto:trabado:<tarjeta>:<estado>`, `auto:necesita:<tarjeta>:<estado>`,
 * `auto:equipo:<tarjeta>:<motivo>` (aviso al equipo) o `coord:necesita:<tarjeta>:<texto>` (pregunta del Coordinador);
 * null si no es de tarjeta. La clave vieja del Coordinador (`coord:necesita:<texto>`) no trae id: da null.
 */
export function idDeTarjetaDeLaClave(clave: string): string | null {
  const partes = String(clave ?? "").split(":");
  if (!tipoDeClaveDeTarjeta(partes)) return null;
  const id = partes[2]?.trim() ?? "";
  // La del Coordinador necesita el texto después del id: sin él, el segmento es el texto viejo y no un id.
  if (partes[0] === "coord" && partes.length < 4) return null;
  return RE_ID_DE_TARJETA.test(id) ? id : null;
}

/* ───────────── CIERRE SOLO (al aprobar, responder, terminar o borrar la tarjeta) ───────────── */

export const MOTIVOS_DE_CIERRE = ["APROBACION", "RESPUESTA", "CIERRE"] as const;
export type MotivoDeCierre = (typeof MOTIVOS_DE_CIERRE)[number];
export const ETIQUETA_DE_MOTIVO_DE_CIERRE: Record<MotivoDeCierre, string> = {
  APROBACION: "aprobación del dueño",
  RESPUESTA: "respuesta del dueño",
  CIERRE: "la tarjeta se cerró",
};

/** Qué tipos de clave cierra cada motivo. El cierre (HECHO, FALLIDO o borrada) cierra todas las de la tarjeta (menos `terminada:<id>`, que no es de esta lista). */
const TIPOS_QUE_CIERRA: Record<MotivoDeCierre, readonly string[] | null> = {
  APROBACION: ["auto:necesita", "auto:trabado", "coord:necesita"],
  RESPUESTA: ["coord:necesita"],
  CIERRE: null,
};

/** ¿Este motivo cierra esta alerta de esta tarjeta? Solo si la clave es de esa tarjeta y de un tipo que el motivo cierra. */
export function motivoCierraLaClave(motivo: MotivoDeCierre, clave: string, tarjetaId: string): boolean {
  if (!tarjetaId || idDeTarjetaDeLaClave(clave) !== tarjetaId) return false;
  const tipos = TIPOS_QUE_CIERRA[motivo];
  return tipos === null || tipos.includes(tipoDeClaveDeTarjeta(String(clave).split(":")) ?? "");
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "d-mmm HH:mm" en hora de Bogotá (p. ej. "30-oct 14:05"). */
function cuandoEnBogota(ahora: Date): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: ZONA, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(ahora)
      .map((parte) => [parte.type, parte.value]),
  );
  return `${Number(partes.day)}-${MESES_CORTOS[Number(partes.month) - 1]} ${partes.hour}:${partes.minute}`;
}

/** La línea que se agrega al detalle de una alerta que se cerró sola: "Resuelta sola: <motivo> (<d-mmm HH:mm>)", hora de Bogotá. */
export function lineaDeCierre(motivo: MotivoDeCierre, ahora: Date): string {
  return `Resuelta sola: ${ETIQUETA_DE_MOTIVO_DE_CIERRE[motivo]} (${cuandoEnBogota(ahora)})`;
}

/** La línea del barrido de cada minuto: "Resuelta sola: la tarjeta ya avanzó o se cerró (<d-mmm HH:mm>)". */
export function lineaDeCierreDelBarrido(ahora: Date): string {
  return `Resuelta sola: la tarjeta ya avanzó o se cerró (${cuandoEnBogota(ahora)})`;
}

/** La línea de la limpieza única de los avisos viejos del Coordinador (los que no traen el id de la tarjeta). */
export function lineaDeCierreDeLaLimpieza(titulo: string, ahora: Date): string {
  return `Resuelta sola: la tarjeta «${tituloCorto(titulo, 80)}» ya avanzó o se cerró; limpieza única de los avisos viejos (${cuandoEnBogota(ahora)})`;
}

/* ───────────── BARRIDO (cada minuto) Y LIMPIEZA ÚNICA (avisos viejos del Coordinador) ───────────── */

/** Los estados de una tarjeta, tal como están en Prisma (EstadoTarjeta). */
const ESTADOS_DE_TARJETA = new Set(["IDEA", "POR_APROBAR", "APROBADO", "EN_CURSO", "HECHO", "FALLIDO", "PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO", "POR_REVISAR", "SUBIENDO", "ERROR"]);
/** Cerrada: ninguna alerta suya sigue sirviendo. */
const ESTADOS_CERRADOS = new Set(["HECHO", "FALLIDO"]);
/** Ya aprobada y en manos del Coordinador: la pregunta del Coordinador ya no espera al dueño. */
const ESTADOS_YA_APROBADOS = new Set(["APROBADO", "PLAN_APROBADO", "PLANEANDO", "EN_CURSO", "SUBIENDO"]);

export type TarjetaDelBarrido = { estado: string; borradoEn: Date | string | null };

/**
 * ¿Esta alerta de tarjeta ya no aplica? (barrido de cada minuto). Sí cuando la tarjeta no existe o está borrada, está en
 * HECHO o FALLIDO, la clave `auto:trabado|necesita:<id>:<ESTADO>` trae un estado distinto del de hoy, o es una
 * `coord:necesita` y la tarjeta ya está aprobada o en curso. Una clave que no es de tarjeta (`terminada:<id>` y demás)
 * nunca se cierra acá. Un sufijo que no es un estado (p. ej. `VIA_PANTALLA`, o el motivo de `auto:equipo`) no se compara.
 */
export function alertaYaNoAplica(clave: string, tarjeta: TarjetaDelBarrido | null): boolean {
  const texto = String(clave ?? "");
  if (texto.startsWith("terminada:") || !idDeTarjetaDeLaClave(texto)) return false;
  if (!tarjeta || tarjeta.borradoEn) return true;
  if (ESTADOS_CERRADOS.has(tarjeta.estado)) return true;
  const partes = texto.split(":");
  const tipo = tipoDeClaveDeTarjeta(partes);
  if (tipo === "auto:trabado" || tipo === "auto:necesita") {
    const estadoDeLaClave = partes[3] ?? "";
    return ESTADOS_DE_TARJETA.has(estadoDeLaClave) && estadoDeLaClave !== tarjeta.estado;
  }
  if (tipo === "coord:necesita") return ESTADOS_YA_APROBADOS.has(tarjeta.estado);
  return false;
}

/**
 * Limpieza única: ¿las tarjetas con el título del aviso viejo ya no esperan nada? Solo si hay al menos una y TODAS están
 * aprobadas o más adelante, HECHO, FALLIDO o borradas. Sin ninguna, o con una que todavía espera (por aprobar, plan listo,
 * por revisar, error…), no: ante la duda la alerta queda abierta.
 */
export function tarjetasYaNoEsperan(tarjetas: readonly TarjetaDelBarrido[]): boolean {
  return tarjetas.length > 0 && tarjetas.every((t) => !!t.borradoEn || ESTADOS_CERRADOS.has(t.estado) || ESTADOS_YA_APROBADOS.has(t.estado));
}

/**
 * El título de un aviso viejo `coord:necesita:<texto>`: lo que va en `para "Título"` o entre `«Título»`. null si no está
 * (la limpieza no adivina).
 */
export function tituloEntreComillasDelAviso(texto: string): string | null {
  const valor = String(texto ?? "");
  const encontrado = /\bpara\s+[“"]([^"”\n]+)[”"]/i.exec(valor) ?? /«([^»\n]+)»/.exec(valor);
  const titulo = encontrado?.[1]?.trim() ?? "";
  return titulo ? titulo : null;
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
