// NOTAS NUEVAS DEL CEREBRO EN LA BÓVEDA (26-oct-2026, decisión del dueño). La cuenta de servicio de Google edita los
// archivos de la carpeta del cerebro, pero NO puede crear uno nuevo en un Drive personal (403 storageQuotaExceeded).
// Esa carpeta es la bóveda de aizen1 (config `boveda.ruta`, p. ej. "D:/Magilus"), sincronizada con Google Drive para
// escritorio. Entonces el CRM deja el pedido (PENDIENTE) y aquí, cada minuto:
//   1. GET /api/trabajador/cerebro/notas-por-crear -> las pendientes (las más viejas primero);
//   2. se escribe <boveda>/<ruta>: crea las carpetas que falten; NUNCA sobrescribe (si ya existe, agrega el contenido al
//      final con una línea separadora); la ruta no puede salir de la bóveda (sin "..", sin rutas absolutas) y solo .md/.txt;
//   3. POST CREADA (o ERROR con motivo). Drive para escritorio sube el archivo a nombre del dueño.
// Para no escribir dos veces la misma nota si el aviso CREADA falla, los ids ya escritos quedan en
// <carpetaTrabajo>/notas-boveda.json y en la vuelta siguiente solo se vuelve a avisar.
import fs from "node:fs";
import path from "node:path";

export const rutaDelEstadoDeNotas = (carpetaTrabajo) => path.join(carpetaTrabajo, "notas-boveda.json");
const MAXIMO_RECORDADAS = 500;

/** La misma regla que el CRM (src/features/cerebro/services/reglas.ts: problemaDeRutaDeNota). null si la ruta sirve. */
export function problemaDeRuta(ruta) {
  if (typeof ruta !== "string" || !ruta.trim()) return "Falta la ruta de la nota.";
  if (ruta.length > 300) return "La ruta es muy larga (máximo 300 letras).";
  if (/^[\\/]/.test(ruta) || /^[a-z]:/i.test(ruta)) return "La ruta no puede ser absoluta.";
  if (/[\u0000-\u001f<>:"|?*]/.test(ruta)) return "La ruta tiene caracteres que no se permiten.";
  const partes = ruta.split(/[\\/]/);
  if (partes.some((parte) => !parte.trim() || parte === "." || parte === ".." || parte !== parte.trim() || parte.endsWith("."))) {
    return 'La ruta no puede tener partes vacías, "." ni "..".';
  }
  if (!/\.(md|txt)$/i.test(ruta)) return "Solo se crean notas .md o .txt.";
  return null;
}

const dentroDe = (base, destino) => {
  const relativa = path.relative(base, destino);
  return relativa !== "" && !relativa.startsWith("..") && !path.isAbsolute(relativa);
};

/** El ancestro más profundo que ya existe (para revisar que una unión o un enlace no saque la escritura de la bóveda). */
function ancestroExistente(destino) {
  let actual = path.dirname(destino);
  while (!fs.existsSync(actual)) {
    const padre = path.dirname(actual);
    if (padre === actual) break;
    actual = padre;
  }
  return actual;
}

/** La ruta absoluta dentro de la bóveda, o un error si la ruta no sirve o se sale. */
export function destinoEnLaBoveda(boveda, ruta) {
  const problema = problemaDeRuta(ruta);
  if (problema) throw new Error(problema);
  const raiz = path.resolve(boveda);
  const destino = path.resolve(raiz, ...ruta.split(/[\\/]/));
  if (!dentroDe(raiz, destino)) throw new Error("La ruta se sale de la bóveda.");
  const raizReal = fs.realpathSync(raiz);
  const ancestro = fs.realpathSync(ancestroExistente(destino));
  if (ancestro !== raizReal && !dentroDe(raizReal, ancestro)) throw new Error("La ruta se sale de la bóveda (por un enlace).");
  return destino;
}

/** El separador cuando la nota ya existía: una línea en blanco, una raya y otra en blanco. */
export const SEPARADOR = "\n\n---\n\n";

/** Escribe la nota. Nunca sobrescribe. -> { accion: "creada" | "agregada", archivo } */
export function escribirNotaEnLaBoveda(boveda, ruta, contenido) {
  const archivo = destinoEnLaBoveda(boveda, ruta);
  const texto = String(contenido ?? "").replace(/\s+$/, "") + "\n";
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  try {
    // "wx": falla si ya existe (así ni una carrera con Drive para escritorio lo pisa).
    fs.writeFileSync(archivo, texto, { flag: "wx" });
    return { accion: "creada", archivo };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const antes = fs.readFileSync(archivo, "utf8");
  // Siempre queda "texto anterior" + línea en blanco + "---" + línea en blanco + lo nuevo.
  const separador = !antes.trim() ? "" : antes.endsWith("\n\n") ? "---\n\n" : antes.endsWith("\n") ? "\n---\n\n" : SEPARADOR;
  fs.appendFileSync(archivo, `${separador}${texto}`);
  return { accion: "agregada", archivo };
}

function leerEstado(carpetaTrabajo) {
  try {
    const datos = JSON.parse(fs.readFileSync(rutaDelEstadoDeNotas(carpetaTrabajo), "utf8").replace(/^\uFEFF/, ""));
    return { escritas: Array.isArray(datos?.escritas) ? datos.escritas.filter((id) => typeof id === "string") : [] };
  } catch {
    return { escritas: [] };
  }
}

function guardarEstado(carpetaTrabajo, estado) {
  fs.mkdirSync(carpetaTrabajo, { recursive: true });
  const ruta = rutaDelEstadoDeNotas(carpetaTrabajo);
  fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify({ escritas: estado.escritas.slice(-MAXIMO_RECORDADAS) }, null, 2)}\n`);
  fs.renameSync(`${ruta}.tmp`, ruta);
}

const primeraLinea = (texto) => String(texto ?? "").split("\n")[0].slice(0, 300);

/**
 * El que crea las notas. `revisar()` va en el bucle del Coordinador: corre como mucho cada `boveda.cadaSegundos` y solo si
 * `boveda.ruta` está. `vuelta()` hace una pasada ya (la usan las pruebas). -> { creadas, agregadas, errores, avisadas }
 */
export function crearNotasDeBoveda({ crm, config, registro, ahora = () => Date.now() }) {
  const boveda = config.boveda?.ruta ?? null;
  const cadaMs = (config.boveda?.cadaSegundos ?? 60) * 1000;
  const carpetaTrabajo = config.carpetaTrabajo;
  let ultima = -Infinity;

  async function vuelta() {
    const cuenta = { creadas: 0, agregadas: 0, errores: 0, avisadas: 0 };
    if (!boveda) return cuenta;
    if (!fs.existsSync(boveda) || !fs.statSync(boveda).isDirectory()) {
      // Puede ser que la unidad no esté montada: no se marca ERROR, se reintenta en la próxima vuelta.
      registro.aviso(`notas de la bóveda: no existe la carpeta ${boveda}`);
      return cuenta;
    }
    const { notas = [] } = (await crm.notasPorCrear()) ?? {};
    if (!notas.length) return cuenta;
    const estado = leerEstado(carpetaTrabajo);
    for (const nota of notas) {
      if (!nota?.id) continue;
      if (estado.escritas.includes(nota.id)) {
        // Ya se escribió en una vuelta anterior, pero el aviso no llegó: solo se avisa (no se escribe dos veces).
        await crm.marcarNota(nota.id, "CREADA");
        cuenta.avisadas += 1;
        continue;
      }
      let resultado;
      try {
        resultado = escribirNotaEnLaBoveda(boveda, nota.ruta, nota.contenido);
      } catch (error) {
        const motivo = primeraLinea(error?.message ?? error);
        registro.aviso(`notas de la bóveda: no se creó "${primeraLinea(nota.ruta)}": ${motivo}`);
        await crm.marcarNota(nota.id, "ERROR", motivo);
        cuenta.errores += 1;
        continue;
      }
      estado.escritas.push(nota.id);
      guardarEstado(carpetaTrabajo, estado);
      registro.info(`notas de la bóveda: ${resultado.accion} ${nota.ruta}`);
      cuenta[resultado.accion === "creada" ? "creadas" : "agregadas"] += 1;
      await crm.marcarNota(nota.id, "CREADA");
    }
    return cuenta;
  }

  return {
    vuelta,
    async revisar() {
      if (!boveda) return null;
      if (ahora() - ultima < cadaMs) return null;
      ultima = ahora();
      return vuelta();
    },
  };
}
