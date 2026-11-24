// BITÁCORA DE INCIDENTES (24-nov-2026, parte 1 de «cada falla de subida queda anotada y se lee antes de construir»).
// Cada vez que una subida falla, el Coordinador deja una entrada:
//   1. al final de <carpetaTrabajo>/incidentes/<repo>.md (la entrada completa, con las líneas del error);
//   2. una línea resumida en la bóveda del cerebro, en config.bitacora.rutaEnBoveda (por defecto
//      "06 Tecnología/Bitácora de incidentes.md"), con escribirNotaEnLaBoveda: agrega al final y nunca borra.
// Esta parte NO cambia cómo se diagnostica, deshace o reintenta (eso es la T-876): solo anota. Nunca lanza.
import fs from "node:fs";
import path from "node:path";

import { idCorto } from "./git.mjs";
import { escribirNotaEnLaBoveda } from "./notas-boveda.mjs";

export const RUTA_EN_BOVEDA_POR_DEFECTO = "06 Tecnología/Bitácora de incidentes.md";
export const BITACORA_POR_DEFECTO = { rutaEnBoveda: RUTA_EN_BOVEDA_POR_DEFECTO, entradasEnPrompt: 15 };

/** Qué falló: los tres casos que se anotan. */
export const QUE_FALLO = {
  no_arranco: "no arrancó",
  vigilancia: "la vigilancia de 30 min la deshizo",
  ensayo: "falló el ensayo de migraciones",
};

/** Cómo se resolvió: la decisión que se tomó en ese momento. */
export const COMO_SE_RESOLVIO = {
  reintento: "reintento por falla pasajera",
  arreglo: "tarjeta 'Arreglo de subida'",
  alertas: "aviso en Alertas a la 3.ª vez",
};

/** Lo que se escribe cuando no hay causa: nunca se inventa una. */
export const SIN_CAUSA = "causa no registrada";

const MAXIMO_LINEAS = 8;
const LARGO_DE_LINEA = 300;

/** Un error de Prisma de varias líneas (P1000…P3999 o el nombre de Prisma, con más de una línea). */
const esErrorDePrismaLargo = (texto) => /prisma|\bP[1-3]\d{3}\b/i.test(texto) && texto.split(/\r?\n/).filter((linea) => linea.trim()).length > 1;

/**
 * Los patrones conocidos, en orden: el primero que calza da la regla. El de Prisma va antes que el corte de red: un error de
 * Prisma puede mencionar un tiempo agotado y no ser pasajero.
 */
const PATRONES_CONOCIDOS = [
  {
    regla: "No usar funciones de Postgres 16 que producción no tiene.",
    calza: (texto) => /pg_input_is_valid|postgres(?:ql)?\s*16|\bpg\s?16\b/i.test(texto),
  },
  { regla: "Leer el error completo, no solo la primera línea.", calza: esErrorDePrismaLargo },
  {
    regla: "Es pasajera, se reintenta.",
    calza: (texto) => /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|corte de red|tiempo agotado|timed? ?out|se pas[oó] del tiempo/i.test(texto),
  },
];

/** Si no calza ningún patrón: una regla genérica según la clase de la falla. */
const REGLA_POR_CLASE = {
  codigo: "Correr build y pruebas completas antes de subir y corregir el error del programa, no el síntoma.",
  arranque: "Revisar el arranque (configuración, migraciones y entrypoint) antes de subir.",
  pasajera: "Es pasajera, se reintenta.",
  desconocida: "Leer los registros completos del servidor y anotar la causa cuando se sepa.",
};

/** La regla que deja el incidente. `causa`: el texto de la causa (y las líneas del error); `clase`: codigo, arranque, pasajera o desconocida. */
export function reglaPara(causa, clase) {
  const texto = String(causa ?? "");
  return PATRONES_CONOCIDOS.find(({ calza }) => calza(texto))?.regla ?? REGLA_POR_CLASE[clase] ?? REGLA_POR_CLASE.desconocida;
}

/** "2026-11-24 14:05" en la hora de Bogotá. */
export function fechaDeLaBitacora(fecha = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(fecha)
      .map((parte) => [parte.type, parte.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}`;
}

/** En una línea, sin saltos y de máximo `n` letras. */
const linea = (texto, n = LARGO_DE_LINEA) => {
  const limpio = String(texto ?? "").replace(/\s+/g, " ").trim();
  return limpio.length > n ? `${limpio.slice(0, n - 1)}…` : limpio;
};

/** El id que va en el encabezado: "T-875" tal cual; un id del CRM, en corto (como las ramas). */
const idDeLaTarjeta = (id) => (/^T-\d+$/.test(String(id ?? "")) ? String(id) : idCorto(id ?? "") || "sin-id");

/** El nombre del repo apto para un archivo (sin rutas): solo letras, números, "-" y "_". */
export const nombreDeArchivoDelRepo = (repo) => String(repo ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "sin-repo";

/** La clave estable de la entrada (para no duplicarla más adelante). */
export const claveDeLaEntrada = ({ fecha, tarjeta }) => `<!-- incidente:${idDeLaTarjeta(tarjeta?.id)}:${linea(fecha ?? "sin-fecha", 40).replace(/--+|>/g, "-")} -->`;

/** Las líneas del error: hasta 8, de 300 letras cada una, sin vacías. */
const lineasLimpias = (lineas) =>
  (Array.isArray(lineas) ? lineas : String(lineas ?? "").split(/\r?\n/))
    .map((texto) => linea(texto))
    .filter(Boolean)
    .slice(0, MAXIMO_LINEAS);

/**
 * La entrada en markdown. `queFallo`: una clave de QUE_FALLO (o un texto); `comoSeResolvio`: una clave de COMO_SE_RESOLVIO (o
 * un texto); `clase`: para la regla genérica; `commit`: opcional.
 */
export function armarEntrada({ fecha, tarjeta, repo, queFallo, causa, lineasDelError, comoSeResolvio, clase = "desconocida", commit = null }) {
  const cuando = linea(fecha || "fecha no registrada", 40);
  const causaLimpia = linea(causa, 600) || SIN_CAUSA;
  const lineas = lineasLimpias(lineasDelError);
  const regla = reglaPara([causaLimpia, ...lineas].join("\n"), clase);
  const partes = [
    `### ${cuando} · ${idDeLaTarjeta(tarjeta?.id)} ${linea(tarjeta?.titulo, 160) || "(sin título)"}`,
    claveDeLaEntrada({ fecha: cuando, tarjeta }),
    "",
    `- Repo: ${linea(repo, 60) || "sin repo"}${commit ? ` (commit ${linea(commit, 40)})` : ""}`,
    `- Qué falló: ${QUE_FALLO[queFallo] ?? (linea(queFallo, 120) || "no registrado")}`,
    `- Causa: ${causaLimpia}`,
    `- Cómo se resolvió: ${COMO_SE_RESOLVIO[comoSeResolvio] ?? (linea(comoSeResolvio, 200) || "no registrado")}`,
    `- Regla: ${regla}`,
  ];
  if (lineas.length) {
    // Las líneas van en un bloque de código; un ``` dentro del log no lo puede cerrar.
    partes.push("", "Líneas del error:", "", "```", ...lineas.map((texto) => texto.replace(/```/g, "'''")), "```");
  }
  return `${partes.join("\n")}\n`;
}

/** La copia corta para el cerebro: una línea con fecha, tarjeta, repo, qué falló, causa, cómo se resolvió y regla. */
export function resumenDeUnaLinea(entrada) {
  const texto = String(entrada ?? "");
  const encabezado = texto.match(/^###\s+(.+)$/m)?.[1] ?? "";
  const campo = (nombre) => texto.match(new RegExp(`^- ${nombre}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
  const partes = [
    linea(encabezado, 200),
    campo("Repo") && `repo ${linea(campo("Repo"), 80)}`,
    campo("Qué falló") && `qué falló: ${campo("Qué falló")}`,
    `causa: ${linea(campo("Causa"), 200) || SIN_CAUSA}`,
    campo("Cómo se resolvió") && `cómo se resolvió: ${linea(campo("Cómo se resolvió"), 120)}`,
    campo("Regla") && `regla: ${campo("Regla")}`,
  ].filter(Boolean);
  return `- ${partes.join(" · ")}`;
}

/** La ruta del archivo local de un repo: <carpetaTrabajo>/incidentes/<repo>.md. */
export const rutaDeIncidentes = (carpetaTrabajo, repo) => path.join(carpetaTrabajo, "incidentes", `${nombreDeArchivoDelRepo(repo)}.md`);

const primeraLinea = (error) => String(error?.message ?? error).split("\n")[0].slice(0, 300);

/**
 * Anota un incidente: la entrada completa en <carpetaTrabajo>/incidentes/<repo>.md y la línea resumida en la bóveda.
 * Cada parte va por su lado (si la bóveda falla, lo local queda igual). Nunca lanza: lo que falle va a registro.aviso.
 * -> { entrada, local: ruta | null, boveda: ruta | null }
 */
export function anotarIncidente({ config, registro, fecha = fechaDeLaBitacora(), ...datos }) {
  const salida = { entrada: null, local: null, boveda: null };
  try {
    const entrada = armarEntrada({ fecha, ...datos });
    salida.entrada = entrada;
    const clave = claveDeLaEntrada({ fecha: linea(fecha || "fecha no registrada", 40), tarjeta: datos.tarjeta });

    try {
      const archivo = rutaDeIncidentes(config.carpetaTrabajo, datos.repo);
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      const antes = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : "";
      if (antes.includes(clave)) {
        registro?.info?.(`bitácora: el incidente ya estaba anotado en ${archivo}`);
      } else {
        // Solo se agrega al final (nunca se reescribe el archivo).
        const encabezado = antes ? "" : `# Bitácora de incidentes: ${nombreDeArchivoDelRepo(datos.repo)}\n`;
        fs.appendFileSync(archivo, `${encabezado}${antes && !antes.endsWith("\n") ? "\n" : ""}\n${entrada}`);
        registro?.info?.(`bitácora: anoté el incidente en ${archivo}`);
      }
      salida.local = archivo;
    } catch (error) {
      registro?.aviso?.(`bitácora: no se pudo anotar en la carpeta de trabajo (${primeraLinea(error)})`);
    }

    const boveda = config.boveda?.ruta ?? null;
    if (!boveda) return salida;
    try {
      const ruta = config.bitacora?.rutaEnBoveda ?? RUTA_EN_BOVEDA_POR_DEFECTO;
      const { archivo } = escribirNotaEnLaBoveda(boveda, ruta, resumenDeUnaLinea(entrada));
      registro?.info?.(`bitácora: dejé la línea en la bóveda (${ruta})`);
      salida.boveda = archivo;
    } catch (error) {
      registro?.aviso?.(`bitácora: no se pudo escribir en la bóveda (${primeraLinea(error)})`);
    }
  } catch (error) {
    registro?.aviso?.(`bitácora: no se pudo anotar el incidente (${primeraLinea(error)})`);
  }
  return salida;
}

/**
 * Incidentes que pasaron antes de que existiera la bitácora. La parte 3 los escribe en el repo correspondiente.
 * T-875: Gestión no arrancó (commit c42a476). La causa no quedó en el historial de la tarjeta que tiene este repo: no se inventa.
 */
export const INCIDENTES_CONOCIDOS = Object.freeze([
  Object.freeze({
    fecha: null,
    tarjeta: Object.freeze({ id: "T-875", titulo: "Gestión no arrancó" }),
    repo: "gestion",
    commit: "c42a476",
    queFallo: "no_arranco",
    causa: SIN_CAUSA,
    lineasDelError: Object.freeze([]),
    comoSeResolvio: "no registrado",
    clase: "desconocida",
  }),
]);
