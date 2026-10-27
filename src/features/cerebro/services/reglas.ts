/*
  CEREBRO: las reglas puras (sin base de datos ni internet), para poder probarlas.

  El cerebro es una carpeta de Google Drive. Aquí está lo que no depende de nadie más: qué documentos se
  pueden leer por dentro, quién ve la pestaña, cómo se compara el Drive con la copia (gana el Drive), cómo
  se arma lo que se escribe y cómo se buscan los pedazos que le sirven a la tarjeta o al coach.
*/

export const MIME_CARPETA = "application/vnd.google-apps.folder";
export const MIME_DOCUMENTO_GOOGLE = "application/vnd.google-apps.document";

/** Texto máximo que se guarda por documento en la copia (lo que sobra se corta y se marca). */
export const MAXIMO_TEXTO_POR_DOCUMENTO = 200_000;
/** Archivos máximos que se recorren en una sincronización y niveles de carpetas hacia abajo. */
export const MAXIMO_ARCHIVOS = 3000;
export const MAXIMO_NIVELES = 10;
/** Tamaño máximo de lo que se escribe de una vez en un documento. */
export const MAXIMO_ESCRITURA = 20_000;

export type TipoDeLectura = "documento" | "texto" | "otro";

/** Qué se puede leer por dentro: Google Docs y .md/.txt. PDF, imágenes y demás se ven solo por nombre. */
export function tipoDeLectura(nombre: string, mime: string): TipoDeLectura {
  if (mime === MIME_DOCUMENTO_GOOGLE) return "documento";
  if (mime === "text/markdown" || mime === "text/x-markdown" || mime === "text/plain") return "texto";
  if (/\.(md|markdown|txt)$/i.test(nombre) && !mime.startsWith("application/vnd.google-apps.")) return "texto";
  return "otro";
}

export const esLegible = (nombre: string, mime: string) => tipoDeLectura(nombre, mime) !== "otro";

/** Los .md y .txt se pueden escribir sin perder formato; un Google Doc no (se reemplazaría todo el formato). */
export const sePuedeEscribir = (nombre: string, mime: string) => tipoDeLectura(nombre, mime) === "texto";

/* ── Lo que NO es del cerebro ─────────────────────────────────────────────────────────────────── */

/**
 * Rutas (relativas a la carpeta del cerebro) que no se indexan: ni ellas ni lo que cuelga de ellas.
 * Se comparan sin importar mayúsculas. Para ignorar otra carpeta, agregarla aquí.
 */
export const RUTAS_IGNORADAS: readonly string[] = ["CRM-Gestion/export-dudas-2026-10-26"];

/** Carpetas que no se indexan en ningún nivel (librerías y compilados): ni ellas ni lo que cuelga de ellas. */
export const CARPETAS_IGNORADAS: readonly string[] = ["node_modules", "dist"];

/** Extensiones que no se indexan: código, configuración, datos sueltos e imágenes. Para mostrar una, quitarla de aquí. */
export const EXTENSIONES_IGNORADAS: readonly string[] = [
  "js", "mjs", "ts", "map", "json", "sql", "cmd", "csv", "html",
  "jpg", "jpeg", "png", "webp",
];

/** Nombres sin extensión que no se indexan (se comparan sin importar mayúsculas). */
export const NOMBRES_IGNORADOS: readonly string[] = ["license", "codeowners"];

const rutaLimpia = (ruta: string) =>
  ruta
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();

/**
 * ¿Este archivo o carpeta queda FUERA del cerebro? Sí si alguna parte de la ruta (o el nombre) empieza con
 * punto (.git, .obsidian, .claude, .gitignore…), si está en RUTAS_IGNORADAS o debajo, si pasa por una carpeta de
 * CARPETAS_IGNORADAS (node_modules, dist), o si es un archivo (nunca una carpeta) de código, datos o imagen.
 * No borra nada: solo dice que no se recorre, no se indexa y no se muestra.
 */
export function seIgnora(
  ruta: string,
  nombre: string,
  tipo?: string | null,
  rutasIgnoradas: readonly string[] = RUTAS_IGNORADAS,
): boolean {
  const partes = [...ruta.split(/[\\/]/), nombre];
  if (partes.some((parte) => parte.trim().startsWith("."))) return true;
  const limpia = rutaLimpia(ruta);
  for (const ignorada of rutasIgnoradas) {
    const base = rutaLimpia(ignorada);
    if (base && (limpia === base || limpia.startsWith(`${base}/`))) return true;
  }
  // La carpeta ignorada puede ser la propia (el nombre) o cualquiera de las de arriba (la ruta).
  const carpetas = tipo === MIME_CARPETA ? [...partes] : ruta.split(/[\\/]/);
  if (carpetas.some((parte) => CARPETAS_IGNORADAS.includes(parte.trim().toLowerCase()))) return true;
  // Las carpetas solo se ignoran por su nombre o su ruta, nunca por extensión (una carpeta "datos.json" se ve).
  if (tipo === MIME_CARPETA) return false;
  if (NOMBRES_IGNORADOS.includes(nombre.trim().toLowerCase())) return true;
  const extension = /\.([a-z0-9]+)$/i.exec(nombre)?.[1]?.toLowerCase();
  if (extension && EXTENSIONES_IGNORADAS.includes(extension)) return true;
  return EXTENSIONES_IGNORADAS.some((ext) => tipo === `image/${ext}`);
}

type NodoContable = { esCarpeta: boolean; hijos: readonly NodoContable[] };

/** Cuántos documentos (no carpetas) tiene un árbol ya filtrado: lo que se muestra como "documentos en el cerebro". */
export function contarDocumentos(nodos: readonly NodoContable[]): number {
  let total = 0;
  for (const nodo of nodos) total += (nodo.esCarpeta ? 0 : 1) + contarDocumentos(nodo.hijos);
  return total;
}

export function recortarTexto(texto: string, maximo = MAXIMO_TEXTO_POR_DOCUMENTO) {
  if (texto.length <= maximo) return { texto, truncado: false };
  return { texto: texto.slice(0, maximo), truncado: true };
}

/* ── Quién ve el cerebro ─────────────────────────────────────────────────────────────────────── */

export type AccesoParaElCerebro = {
  userId: string;
  isOwner: boolean;
  membershipRole: string | null;
};

/** El dueño del negocio (la misma idea de "dueño" de la pantalla Claude). */
export function esDuenoDelCerebro(acceso: Pick<AccesoParaElCerebro, "isOwner" | "membershipRole">) {
  return acceso.isOwner || acceso.membershipRole === "OWNER";
}

/** Ve la pestaña: el dueño y quien él autorizó. */
export function puedeVerElCerebro(acceso: AccesoParaElCerebro, autorizados: readonly string[]) {
  return esDuenoDelCerebro(acceso) || autorizados.includes(acceso.userId);
}

/** Conectar Google, elegir la carpeta, desconectar y autorizar personas: solo el dueño. */
export const puedeAdministrarElCerebro = esDuenoDelCerebro;

export function autorizadosDeEntrada(valor: unknown): string[] {
  if (typeof valor !== "string" || !valor.trim()) return [];
  try {
    const lista: unknown = JSON.parse(valor);
    if (!Array.isArray(lista)) return [];
    return [...new Set(lista.filter((id): id is string => typeof id === "string" && id.length > 0))];
  } catch {
    return [];
  }
}

/* ── Gana el Drive ───────────────────────────────────────────────────────────────────────────── */

/** Lo que dice el Drive de un archivo o carpeta. */
export type ArchivoDeDrive = {
  driveId: string;
  padreId: string | null;
  nombre: string;
  ruta: string;
  tipo: string;
  esCarpeta: boolean;
  modificadoEnDrive: string | null;
  versionDrive: string | null;
  linkDrive: string | null;
};

/** Lo que hay en la copia de la base. */
export type CopiaDeArchivo = {
  driveId: string;
  nombre: string;
  ruta: string;
  padreId: string | null;
  versionDrive: string | null;
  modificadoEnDrive: string | null;
  enDrive: boolean;
  tieneTexto: boolean;
  /** El tipo (mime) que tenía: sirve para reconocer imágenes ignoradas. */
  tipo?: string | null;
};

export type PlanDeSincronizacion = {
  /** Archivos que no están en la copia: se crean (y se baja su texto si es legible). */
  nuevos: ArchivoDeDrive[];
  /** Cambiaron en el Drive: la copia se reemplaza con lo del Drive (se baja el texto de nuevo). */
  cambiados: ArchivoDeDrive[];
  /** Solo cambió de nombre o de lugar: se actualiza la ficha sin bajar el texto. */
  movidos: ArchivoDeDrive[];
  /** Están en la copia y ya no en el Drive: se marcan "ya no está en Drive" (no se borran de la copia). */
  ausentes: string[];
  /**
   * Están vigentes en la copia pero quedan fuera por seIgnora: se marcan igual que los ausentes, aunque el
   * recorrido venga truncado (no es duda: es la regla). Nunca se borran filas.
   */
  ignorados: string[];
  /** Estaban marcados ausentes y volvieron: se actualizan igual que los cambiados. */
  igualesSinCambio: number;
};

/**
 * Compara el Drive con la copia. El Drive manda: si la versión o la fecha de modificación son distintas,
 * la copia se reemplaza; si el archivo ya no aparece, se marca como ausente. Nunca devuelve nada que
 * borre algo en el Drive: este plan solo mueve la copia.
 */
export function planificarSincronizacion(
  delDrive: readonly ArchivoDeDrive[],
  copia: readonly CopiaDeArchivo[],
): PlanDeSincronizacion {
  const enCopia = new Map(copia.map((fila) => [fila.driveId, fila]));
  const vistos = new Set<string>();
  const ignorados = new Set<string>();
  const plan: PlanDeSincronizacion = { nuevos: [], cambiados: [], movidos: [], ausentes: [], ignorados: [], igualesSinCambio: 0 };

  for (const archivo of delDrive) {
    // Red de seguridad: aunque el recorrido ya los salta, lo ignorado nunca entra a la copia.
    if (seIgnora(archivo.ruta, archivo.nombre, archivo.tipo)) {
      if (enCopia.get(archivo.driveId)?.enDrive) ignorados.add(archivo.driveId);
      continue;
    }
    vistos.add(archivo.driveId);
    const previo = enCopia.get(archivo.driveId);
    if (!previo) {
      plan.nuevos.push(archivo);
      continue;
    }
    const contenidoIgual =
      previo.enDrive &&
      (archivo.esCarpeta ||
        ((archivo.versionDrive ?? null) === (previo.versionDrive ?? null) &&
          (archivo.modificadoEnDrive ?? null) === (previo.modificadoEnDrive ?? null) &&
          (previo.tieneTexto || !esLegible(archivo.nombre, archivo.tipo))));
    if (contenidoIgual) {
      const fichaIgual =
        previo.nombre === archivo.nombre && previo.ruta === archivo.ruta && (previo.padreId ?? null) === (archivo.padreId ?? null);
      if (fichaIgual) plan.igualesSinCambio += 1;
      else plan.movidos.push(archivo);
    } else {
      plan.cambiados.push(archivo);
    }
  }
  for (const fila of copia) {
    if (!fila.enDrive || vistos.has(fila.driveId)) continue;
    if (ignorados.has(fila.driveId) || seIgnora(fila.ruta, fila.nombre, fila.tipo)) ignorados.add(fila.driveId);
    else plan.ausentes.push(fila.driveId);
  }
  plan.ignorados = [...ignorados];
  return plan;
}

/* ── Árbol y rutas ───────────────────────────────────────────────────────────────────────────── */

export type NodoDelArbol<T extends { driveId: string; padreId: string | null; nombre: string; esCarpeta: boolean }> = T & {
  hijos: NodoDelArbol<T>[];
};

/** Arma el árbol desde la lista plana: carpetas primero, luego por nombre. La raíz es la carpeta elegida. */
export function armarArbol<T extends { driveId: string; padreId: string | null; nombre: string; esCarpeta: boolean }>(
  filas: readonly T[],
  raizId: string,
): NodoDelArbol<T>[] {
  const nodos = new Map<string, NodoDelArbol<T>>(filas.map((fila) => [fila.driveId, { ...fila, hijos: [] }]));
  const raices: NodoDelArbol<T>[] = [];
  for (const nodo of nodos.values()) {
    const madre = nodo.padreId && nodo.padreId !== raizId ? nodos.get(nodo.padreId) : null;
    if (madre) madre.hijos.push(nodo);
    else raices.push(nodo);
  }
  const ordenar = (lista: NodoDelArbol<T>[]) => {
    lista.sort((a, b) => Number(b.esCarpeta) - Number(a.esCarpeta) || a.nombre.localeCompare(b.nombre, "es"));
    for (const nodo of lista) ordenar(nodo.hijos);
  };
  ordenar(raices);
  return raices;
}

export function rutaDe(rutaDeLaMadre: string, nombre: string) {
  return rutaDeLaMadre ? `${rutaDeLaMadre}/${nombre}` : nombre;
}

/* ── Buscar ──────────────────────────────────────────────────────────────────────────────────── */

const sinTildes = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Las palabras de una consulta (sin tildes, de 3 letras o más, sin repetir). */
export function palabrasDeLaConsulta(consulta: string, maximo = 8): string[] {
  const palabras = sinTildes(consulta)
    .split(/[^a-z0-9ñ]+/)
    .filter((palabra) => palabra.length >= 3);
  return [...new Set(palabras)].slice(0, maximo);
}

export type PedazoDelCerebro = { driveId: string; nombre: string; ruta: string; fragmento: string; puntos: number };

/** Un fragmento alrededor de la primera coincidencia (o el comienzo si solo coincide el nombre). */
export function fragmentoAlrededor(texto: string, palabras: readonly string[], largo = 280): string {
  const plano = texto.replace(/\s+/g, " ").trim();
  const limpio = sinTildes(plano);
  let donde = -1;
  for (const palabra of palabras) {
    const posicion = limpio.indexOf(palabra);
    if (posicion >= 0 && (donde < 0 || posicion < donde)) donde = posicion;
  }
  const inicio = Math.max(0, (donde < 0 ? 0 : donde) - 60);
  const trozo = plano.slice(inicio, inicio + largo);
  return `${inicio > 0 ? "…" : ""}${trozo}${inicio + largo < plano.length ? "…" : ""}`;
}

/** Ordena documentos por cuántas palabras de la consulta tienen (el nombre pesa más que el texto). */
export function ordenarPorRelevancia(
  documentos: ReadonlyArray<{ driveId: string; nombre: string; ruta: string; texto: string | null }>,
  consulta: string,
  maximo = 10,
): PedazoDelCerebro[] {
  const palabras = palabrasDeLaConsulta(consulta);
  if (!palabras.length) return [];
  const resultados: PedazoDelCerebro[] = [];
  for (const documento of documentos) {
    const nombre = sinTildes(`${documento.ruta}`);
    const texto = sinTildes(documento.texto ?? "");
    let puntos = 0;
    for (const palabra of palabras) {
      if (nombre.includes(palabra)) puntos += 3;
      if (texto.includes(palabra)) puntos += 1;
    }
    if (puntos > 0) {
      resultados.push({
        driveId: documento.driveId,
        nombre: documento.nombre,
        ruta: documento.ruta,
        fragmento: fragmentoAlrededor(documento.texto ?? "", palabras),
        puntos,
      });
    }
  }
  return resultados.sort((a, b) => b.puntos - a.puntos || a.ruta.localeCompare(b.ruta, "es")).slice(0, maximo);
}

/** El bloque de texto que se le manda al trabajador del Tablero IA con lo del cerebro que toca la tarjeta. */
export function bloqueDelCerebroParaLaTarjeta(pedazos: readonly PedazoDelCerebro[], maximoLetras = 3500): string {
  if (!pedazos.length) return "";
  const lineas: string[] = [];
  let largo = 0;
  for (const pedazo of pedazos) {
    const linea = `- ${pedazo.ruta}: ${pedazo.fragmento}`;
    if (largo + linea.length > maximoLetras) break;
    lineas.push(linea);
    largo += linea.length;
  }
  return lineas.join("\n");
}

/* ── Escribir ────────────────────────────────────────────────────────────────────────────────── */

/** Un nombre de archivo seguro para el Drive, siempre terminado en .md. */
export function nombreDeDocumentoNuevo(nombre: unknown): string | null {
  if (typeof nombre !== "string") return null;
  const limpio = nombre
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (limpio.length < 3) return null;
  return /\.(md|txt)$/i.test(limpio) ? limpio : `${limpio}.md`;
}

export const FECHA_BOGOTA = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Bogota", dateStyle: "short" });

/** La fecha de hoy en Bogotá como AAAA-MM-DD. */
export const fechaEnBogota = (fecha: Date) => FECHA_BOGOTA.format(fecha);

/**
 * El bloque que se agrega a un documento al "pasar al cerebro": SOLO la conclusión (no la tarjeta entera),
 * con la fecha y el link a la tarjeta.
 */
export function bloqueDeConclusion(datos: { fecha: Date; conclusion: string; tituloTarjeta: string; linkTarjeta: string }) {
  return [
    `## ${fechaEnBogota(datos.fecha)} — ${datos.tituloTarjeta.trim().slice(0, 120)}`,
    "",
    datos.conclusion.trim(),
    "",
    `Origen: ${datos.linkTarjeta}`,
    "",
  ].join("\n");
}

/** Agrega un bloque al final de un texto con una línea en blanco de por medio. */
export function agregarAlFinal(actual: string, bloque: string) {
  const base = actual.replace(/\s+$/, "");
  return base ? `${base}\n\n${bloque.trim()}\n` : `${bloque.trim()}\n`;
}

/** El documento único donde Claude anota cada decisión del dueño, con fecha. */
export const NOMBRE_DECISIONES = "Decisiones de Magilus";

/** La fecha de hoy en Colombia (AAAA-MM-DD). */
export function fechaDeColombia(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

/** ¿Este documento es el de decisiones? (con o sin .md, sin importar mayúsculas ni tildes). */
export function esDocumentoDeDecisiones(nombre: string): boolean {
  const limpio = nombre
    .replace(/\.(md|markdown|txt)$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const esperado = NOMBRE_DECISIONES.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return limpio === esperado;
}

/** En "Decisiones de Magilus" cada decisión lleva su fecha: si el texto no empieza con una, el servidor se la pone. */
export function conFechaDeDecision(nombreDocumento: string, bloque: string, ahora: Date = new Date()): string {
  if (!esDocumentoDeDecisiones(nombreDocumento)) return bloque;
  const texto = bloque.trim();
  if (/^(#+\s*)?\d{4}-\d{2}-\d{2}/.test(texto)) return bloque;
  return `### ${fechaDeColombia(ahora)}\n${texto}`;
}

/** Valida lo que se va a escribir: no vacío y no gigante. */
export function problemaDelContenido(contenido: unknown): string | null {
  if (typeof contenido !== "string" || !contenido.trim()) return "Falta el texto que se va a escribir en el cerebro.";
  if (contenido.length > MAXIMO_ESCRITURA) {
    return `El texto es muy largo (${contenido.length} letras): el máximo por escritura es ${MAXIMO_ESCRITURA}. Escribe solo la conclusión.`;
  }
  return null;
}

/** La conclusión que se sugiere de una tarjeta HECHA: el resumen del resultado y, si no hay, el detalle. */
export function conclusionSugerida(tarjeta: { detalle?: string | null; resultado?: { resumen?: string | null } | null }) {
  const resumen = tarjeta.resultado?.resumen?.trim();
  const texto = resumen || tarjeta.detalle?.trim() || "";
  return texto.slice(0, 1500);
}

/** El documento donde conviene guardar una conclusión: el primero cuyo nombre comparte palabras con la tarjeta. */
export function documentoSugerido(
  documentos: ReadonlyArray<{ driveId: string; nombre: string; ruta: string; legibleParaEscribir: boolean }>,
  titulo: string,
): { driveId: string; ruta: string } | null {
  const palabras = palabrasDeLaConsulta(titulo);
  let mejor: { driveId: string; ruta: string; puntos: number } | null = null;
  for (const documento of documentos) {
    if (!documento.legibleParaEscribir) continue;
    const nombre = sinTildes(documento.ruta);
    const puntos = palabras.filter((palabra) => nombre.includes(palabra)).length;
    if (puntos > 0 && (!mejor || puntos > mejor.puntos)) mejor = { driveId: documento.driveId, ruta: documento.ruta, puntos };
  }
  return mejor ? { driveId: mejor.driveId, ruta: mejor.ruta } : null;
}

/** ¿Pasar al cerebro se ofrece en esta tarjeta? HECHA, o de un tipo llamado "Decisión". */
export function sePuedePasarAlCerebro(tarjeta: { estado: string }, tipoNombre: string | null | undefined) {
  if (tarjeta.estado === "HECHO") return true;
  return sinTildes(tipoNombre ?? "").trim() === "decision";
}

/* ── Lo que se escribe es lo que se pidió (revisión de versión) ──────────────────────────────── */

/**
 * El documento no puede haber cambiado en el Drive desde que se leyó. Si la versión que está en el Drive
 * es otra que la esperada, no se escribe.
 */
export function problemaDeVersion(versionEsperada: string | null, versionEnDrive: string | null): string | null {
  if (versionEsperada === null || versionEsperada === "") {
    return "No se sabe qué versión se leyó: lee el documento con cerebro_leer y manda su version.";
  }
  if (versionEsperada !== (versionEnDrive ?? "")) {
    return "El documento cambió en el Drive desde que se leyó. No se escribió nada: léelo de nuevo y vuelve a intentar.";
  }
  return null;
}

/** Los nombres que se preseleccionan al elegir la carpeta del cerebro (la del dueño se llama "Magilus"). */
export const CARPETAS_PREFERIDAS = ["magilus", "empresa magilus"];

/** La carpeta que se preselecciona: la que se llama como una preferida; si hay una sola, esa; si no, ninguna. */
export function carpetaPreferida(carpetas: ReadonlyArray<{ id: string; nombre: string }>): string {
  const normal = (texto: string) => texto.trim().toLowerCase();
  for (const preferida of CARPETAS_PREFERIDAS) {
    const encontrada = carpetas.find((carpeta) => normal(carpeta.nombre) === preferida);
    if (encontrada) return encontrada.id;
  }
  return carpetas.length === 1 ? carpetas[0].id : "";
}

/* ── Notas NUEVAS que crea aizen1 (la cuenta de servicio no puede crear en un Drive personal) ── */

export const ESTADOS_DE_NOTA = ["PENDIENTE", "CREADA", "ERROR"] as const;
export type EstadoDeNota = (typeof ESTADOS_DE_NOTA)[number];

/** Cómo se dice el estado en la pantalla y el MCP. */
export const TEXTO_DEL_ESTADO_DE_NOTA: Record<string, string> = {
  PENDIENTE: "pendiente de crear en aizen1",
  CREADA: "creada",
  ERROR: "error al crear en aizen1",
};

export const AVISO_NOTA_EN_AIZEN1 ="Se crea en aizen1 en ~1 minuto (pendiente de crear en aizen1).";

/**
 * ¿Esta ruta (relativa a la carpeta del cerebro) se puede crear en la bóveda? null si sí; si no, el motivo.
 * Nada que salga de la carpeta: sin "..", sin rutas absolutas ni de unidad (C:), sin caracteres raros; solo .md o .txt.
 * La misma regla la repite el Coordinador (trabajador-tablero/lib/notas-boveda.mjs) antes de escribir.
 */
export function problemaDeRutaDeNota(ruta: unknown): string | null {
  if (typeof ruta !== "string" || !ruta.trim()) return "Falta la ruta de la nota.";
  if (ruta.length > 300) return "La ruta es muy larga (máximo 300 letras).";
  if (/^[\\/]/.test(ruta) || /^[a-z]:/i.test(ruta)) return "La ruta no puede ser absoluta.";
  if (/[\u0000-\u001f<>:"|?*]/.test(ruta)) return "La ruta tiene caracteres que no se permiten.";
  const partes = ruta.split(/[\\/]/);
  if (partes.some((parte) => !parte.trim() || parte === "." || parte === ".." || parte !== parte.trim() || parte.endsWith("."))) {
    return "La ruta no puede tener partes vacías, \".\" ni \"..\".";
  }
  if (!/\.(md|txt)$/i.test(ruta)) return "Solo se crean notas .md o .txt.";
  return null;
}

/** Une la carpeta y el nombre como ruta relativa con "/". */
export const rutaDeNota = (carpeta: string, nombre: string) => (carpeta ? `${carpeta.replace(/[\\/]+$/, "")}/${nombre}` : nombre);
