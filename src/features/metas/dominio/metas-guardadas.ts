/**
 * Metas guardadas en `AppSetting`: claves, meses y validación. Solo lógica, sin base de datos, para poder probarla.
 *
 * Cada mes del negocio es una fila `metas-ventas:<workspaceId>:<AAAA-MM>` con el JSON de `MetasDelMes`.
 * El dueño las carga en /cliente/metas; nada se guarda hasta que da "Guardar".
 */

import {
  ZONA_DEL_NEGOCIO,
  limpiarNombre,
  type AsesoraConMeta,
  type MetasDelMes,
} from "./calculo";

export const PREFIJO_METAS = "metas-ventas:";

/** Tope de asesoras por mes: evita que un formulario armado a mano guarde una fila gigante. */
export const MAXIMO_DE_ASESORAS = 50;
export const MAXIMO_LARGO_DE_NOMBRE = 80;

const FORMATO_DE_MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const esMesValido = (mes: string) => FORMATO_DE_MES.test(mes);

export const claveDeMetas = (workspaceId: string, mes: string) => `${PREFIJO_METAS}${workspaceId}:${mes}`;

/** El mes ('AAAA-MM') de `hoy` en hora de Bogotá. */
export function mesActualBogota(hoy: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_DEL_NEGOCIO, year: "numeric", month: "2-digit" })
    .formatToParts(hoy);
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}`;
}

/** Suma (o resta) meses a un 'AAAA-MM'. */
export function moverMes(mes: string, cuantos: number): string {
  const [anio, numero] = mes.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, numero - 1 + cuantos, 1));
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const mesAnterior = (mes: string) => moverMes(mes, -1);

const NOMBRES_DE_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** '2026-11' → 'noviembre 2026'. */
export function mesEnPalabras(mes: string): string {
  const [anio, numero] = mes.split("-").map(Number);
  return `${NOMBRES_DE_MES[numero - 1] ?? mes} ${anio}`;
}

const esNumeroNoNegativo = (valor: unknown): valor is number =>
  typeof valor === "number" && Number.isFinite(valor) && valor >= 0;
const esPorcentaje = (valor: unknown): valor is number => esNumeroNoNegativo(valor) && valor <= 1;
const textoOpcional = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

/**
 * Revisa el JSON leído de la fila. Si algo no cuadra (un número negativo, un porcentaje fuera de 0–1, una asesora
 * sin nombre) devuelve `null`: mejor pedir que se vuelvan a cargar que mostrar comisiones con datos dañados.
 */
export function validarMetas(valor: unknown): MetasDelMes | null {
  if (!valor || typeof valor !== "object") return null;
  const datos = valor as Record<string, unknown>;
  if (!Array.isArray(datos.asesoras) || datos.asesoras.length > MAXIMO_DE_ASESORAS) return null;

  const asesoras: AsesoraConMeta[] = [];
  for (const cruda of datos.asesoras) {
    if (!cruda || typeof cruda !== "object") return null;
    const asesora = cruda as Record<string, unknown>;
    const nombre = textoOpcional(asesora.nombre);
    if (!nombre || nombre.length > MAXIMO_LARGO_DE_NOMBRE) return null;
    if (!esNumeroNoNegativo(asesora.meta) || !esNumeroNoNegativo(asesora.reto)) return null;
    if (asesora.userId !== null && asesora.userId !== undefined && typeof asesora.userId !== "string") return null;
    asesoras.push({
      userId: textoOpcional(asesora.userId),
      nombre,
      nombreEnGestion: textoOpcional(asesora.nombreEnGestion),
      meta: asesora.meta,
      reto: asesora.reto,
    });
  }

  if (
    !esNumeroNoNegativo(datos.metaEquipo) ||
    !esNumeroNoNegativo(datos.minimoEquipo) ||
    !esNumeroNoNegativo(datos.bono) ||
    !esPorcentaje(datos.porcentajeHastaMeta) ||
    !esPorcentaje(datos.porcentajeSobreMeta)
  ) {
    return null;
  }

  return {
    asesoras,
    metaEquipo: datos.metaEquipo,
    minimoEquipo: datos.minimoEquipo,
    bono: datos.bono,
    porcentajeHastaMeta: datos.porcentajeHastaMeta,
    porcentajeSobreMeta: datos.porcentajeSobreMeta,
  };
}

export function leerMetasDeTexto(texto: string | null | undefined): MetasDelMes | null {
  if (!texto) return null;
  try {
    return validarMetas(JSON.parse(texto));
  } catch {
    return null;
  }
}

export type MiembroDelNegocio = { userId: string; nombre: string };

/**
 * Pone el `userId` a las asesoras que no lo tienen cuando su nombre (o su nombre en Gestión) coincide con un solo
 * miembro del negocio: igual, o como comienzo del nombre del miembro ("Yair" ↔ "Yair Gómez"). Si coincide con
 * dos miembros, no se adivina: queda sin userId.
 */
export function cruzarConMiembros(metas: MetasDelMes, miembros: MiembroDelNegocio[]): MetasDelMes {
  const buscar = (nombre: string) => {
    const limpio = limpiarNombre(nombre);
    if (!limpio) return null;
    const iguales = miembros.filter((miembro) => limpiarNombre(miembro.nombre) === limpio);
    if (iguales.length > 0) return iguales.length === 1 ? iguales[0].userId : null;
    const empiezan = miembros.filter((miembro) => limpiarNombre(miembro.nombre).startsWith(`${limpio} `));
    return empiezan.length === 1 ? empiezan[0].userId : null;
  };

  const usados = new Set(metas.asesoras.map((asesora) => asesora.userId).filter(Boolean));
  return {
    ...metas,
    asesoras: metas.asesoras.map((asesora) => {
      if (asesora.userId) return asesora;
      const userId = buscar(asesora.nombre) ?? buscar(asesora.nombreEnGestion ?? "");
      if (!userId || usados.has(userId)) return asesora;
      usados.add(userId);
      return { ...asesora, userId };
    }),
  };
}

/**
 * Lee un monto escrito por el dueño: acepta "25000000", "25.000.000" o "$ 25.000.000".
 * Devuelve `null` si no es un número entero mayor o igual a 0.
 */
export function leerMonto(texto: string | null | undefined): number | null {
  const limpio = (texto ?? "").replace(/[\s.$]/g, "");
  if (!/^\d{1,13}$/.test(limpio)) return null;
  return Number(limpio);
}

/** Lee un porcentaje escrito como "10" o "12,5" (sobre 100) y lo devuelve entre 0 y 1, o `null`. */
export function leerPorcentaje(texto: string | null | undefined): number | null {
  const limpio = (texto ?? "").replace(/[\s%]/g, "").replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(limpio)) return null;
  const fraccion = Number(limpio) / 100;
  return fraccion >= 0 && fraccion <= 1 ? Math.round(fraccion * 10_000) / 10_000 : null;
}

export type ResultadoDelFormulario =
  | { ok: true; mes: string; metas: MetasDelMes }
  | { ok: false; error: string };

/**
 * Arma las metas desde los campos del formulario de /cliente/metas. `campo` devuelve el texto de un campo o `null`.
 * Los porcentajes llegan sobre 100 (10 = 10 %) y se guardan entre 0 y 1.
 */
export function metasDesdeFormulario(campo: (nombre: string) => string | null): ResultadoDelFormulario {
  const mes = (campo("mes") ?? "").trim();
  if (!esMesValido(mes)) return { ok: false, error: "El mes no es válido." };

  const cantidad = Number(campo("cantidadDeAsesoras") ?? "");
  if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > MAXIMO_DE_ASESORAS) {
    return { ok: false, error: "La lista de asesoras no es válida." };
  }

  const asesoras: AsesoraConMeta[] = [];
  for (let indice = 0; indice < cantidad; indice += 1) {
    const nombre = (campo(`asesora.${indice}.nombre`) ?? "").trim();
    if (!nombre) return { ok: false, error: `Falta el nombre de la asesora ${indice + 1}.` };
    if (nombre.length > MAXIMO_LARGO_DE_NOMBRE) return { ok: false, error: `El nombre de ${nombre} es muy largo.` };
    const nombreEnGestion = (campo(`asesora.${indice}.nombreEnGestion`) ?? "").trim();
    if (nombreEnGestion.length > MAXIMO_LARGO_DE_NOMBRE) {
      return { ok: false, error: `El nombre en Gestión de ${nombre} es muy largo.` };
    }
    const meta = leerMonto(campo(`asesora.${indice}.meta`));
    const reto = leerMonto(campo(`asesora.${indice}.reto`));
    if (meta === null) return { ok: false, error: `La meta de ${nombre} tiene que ser un número mayor o igual a 0.` };
    if (reto === null) return { ok: false, error: `El reto de ${nombre} tiene que ser un número mayor o igual a 0.` };
    asesoras.push({
      userId: (campo(`asesora.${indice}.userId`) ?? "").trim() || null,
      nombre,
      nombreEnGestion: nombreEnGestion || null,
      meta,
      reto,
    });
  }

  const userIds = asesoras.map((asesora) => asesora.userId).filter(Boolean);
  if (new Set(userIds).size < userIds.length) return { ok: false, error: "Hay una asesora repetida." };

  const metaEquipo = leerMonto(campo("metaEquipo"));
  const minimoEquipo = leerMonto(campo("minimoEquipo"));
  const bono = leerMonto(campo("bono"));
  if (metaEquipo === null) return { ok: false, error: "La meta del equipo tiene que ser un número mayor o igual a 0." };
  if (minimoEquipo === null) return { ok: false, error: "El mínimo del equipo tiene que ser un número mayor o igual a 0." };
  if (bono === null) return { ok: false, error: "El bono tiene que ser un número mayor o igual a 0." };

  const porcentajeHastaMeta = leerPorcentaje(campo("porcentajeHastaMeta"));
  const porcentajeSobreMeta = leerPorcentaje(campo("porcentajeSobreMeta"));
  if (porcentajeHastaMeta === null) return { ok: false, error: "El % hasta la meta tiene que estar entre 0 y 100." };
  if (porcentajeSobreMeta === null) return { ok: false, error: "El % sobre la meta tiene que estar entre 0 y 100." };

  return {
    ok: true,
    mes,
    metas: { asesoras, metaEquipo, minimoEquipo, bono, porcentajeHastaMeta, porcentajeSobreMeta },
  };
}
