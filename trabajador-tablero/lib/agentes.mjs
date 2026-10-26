// Un agente por proyecto (26-oct-2026). El Coordinador de Sistemas reparte las tarjetas y cada una la trabaja el
// agente de SU proyecto: con su identidad, el CLAUDE.md de la raíz de su repositorio y su propia cola
// (`maxEnParalelo`). Este archivo es PURO: no lee archivos ni la red; los datos salen de `repos.<clave>.agente`
// de la configuración y, si faltan, se deducen de la clave del proyecto.
import path from "node:path";

/** El nombre de cada agente según el proyecto (lo que no esté acá se llama "Agente <clave>"). */
export const NOMBRES_DE_AGENTES = {
  aizencrm: "Agente CRM",
  gestion: "Agente Gestión",
  "messenger-basic": "Agente Marketplace (NETMAGI)",
  marketing: "Agente Marketing",
};

/** Cuántas tarjetas a la vez tiene un agente cuando ni él ni la configuración general lo dicen. */
export const MAX_EN_PARALELO_POR_DEFECTO = 2;

/**
 * Los datos del agente de un proyecto: { nombre, clave, carpeta, archivoClaude, archivoLecciones, maxEnParalelo }.
 * `repo` es la entrada de config.repos (con `clave`, `ruta` y, si hay, `agente`). `maxPorDefecto` es el tope que
 * se usa si el agente no trae `maxEnParalelo` (lo que cabe en total, para que quien no configure nada siga igual).
 */
export function agenteDelRepo(repo, maxPorDefecto = MAX_EN_PARALELO_POR_DEFECTO) {
  const clave = String(repo?.clave ?? "");
  const datos = repo?.agente && typeof repo.agente === "object" ? repo.agente : {};
  const carpeta = typeof repo?.ruta === "string" ? repo.ruta : "";
  const nombre = typeof datos.nombre === "string" && datos.nombre.trim() ? datos.nombre.trim() : (NOMBRES_DE_AGENTES[clave] ?? `Agente ${clave}`);
  const lecciones = typeof datos.lecciones === "string" && datos.lecciones.trim() ? datos.lecciones.trim() : "";
  const maximo = Math.floor(Number(datos.maxEnParalelo));
  return {
    nombre,
    clave,
    carpeta,
    archivoClaude: carpeta ? path.join(carpeta, "CLAUDE.md") : "CLAUDE.md",
    archivoLecciones: lecciones ? path.resolve(carpeta || ".", lecciones) : "",
    maxEnParalelo: Number.isFinite(maximo) && maximo >= 1 ? maximo : Math.max(1, Math.floor(Number(maxPorDefecto)) || MAX_EN_PARALELO_POR_DEFECTO),
  };
}

/** La primera línea de las instrucciones: quién eres y de qué proyecto es la tarjeta. */
export function textoDeIdentidad(agente) {
  const lecciones = agente.archivoLecciones ? ` y las lecciones de ${agente.archivoLecciones}` : "";
  return `Eres el ${agente.nombre} del proyecto ${agente.clave}; el Coordinador de Sistemas te pasó esta tarjeta. Sigue el CLAUDE.md de la raíz de tu repositorio${lecciones}.`;
}
