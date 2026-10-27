/**
 * COMPARAR EMBUDOS (pantalla /cliente/direccion/comparar-embudos y herramienta MCP `comparar_embudos`),
 * en código puro: sin base ni Next. La pantalla y el MCP usan ESTAS funciones, así que nunca dan
 * números distintos. Se prueba con `npm run test:comparar-embudos` (scripts/check-comparar-embudos.mjs).
 *
 * QUÉ ES UNA "VERSIÓN": la versión del libro del agente con la que entró el chat
 * (EmbudoLead.libroVersionEntrada). Los chats sin ese dato van en "sin versión" y no se inventa.
 *
 * LOS CINCO PASOS (acumulativos: quien llegó a un paso cuenta en los de antes):
 *  1. Entró.
 *  2. Respondió la bienvenida (evento CLIENTE_RESPONDIO).
 *  3. Dio su ciudad (señal `envio_ciudad` guardada en el lead).
 *  4. Llegó a Caliente (temperatura CALIENTE o ya tiene cotización/anticipo).
 *  5. Compró (Ganado en el CRM o EmbudoLead.ventaEn).
 *
 * PLATA: el CRM no guarda el monto (vive en Gestión). Si el lead trae `monto` se suma; si ninguno
 * lo trae, la plata sale como "no disponible" y el resto sigue igual.
 */

import { familiaDeTexto, porcentaje, type ClaveDeFamilia } from "./semanal";

/** Con menos chats que esto, los % engañan: se avisa "faltan datos". */
export const MINIMO_DE_CHATS = 100;

export const ORIGENES = [
  { clave: "anuncio", nombre: "Anuncio" },
  { clave: "marketplace", nombre: "Marketplace" },
  { clave: "directo", nombre: "Directo (sin anuncio)" },
] as const;
export type ClaveDeOrigen = (typeof ORIGENES)[number]["clave"];

export function esOrigen(valor: string): valor is ClaveDeOrigen {
  return ORIGENES.some((origen) => origen.clave === valor);
}

export const PASOS_COMPARADOS = [
  { clave: "entro", nombre: "Entró" },
  { clave: "respondio", nombre: "Respondió la bienvenida" },
  { clave: "ciudad", nombre: "Dio su ciudad" },
  { clave: "caliente", nombre: "Llegó a Caliente" },
  { clave: "compro", nombre: "Compró" },
] as const;
export type ClaveDePasoComparado = (typeof PASOS_COMPARADOS)[number]["clave"];

/** Lo que se necesita de cada chat. La lectura de la base lo arma (servicios/leer-comparacion.ts). */
export type LeadParaComparar = {
  conversationId: string;
  entradaEn: Date | string;
  /** Versión del libro con la que entró. null = sin dato. */
  libroVersion: number | null;
  familia: ClaveDeFamilia;
  canalId: string | null;
  origen: ClaveDeOrigen;
  respondio: boolean;
  dioCiudad: boolean;
  caliente: boolean;
  compro: boolean;
  /** Fecha de la venta (wonAt o EmbudoLead.ventaEn). */
  ventaEn?: Date | string | null;
  /** Plata de la venta, si se pudo leer de Gestión. */
  monto?: number | null;
};

export type FiltrosDeComparacion = {
  /** AAAA-MM-DD, hora de Bogotá, incluido. */
  desde?: string | null;
  hasta?: string | null;
  canalId?: string | null;
  origen?: ClaveDeOrigen | null;
  familia?: ClaveDeFamilia | null;
};

const ms = (valor: Date | string) => (valor instanceof Date ? valor.getTime() : new Date(valor).getTime());

export function esDiaValido(valor: string | null | undefined): valor is string {
  return Boolean(valor) && /^\d{4}-\d{2}-\d{2}$/.test(valor as string) && Number.isFinite(new Date(`${valor}T12:00:00.000Z`).getTime());
}

/** Los chats que pasan los filtros (las fechas miran el día de entrada, hora de Bogotá). */
export function filtrarLeads(leads: ReadonlyArray<LeadParaComparar>, filtros: FiltrosDeComparacion): LeadParaComparar[] {
  const desde = esDiaValido(filtros.desde) ? new Date(`${filtros.desde}T00:00:00.000-05:00`).getTime() : null;
  const hasta = esDiaValido(filtros.hasta) ? new Date(`${filtros.hasta}T23:59:59.999-05:00`).getTime() : null;
  return leads.filter((lead) => {
    const entrada = ms(lead.entradaEn);
    if (desde !== null && entrada < desde) return false;
    if (hasta !== null && entrada > hasta) return false;
    if (filtros.canalId && lead.canalId !== filtros.canalId) return false;
    if (filtros.origen && lead.origen !== filtros.origen) return false;
    if (filtros.familia && lead.familia !== filtros.familia) return false;
    return true;
  });
}

/** Las versiones que hay en esos chats, la de más chats primero. Los chats sin versión no entran. */
export function versionesDisponibles(leads: ReadonlyArray<LeadParaComparar>): Array<{ version: number; chats: number }> {
  const cuenta = new Map<number, number>();
  for (const lead of leads) {
    if (lead.libroVersion === null) continue;
    cuenta.set(lead.libroVersion, (cuenta.get(lead.libroVersion) ?? 0) + 1);
  }
  return [...cuenta.entries()].map(([version, chats]) => ({ version, chats })).sort((a, b) => b.chats - a.chats || b.version - a.version);
}

/** La familia que nombra un texto libre ("camillas", "Combo camilla"), o null. */
export function familiaDePedido(texto: string | null | undefined): ClaveDeFamilia | null {
  const limpio = (texto ?? "").trim().toLowerCase();
  if (!limpio) return null;
  if (limpio === "marketplace") return "marketplace";
  if (limpio === "otros") return "otros";
  return familiaDeTexto(limpio);
}

/* -------------------------------------------------------------------------------- una versión */

export type PasoResumen = { clave: ClaveDePasoComparado; nombre: string; leads: number; pct: number | null };

export type CaidaMayor = {
  desde: ClaveDePasoComparado;
  hacia: ClaveDePasoComparado;
  desdeNombre: string;
  haciaNombre: string;
  /** Cuántos llegaron al paso y no pasaron al siguiente. */
  quedaron: number;
  /** % de los que llegaron al paso que se quedaron. */
  pctQuedaron: number;
};

export type ResumenDeVersion = {
  /** null = los chats sin versión. */
  version: number | null;
  etiqueta: string;
  chats: number;
  faltanDatos: boolean;
  pasos: PasoResumen[];
  pctRespondio: number | null;
  pctCiudad: number | null;
  pctCaliente: number | null;
  /** % que compró = tasa de cierre. */
  tasaCierre: number | null;
  compraron: number;
  mayorCaida: CaidaMayor | null;
  /** Días promedio entre la entrada y la venta. null = sin ventas con fecha. */
  diasHastaVenta: number | null;
  /** null = no disponible (el CRM no guarda el monto). */
  plata: number | null;
};

export function etiquetaDeVersion(version: number | null): string {
  return version === null ? "Sin versión" : `Versión ${version}`;
}

function alcanzo(lead: LeadParaComparar, paso: ClaveDePasoComparado): boolean {
  const compro = lead.compro;
  const caliente = lead.caliente || compro;
  const ciudad = lead.dioCiudad || caliente;
  const respondio = lead.respondio || ciudad;
  switch (paso) {
    case "entro":
      return true;
    case "respondio":
      return respondio;
    case "ciudad":
      return ciudad;
    case "caliente":
      return caliente;
    case "compro":
      return compro;
  }
}

/** La mayor caída ABSOLUTA entre pasos consecutivos. Empate: la más temprana. */
export function mayorCaidaDe(pasos: ReadonlyArray<PasoResumen>): CaidaMayor | null {
  let mejor: CaidaMayor | null = null;
  for (let i = 0; i < pasos.length - 1; i += 1) {
    const quedaron = pasos[i].leads - pasos[i + 1].leads;
    if (quedaron <= 0 || (mejor && quedaron <= mejor.quedaron)) continue;
    mejor = {
      desde: pasos[i].clave,
      hacia: pasos[i + 1].clave,
      desdeNombre: pasos[i].nombre,
      haciaNombre: pasos[i + 1].nombre,
      quedaron,
      pctQuedaron: Math.round((quedaron / Math.max(pasos[i].leads, 1)) * 100),
    };
  }
  return mejor;
}

/** Arma los números de UNA versión a partir de sus chats. */
export function resumirVersion(version: number | null, leads: ReadonlyArray<LeadParaComparar>): ResumenDeVersion {
  const chats = leads.length;
  const pasos: PasoResumen[] = PASOS_COMPARADOS.map((paso) => {
    const cuantos = leads.filter((lead) => alcanzo(lead, paso.clave)).length;
    return { clave: paso.clave, nombre: paso.nombre, leads: cuantos, pct: porcentaje(cuantos, chats) };
  });
  const pct = (clave: ClaveDePasoComparado) => pasos.find((paso) => paso.clave === clave)?.pct ?? null;

  const ventas = leads.filter((lead) => lead.compro);
  const dias = ventas
    .filter((lead) => lead.ventaEn)
    .map((lead) => (ms(lead.ventaEn as Date | string) - ms(lead.entradaEn)) / 86_400_000)
    .filter((valor) => Number.isFinite(valor) && valor >= 0);
  const conMonto = ventas.filter((lead) => typeof lead.monto === "number");

  return {
    version,
    etiqueta: etiquetaDeVersion(version),
    chats,
    faltanDatos: chats < MINIMO_DE_CHATS,
    pasos,
    pctRespondio: pct("respondio"),
    pctCiudad: pct("ciudad"),
    pctCaliente: pct("caliente"),
    tasaCierre: pct("compro"),
    compraron: ventas.length,
    mayorCaida: mayorCaidaDe(pasos),
    diasHastaVenta: dias.length ? Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10 : null,
    plata: conMonto.length ? conMonto.reduce((suma, lead) => suma + (lead.monto as number), 0) : null,
  };
}

/* ------------------------------------------------------------------------------ comparación */

export type TonoDeDiferencia = "mejor" | "peor" | "igual" | "nada";

export type Diferencia = { texto: string; tono: TonoDeDiferencia };

export type IndicadorComparado = "chats" | "respondio" | "ciudad" | "caliente" | "cierre" | "dias" | "plata";

const coma = (valor: number) => valor.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/**
 * Cuánto cambió B frente a A. `masEsMejor`: en los % y la plata, más es mejor (verde); en los días
 * hasta la venta, menos es mejor. Los chats que entraron no son bueno ni malo: tono "igual" o "nada".
 */
export function diferenciaDe(
  a: number | null,
  b: number | null,
  opciones: { unidad: "pp" | "chats" | "dias" | "plata"; masEsMejor: boolean | null },
): Diferencia {
  if (a === null || b === null) return { texto: "sin dato", tono: "nada" };
  const bruto = b - a;
  const redondo = Math.abs(bruto) >= 1 ? Math.round(bruto) : Math.round(bruto * 10) / 10;
  if (redondo === 0) return { texto: "igual", tono: "igual" };
  const signo = redondo > 0 ? "+" : "−";
  const valor = coma(Math.abs(redondo));
  const texto =
    opciones.unidad === "pp"
      ? `${signo}${valor} ${Math.abs(redondo) === 1 ? "punto" : "puntos"}`
      : opciones.unidad === "dias"
        ? `${signo}${valor} ${Math.abs(redondo) === 1 ? "día" : "días"}`
        : opciones.unidad === "plata"
          ? `${signo}$${Math.abs(Math.round(bruto)).toLocaleString("es-CO")}`
          : `${signo}${valor} chats`;
  if (opciones.masEsMejor === null) return { texto, tono: "nada" };
  const mejora = opciones.masEsMejor ? bruto > 0 : bruto < 0;
  return { texto, tono: mejora ? "mejor" : "peor" };
}

export type Comparacion = {
  a: ResumenDeVersion;
  b: ResumenDeVersion;
  /** Diferencias de B frente a A. */
  diferencias: Record<IndicadorComparado, Diferencia>;
  /** Cuál vende más por tasa de cierre: "a", "b" o null si empatan o no se puede decir. */
  ganadora: "a" | "b" | null;
  avisos: string[];
};

export function compararResumenes(a: ResumenDeVersion, b: ResumenDeVersion): Comparacion {
  const diferencias: Record<IndicadorComparado, Diferencia> = {
    chats: diferenciaDe(a.chats, b.chats, { unidad: "chats", masEsMejor: null }),
    respondio: diferenciaDe(a.pctRespondio, b.pctRespondio, { unidad: "pp", masEsMejor: true }),
    ciudad: diferenciaDe(a.pctCiudad, b.pctCiudad, { unidad: "pp", masEsMejor: true }),
    caliente: diferenciaDe(a.pctCaliente, b.pctCaliente, { unidad: "pp", masEsMejor: true }),
    cierre: diferenciaDe(a.tasaCierre, b.tasaCierre, { unidad: "pp", masEsMejor: true }),
    dias: diferenciaDe(a.diasHastaVenta, b.diasHastaVenta, { unidad: "dias", masEsMejor: false }),
    plata: diferenciaDe(a.plata, b.plata, { unidad: "plata", masEsMejor: true }),
  };
  const avisos: string[] = [];
  for (const resumen of [a, b]) {
    if (resumen.faltanDatos) {
      avisos.push(`Faltan datos: ${resumen.etiqueta} tiene ${resumen.chats} chats (menos de ${MINIMO_DE_CHATS}); los porcentajes pueden engañar.`);
    }
  }
  if (a.plata === null && b.plata === null) {
    avisos.push("La plata vendida no está disponible: el CRM no guarda el monto (vive en Gestión).");
  }
  let ganadora: "a" | "b" | null = null;
  if (a.tasaCierre !== null && b.tasaCierre !== null && a.tasaCierre !== b.tasaCierre) {
    ganadora = b.tasaCierre > a.tasaCierre ? "b" : "a";
  }
  return { a, b, diferencias, ganadora, avisos };
}

/** Compara dos versiones sobre los mismos chats ya filtrados. */
export function compararVersiones(
  leads: ReadonlyArray<LeadParaComparar>,
  versionA: number | null,
  versionB: number | null,
): Comparacion {
  const de = (version: number | null) => leads.filter((lead) => lead.libroVersion === version);
  return compararResumenes(resumirVersion(versionA, de(versionA)), resumirVersion(versionB, de(versionB)));
}

/* --------------------------------------------------------------------------------- texto (MCP) */

const pctTexto = (valor: number | null) => (valor === null ? "sin dato" : `${coma(valor)} %`);

/** Lo mismo que la pantalla, en frases para que Claude lo diga por voz. */
export function textoDeComparacion(comparacion: Comparacion): string {
  const { a, b } = comparacion;
  const lineas: string[] = [];
  if (comparacion.ganadora) {
    const gana = comparacion[comparacion.ganadora];
    const pierde = comparacion[comparacion.ganadora === "a" ? "b" : "a"];
    lineas.push(
      `${gana.etiqueta} vende más: cierra ${pctTexto(gana.tasaCierre)} contra ${pctTexto(pierde.tasaCierre)} de ${pierde.etiqueta}.`,
    );
  } else {
    lineas.push("Las dos versiones cierran igual, o todavía no hay datos para decir cuál vende más.");
  }
  for (const resumen of [a, b]) {
    const partes = [
      `${resumen.chats} chats`,
      `respondió la bienvenida ${pctTexto(resumen.pctRespondio)}`,
      `dio su ciudad ${pctTexto(resumen.pctCiudad)}`,
      `llegó a Caliente ${pctTexto(resumen.pctCaliente)}`,
      `compró ${pctTexto(resumen.tasaCierre)} (${resumen.compraron})`,
      `días hasta la venta: ${resumen.diasHastaVenta === null ? "sin dato" : coma(resumen.diasHastaVenta)}`,
      `plata vendida: ${resumen.plata === null ? "no disponible" : `$${Math.round(resumen.plata).toLocaleString("es-CO")}`}`,
    ];
    lineas.push(`${resumen.etiqueta}: ${partes.join("; ")}.`);
    lineas.push(
      resumen.mayorCaida
        ? `En ${resumen.etiqueta} la gente se cae sobre todo entre «${resumen.mayorCaida.desdeNombre}» y «${resumen.mayorCaida.haciaNombre}»: se quedan ${resumen.mayorCaida.quedaron} (${resumen.mayorCaida.pctQuedaron} % de los que llegaron al paso).`
        : `En ${resumen.etiqueta} no hay caída que señalar.`,
    );
  }
  lineas.push(...comparacion.avisos);
  return lineas.join("\n");
}
