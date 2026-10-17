/**
 * Los filtros de la bandeja: que son y como se leen.
 *
 * Desde el 16-10-2026 son CONDICIONES, como en el editor de Automatizaciones (Alex): cada una es
 * [campo] [operador] [valor] y se cumplen TODAS (Y). Arriba del modal siguen los dos atajos de
 * siempre (asignacion y estado), que viajan aparte (`assigned`, `status`).
 *
 * La lista de Chats se arma con CUATRO consultas que no se conocen entre si: la de la pantalla, la
 * del canal oficial, la del scroll infinito y la de los contadores. Un filtro aplicado en una sola
 * deja pasar las otras ENTERAS, sin error ni aviso —la lista simplemente trae de mas—, y ya nos
 * paso dos veces con el estado y con la asignacion. Por eso el criterio se escribe aca una vez y
 * las cuatro lo importan, en vez de repetirlo cuatro veces y que se separen con el tiempo.
 *
 * Este archivo no toca la base a proposito: el modal de filtros es del NAVEGADOR y necesita estos
 * mismos nombres y etapas. Si viviera junto a las consultas, Prisma entero terminaria viajando al
 * telefono de la asesora. Lo que consulta esta en ../services/filtros-de-bandeja.
 *
 * EN LA DIRECCION: `c=<condicion>;<condicion>…`, cada una `campo:operador:valor` (ver
 * `textoDeCondicionEnUrl`). Las listas guardadas ANTES siguen sirviendo: `stage=`, `tag=` y
 * `pending=1` se leen como sus condiciones.
 */

export const ETAPAS_CRM = [
  "NUEVO",
  "CALIFICADO",
  "PROPUESTA",
  "NEGOCIACION",
  "GANADO",
  "PERDIDO",
] as const;

export type EtapaCrm = (typeof ETAPAS_CRM)[number];

/** "Sin asignar" como valor de la condicion Asesora (el mismo de Automatizaciones). */
export const SIN_ASIGNAR = "sin_asignar";

/* ------------------------------------------------------------------------------------------------
   LAS CONDICIONES
------------------------------------------------------------------------------------------------ */

/** Sobre que fecha mira la condicion Fecha: el ultimo mensaje (lo de siempre) o cuando llego el chat. */
export type CampoDeFecha = "ultimo" | "llego";

export type CondicionDeBandeja =
  | { campo: "etapa"; operador: "es" | "no_es"; valores: EtapaCrm[] }
  /** "tiene" = alguna de estas; "no_tiene" = ninguna ("no tiene PROVEEDOR"). */
  | { campo: "etiquetas"; operador: "tiene" | "no_tiene"; valores: string[] }
  /** userIds y/o SIN_ASIGNAR. */
  | { campo: "asesora"; operador: "es" | "no_es"; valores: string[] }
  | { campo: "canal"; operador: "es" | "no_es"; valores: string[] }
  /**
   * Dias de Bogota, INCLUIDOS. "entre" usa desde/hasta (puede faltar uno); "ultimos" usa `dias`
   * (hoy y los N−1 anteriores). Los relativos (ultimos, hoy, ayer, mes) se guardan RELATIVOS: una
   * lista "ultimos 7 dias" siempre son los 7 de hoy.
   */
  | {
      campo: "fecha";
      operador: "entre" | "ultimos" | "hoy" | "ayer" | "mes";
      sobre: CampoDeFecha;
      desde?: string | null;
      hasta?: string | null;
      dias?: number | null;
    }
  /** El ultimo que hablo fue el cliente (no / si). */
  | { campo: "sin_responder"; operador: "si" | "no" }
  /** El cliente no escribe hace al menos N dias (igual que en Automatizaciones). */
  | { campo: "dias_sin_responder"; operador: "al_menos"; dias: number };

export type CampoDeBandeja = CondicionDeBandeja["campo"];

export const CAMPOS_DE_BANDEJA: ReadonlyArray<{ campo: CampoDeBandeja; etiqueta: string }> = [
  { campo: "etapa", etiqueta: "Etapa" },
  { campo: "etiquetas", etiqueta: "Etiquetas" },
  { campo: "asesora", etiqueta: "Asesora" },
  { campo: "canal", etiqueta: "Línea" },
  { campo: "fecha", etiqueta: "Fecha" },
  { campo: "sin_responder", etiqueta: "Sin responder" },
  { campo: "dias_sin_responder", etiqueta: "Días sin responder" },
];

export const OPERADORES_DE_BANDEJA: Record<CampoDeBandeja, ReadonlyArray<{ valor: string; etiqueta: string }>> = {
  etapa: [
    { valor: "es", etiqueta: "es" },
    { valor: "no_es", etiqueta: "no es" },
  ],
  etiquetas: [
    { valor: "tiene", etiqueta: "tiene" },
    { valor: "no_tiene", etiqueta: "no tiene" },
  ],
  asesora: [
    { valor: "es", etiqueta: "es" },
    { valor: "no_es", etiqueta: "no es" },
  ],
  canal: [
    { valor: "es", etiqueta: "es" },
    { valor: "no_es", etiqueta: "no es" },
  ],
  fecha: [
    { valor: "entre", etiqueta: "entre" },
    { valor: "ultimos", etiqueta: "últimos" },
    { valor: "hoy", etiqueta: "hoy" },
    { valor: "ayer", etiqueta: "ayer" },
    { valor: "mes", etiqueta: "este mes" },
  ],
  sin_responder: [
    { valor: "si", etiqueta: "sí" },
    { valor: "no", etiqueta: "no" },
  ],
  dias_sin_responder: [{ valor: "al_menos", etiqueta: "al menos" }],
};

/** Una condicion recien agregada (o al cambiar de campo). */
export function condicionVaciaDeBandeja(campo: CampoDeBandeja): CondicionDeBandeja {
  switch (campo) {
    case "etapa":
      return { campo, operador: "es", valores: [] };
    case "etiquetas":
      return { campo, operador: "tiene", valores: [] };
    case "asesora":
    case "canal":
      return { campo, operador: "es", valores: [] };
    case "fecha":
      return { campo, operador: "ultimos", sobre: "ultimo", dias: 7 };
    case "sin_responder":
      return { campo, operador: "si" };
    case "dias_sin_responder":
      return { campo, operador: "al_menos", dias: 3 };
  }
}

export type FiltrosDeBandeja = {
  /** Se cumplen TODAS. Vacio = sin filtro. Solo las completas (ver `condicionCompleta`). */
  condiciones: CondicionDeBandeja[];
};

export const SIN_FILTROS: FiltrosDeBandeja = { condiciones: [] };

export const MAX_CONDICIONES = 12;
const MAX_VALORES = 20;
const MAX_DIAS = 3650;

export function hayFiltrosPuestos(filtros: FiltrosDeBandeja): boolean {
  return filtros.condiciones.length > 0;
}

/** ¿Tiene lo que hace falta para filtrar? (una fila a medio llenar no filtra ni se guarda) */
export function condicionCompleta(c: CondicionDeBandeja): boolean {
  switch (c.campo) {
    case "etapa":
    case "etiquetas":
    case "asesora":
    case "canal":
      return c.valores.length > 0;
    case "fecha":
      if (c.operador === "entre") return Boolean(c.desde || c.hasta);
      if (c.operador === "ultimos") return Boolean(c.dias && c.dias > 0);
      return true;
    case "sin_responder":
      return true;
    case "dias_sin_responder":
      return c.dias > 0;
  }
}

/* ------------------------------------------------------------------------------------------------
   FECHAS (dias de Bogota: Colombia no cambia la hora, UTC−5 fijo)
------------------------------------------------------------------------------------------------ */

const DESFASE_BOGOTA_MS = 5 * 3_600_000;
const DIA_MS = 86_400_000;

/** "2026-10-01" valido (una fecha que existe), o null. */
export function diaValido(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim();
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) return null;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  if (anio < 2000 || anio > 2100) return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia ? texto : null;
}

/** El dia de Bogota de un instante, como YYYY-MM-DD. */
export function diaEnBogota(instante: Date): string {
  return new Date(instante.getTime() - DESFASE_BOGOTA_MS).toISOString().slice(0, 10);
}

function inicioDelDia(dia: string): Date {
  return new Date(Date.parse(`${dia}T00:00:00.000Z`) + DESFASE_BOGOTA_MS);
}

function sumarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00.000Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

type CondicionDeFecha = Extract<CondicionDeBandeja, { campo: "fecha" }>;

/** Los dias (incluidos) de una condicion de fecha, con los relativos resueltos contra `ahora`. */
export function diasDeLaFecha(c: CondicionDeFecha, ahora: Date): { desde: string | null; hasta: string | null } {
  const hoy = diaEnBogota(ahora);
  switch (c.operador) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "ayer": {
      const ayer = sumarDias(hoy, -1);
      return { desde: ayer, hasta: ayer };
    }
    case "ultimos":
      return { desde: sumarDias(hoy, -(Math.max(1, c.dias ?? 1) - 1)), hasta: hoy };
    case "mes":
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
    case "entre":
      return { desde: c.desde ?? null, hasta: c.hasta ?? null };
  }
}

/**
 * Los instantes para la consulta: `desde` INCLUIDO (00:00 de Bogota) y `antesDe` EXCLUIDO (00:00
 * del dia siguiente al "hasta"): "hasta el 15" incluye todo el 15.
 */
export function limitesDeLaFecha(c: CondicionDeFecha, ahora: Date): { desde: Date | null; antesDe: Date | null } {
  const dias = diasDeLaFecha(c, ahora);
  return {
    desde: dias.desde ? inicioDelDia(dias.desde) : null,
    antesDe: dias.hasta ? inicioDelDia(sumarDias(dias.hasta, 1)) : null,
  };
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function textoDeLaFecha(c: CondicionDeFecha, ahora: Date): string {
  const prefijo = c.sobre === "llego" ? "llegó " : "";
  switch (c.operador) {
    case "hoy":
      return `${prefijo}hoy`;
    case "ayer":
      return `${prefijo}ayer`;
    case "mes":
      return `${prefijo}este mes`;
    case "ultimos":
      return `${prefijo}últimos ${c.dias ?? 1} días`;
    case "entre":
      break;
  }
  const anioDeHoy = diaEnBogota(ahora).slice(0, 4);
  const corto = (dia: string) => ({ d: Number(dia.slice(8, 10)), mes: MESES[Number(dia.slice(5, 7)) - 1] ?? "", anio: dia.slice(0, 4) });
  const conAnio = (dia: string) => {
    const x = corto(dia);
    return `${x.d} ${x.mes}${x.anio === anioDeHoy ? "" : ` ${x.anio}`}`;
  };
  const { desde, hasta } = c;
  if (desde && hasta) {
    if (desde === hasta) return `${prefijo}${conAnio(desde)}`;
    const a = corto(desde);
    const b = corto(hasta);
    if (a.mes === b.mes && a.anio === b.anio) return `${prefijo}${a.d}–${conAnio(hasta)}`;
    return `${prefijo}${conAnio(desde)} – ${conAnio(hasta)}`;
  }
  if (desde) return `${prefijo}desde ${conAnio(desde)}`;
  return `${prefijo}hasta ${conAnio(hasta ?? "")}`;
}

/* ------------------------------------------------------------------------------------------------
   EN LA DIRECCION
------------------------------------------------------------------------------------------------ */

/** Ids (usuarios, etiquetas, lineas): solo letras, numeros, guion y guion bajo, para que nada raro llegue a la consulta. */
const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

function ids(crudo: string): string[] {
  const lista = crudo
    .split(",")
    .map((valor) => valor.trim())
    .filter((valor) => ID_VALIDO.test(valor));
  return Array.from(new Set(lista)).slice(0, MAX_VALORES);
}

function etapas(crudo: string): EtapaCrm[] {
  const lista = crudo
    .split(",")
    .map((valor) => valor.trim().toUpperCase())
    .filter((valor): valor is EtapaCrm => (ETAPAS_CRM as readonly string[]).includes(valor));
  return Array.from(new Set(lista));
}

function entero(crudo: string | undefined): number | null {
  const n = Number.parseInt(crudo ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_DIAS) : null;
}

/** Una condicion de la direccion (`campo:operador:valor`), o null si no se entiende. */
export function leerCondicion(texto: string): CondicionDeBandeja | null {
  const [campo = "", operador = "", ...resto] = texto.trim().split(":");
  const valor = resto.join(":");
  switch (campo) {
    case "etapa": {
      if (operador !== "es" && operador !== "no_es") return null;
      const valores = etapas(valor);
      return valores.length ? { campo, operador, valores } : null;
    }
    case "etiquetas": {
      if (operador !== "tiene" && operador !== "no_tiene") return null;
      const valores = ids(valor);
      return valores.length ? { campo, operador, valores } : null;
    }
    case "asesora":
    case "canal": {
      if (operador !== "es" && operador !== "no_es") return null;
      const valores = ids(valor);
      return valores.length ? { campo, operador, valores } : null;
    }
    case "fecha": {
      const [sobreCrudo = "", a = "", b = ""] = valor.split(",");
      const sobre: CampoDeFecha = sobreCrudo === "llego" ? "llego" : "ultimo";
      if (operador === "hoy" || operador === "ayer" || operador === "mes") return { campo, operador, sobre };
      if (operador === "ultimos") {
        const dias = entero(a);
        return dias ? { campo, operador, sobre, dias } : null;
      }
      if (operador === "entre") {
        let desde = diaValido(a);
        let hasta = diaValido(b);
        if (!desde && !hasta) return null;
        // Al reves ("del 15 al 1") se da vuelta en vez de dejar la lista vacia.
        if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
        return { campo, operador, sobre, desde, hasta };
      }
      return null;
    }
    case "sin_responder":
      return operador === "si" || operador === "no" ? { campo, operador } : null;
    case "dias_sin_responder": {
      const dias = entero(valor);
      return operador === "al_menos" && dias ? { campo, operador, dias } : null;
    }
    default:
      return null;
  }
}

/** La condicion como texto de la direccion. Valores ordenados: la misma condicion da el mismo texto. */
export function textoDeCondicionEnUrl(c: CondicionDeBandeja): string {
  switch (c.campo) {
    case "etapa":
    case "etiquetas":
    case "asesora":
    case "canal":
      return `${c.campo}:${c.operador}:${[...c.valores].sort().join(",")}`;
    case "fecha": {
      const sobre = c.sobre === "llego" ? "llego" : "ultimo";
      if (c.operador === "ultimos") return `fecha:ultimos:${sobre},${c.dias ?? 1}`;
      if (c.operador === "entre") return `fecha:entre:${sobre},${c.desde ?? ""},${c.hasta ?? ""}`;
      return `fecha:${c.operador}:${sobre}`;
    }
    case "sin_responder":
      return `sin_responder:${c.operador}`;
    case "dias_sin_responder":
      return `dias_sin_responder:al_menos:${c.dias}`;
  }
}

/**
 * Lee los filtros de la direccion.
 *
 * Sirve igual para la pantalla (searchParams de Next) que para las rutas de API (URLSearchParams),
 * porque recibe una funcion de lectura en vez de un objeto. Lo viejo (`stage`, `tag`, `pending`)
 * entra como condiciones; si una condicion nueva dice lo mismo, no se repite.
 */
export function leerFiltrosDeBandeja(
  leer: (clave: string) => string | null | undefined,
): FiltrosDeBandeja {
  const condiciones: CondicionDeBandeja[] = [];
  const vistas = new Set<string>();
  const agregar = (c: CondicionDeBandeja | null) => {
    if (!c || condiciones.length >= MAX_CONDICIONES) return;
    const clave = textoDeCondicionEnUrl(c);
    if (vistas.has(clave)) return;
    vistas.add(clave);
    condiciones.push(c);
  };

  const viejasEtapas = etapas(leer("stage") ?? "");
  if (viejasEtapas.length) agregar({ campo: "etapa", operador: "es", valores: viejasEtapas });
  const viejasEtiquetas = ids(leer("tag") ?? "");
  if (viejasEtiquetas.length) agregar({ campo: "etiquetas", operador: "tiene", valores: viejasEtiquetas });
  if ((leer("pending") ?? "") === "1") agregar({ campo: "sin_responder", operador: "si" });

  for (const texto of (leer("c") ?? "").split(";")) {
    if (texto.trim()) agregar(leerCondicion(texto));
  }
  return { condiciones };
}

/** Los filtros como pares para armar una direccion. Lo que esta vacio no viaja. */
export function paramsDeFiltros(filtros: FiltrosDeBandeja): Array<[string, string]> {
  const textos = filtros.condiciones.filter(condicionCompleta).map(textoDeCondicionEnUrl);
  return textos.length ? [["c", textos.join(";")]] : [];
}

/* ------------------------------------------------------------------------------------------------
   EN PALABRAS (resumen del modal y chapitas de la bandeja)
------------------------------------------------------------------------------------------------ */

export type NombresDeBandeja = {
  etapa: (etapa: EtapaCrm) => string;
  etiqueta: (id: string) => string | null;
  asesora: (id: string) => string | null;
  canal: (id: string) => string | null;
};

function lista(nombres: Array<string | null>, cuantos: number, plural: string, negada = false): string {
  const conocidos = nombres.filter((n): n is string => Boolean(n));
  if (cuantos > 2 || conocidos.length < cuantos) return `${cuantos} ${plural}`;
  return conocidos.join(negada ? " ni " : " o ");
}

/** Una condicion en pocas palabras: "Propuesta", "sin PROVEEDOR", "no Ventas 2", "1–15 oct". */
export function textoDeCondicion(c: CondicionDeBandeja, nombres: NombresDeBandeja, ahora: Date): string {
  switch (c.campo) {
    case "etapa": {
      const texto = lista(c.valores.map(nombres.etapa), c.valores.length, "etapas", c.operador === "no_es");
      return c.operador === "es" ? texto : `no ${texto}`;
    }
    case "etiquetas": {
      const texto = lista(c.valores.map(nombres.etiqueta), c.valores.length, "etiquetas", c.operador === "no_tiene");
      return c.operador === "tiene" ? `con ${texto}` : `sin ${texto}`;
    }
    case "asesora": {
      const texto = lista(
        c.valores.map((id) => (id === SIN_ASIGNAR ? "Sin asignar" : nombres.asesora(id))),
        c.valores.length,
        "asesoras",
        c.operador === "no_es",
      );
      return c.operador === "es" ? texto : `no ${texto}`;
    }
    case "canal": {
      const texto = lista(c.valores.map(nombres.canal), c.valores.length, "líneas", c.operador === "no_es");
      return c.operador === "es" ? texto : `no ${texto}`;
    }
    case "fecha":
      return textoDeLaFecha(c, ahora);
    case "sin_responder":
      return c.operador === "si" ? "sin responder" : "respondidas";
    case "dias_sin_responder":
      return `callado ${c.dias}+ días`;
  }
}

/** Hasta donde se mira hacia atras al buscar lo que quedo sin responder. */
export const DIAS_DE_SIN_RESPONDER = 60;

/**
 * Una vista como texto comparable: sin la conexion, la busqueda ni el chat abierto, y con los
 * parametros ordenados. Dos direcciones que muestran lo mismo dan la misma firma.
 */
export function firmaDeLaVista(query: string): string {
  const params = new URLSearchParams(query);
  for (const clave of ["connection", "q", "chatKey"]) params.delete(clave);
  return [...params.entries()]
    .map(([clave, valor]) => `${clave}=${valor.split(",").sort().join(",")}`)
    .sort()
    .join("&");
}

/**
 * Una lista que no filtra nada: su firma es la de la vista por defecto (Todas, abiertas, sin
 * filtros). Mostraria exactamente lo mismo que la pastilla "Todas".
 */
export function esListaSinFiltro(query: string): boolean {
  return firmaDeLaVista(query) === "";
}

/**
 * La lista que se esta mirando: la que dice lo mismo que la vista de ahora.
 *
 * Una lista SIN filtro nunca cuenta como abierta (13-10-2026). Alex guardo "Maria" sin marcar a
 * Maria (query vacia): como su firma era la de "Todas", la bandeja la daba por abierta cada vez que
 * estaba en Todas —"Maria" en azul con el total, 1648— y tocar "Todas" no la soltaba nunca: volvia
 * a la misma direccion y la lista seguia coincidiendo.
 */
export function listaQueSeEstaMirando<T extends { query: string }>(listas: readonly T[], firma: string): T | null {
  if (firma === "") return null;
  return listas.find((lista) => firmaDeLaVista(lista.query) === firma) ?? null;
}
