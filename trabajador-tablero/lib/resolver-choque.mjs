// Resolver solo el choque con main al subir (31-oct-2026). Cuando el rebase de la rama de la tarjeta sobre main choca, en
// vez de cancelar y construir todo otra vez, una sesión CORTA de Claude (máximo 15 min) dentro de la carpeta de subida
// resuelve SOLO los archivos en conflicto, conservando los cambios de las dos tareas. Su última línea dice qué pasó:
//   CHOQUE_SIMPLE: OK             se juntaron las dos versiones
//   CHOQUE_DE_LOGICA: <motivo>    las dos tareas no encajan: lo decide el dueño
// Con CHOQUE_SIMPLE el Coordinador comprueba tres cosas antes de creerle: que no quede ninguna marca <<<<<<<, que solo
// cambiaron los archivos en conflicto y que pasa el `verificar` de siempre (compila y pasan todas las pruebas). Un archivo
// en conflicto dentro de las migraciones va directo a choque de lógica, sin llamar a Claude.
// Este módulo no lanza errores de la etapa: devuelve qué pasó y etapas.mjs (subir, revisar de nuevo) decide. Nunca empuja.
import { archivosConMarcas, archivosTocados, cancelarRebase, seguirRebase } from "./git.mjs";
import { enUnaLinea } from "./diagnostico.mjs";

const MINUTO = 60_000;

/** El tope de la sesión de Claude que resuelve el choque (todas las vueltas juntas). */
export const MINUTOS_PARA_RESOLVER = 15;

/** Cuántos commits seguidos de la rama pueden chocar en el mismo rebase antes de rendirse. */
const MAXIMO_DE_VUELTAS = 5;

/** ¿El archivo está dentro de la carpeta de migraciones? (prisma/migrations/** por defecto). */
export function esDeMigraciones(archivo, carpetaMigraciones = "prisma/migrations") {
  const carpeta = String(carpetaMigraciones || "prisma/migrations").replace(/\\/g, "/").replace(/\/+$/, "");
  return String(archivo).replace(/\\/g, "/").startsWith(`${carpeta}/`);
}

/**
 * Lo que contestó la sesión, leído de su ÚLTIMA línea con texto.
 * -> { tipo: "simple" } | { tipo: "logica", motivo } | null (no dijo ninguna de las dos)
 */
export function respuestaDelChoque(texto) {
  const ultima = String(texto ?? "")
    .split(/\r?\n/)
    .map((linea) => linea.trim().replace(/^[`*_\s]+|[`*_\s]+$/g, ""))
    .filter(Boolean)
    .at(-1);
  if (!ultima) return null;
  if (/^CHOQUE_SIMPLE:\s*OK\b/i.test(ultima)) return { tipo: "simple" };
  const logica = ultima.match(/^CHOQUE_DE_LOGICA:\s*(.*)$/i);
  if (logica) return { tipo: "logica", motivo: enUnaLinea(logica[1], 300) || "la sesión no dijo el motivo" };
  return null;
}

/** La orden para la sesión corta. Lleva "Tarea: <título>" (como las demás) para que el log y las pruebas la reconozcan. */
export function promptDeResolverChoque({ tarjeta, ramaBase, conflicto }) {
  return [
    "RESOLVER EL CHOQUE CON MAIN. Eres el Agente CRM del Coordinador del Tablero IA de Magilus.",
    `Tarea: ${tarjeta.titulo}`,
    `Estás en la carpeta de subida de esta tarea. Git está a mitad de un rebase de su rama sobre ${ramaBase}: otra tarea ya subió cambios a los mismos archivos y git dejó marcas de conflicto (<<<<<<<, =======, >>>>>>>) en:\n${conflicto.map((archivo) => `- ${archivo}`).join("\n")}`,
    "Qué hacer:\n" +
      "1. Edita SOLO esos archivos. No cambies ningún otro archivo, no crees archivos nuevos y no corras git (ni add, ni commit, ni rebase): el Coordinador sigue el rebase y verifica.\n" +
      `2. Conserva los cambios de las DOS tareas: lo que ya está en ${ramaBase} y lo que agrega esta tarea. Borra todas las marcas de conflicto.\n` +
      "3. Si se pueden juntar sin decidir nada (por ejemplo, las dos agregan cosas distintas cerca), júntalas.\n" +
      "4. Si juntarlas obliga a elegir una lógica sobre la otra (las dos cambian lo mismo de forma distinta, o una borra lo que la otra usa), NO elijas: deja los archivos como estén.",
    "Trabaja en primer plano, sin subagentes y sin tareas en segundo plano.",
    "Termina con UNA última línea, exactamente una de estas dos:\nCHOQUE_SIMPLE: OK\nCHOQUE_DE_LOGICA: <el motivo en una frase corta, en español sencillo>",
  ].join("\n\n");
}

/** Las fallas que son del PC, de la cuenta o del Coordinador (no del choque): se cancela el rebase y se relanzan tal cual. */
function esDelEntorno(error) {
  return Boolean(error?.limiteDeUso || error?.esperaDeCola || ["coordinador_cortado", "pc_sobrecargado", "carpeta_trabada"].includes(error?.categoria));
}

/**
 * Resuelve el choque del rebase a medias en `carpeta` (rebaseSobre con dejarConflicto). Las piezas que dependen de la etapa
 * se inyectan (así no hay import circular con etapas.mjs y se prueba aparte):
 *   correrClaude(prompt, { timeoutMs }) -> el texto que contestó la sesión (acceptEdits dentro de `carpeta`)
 *   verificar() -> las líneas de pruebas (instalar + el verificar de siempre); lanza si no compila o fallan pruebas
 *   restaMs() -> lo que le queda al reloj de la etapa (lanza si ya no queda)
 * Devuelve:
 *   { resultado: "simple", pruebas, archivos }   el rebase terminó, sin marcas, solo cambió lo que chocaba y pasó verificar
 *   { resultado: "logica", motivo, archivos }    choque de lógica (o una migración): el rebase quedó cancelado
 *   { resultado: "no_se_pudo", motivo, archivos } no se pudo resolver (no compila, tocó otros archivos…): rebase cancelado
 * Lanza solo las fallas del entorno (límite de uso, Coordinador cortado…), con el rebase ya cancelado.
 */
export async function resolverChoque({ carpeta, rebase, tarjeta, ramaBase, carpetaMigraciones, identidad, correrClaude, verificar, restaMs = () => Infinity, registro = null, ahora = () => Date.now() }) {
  const todos = new Set();
  const cancelar = async (resultado, motivo) => {
    await cancelarRebase(carpeta, rebase.cabeza);
    return { resultado, motivo: enUnaLinea(motivo, 400), archivos: [...todos] };
  };
  const limite = ahora() + MINUTOS_PARA_RESOLVER * MINUTO;
  let conflicto = rebase.conflicto ?? [];
  try {
    for (let vuelta = 1; ; vuelta += 1) {
      conflicto.forEach((archivo) => todos.add(archivo));
      if (!conflicto.length) return await cancelar("no_se_pudo", `el rebase falló sin archivos en conflicto: ${rebase.detalle ?? ""}`);
      const migraciones = conflicto.filter((archivo) => esDeMigraciones(archivo, carpetaMigraciones));
      if (migraciones.length) return await cancelar("logica", `choca en una migración (${migraciones.join(", ")}): las migraciones no se juntan solas`);
      if (vuelta > MAXIMO_DE_VUELTAS) return await cancelar("no_se_pudo", `chocaron más de ${MAXIMO_DE_VUELTAS} commits seguidos de la rama`);
      const timeoutMs = Math.min(limite - ahora(), restaMs());
      if (timeoutMs <= 0) return await cancelar("no_se_pudo", `se pasaron los ${MINUTOS_PARA_RESOLVER} min para resolver el choque`);
      registro?.info?.(`choque con ${ramaBase}: una sesión corta de Claude resuelve ${conflicto.join(", ")} (vuelta ${vuelta})`);
      let texto;
      try {
        texto = await correrClaude(promptDeResolverChoque({ tarjeta, ramaBase, conflicto }), { timeoutMs });
      } catch (error) {
        if (esDelEntorno(error)) throw error;
        return await cancelar("no_se_pudo", `la sesión que resolvía el choque falló: ${error?.message ?? error}`);
      }
      const respuesta = respuestaDelChoque(texto);
      if (respuesta?.tipo === "logica") return await cancelar("logica", respuesta.motivo);
      if (respuesta?.tipo !== "simple") return await cancelar("no_se_pudo", "la sesión no terminó con CHOQUE_SIMPLE: OK ni CHOQUE_DE_LOGICA");
      // Las comprobaciones 1 y 2: sin marcas y solo los archivos en conflicto.
      const conMarcas = archivosConMarcas(carpeta, conflicto);
      if (conMarcas.length) return await cancelar("no_se_pudo", `quedaron marcas <<<<<<< en ${conMarcas.join(", ")}`);
      const deMas = (await archivosTocados(carpeta)).filter((archivo) => !conflicto.includes(archivo));
      if (deMas.length) return await cancelar("no_se_pudo", `la sesión cambió archivos que no estaban en conflicto (${deMas.slice(0, 5).join(", ")})`);
      const seguido = await seguirRebase(carpeta, conflicto, { identidad, atributos: rebase.atributos });
      if (seguido.ok) break;
      // El commit siguiente de la rama chocó también: otra vuelta con sus archivos.
      conflicto = seguido.conflicto;
      if (!conflicto.length) return await cancelar("no_se_pudo", `no se pudo seguir el rebase: ${seguido.detalle}`);
    }
    // La comprobación 3: el verificar de siempre sobre lo ya juntado (compila y pasan todas las pruebas).
    let pruebas;
    try {
      pruebas = await verificar();
    } catch (error) {
      if (esDelEntorno(error)) throw error;
      return await cancelar("no_se_pudo", `lo juntado no pasa build o pruebas: ${String(error?.message ?? error).split("\n")[0]}`);
    }
    const archivos = [...todos];
    return { resultado: "simple", archivos, pruebas: [`✔ choque con ${ramaBase} resuelto solo (${archivos.join(", ")}): sin marcas, solo esos archivos y verificado otra vez`, ...(pruebas ?? [])] };
  } catch (error) {
    await cancelarRebase(carpeta, rebase.cabeza);
    throw error;
  }
}
