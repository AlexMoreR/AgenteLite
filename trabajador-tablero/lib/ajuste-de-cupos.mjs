// EL AJUSTE AUTOMÁTICO DEL CUPO DE LA NUBE (31-oct-2026, parte 4 de «cupos por sistema»). Con varias tareas del mismo
// proyecto construyendo a la vez en la nube (repos.<repo>.cuposNube: CRM 3, Gestión 2) pueden subir los choques con main.
// Durante VENTANA_DIAS desde que se prenden los cupos nuevos, por cada proyecto con más de 1 puesto se anota cada tarea que
// se construyó en la nube:
//   - si corrió SOLA o ACOMPAÑADA de otra del mismo proyecto en la nube;
//   - si falló por choque (categorías choca_con_main o choque_de_logica de los intentos).
// Si las acompañadas chocan más que las solas (con al menos MINIMO_ACOMPANADAS acompañadas y MINIMO_CHOQUES choques entre
// ellas), el cupo de ese proyecto baja en 1 (nunca de 1), UNA vez por proyecto en la ventana, y queda un aviso pendiente
// para Emanuel (crm.aviso(texto, "cupos"), lo manda bucle.mjs). El cupo bajado se queda así hasta que alguien cambie el
// número en la configuración. Solo baja: nunca sube solo.
//
// "Las de antes" se miden con las solas del mismo proyecto (el Coordinador no guarda historial de antes). Sin solas, la base
// es 0 choques: bajar es lo seguro.
//
// El estado vive en carpetaTrabajo/estado-uso.json, bajo la clave propia `ajusteCupos` (el archivo lo comparte con la pausa
// por uso: cada uno escribe solo su clave). Nunca lanza: si no se puede leer o guardar, se anota y se sigue.
//
// También está acá el SEMÁFORO de la carga de aizen1, con la misma regla que pinta CargaVista.semaforo en el CRM
// (reglas-coordinador-en-vivo.ts: semaforoDeLaCarga): con amarillo no se abre una 2.ª ni una 3.ª tarea del mismo proyecto.
import fs from "node:fs";
import path from "node:path";

export const VENTANA_DIAS = 3;
export const MINIMO_ACOMPANADAS = 4;
export const MINIMO_CHOQUES = 2;
export const CATEGORIAS_DE_CHOQUE = ["choca_con_main", "choque_de_logica"];
const DIA_MS = 24 * 60 * 60_000;

// Los mismos números que el CRM (reglas-coordinador-en-vivo.ts): LIMITE_ROJO, LIMITE_AMARILLO y el disco libre en GB.
export const LIMITE_ROJO = 85;
export const LIMITE_AMARILLO = 70;
export const DISCO_LIBRE_ROJO_GB = 10;
export const DISCO_LIBRE_AMARILLO_GB = 20;

/**
 * El semáforo de aizen1 con la regla del CRM: verde bajo 70 %; amarillo de 70 a 85 % (o si espera que el PC se desocupe, o
 * queda poco disco); rojo si pasa de 85 % o el disco libre es muy poco. Sin datos, null.
 * `carga` = { cpu, memoriaPorciento, discoLibreGb, esperandoPc } (lo mismo que va en el latido).
 */
export function semaforoDeLaCarga(carga) {
  if (!carga) return null;
  const medidas = [carga.cpu, carga.memoriaPorciento].filter((valor) => typeof valor === "number" && Number.isFinite(valor));
  const disco = typeof carga.discoLibreGb === "number" && Number.isFinite(carga.discoLibreGb) ? carga.discoLibreGb : null;
  if (!medidas.length && disco === null) return null;
  const peor = medidas.length ? Math.max(...medidas) : 0;
  if (peor > LIMITE_ROJO || (disco !== null && disco < DISCO_LIBRE_ROJO_GB)) return "rojo";
  if (peor >= LIMITE_AMARILLO || carga.esperandoPc === true || (disco !== null && disco < DISCO_LIBRE_AMARILLO_GB)) return "amarillo";
  return "verde";
}

/** "CPU 75 %, disco libre 12 GB": por qué el semáforo no está verde (para el motivo de la espera). */
export function motivoDelSemaforo(carga) {
  if (!carga) return "sin datos";
  const partes = [];
  if (typeof carga.cpu === "number" && carga.cpu >= LIMITE_AMARILLO) partes.push(`CPU ${carga.cpu} %`);
  if (typeof carga.memoriaPorciento === "number" && carga.memoriaPorciento >= LIMITE_AMARILLO) partes.push(`memoria ${carga.memoriaPorciento} %`);
  if (typeof carga.discoLibreGb === "number" && carga.discoLibreGb < DISCO_LIBRE_AMARILLO_GB) partes.push(`disco libre ${carga.discoLibreGb} GB`);
  if (carga.esperandoPc === true) partes.push("espera que el PC se desocupe");
  return partes.join(", ") || "carga alta";
}

const conteoVacio = () => ({ tareas: 0, choques: 0 });
const tasa = ({ tareas, choques }) => (tareas > 0 ? choques / tareas : 0);

/**
 * ¿Hay que bajar el cupo? Las acompañadas chocan más que las solas, con al menos MINIMO_ACOMPANADAS acompañadas y
 * MINIMO_CHOQUES choques entre ellas. Pura (se prueba sola).
 */
export function debeBajarElCupo({ solas = conteoVacio(), acompanadas = conteoVacio() } = {}) {
  if (acompanadas.tareas < MINIMO_ACOMPANADAS || acompanadas.choques < MINIMO_CHOQUES) return false;
  return tasa(acompanadas) > tasa(solas);
}

/** El WhatsApp a Emanuel cuando el cupo baja solo: 3 líneas como máximo. */
export function textoDelAvisoDeBajada({ nombre, de, a, solas, acompanadas }) {
  return [
    `⚠️ Bajé el cupo de la nube de ${nombre} de ${de} a ${a}: con varias a la vez chocan más con main.`,
    `Acompañadas: ${acompanadas.choques} choques en ${acompanadas.tareas}. Solas: ${solas.choques} en ${solas.tareas}.`,
    `Para devolverlo, cambia repos.<repo>.cuposNube en config.local.json y reinicia el Coordinador.`,
  ].join("\n");
}

/**
 * El ajuste del cupo. `config.repos.<repo>.cuposNube` es lo configurado; `nombreDe(clave)` el nombre para el aviso.
 *   cupo(clave)                 el cupo de la nube que vale ahora (el bajado si la configuración no cambió; si no, el configurado).
 *   empezo(id, clave, acompanada, otrosIds)   una tarea empezó a construir en la nube (con otras del proyecto: acompañada,
 *                               y las otras pasan a acompañadas).
 *   termino(id, resultado, hacer)             terminó una sesión de esa tarjeta: con choque o subida cuenta; si no, sigue.
 *   pendientes() / avisado(clave)             los avisos que faltan mandar (los manda bucle.mjs) y marcarlos.
 *   resumen()                   lo que va en el latido.
 */
export function crearAjusteDeCupos({ config, registro, ahora = () => Date.now(), nombreDe = (clave) => clave }) {
  const archivo = config.carpetaTrabajo ? path.join(config.carpetaTrabajo, "estado-uso.json") : null;

  const leerArchivo = () => {
    if (!archivo) return {};
    try {
      return JSON.parse(fs.readFileSync(archivo, "utf8"));
    } catch {
      return {};
    }
  };
  // Lee lo que hay y cambia solo `ajusteCupos`: lo de la pausa por uso queda igual.
  const guardar = (estado) => {
    if (!archivo) return;
    try {
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      fs.writeFileSync(archivo, `${JSON.stringify({ ...leerArchivo(), ajusteCupos: estado }, null, 2)}\n`);
    } catch (error) {
      registro?.aviso?.(`no pude guardar el ajuste de cupos en ${archivo}: ${error.message}`);
    }
  };

  const configurado = (clave) => config.repos?.[clave]?.cuposNube ?? null;
  /** Los proyectos que entran al ajuste: los que tienen más de 1 puesto de la nube configurado. */
  const conVariosPuestos = () => Object.keys(config.repos ?? {}).filter((clave) => Number.isInteger(configurado(clave)) && configurado(clave) > 1);

  let estado = leerArchivo().ajusteCupos ?? null;
  if (!estado || typeof estado !== "object" || !Number.isFinite(estado.desde)) estado = null;
  // Se prende la primera vez que corre con algún proyecto de más de 1 puesto.
  if (!estado && conVariosPuestos().length) {
    estado = { desde: ahora(), repos: {}, tareas: {} };
    guardar(estado);
    registro?.info?.(`ajuste de cupos: prendido por ${VENTANA_DIAS} días (${conVariosPuestos().map((clave) => `${clave} ${configurado(clave)}`).join(", ")})`);
  }

  const hasta = () => (estado ? estado.desde + VENTANA_DIAS * DIA_MS : null);
  const enVentana = () => Boolean(estado) && ahora() < hasta();
  const delRepo = (clave) => {
    estado.repos[clave] ??= { solas: conteoVacio(), acompanadas: conteoVacio(), bajadoA: null, cupoDeLaConfig: null, bajadoEn: null, aviso: null };
    return estado.repos[clave];
  };

  function cupo(clave) {
    const valor = configurado(clave);
    const r = estado?.repos?.[clave];
    // El cupo bajado vale mientras la configuración siga con el número que había al bajarlo.
    if (r?.bajadoA && r.cupoDeLaConfig === valor) return r.bajadoA;
    return valor;
  }

  function decidir(clave) {
    const r = delRepo(clave);
    const actual = cupo(clave);
    if (r.bajadoEn || !(Number.isInteger(actual) && actual > 1) || !debeBajarElCupo(r)) return;
    r.bajadoA = actual - 1;
    r.cupoDeLaConfig = configurado(clave);
    r.bajadoEn = ahora();
    r.aviso = { texto: textoDelAvisoDeBajada({ nombre: nombreDe(clave), de: actual, a: r.bajadoA, solas: r.solas, acompanadas: r.acompanadas }), avisado: false };
    registro?.aviso?.(`ajuste de cupos: ${clave} baja de ${actual} a ${r.bajadoA} en la nube (acompañadas ${r.acompanadas.choques}/${r.acompanadas.tareas} choques, solas ${r.solas.choques}/${r.solas.tareas})`);
  }

  return {
    cupo,
    /** Una tarjeta empezó a construir en la nube. Solo cuenta en la ventana y en proyectos de más de 1 puesto. */
    empezo(id, clave, acompanada, otrosIds = []) {
      try {
        if (!enVentana() || !conVariosPuestos().includes(clave)) return;
        estado.tareas[id] = { repo: clave, acompanada: Boolean(acompanada) };
        for (const otro of otrosIds) if (estado.tareas[otro]?.repo === clave) estado.tareas[otro].acompanada = true;
        guardar(estado);
      } catch (error) {
        registro?.aviso?.(`ajuste de cupos: no pude anotar el inicio (${error.message})`);
      }
    },
    /**
     * Terminó una sesión de la tarjeta `id`. Cuenta (y deja de seguirla) si falló por choque, si subió (subir ok) o si falló
     * por otra cosa de la tarea; una construcción que salió bien sigue esperando su subida; una pausa o espera no cuenta.
     */
    termino(id, resultado, hacer) {
      try {
        const tarea = estado?.tareas?.[id];
        if (!tarea) return;
        if (!enVentana()) {
          delete estado.tareas[id];
          guardar(estado);
          return;
        }
        const choque = CATEGORIAS_DE_CHOQUE.includes(resultado?.categoria);
        const subio = resultado?.ok === true && hacer === "subir";
        // Construyó bien: sigue esperando su subida.
        if (!choque && !subio && resultado?.ok === true) return;
        // Falló por algo de la tarea (no una pausa, el límite de uso ni una espera ajena): cuenta, sin choque.
        const fallaDeLaTarea = resultado?.ok === false && Boolean(resultado?.categoria) && resultado?.accion !== "esperar";
        if (!choque && !subio && !fallaDeLaTarea) {
          delete estado.tareas[id];
          guardar(estado);
          return;
        }
        const r = delRepo(tarea.repo);
        const conteo = tarea.acompanada ? r.acompanadas : r.solas;
        conteo.tareas += 1;
        if (choque) conteo.choques += 1;
        delete estado.tareas[id];
        decidir(tarea.repo);
        guardar(estado);
      } catch (error) {
        registro?.aviso?.(`ajuste de cupos: no pude anotar el final (${error.message})`);
      }
    },
    /** Los avisos de bajada que falta mandar: [{ clave, texto }]. */
    pendientes: () => Object.entries(estado?.repos ?? {}).filter(([, r]) => r.aviso && !r.aviso.avisado).map(([clave, r]) => ({ clave, texto: r.aviso.texto })),
    avisado(clave) {
      const r = estado?.repos?.[clave];
      if (!r?.aviso) return;
      r.aviso.avisado = true;
      guardar(estado);
    },
    /** Para el latido: { estado: "prendido"|"terminado"|"apagado", desde, hasta, diasQuedan, repos: { clave: { cupo, configurado, bajado, … } } }. */
    resumen() {
      const repos = {};
      for (const clave of Object.keys(config.repos ?? {})) {
        const r = estado?.repos?.[clave];
        repos[clave] = {
          cupo: cupo(clave),
          configurado: configurado(clave),
          bajado: Boolean(r?.bajadoA && r.cupoDeLaConfig === configurado(clave)),
          solas: r?.solas ?? conteoVacio(),
          acompanadas: r?.acompanadas ?? conteoVacio(),
        };
      }
      if (!estado) return { estado: "apagado", desde: null, hasta: null, diasQuedan: 0, repos };
      const quedanMs = Math.max(0, hasta() - ahora());
      return {
        estado: quedanMs > 0 ? "prendido" : "terminado",
        desde: new Date(estado.desde).toISOString(),
        hasta: new Date(hasta()).toISOString(),
        diasQuedan: Math.round((quedanMs / DIA_MS) * 10) / 10,
        repos,
      };
    },
  };
}
