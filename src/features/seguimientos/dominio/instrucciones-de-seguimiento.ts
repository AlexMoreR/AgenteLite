/**
 * LAS INSTRUCCIONES DE LOS SEGUIMIENTOS CON IA, editables por el MCP (pedido del dueño, 6-nov-2026).
 * Codigo puro, sin base.
 *
 * El redactor (`redactarSeguimientoQueEscucha`) le pide a la IA un seguimiento con 16 reglas. Desde aqui
 * se pueden ajustar por voz, con las mismas reglas que el libro V3: leer antes de cambiar, el cambio
 * queda activo al instante y se deshace en un paso.
 *  - Global: reemplaza las reglas editables (tono, que mencionar, como cerrar, que no repetir, frases a evitar).
 *  - Por producto: se agrega para el chat de ese producto.
 *  - Por numero de seguimiento: se agrega para el 1.º, 2.º... desde que el cliente callo (no es el paso del embudo).
 * Los candados (2 lineas, no inventar, nada de envio ni pago, no pedir apartar a quien ya pago o dijo que
 * no, solo el texto) no se editan y van siempre al final. El revisor sigue siendo el ultimo filtro.
 * La version 0 son las reglas de siempre: con nada guardado la IA recibe exactamente lo de antes.
 */

import {
  CANDADOS,
  LINEAS_MAXIMAS,
  REGLAS_EDITABLES_ORIGINALES,
  textoPersonalizadoParaLaIA,
  type InstruccionesDelPedido,
} from "@/features/seguimientos/dominio/seguimiento-que-escucha";

/** Donde viven, una fila por negocio (en AppSetting, como el libro V3: sin migrar la base). */
export const CLAVE_INSTRUCCIONES = "seguimientos-que-escuchan:instrucciones:";
export const CLAVE_HISTORIAL_DE_INSTRUCCIONES = "seguimientos-que-escuchan:instrucciones-historial:";

/** Versiones que se guardan en el historial (las mas nuevas). */
export const MAXIMO_DE_VERSIONES = 30;

/** Largo maximo de cada texto. */
export const LARGO_MAXIMO_GLOBAL = 4_000;
export const LARGO_MAXIMO_DE_ANADIDO = 1_500;

/** Numeros de seguimiento que se pueden personalizar (1.º al 10.º desde que el cliente callo). */
export const NUMERO_MAXIMO_DE_SEGUIMIENTO = 10;

export type AnadidoPorProducto = { productoId: string; producto: string; texto: string };
export type AnadidoPorNumero = { numero: number; texto: string };

export type InstruccionesGuardadas = {
  version: number;
  /** null = las reglas editables de siempre. */
  global: string | null;
  porProducto: AnadidoPorProducto[];
  porNumero: AnadidoPorNumero[];
  actualizadoEl: string | null;
  actualizadoPor: string | null;
};

/**
 * Una fila del historial = UN CAMBIO. `version` es la que dejo el cambio y `anterior` la que habia;
 * `fotoAnterior` es como estaba en `anterior` (con eso se vuelve atras).
 */
export type CambioDeInstrucciones = {
  version: number;
  anterior: number;
  fecha: string;
  quien: string;
  resumen: string;
  fotoAnterior: InstruccionesGuardadas;
};

/** La version 0: las reglas de siempre, sin añadidos. */
export const INSTRUCCIONES_ORIGINALES: InstruccionesGuardadas = {
  version: 0,
  global: null,
  porProducto: [],
  porNumero: [],
  actualizadoEl: null,
  actualizadoPor: null,
};

/** Lo que el revisor rechaza aunque la instruccion lo pida (no se cambia desde el MCP). */
export const LO_QUE_RECHAZA_EL_REVISOR: readonly string[] = [
  `Más de ${LINEAS_MAXIMAS} líneas o más de unas 35 palabras.`,
  "Que no termine en pregunta o que haga más de una pregunta.",
  'Las frases prohibidas: "pero", "¿sigues interesada?", "cuando puedas me avisas", "¿pudiste ver lo que te envié?", "aquí estoy para ayudarte", "si te queda alguna duda", el trato de usted y el voseo.',
  "Que se parezca a un seguimiento ya enviado a ese chat.",
  'Empezar con "¿ya decidiste?", "¿pudiste revisar?" o "¿te lo aparto?", aunque lleve saludo.',
  "En el texto de la IA: que no traiga negrita en 1 a 3 palabras, que la pregunta pase de 15 palabras o que pida apartar o separar.",
  'Volver a preguntar lo que el cliente ya dijo (ciudad, color, para cuándo o "¿ya tienes fecha?", su servicio).',
  "Pedir apartar a quien ya compró o dijo que no le interesa.",
  "Un precio, cifra o fecha que no esté en el libro, en el producto ni en la conversación.",
  'El valor del envío, "gratis", "sin costo" o "envío incluido" (ni con el 50 %).',
  "Prometer que llega, el pago (50 %, anticipo, al recibir) o la contraentrega si el texto agendado no lo dice.",
  "Contraentrega en un producto que no es el Combo, o prometer que llega a San Andrés, Leticia, Inírida o Mitú.",
];

/* ----------------------------------------------------------------------------------------------
   Leer lo guardado (si esta roto, null: el redactor sigue con las reglas de siempre)
---------------------------------------------------------------------------------------------- */

function esTexto(valor: unknown): valor is string {
  return typeof valor === "string";
}

function comoInstrucciones(dato: unknown): InstruccionesGuardadas | null {
  if (!dato || typeof dato !== "object") return null;
  const d = dato as Record<string, unknown>;
  if (typeof d.version !== "number" || !Number.isInteger(d.version) || d.version < 0) return null;
  if (d.global !== null && !esTexto(d.global)) return null;
  if (!Array.isArray(d.porProducto) || !Array.isArray(d.porNumero)) return null;
  const porProducto: AnadidoPorProducto[] = [];
  for (const fila of d.porProducto) {
    const f = fila as Record<string, unknown> | null;
    if (!f || !esTexto(f.productoId) || !esTexto(f.texto)) return null;
    porProducto.push({ productoId: f.productoId, producto: esTexto(f.producto) ? f.producto : "", texto: f.texto });
  }
  const porNumero: AnadidoPorNumero[] = [];
  for (const fila of d.porNumero) {
    const f = fila as Record<string, unknown> | null;
    if (!f || typeof f.numero !== "number" || !Number.isInteger(f.numero) || !esTexto(f.texto)) return null;
    porNumero.push({ numero: f.numero, texto: f.texto });
  }
  return {
    version: d.version,
    global: d.global as string | null,
    porProducto,
    porNumero,
    actualizadoEl: esTexto(d.actualizadoEl) ? d.actualizadoEl : null,
    actualizadoPor: esTexto(d.actualizadoPor) ? d.actualizadoPor : null,
  };
}

/** Lo guardado en AppSetting. Sin fila = la version 0. Roto = null (quien llama decide). */
export function leerInstruccionesGuardadas(valor: string | null | undefined): InstruccionesGuardadas | null {
  if (valor == null) return INSTRUCCIONES_ORIGINALES;
  try {
    return comoInstrucciones(JSON.parse(valor));
  } catch {
    return null;
  }
}

/** El historial guardado, del mas nuevo al mas viejo. Las filas rotas se saltan. */
export function leerHistorialGuardado(valor: string | null | undefined): CambioDeInstrucciones[] {
  if (!valor) return [];
  let filas: unknown;
  try {
    filas = JSON.parse(valor);
  } catch {
    return [];
  }
  if (!Array.isArray(filas)) return [];
  const historial: CambioDeInstrucciones[] = [];
  for (const fila of filas) {
    const f = fila as Record<string, unknown> | null;
    const foto = comoInstrucciones(f?.fotoAnterior);
    if (!f || !foto || typeof f.version !== "number" || typeof f.anterior !== "number") continue;
    historial.push({
      version: f.version,
      anterior: f.anterior,
      fecha: esTexto(f.fecha) ? f.fecha : "",
      quien: esTexto(f.quien) ? f.quien : "",
      resumen: esTexto(f.resumen) ? f.resumen : "",
      fotoAnterior: foto,
    });
  }
  return historial;
}

/* ----------------------------------------------------------------------------------------------
   Lo que le llega al redactor
---------------------------------------------------------------------------------------------- */

/** Las instrucciones que tocan a ESTE seguimiento: la global, la de su producto y la de su numero. */
export function instruccionesParaElPedido(
  guardadas: InstruccionesGuardadas | null | undefined,
  productoId: string | null | undefined,
  paso: number,
): InstruccionesDelPedido | null {
  if (!guardadas) return null;
  const producto = productoId ? guardadas.porProducto.find((a) => a.productoId === productoId)?.texto : undefined;
  const numero = guardadas.porNumero.find((a) => a.numero === paso)?.texto;
  if (guardadas.global === null && !producto && !numero) return null;
  return { global: guardadas.global, producto: producto ?? null, numero: numero ?? null };
}

/** El texto global como se ve hoy: el personalizado o las reglas editables de siempre (una por linea). */
export function textoGlobalVigente(guardadas: InstruccionesGuardadas): string {
  return guardadas.global ?? REGLAS_EDITABLES_ORIGINALES.join("\n");
}

/* ----------------------------------------------------------------------------------------------
   Cambiar
---------------------------------------------------------------------------------------------- */

export type CambioPedido =
  | { nivel: "global"; texto: string | null }
  | { nivel: "producto"; productoId: string; producto: string; texto: string }
  | { nivel: "numero"; numero: number; texto: string };

/** Normaliza un texto: sin espacios de mas al final de cada linea ni lineas vacias repetidas. */
function limpiar(texto: string): string {
  return texto
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** El texto que hay hoy en ese nivel ("" = no hay añadido). */
export function textoActualDelNivel(guardadas: InstruccionesGuardadas, cambio: CambioPedido): string {
  if (cambio.nivel === "global") return textoGlobalVigente(guardadas);
  if (cambio.nivel === "producto") return guardadas.porProducto.find((a) => a.productoId === cambio.productoId)?.texto ?? "";
  return guardadas.porNumero.find((a) => a.numero === cambio.numero)?.texto ?? "";
}

/** El texto que quedaria en ese nivel. Global "" o null = las reglas de siempre; añadido "" = se quita. */
export function textoNuevoDelNivel(cambio: CambioPedido): string {
  if (cambio.nivel === "global") return cambio.texto === null || !limpiar(cambio.texto) ? REGLAS_EDITABLES_ORIGINALES.join("\n") : limpiar(cambio.texto);
  return limpiar(cambio.texto);
}

/** Errores que impiden guardar (vacio = se puede). */
export function erroresDelCambio(cambio: CambioPedido): string[] {
  const errores: string[] = [];
  const texto = cambio.texto === null ? "" : limpiar(cambio.texto);
  if (cambio.nivel === "global" && texto.length > LARGO_MAXIMO_GLOBAL) {
    errores.push(`El texto global es muy largo (${texto.length} caracteres; máximo ${LARGO_MAXIMO_GLOBAL}).`);
  }
  if (cambio.nivel !== "global" && texto.length > LARGO_MAXIMO_DE_ANADIDO) {
    errores.push(`El añadido es muy largo (${texto.length} caracteres; máximo ${LARGO_MAXIMO_DE_ANADIDO}).`);
  }
  if (cambio.nivel === "numero" && (!Number.isInteger(cambio.numero) || cambio.numero < 1 || cambio.numero > NUMERO_MAXIMO_DE_SEGUIMIENTO)) {
    errores.push(`El número de seguimiento va de 1 a ${NUMERO_MAXIMO_DE_SEGUIMIENTO}.`);
  }
  return errores;
}

/** Como quedan las instrucciones con el cambio (sin version nueva: la pone quien guarda). */
export function aplicarCambio(guardadas: InstruccionesGuardadas, cambio: CambioPedido): InstruccionesGuardadas {
  if (cambio.nivel === "global") {
    const texto = cambio.texto === null ? "" : limpiar(cambio.texto);
    // Volver a escribir las de siempre tal cual tambien cuenta como "las de siempre".
    const global = !texto || texto === REGLAS_EDITABLES_ORIGINALES.join("\n") ? null : texto;
    return { ...guardadas, global };
  }
  if (cambio.nivel === "producto") {
    const texto = limpiar(cambio.texto);
    const otros = guardadas.porProducto.filter((a) => a.productoId !== cambio.productoId);
    return {
      ...guardadas,
      porProducto: texto ? [...otros, { productoId: cambio.productoId, producto: cambio.producto, texto }] : otros,
    };
  }
  const texto = limpiar(cambio.texto);
  const otros = guardadas.porNumero.filter((a) => a.numero !== cambio.numero);
  return {
    ...guardadas,
    porNumero: (texto ? [...otros, { numero: cambio.numero, texto }] : otros).sort((a, b) => a.numero - b.numero),
  };
}

/** ¿Las dos dicen lo mismo (sin mirar version ni quien)? */
export function mismasInstrucciones(a: InstruccionesGuardadas, b: InstruccionesGuardadas): boolean {
  const forma = (i: InstruccionesGuardadas) =>
    JSON.stringify({
      global: i.global,
      porProducto: [...i.porProducto].sort((x, y) => x.productoId.localeCompare(y.productoId)).map((x) => [x.productoId, x.texto]),
      porNumero: [...i.porNumero].sort((x, y) => x.numero - y.numero).map((x) => [x.numero, x.texto]),
    });
  return forma(a) === forma(b);
}

/** Frases del texto que no le llegan a la IA (hablan de envio, gratis, contraentrega o pago). */
export function frasesQueNoLleganALaIA(texto: string): string[] {
  const queda = new Set(
    textoPersonalizadoParaLaIA(texto)
      .split(/\r?\n/)
      .flatMap((l) => l.split(/(?<=[.!?])\s+/))
      .map((f) => f.trim())
      .filter(Boolean),
  );
  return texto
    .split(/\r?\n/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((f) => f.trim())
    .filter((f) => f && !/^\s*[-*•]\s*$/.test(f) && !queda.has(f));
}

/**
 * Avisos de la vista previa (no impiden guardar). Detectan lo que se puede ver en el texto, no todo:
 * el resultado no se prueba con la IA antes de guardar.
 */
export function avisosDelCambio(cambio: CambioPedido): string[] {
  const avisos: string[] = [];
  const nuevo = textoNuevoDelNivel(cambio);
  const quitadas = frasesQueNoLleganALaIA(nuevo);
  if (quitadas.length) {
    avisos.push(
      `Estas frases hablan de envío, "gratis", contraentrega o pago y NO le llegan a la IA (regla fija del 6-nov-2026, chat 8927): ${quitadas
        .map((f) => `«${f.slice(0, 120)}»`)
        .join(", ")}.`,
    );
  }
  const normal = nuevo.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/\b([3-9]|tres|cuatro|cinco|seis) (lineas|renglones|parrafos)\b/.test(normal) || /\b([4-9]\d|\d{3,}) palabras\b/.test(normal)) {
    avisos.push(`Pide textos más largos: el revisor rechaza más de ${LINEAS_MAXIMAS} líneas o más de unas 35 palabras y saldrá un texto de respaldo.`);
  }
  if (/\b(usted|ustedes)\b/.test(normal) && !/\bno (trates|tratar|trate) de usted\b/.test(normal)) {
    avisos.push("Menciona «usted»: el revisor rechaza el trato de usted.");
  }
  if (cambio.nivel === "global" && cambio.texto !== null && limpiar(cambio.texto)) {
    avisos.push(
      "El texto global REEMPLAZA las reglas editables: lo que no escribas ya no se le pide a la IA. Los candados siguen al final, y los cambios futuros del código a las reglas editables no llegarán solos.",
    );
  }
  if (cambio.nivel === "global" && (cambio.texto === null || !limpiar(cambio.texto))) {
    avisos.push("El texto global vuelve a las reglas de siempre.");
  }
  if (cambio.nivel !== "global" && !limpiar(cambio.texto)) avisos.push("Se quita este añadido.");
  return avisos;
}

/* ----------------------------------------------------------------------------------------------
   Historial y volver
---------------------------------------------------------------------------------------------- */

/**
 * Como estaban las instrucciones en la version `n`: la actual, la 0 (las de siempre) o la foto del
 * cambio que salio de `n`. null = esa version ya no esta en el historial.
 */
export function instruccionesDeLaVersion(
  actual: InstruccionesGuardadas,
  historial: readonly CambioDeInstrucciones[],
  n: number,
): InstruccionesGuardadas | null {
  if (n === actual.version) return actual;
  if (n === 0) return INSTRUCCIONES_ORIGINALES;
  return historial.find((c) => c.anterior === n)?.fotoAnterior ?? null;
}

/** Las instrucciones nuevas, con la version siguiente, y la fila del historial con la foto de antes. */
export function nuevaVersion(input: {
  actual: InstruccionesGuardadas;
  nuevas: InstruccionesGuardadas;
  historial: readonly CambioDeInstrucciones[];
  quien: string;
  resumen: string;
  ahora: Date;
}): { instrucciones: InstruccionesGuardadas; historial: CambioDeInstrucciones[] } {
  const version = input.actual.version + 1;
  const fecha = input.ahora.toISOString();
  const instrucciones: InstruccionesGuardadas = {
    version,
    global: input.nuevas.global,
    porProducto: input.nuevas.porProducto,
    porNumero: input.nuevas.porNumero,
    actualizadoEl: fecha,
    actualizadoPor: input.quien,
  };
  const cambio: CambioDeInstrucciones = {
    version,
    anterior: input.actual.version,
    fecha,
    quien: input.quien,
    resumen: input.resumen.trim().slice(0, 200) || "Cambio de instrucciones",
    fotoAnterior: input.actual,
  };
  return { instrucciones, historial: [cambio, ...input.historial].slice(0, MAXIMO_DE_VERSIONES) };
}

export { CANDADOS };
