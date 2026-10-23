// La configuración del trabajador: trabajador-tablero/config.local.json (NO se versiona: tiene la clave).
// La plantilla es config.example.json. Acá se leen, se completan los valores por defecto y se revisan.
import fs from "node:fs";
import path from "node:path";

/** Lo que Claude puede usar al CONSTRUIR (acceptEdits): editar dentro del worktree y correr pruebas. */
export const HERRAMIENTAS_PERMITIDAS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash(npm run:*)",
  "Bash(npx tsc:*)",
  "Bash(npx eslint:*)",
  "Bash(npx prisma generate:*)",
  "Bash(npx prisma validate:*)",
  "Bash(npx prisma format:*)",
  "Bash(node scripts/:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  // Subagentes (22-oct-2026): para investigar el código, escribir pruebas y revisar el cambio.
  "Agent",
  "Task",
];

/** Lo que Claude NUNCA puede usar, aunque se cuele en la lista de arriba. */
export const HERRAMIENTAS_PROHIBIDAS = [
  "Bash(git push:*)",
  "Bash(git remote:*)",
  "Bash(git reset:*)",
  "Bash(git checkout:*)",
  "Bash(git rebase:*)",
  "Bash(npx prisma migrate:*)",
  "Bash(npx prisma db:*)",
  "Bash(npm run db:*)",
  "Bash(ssh:*)",
  "Bash(curl:*)",
  "WebFetch",
];

const TIEMPOS_POR_DEFECTO = {
  // Un poco menos que el tope del CRM (20 / 90 / 45 min), para avisar el error antes de que venza.
  planMinutos: 19,
  construirMinutos: 88,
  subirMinutos: 44,
  latidoSegundos: 60,
  intervaloSegundos: 60,
  // Cada comando de verificación (tsc, build, pruebas) como mucho esto.
  comandoMinutos: 30,
  // Si Claude llega a su límite de uso, la tarjeta se suelta sin ERROR y no se abren sesiones por esto.
  pausaLimiteMinutos: 30,
};

/** Cuántas tarjetas a la vez como mucho (22-oct-2026). El CRM tampoco da más de 5. */
const MAXIMO_EN_PARALELO = 5;

/** Si la CPU (promedio del último minuto) o la memoria pasan de esto, no se abre otra sesión. */
const LIMITES_POR_DEFECTO = { cpuPorciento: 85, memoriaPorciento: 85 };

export function leerConfig(ruta) {
  if (!fs.existsSync(ruta)) {
    throw new Error(`No existe ${ruta}. Copia config.example.json a config.local.json y complétalo (ver README.md).`);
  }
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`${ruta} no es un JSON válido: ${error.message}`);
  }
  return completarConfig(datos, path.dirname(ruta));
}

const lista = (valor) => (Array.isArray(valor) ? valor : []);
const comando = (valor, campo) => {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor) || !valor.length || !valor.every((parte) => typeof parte === "string")) {
    throw new Error(`${campo} va como lista: ["npm", "run", "build"].`);
  }
  return valor;
};

export function completarConfig(datos, base = process.cwd()) {
  const errores = [];
  const urlCrm = typeof datos.urlCrm === "string" ? datos.urlCrm.replace(/\/+$/, "") : "";
  if (!/^https?:\/\//.test(urlCrm)) errores.push('urlCrm: la dirección del CRM, por ejemplo "https://app.aizenbot.com".');
  if (urlCrm.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(urlCrm)) {
    errores.push("urlCrm tiene que ser https (salvo localhost, para pruebas).");
  }
  const claveTrabajador = typeof datos.claveTrabajador === "string" ? datos.claveTrabajador.trim() : "";
  if (!claveTrabajador.startsWith("aizen_trab_")) errores.push("claveTrabajador: la clave que se crea en el panel Trabajador (aizen_trab_...).");
  const carpetaTrabajo = path.resolve(base, typeof datos.carpetaTrabajo === "string" ? datos.carpetaTrabajo : "../../trabajador-tablero-trabajo");

  const repos = {};
  for (const [clave, repo] of Object.entries(datos.repos ?? {})) {
    if (!repo || typeof repo.ruta !== "string") {
      errores.push(`repos.${clave}.ruta: la carpeta del repositorio en este PC.`);
      continue;
    }
    const zonasProtegidas = repo.zonasProtegidas && typeof repo.zonasProtegidas === "object" ? repo.zonasProtegidas : {};
    const subirSolo = repo.subirSolo === true;
    // Un descuido en la configuración no puede hacer que un cambio de chats suba solo: en AizenCRM,
    // subirSolo exige la zona CHATS con sus rutas.
    if (subirSolo && clave === "aizencrm" && !(Array.isArray(zonasProtegidas.CHATS) && zonasProtegidas.CHATS.length)) {
      errores.push(`repos.${clave}.subirSolo está prendido pero falta la zona CHATS en zonasProtegidas: no se prende sin ella.`);
    }
    try {
      repos[clave] = {
        clave,
        subirSolo,
        ruta: path.resolve(base, repo.ruta),
        ramaBase: typeof repo.ramaBase === "string" ? repo.ramaBase : "main",
        remoto: typeof repo.remoto === "string" ? repo.remoto : "origin",
        instalar: comando(repo.instalar, `repos.${clave}.instalar`),
        verificar: lista(repo.verificar).map((uno, i) => comando(uno, `repos.${clave}.verificar[${i}]`)),
        pruebas: lista(repo.pruebas).map((uno, i) => comando(uno, `repos.${clave}.pruebas[${i}]`)),
        lint: repo.lint?.comando ? { comando: comando(repo.lint.comando, `repos.${clave}.lint.comando`) } : null,
        carpetaMigraciones: typeof repo.carpetaMigraciones === "string" ? repo.carpetaMigraciones.replace(/\\/g, "/") : null,
        ensayoPglite: comando(repo.ensayoPglite, `repos.${clave}.ensayoPglite`),
        ensayoProduccion: repo.ensayoProduccion?.tablaGuia ? { tablaGuia: String(repo.ensayoProduccion.tablaGuia) } : null,
        zonasProtegidas,
        subida: {
          ciBuscar: comando(repo.subida?.ciBuscar, `repos.${clave}.subida.ciBuscar`),
          ciEsperar: comando(repo.subida?.ciEsperar, `repos.${clave}.subida.ciEsperar`),
          ciMinutos: Number(repo.subida?.ciMinutos) || 20,
          urlVersion: typeof repo.subida?.urlVersion === "string" ? repo.subida.urlVersion : null,
          campoVersion: typeof repo.subida?.campoVersion === "string" ? repo.subida.campoVersion : "version",
          versionMinutos: Number(repo.subida?.versionMinutos) || 10,
          urlArranque: typeof repo.subida?.urlArranque === "string" ? repo.subida.urlArranque : null,
        },
      };
    } catch (error) {
      errores.push(error.message);
    }
  }
  if (!Object.keys(repos).length) errores.push("repos: falta al menos un repositorio (gestion, aizencrm).");

  const ssh =
    datos.ssh && typeof datos.ssh.destino === "string" && typeof datos.ssh.psql === "string"
      ? { comando: comando(datos.ssh.comando, "ssh.comando") ?? ["ssh"], destino: datos.ssh.destino, psql: datos.ssh.psql }
      : null;

  const maxParalelo = datos.maxParalelo === undefined ? 2 : Math.floor(Number(datos.maxParalelo));
  if (!Number.isFinite(maxParalelo) || maxParalelo < 1 || maxParalelo > MAXIMO_EN_PARALELO) {
    errores.push(`maxParalelo: cuántas tarjetas a la vez, de 1 a ${MAXIMO_EN_PARALELO}.`);
  }
  const limites = { ...LIMITES_POR_DEFECTO, ...(datos.limites ?? {}) };
  for (const campo of ["cpuPorciento", "memoriaPorciento"]) {
    limites[campo] = Number(limites[campo]);
    if (!Number.isFinite(limites[campo]) || limites[campo] < 10 || limites[campo] > 100) {
      errores.push(`limites.${campo}: un porcentaje de 10 a 100.`);
    }
  }

  if (errores.length) throw new Error(`La configuración tiene problemas:\n- ${errores.join("\n- ")}`);

  return {
    urlCrm,
    claveTrabajador,
    carpetaTrabajo,
    repos,
    ssh,
    maxParalelo,
    limites,
    comandoClaude: comando(datos.comandoClaude, "comandoClaude") ?? ["claude"],
    herramientasPermitidas: lista(datos.herramientasPermitidas).length ? datos.herramientasPermitidas : HERRAMIENTAS_PERMITIDAS,
    herramientasProhibidas: [...new Set([...HERRAMIENTAS_PROHIBIDAS, ...lista(datos.herramientasProhibidas)])],
    tiempos: { ...TIEMPOS_POR_DEFECTO, ...(datos.tiempos ?? {}) },
    git: {
      nombre: typeof datos.git?.nombre === "string" ? datos.git.nombre : "Trabajador Tablero IA",
      correo: typeof datos.git?.correo === "string" ? datos.git.correo : "gestionmagilus@gmail.com",
    },
  };
}
