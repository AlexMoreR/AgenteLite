// BITÁCORA DE INCIDENTES (24-nov-2026, parte 1 de «cada falla de subida queda anotada y se lee antes de construir»).
// Cada vez que una subida falla, el Coordinador deja una entrada:
//   1. al final de <carpetaTrabajo>/incidentes/<repo>.md (la entrada completa, con las líneas del error);
//   2. una línea resumida en la bóveda del cerebro, en config.bitacora.rutaEnBoveda (por defecto
//      "06 Tecnología/Bitácora de incidentes.md"), con escribirNotaEnLaBoveda: agrega al final y nunca borra.
// Esta parte NO cambia cómo se diagnostica, deshace o reintenta (eso es la T-876): solo anota. Nunca lanza.
import fs from "node:fs";
import path from "node:path";

import { crearWorktree, git, idCorto, pushARamaBase, quitarWorktree } from "./git.mjs";
import { INTENTOS_POR_NOCHE, horaEnBogota } from "./manual-nocturno.mjs";
import { fechaBogota } from "./motores.mjs";
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
  // 25-nov-2026: se deshizo antes de que el servidor bajara la versión; no es del código y se sube el mismo commit.
  falsa: "No es falla del código: el servidor no había bajado la versión nueva; se vuelve a subir el mismo commit.",
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

// LEER LA BITÁCORA ANTES DE PLANEAR Y CONSTRUIR (parte 2): las instrucciones de planear, construir y la nube llevan las
// últimas entradas, para que la sesión no repita una falla que ya se vio en ese repo.

/** El archivo de la bitácora dentro de cada repo (lo que ya se sabe y viaja con el código). */
export const BITACORA_DEL_REPO = path.join("docs", "incidentes.md");

/** Los bloques "### ..." de un texto de bitácora que traen su clave estable. -> [{ clave, bloque }] */
export function bloquesDeLaBitacora(texto) {
  return String(texto ?? "")
    .split(/^(?=### )/m)
    .map((bloque) => {
      const clave = bloque.match(/<!-- incidente:[^\n]*?-->/)?.[0];
      return bloque.startsWith("### ") && clave ? { clave, bloque } : null;
    })
    .filter(Boolean);
}

/** Las entradas de un texto de bitácora: solo las que traen su clave estable. -> [{ clave, regla, causa }] */
export function entradasDeLaBitacora(texto) {
  return bloquesDeLaBitacora(texto).map(({ clave, bloque }) => {
    const campo = (nombre) => bloque.match(new RegExp(`^- ${nombre}:[ \\t]*(.*)$`, "m"))?.[1]?.trim() ?? "";
    return { clave, regla: campo("Regla"), causa: campo("Causa") };
  });
}

/** El texto de un archivo, o "" si no existe o no se puede leer. */
const leerSiSePuede = (archivo) => {
  try {
    return archivo && fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : "";
  } catch {
    return "";
  }
};

/**
 * Los incidentes ya vistos en un repo, para las instrucciones: primero los de docs/incidentes.md de la copia del repo y después
 * los de <carpetaTrabajo>/incidentes/<repo>.md que todavía no están en ese archivo (por la clave estable). Las últimas `cuantas`,
 * una línea por entrada: "- Regla — causa". "" si no hay nada. Nunca lanza.
 */
export function incidentesParaElPrompt({ raizDelRepo = null, carpetaTrabajo = null, repo, config = null, cuantas = config?.bitacora?.entradasEnPrompt ?? BITACORA_POR_DEFECTO.entradasEnPrompt } = {}) {
  try {
    const n = Number(cuantas);
    if (!Number.isInteger(n) || n <= 0) return "";
    const delRepo = entradasDeLaBitacora(raizDelRepo ? leerSiSePuede(path.join(raizDelRepo, BITACORA_DEL_REPO)) : "");
    const yaEstan = new Set(delRepo.map(({ clave }) => clave));
    const locales = entradasDeLaBitacora(carpetaTrabajo ? leerSiSePuede(rutaDeIncidentes(carpetaTrabajo, repo)) : "").filter(({ clave }) => {
      if (yaEstan.has(clave)) return false;
      yaEstan.add(clave);
      return true;
    });
    return [...delRepo, ...locales]
      .slice(-n)
      .map(({ regla, causa }) => `- ${linea(regla, 200) || "sin regla"} — ${linea(causa, 200) || SIN_CAUSA}`)
      .join("\n");
  } catch {
    return "";
  }
}

/** El bloque de las instrucciones con los incidentes ya vistos; "" si no hay. */
export function bloqueDeIncidentes(texto) {
  const limpio = String(texto ?? "").trim();
  return limpio ? `Incidentes ya vistos en este repo: no los repitas.\n${limpio}` : "";
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

// EL PASO DE LA NOCHE (parte 3): una vez al día, pasada la hora del manual (config.manual.hora, Bogotá), el Coordinador pasa a
// docs/incidentes.md de cada repo (aizencrm y gestion) las entradas de <carpetaTrabajo>/incidentes/<repo>.md que todavía no
// están (por la clave estable), y sube el cambio a la rama base sin forzar. No usa Claude: solo copia texto. Mismo esquema que
// el manual de la noche (lib/manual-nocturno.mjs): estado diario, una copia aparte de cada repo y hasta 3 intentos por noche.

/** Los repos que llevan la bitácora en su docs/incidentes.md. */
export const REPOS_DE_LA_BITACORA = Object.freeze(["aizencrm", "gestion"]);

export const rutaDelEstadoDeLaBitacora = (carpetaTrabajo) => path.join(carpetaTrabajo, "bitacora-nocturna.json");

export function leerEstadoDeLaBitacora(carpetaTrabajo) {
  try {
    return JSON.parse(fs.readFileSync(rutaDelEstadoDeLaBitacora(carpetaTrabajo), "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function guardarEstadoDeLaBitacora(carpetaTrabajo, estado) {
  fs.mkdirSync(carpetaTrabajo, { recursive: true });
  const ruta = rutaDelEstadoDeLaBitacora(carpetaTrabajo);
  fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify(estado, null, 2)}\n`);
  fs.renameSync(`${ruta}.tmp`, ruta);
  return estado;
}

/** El encabezado de docs/incidentes.md cuando el repo todavía no lo tiene. */
export const encabezadoDeLaBitacoraDelRepo = (repo) =>
  [
    `# Bitácora de incidentes: ${nombreDeArchivoDelRepo(repo)}`,
    "",
    "Qué es: cada vez que una subida de este repo falla (no arrancó, la vigilancia de 30 min la deshizo o falló el ensayo de",
    "migraciones), queda una entrada acá con qué falló, la causa, cómo se resolvió y la regla que deja. El Coordinador la anota en",
    `su carpeta de trabajo (\`incidentes/${nombreDeArchivoDelRepo(repo)}.md\`) y de noche la pasa a este archivo, sin repetir las que`,
    "ya están (por la clave estable que lleva cada entrada en un comentario). Antes de planear y de construir, las últimas",
    "entradas van en las instrucciones como «Incidentes ya vistos en este repo: no los repitas».",
    "",
  ].join("\n");

/** Las entradas que se pasan al repo: las conocidas de antes de la bitácora (solo las de ese repo) y las de la carpeta local. */
export function entradasParaElRepo({ carpetaTrabajo, repo }) {
  const conocidas = INCIDENTES_CONOCIDOS.filter((incidente) => incidente.repo === repo).map((incidente) => {
    const bloque = armarEntrada(incidente);
    return { clave: bloque.match(/<!-- incidente:[^\n]*?-->/)[0], bloque };
  });
  return [...conocidas, ...bloquesDeLaBitacora(leerSiSePuede(rutaDeIncidentes(carpetaTrabajo, repo)))];
}

/**
 * El texto nuevo de docs/incidentes.md: `antes` (o el encabezado, si no existe) más las entradas cuya clave no está.
 * -> { texto, nuevas } (nuevas = 0: no hay nada que agregar).
 */
export function juntarBitacora(antes, entradas, repo) {
  const base = antes ?? encabezadoDeLaBitacoraDelRepo(repo);
  const vistas = new Set();
  const nuevas = entradas.filter(({ clave }) => {
    if (base.includes(clave) || vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
  if (!nuevas.length) return { texto: base, nuevas: 0 };
  const cuerpo = nuevas.map(({ bloque }) => `${bloque.trimEnd()}\n`).join("\n");
  return { texto: `${base.trimEnd()}\n\n${cuerpo}`, nuevas: nuevas.length };
}

/**
 * crearBitacoraNocturna({ config, registro, avisar?, entorno?, ahora? }) -> { revisar(planificador) }
 *   revisar() mira si toca pasar la bitácora y, si toca, la pasa repo por repo. Devuelve { hizo, motivo, repos }. Nunca lanza.
 *   Recibe `entorno` como el manual (trabajador.mjs lo pasa), pero no lo usa: este paso no corre Claude.
 */
export function crearBitacoraNocturna({ config, registro, avisar = async () => undefined, ahora = () => new Date() }) {
  const aviso = async (texto) => {
    try {
      await avisar(texto);
    } catch (error) {
      registro?.aviso?.(`bitácora de la noche: no se pudo avisar (${primeraLinea(error)})`);
    }
  };

  /** Pasa la bitácora de un repo. -> { nuevas, subio } ; lanza si git falla (lo atrapa revisar). */
  async function pasarUnRepo(clave, repo) {
    const entradas = entradasParaElRepo({ carpetaTrabajo: config.carpetaTrabajo, repo: clave });
    if (!entradas.length) return { nuevas: 0, subio: false };
    const carpeta = path.join(config.carpetaTrabajo, "wt", `bitacora-nocturna-${nombreDeArchivoDelRepo(clave)}`);
    try {
      await git(repo.ruta, ["fetch", repo.remoto]);
      await crearWorktree(repo, carpeta, `${repo.remoto}/${repo.ramaBase}`, null);
      const archivo = path.join(carpeta, BITACORA_DEL_REPO);
      const antes = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : null;
      const { texto, nuevas } = juntarBitacora(antes, entradas, clave);
      if (!nuevas) return { nuevas: 0, subio: false };
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      fs.writeFileSync(archivo, texto);
      const relativo = BITACORA_DEL_REPO.split(path.sep).join("/");
      await git(carpeta, ["add", "--", relativo]);
      await git(carpeta, ["commit", "-m", `docs(incidentes): pasa ${nuevas} entrada(s) de la bitácora de incidentes`], { identidad: config.git });
      await pushARamaBase(carpeta, repo.remoto, repo.ramaBase);
      return { nuevas, subio: true };
    } finally {
      await quitarWorktree(repo, carpeta);
    }
  }

  return {
    async revisar(planificador) {
      try {
        const repos = REPOS_DE_LA_BITACORA.filter((clave) => config.repos?.[clave] && config.repos[clave].activo !== false);
        if (!repos.length) return { hizo: false, motivo: "sin_repo" };
        const fecha = ahora();
        const hora = config.manual?.hora ?? 23;
        if (horaEnBogota(fecha) < hora) return { hizo: false, motivo: "antes_de_la_hora" };
        const hoy = fechaBogota(fecha);
        const estado = leerEstadoDeLaBitacora(config.carpetaTrabajo);
        const deHoy = estado?.dia === hoy ? estado : { dia: hoy, hecho: false, intentos: 0, listos: [] };
        if (deHoy.hecho || deHoy.intentos >= INTENTOS_POR_NOCHE) return { hizo: false, motivo: deHoy.hecho ? "ya_hecho" : "sin_intentos" };
        if ((planificador?.corriendo?.() ?? 0) > 0) return { hizo: false, motivo: "subiendo" };

        const intento = deHoy.intentos + 1;
        registro?.info?.(`bitácora de la noche: paso las entradas nuevas a ${BITACORA_DEL_REPO} (intento ${intento} de ${INTENTOS_POR_NOCHE})`);
        const listos = new Set(Array.isArray(deHoy.listos) ? deHoy.listos : []);
        const resultados = {};
        const fallos = [];
        for (const clave of repos.filter((uno) => !listos.has(uno))) {
          try {
            resultados[clave] = await pasarUnRepo(clave, config.repos[clave]);
            listos.add(clave);
            if (resultados[clave].subio) registro?.info?.(`bitácora de la noche: pasé ${resultados[clave].nuevas} entrada(s) a ${clave} y la subí a ${config.repos[clave].ramaBase}`);
          } catch (error) {
            resultados[clave] = { nuevas: 0, subio: false, error: primeraLinea(error) };
            fallos.push(`${clave}: ${primeraLinea(error)}`);
            registro?.aviso?.(`bitácora de la noche: no se subió nada a ${clave} (intento ${intento} de ${INTENTOS_POR_NOCHE}): ${primeraLinea(error)}`);
          }
        }
        const hecho = repos.every((clave) => listos.has(clave));
        try {
          guardarEstadoDeLaBitacora(config.carpetaTrabajo, { dia: hoy, hecho, intentos: intento, listos: [...listos], repos: resultados, ...(fallos.length ? { error: fallos.join(" | ") } : {}) });
        } catch (error) {
          registro?.aviso?.(`bitácora de la noche: no se pudo guardar el estado (${primeraLinea(error)})`);
        }
        const subidos = Object.entries(resultados).filter(([, r]) => r.subio);
        if (subidos.length) {
          await aviso(`Bitácora de la noche: pasé ${subidos.map(([clave, r]) => `${r.nuevas} entrada(s) a ${clave}`).join(" y ")} (${BITACORA_DEL_REPO}).`);
        }
        if (fallos.length) {
          await aviso(
            `Bitácora de la noche: no se pudo (${fallos.join(" | ")}). Las entradas siguen en la carpeta de trabajo.${intento < INTENTOS_POR_NOCHE ? " Lo intento otra vez." : " Se acabaron los intentos de esta noche."}`,
          );
          return { hizo: false, motivo: "fallo", error: fallos.join(" | "), repos: resultados };
        }
        if (!subidos.length) registro?.info?.("bitácora de la noche: no hay entradas nuevas");
        return { hizo: true, repos: resultados };
      } catch (error) {
        registro?.aviso?.(`bitácora de la noche: ${primeraLinea(error)}`);
        return { hizo: false, motivo: "fallo", error: primeraLinea(error) };
      }
    },
  };
}
