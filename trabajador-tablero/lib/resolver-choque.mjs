// Resolver solo el choque con main al subir (31-oct-2026). Antes, si el rebase de la rama sobre main chocaba, se
// cancelaba y la tarjeta se construía otra vez desde cero. Ahora el rebase queda a medias (git.mjs: rebaseSobre con
// dejarAbierto) y una sesión CORTA de Claude (máximo 15 min), dentro de la carpeta de subida, junta SOLO los archivos en
// conflicto conservando los cambios de las dos tareas. Su última línea dice:
//   CHOQUE_SIMPLE: OK               -> se comprueba: sin marcas '<<<<<<<', solo cambiaron los archivos en conflicto y
//                                     pasa el verificar de siempre (compila y pasan todas las pruebas); se sigue el rebase.
//   CHOQUE_DE_LOGICA: <motivo>      -> lo nuevo de main y la tarea no encajan: lo decide el dueño (categoría choque_de_logica).
// Un conflicto en prisma/migrations/** es siempre de lógica: no se llama a Claude. Si no se puede resolver (no compila,
// quedan marcas, tocó otros archivos, no contestó), el rebase se cancela y el que llama lanza choca_con_main. Nunca empuja.
import { archivosConMarcas, cancelarRebase, git, seguirRebase } from "./git.mjs";
import { enUnaLinea, recortar } from "./diagnostico.mjs";
import { lineasQueFallaron, ultimasLineas } from "./procesos.mjs";

/** El tope de la sesión de Claude que resuelve el choque (todas las vueltas juntas). */
export const MINUTOS_PARA_RESOLVER = 15;

/** Cuántos commits de la rama pueden chocar uno tras otro en el mismo rebase antes de rendirse. */
export const VUELTAS_MAXIMAS = 5;

/** Las fallas del PC, de la red o del Coordinador (no del choque): se relanzan para que el bucle las trate como siempre. */
const CATEGORIAS_DEL_ENTORNO = ["coordinador_cortado", "pc_sobrecargado", "carpeta_trabada", "tiempo_agotado"];
export const esFallaDelEntornoPorDefecto = (error) => Boolean(error?.limiteDeUso || error?.esperaDeCola || CATEGORIAS_DEL_ENTORNO.includes(error?.categoria));

/** ¿El archivo está en la carpeta de migraciones? (prisma/migrations/** por defecto). */
export function esDeMigraciones(archivo, carpeta = "prisma/migrations") {
  const base = String(carpeta ?? "prisma/migrations").replace(/\\/g, "/").replace(/\/+$/, "");
  return String(archivo ?? "").replace(/\\/g, "/").startsWith(`${base}/`);
}

/**
 * La palabra de la última línea con texto: { tipo: "simple" } | { tipo: "logica", motivo } | null (no dijo ninguna).
 */
export function respuestaDelChoque(texto) {
  const ultima = String(texto ?? "")
    .split(/\r?\n/)
    .map((linea) => linea.trim().replace(/^[`*_\s]+|[`*_\s]+$/g, ""))
    .filter(Boolean)
    .at(-1);
  if (!ultima) return null;
  if (/^CHOQUE_SIMPLE:\s*OK\.?$/i.test(ultima)) return { tipo: "simple" };
  const logica = ultima.match(/^CHOQUE_DE_LOGICA:\s*(.+)$/i);
  if (logica) return { tipo: "logica", motivo: enUnaLinea(logica[1], 300) };
  return null;
}

/** La orden para la sesión corta de Claude. La línea "Tarea: <título>" la usan las pruebas (claude-falso.mjs). */
export function promptDeResolver({ tarjeta, ramaBase = "main", conflicto }) {
  return [
    "Eres el RESOLVEDOR DE CHOQUES del Coordinador del Tablero IA de Magilus. Se está subiendo una tarea a " +
      `${ramaBase} y el rebase de su rama sobre lo nuevo de ${ramaBase} chocó. El rebase está a medias en esta carpeta.`,
    `Tarea: ${tarjeta?.titulo ?? ""}`,
    `Lo que pedía la tarea (plan aprobado):\n${recortar(String(tarjeta?.plan ?? tarjeta?.detalle ?? ""), 3000)}`,
    `Archivos en conflicto (SOLO estos):\n${conflicto.map((archivo) => `- ${archivo}`).join("\n")}`,
    [
      "Qué hacer:",
      `1. En cada archivo de la lista, junta los dos lados del conflicto: arriba (entre '<<<<<<<' y '=======') está lo que ya subió otra tarea a ${ramaBase}; abajo (entre '=======' y '>>>>>>>') está lo de esta tarea. Conserva los cambios de las DOS tareas.`,
      "2. Borra todas las marcas '<<<<<<<', '=======' y '>>>>>>>'. Que el archivo quede como código válido.",
      "3. No toques ningún otro archivo. No corras git ni comandos: el Coordinador sigue el rebase, compila y corre las pruebas.",
      "4. Si los dos cambios no se pueden juntar sin decidir algo de negocio (se contradicen, uno borra lo que el otro usa, cambian la misma regla de forma distinta), NO lo resuelvas: deja los archivos como están.",
    ].join("\n"),
    "Tu ÚLTIMA línea, sola y exacta, es una de estas dos:\nCHOQUE_SIMPLE: OK\nCHOQUE_DE_LOGICA: <el motivo en una línea, en español sencillo>",
  ].join("\n\n");
}

/** Lo que difiere del índice o está sin seguir, fuera de `conflicto` (lo que una resolución no debería tocar). */
async function cambiosFueraDelConflicto(cwd, conflicto) {
  const aparte = new Set(conflicto);
  const nombres = async (argumentos) =>
    (await git(cwd, argumentos, { permitirFallo: true })).salida
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter(Boolean);
  const todos = [...(await nombres(["diff", "--name-only"])), ...(await nombres(["ls-files", "--others", "--exclude-standard"]))];
  return new Set(todos.filter((archivo) => !aparte.has(archivo)));
}

/** El motivo de una verificación que falló, en una línea (las líneas que fallaron, o lo último que dijo). */
function motivoDeVerificacion(error) {
  const texto = String(error?.message ?? error);
  const titular = enUnaLinea(texto.split("\n")[0].replace(/\s*No se subió nada\.?$/, ""), 160);
  const fallas = lineasQueFallaron(error?.salida ?? texto, { contexto: 0, maximo: 4 }) || ultimasLineas(error?.salida ?? texto, 3);
  return enUnaLinea(`después de juntarlo no pasa build o pruebas: ${titular}${fallas ? ` — ${fallas.replace(/\n/g, " | ")}` : ""}`, 400);
}

/**
 * Resuelve el choque del rebase a medias en `cwd`. El rebase ya está abierto con los archivos de `conflicto`.
 *   tarjeta, ramaBase, carpetaMigraciones
 *   opcionesDeRebase  las mismas de rebaseSobre (identidad, carpetaTrabajo, sinChoque, nombre) para seguir el rebase
 *   correrClaude(prompt, { cwd, timeoutMs }) -> el texto que contestó (la sesión corta; etapas.mjs la arma)
 *   verificar() -> las líneas de "pruebas" (instalar + verificar de siempre); lanza si no pasa
 *   timeoutMs         el tope de Claude (como mucho MINUTOS_PARA_RESOLVER)
 *   esFallaDelEntorno qué errores de verificar() se relanzan tal cual (el PC, la red, el Coordinador)
 *   registro          para el log
 * -> { resultado: "resuelto", archivos, pruebas } | { resultado: "logica", motivo, archivos } | { resultado: "no_se_pudo", motivo, archivos }
 * Si no queda "resuelto", el rebase queda cancelado (el worktree como antes del rebase), salvo si ya terminó y falló verificar.
 */
export async function resolverChoque({
  cwd,
  tarjeta,
  ramaBase = "main",
  conflicto,
  carpetaMigraciones = "prisma/migrations",
  opcionesDeRebase = {},
  correrClaude,
  verificar,
  timeoutMs = MINUTOS_PARA_RESOLVER * 60_000,
  esFallaDelEntorno = esFallaDelEntornoPorDefecto,
  registro = null,
}) {
  const limite = Date.now() + Math.min(timeoutMs, MINUTOS_PARA_RESOLVER * 60_000);
  const archivos = [];
  const rendirse = async (resultado, motivo) => {
    await cancelarRebase(cwd);
    registro?.info?.(`resolver el choque: ${resultado === "logica" ? "choque de lógica" : "no se pudo"}: ${motivo}`);
    return { resultado, motivo: enUnaLinea(motivo, 400), archivos: [...new Set(archivos)] };
  };
  let pendientes = [...(conflicto ?? [])];
  for (let vuelta = 1; ; vuelta += 1) {
    if (!pendientes.length) return rendirse("no_se_pudo", "el rebase chocó pero git no dijo qué archivos");
    archivos.push(...pendientes);
    // Una migración no se junta a mano: dos migraciones sobre lo mismo son una decisión del dueño.
    const migraciones = pendientes.filter((archivo) => esDeMigraciones(archivo, carpetaMigraciones));
    if (migraciones.length) return rendirse("logica", `choca en las migraciones (${migraciones.join(", ")}): no se juntan solas`);
    const resta = limite - Date.now();
    if (resta <= 0) return rendirse("no_se_pudo", `se pasó de los ${MINUTOS_PARA_RESOLVER} min para resolver el choque`);

    const antes = await cambiosFueraDelConflicto(cwd, pendientes);
    let texto;
    try {
      texto = await correrClaude(promptDeResolver({ tarjeta, ramaBase, conflicto: pendientes }), { cwd, timeoutMs: resta });
    } catch (error) {
      // El límite de uso o la tarjeta vencida no son del choque: el bucle los trata como siempre.
      if (error?.limiteDeUso || error?.categoria === "coordinador_cortado") {
        await cancelarRebase(cwd);
        throw error;
      }
      return rendirse("no_se_pudo", `la sesión de Claude falló: ${String(error?.message ?? error).split("\n")[0]}`);
    }
    const respuesta = respuestaDelChoque(texto);
    if (!respuesta) return rendirse("no_se_pudo", "Claude no terminó con CHOQUE_SIMPLE ni CHOQUE_DE_LOGICA");
    if (respuesta.tipo === "logica") return rendirse("logica", respuesta.motivo);

    // Comprobaciones de un choque simple: 1) sin marcas; 2) solo cambiaron los archivos en conflicto.
    const conMarcas = archivosConMarcas(cwd, pendientes);
    if (conMarcas.length) return rendirse("no_se_pudo", `quedaron marcas de conflicto en ${conMarcas.join(", ")}`);
    const despues = await cambiosFueraDelConflicto(cwd, pendientes);
    const otros = [...despues].filter((archivo) => !antes.has(archivo));
    if (otros.length) return rendirse("no_se_pudo", `cambió archivos fuera del conflicto (${otros.slice(0, 5).join(", ")})`);

    const siguiente = await seguirRebase(cwd, pendientes, opcionesDeRebase);
    if (siguiente.ok) break;
    if (!siguiente.abierto || !siguiente.conflicto.length) return rendirse("no_se_pudo", `no se pudo seguir el rebase: ${enUnaLinea(siguiente.detalle, 200)}`);
    if (vuelta >= VUELTAS_MAXIMAS) return rendirse("no_se_pudo", `chocan más de ${VUELTAS_MAXIMAS} commits seguidos`);
    registro?.info?.(`resolver el choque: el commit siguiente también choca (${siguiente.conflicto.join(", ")})`);
    pendientes = siguiente.conflicto;
  }

  // 3) Pasa el verificar de siempre con lo juntado (el rebase ya terminó: no hay nada que cancelar; el worktree se borra).
  const juntados = [...new Set(archivos)];
  registro?.info?.(`resolver el choque: Claude juntó ${juntados.join(", ")}; se compila y se prueba`);
  try {
    const pruebas = (await verificar?.()) ?? [];
    return { resultado: "resuelto", archivos: juntados, pruebas };
  } catch (error) {
    if (esFallaDelEntorno(error)) throw error;
    const motivo = motivoDeVerificacion(error);
    registro?.info?.(`resolver el choque: no se pudo: ${motivo}`);
    return { resultado: "no_se_pudo", motivo, archivos: juntados };
  }
}
