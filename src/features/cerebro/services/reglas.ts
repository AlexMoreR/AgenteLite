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
  const plan: PlanDeSincronizacion = { nuevos: [], cambiados: [], movidos: [], ausentes: [], igualesSinCambio: 0 };

  for (const archivo of delDrive) {
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
    if (!vistos.has(fila.driveId) && fila.enDrive) plan.ausentes.push(fila.driveId);
  }
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
