import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * La parte de DISCO de la subida por pedazos del chat (la ruta solo revisa permisos y contesta).
 *
 * Antes cada pedazo se pegaba al final de un solo archivo (`<uploadId>.part`). Eso obligaba a
 * mandarlos de a uno y en orden, y tenia un daño escondido: si se perdia la respuesta del ultimo
 * pedazo y el celular lo reintentaba, el archivo ya se habia movido y quedaba uno cortado.
 *
 * Ahora cada pedazo vive aparte, en `<tmp>/<uploadId>/<indice>.part`, y el archivo se arma recien
 * cuando llega el ultimo, comprobando que esten TODOS. Asi se pueden subir varios a la vez, un
 * reintento sobrescribe su pedazo en vez de duplicarlo y nunca se crea un archivo incompleto.
 *
 * Esta separado de la ruta para poder probarlo con una carpeta de verdad, sin sesion ni base.
 */

export type ResultadoDelPedazo =
  /** El pedazo quedo guardado y todavia faltan otros. */
  | { estado: "guardado"; recibido: number; bytes: number }
  /** Era el ultimo y el archivo quedo armado en `destinoDir/nombreFinal`. */
  | { estado: "completo"; rutaFinal: string; bytes: number }
  | { estado: "error"; status: 400 | 409 | 500; error: string };

const NOMBRE_PEDAZO = /^(\d+)\.part$/;

/** El indice termina siendo parte de un nombre de archivo: solo se acepta 0..total-1. */
export function indiceDePedazoValido(indice: number, total: number) {
  return Number.isInteger(indice) && Number.isInteger(total) && total >= 1 && indice >= 0 && indice < total;
}

function esNoExiste(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

/** Los pedazos ya guardados de la carpeta (los provisionales a medio escribir no cuentan). */
async function leerPedazos(carpeta: string) {
  const nombres = await readdir(carpeta);
  const pedazos = new Map<number, number>();
  for (const nombre of nombres) {
    const coincide = NOMBRE_PEDAZO.exec(nombre);
    if (!coincide) continue;
    const tamano = await stat(path.join(carpeta, nombre))
      .then((info) => info.size)
      .catch(() => null);
    if (tamano !== null) pedazos.set(Number(coincide[1]), tamano);
  }
  return pedazos;
}

function sumar(pedazos: Map<number, number>) {
  let suma = 0;
  for (const tamano of pedazos.values()) suma += tamano;
  return suma;
}

function estanTodos(pedazos: Map<number, number>, total: number) {
  // Primero el conteo: un `total` enorme inventado no obliga a recorrer millones de indices.
  if (pedazos.size < total) return false;
  for (let indice = 0; indice < total; indice += 1) {
    if (!pedazos.has(indice)) return false;
  }
  return true;
}

const MENSAJE_FALTAN = "Faltan partes del archivo: la subida quedó incompleta. Volvé a enviarlo.";

export async function recibirPedazo(input: {
  /** Carpeta de subidas a medias (`chat-media-tmp`). */
  tmpDir: string;
  /** Carpeta final (`chat-media`). */
  destinoDir: string;
  uploadId: string;
  indice: number;
  total: number;
  datos: Uint8Array;
  maxBytes: number;
  maxMb: number;
  /** Nombre con el que queda el archivo armado dentro de `destinoDir`. */
  nombreFinal: string;
}): Promise<ResultadoDelPedazo> {
  const { tmpDir, uploadId, indice, total } = input;

  if (!indiceDePedazoValido(indice, total)) {
    return { estado: "error", status: 400, error: "Pedido invalido." };
  }

  const carpeta = path.join(tmpDir, uploadId);
  const esUltimo = indice === total - 1;

  /*
    El ultimo pedazo de un archivo de varios llega cuando los demas ya estan: si la carpeta no
    existe, otro pedido ya armo (o descarto) esta subida. No se crea de nuevo, porque quedaria una
    carpeta con un solo pedazo que nunca se completa.
  */
  if (esUltimo && total > 1) {
    const existe = await stat(carpeta).then(() => true).catch(() => false);
    if (!existe) {
      return { estado: "error", status: 409, error: MENSAJE_FALTAN };
    }
  }

  await mkdir(carpeta, { recursive: true });

  // Primero con un nombre provisional y despues se mueve: nunca queda un pedazo a medio escribir
  // con su nombre final, y un reintento reemplaza al anterior en vez de sumarse.
  const final = path.join(carpeta, `${indice}.part`);
  const provisional = path.join(carpeta, `${indice}.part.${randomUUID()}.tmp`);
  try {
    await writeFile(provisional, input.datos);
    await rename(provisional, final);
  } catch (error) {
    await unlink(provisional).catch(() => {});
    // La carpeta desaparecio en el medio: otro pedido la tomo para armar o la descarto.
    if (esNoExiste(error)) {
      return { estado: "error", status: 409, error: MENSAJE_FALTAN };
    }
    throw error;
  }

  const pedazos = await leerPedazos(carpeta).catch((error) => {
    if (esNoExiste(error)) return null;
    throw error;
  });
  if (!pedazos) {
    return { estado: "error", status: 409, error: MENSAJE_FALTAN };
  }

  const acumulado = sumar(pedazos);
  if (acumulado > input.maxBytes) {
    await rm(carpeta, { recursive: true, force: true });
    return { estado: "error", status: 400, error: `El archivo supera los ${input.maxMb} MB.` };
  }

  if (!esUltimo) {
    return { estado: "guardado", recibido: indice, bytes: acumulado };
  }

  // Si falta alguno no se arma nada y los pedazos que llegaron se dejan como estan.
  if (!estanTodos(pedazos, total)) {
    return { estado: "error", status: 409, error: MENSAJE_FALTAN };
  }

  /*
    Se reserva la carpeta moviendola a un nombre unico. Si el ultimo pedazo llega dos veces a la
    vez (se perdio la respuesta y el celular lo reintento), solo uno de los dos logra moverla: el
    otro recibe 409 y no arma un segundo archivo. El nombre lleva un punto, que un uploadId no
    puede tener, asi que no choca con ninguna subida.
  */
  const reservada = path.join(tmpDir, `${uploadId}.armando-${randomUUID()}`);
  try {
    await rename(carpeta, reservada);
  } catch (error) {
    if (esNoExiste(error)) {
      return { estado: "error", status: 409, error: MENSAJE_FALTAN };
    }
    throw error;
  }

  try {
    const enLaReserva = await leerPedazos(reservada);
    if (!estanTodos(enLaReserva, total)) {
      return { estado: "error", status: 409, error: MENSAJE_FALTAN };
    }

    let esperado = 0;
    for (let i = 0; i < total; i += 1) esperado += enLaReserva.get(i) ?? 0;

    /*
      Se arma en orden, leyendo de a un pedazo y en bloques chicos: nunca se carga el archivo
      entero en memoria. Cada pedazo se borra apenas se copia, para que el disco (que esta justo)
      no llegue a tener el archivo dos veces.
    */
    const armado = path.join(reservada, "armado.tmp");
    const salida = await open(armado, "w");
    try {
      for (let i = 0; i < total; i += 1) {
        const pedazo = path.join(reservada, `${i}.part`);
        for await (const bloque of createReadStream(pedazo)) {
          await salida.write(bloque as Buffer);
        }
        await unlink(pedazo);
      }
    } finally {
      await salida.close();
    }

    const tamanoFinal = (await stat(armado)).size;
    if (tamanoFinal !== esperado) {
      console.error("[chat-upload] el archivo armado no mide lo que suman sus pedazos", {
        uploadId,
        esperado,
        tamanoFinal,
      });
      return { estado: "error", status: 500, error: "No se pudo armar el archivo. Volvé a enviarlo." };
    }

    await mkdir(input.destinoDir, { recursive: true });
    const rutaFinal = path.join(input.destinoDir, input.nombreFinal);
    // rename y no copiar: dentro del mismo volumen es instantaneo y no duplica el archivo en disco.
    await rename(armado, rutaFinal);
    return { estado: "completo", rutaFinal, bytes: tamanoFinal };
  } finally {
    // Pase lo que pase, la reserva se borra: o ya se movio el archivo, o no sirve para nada.
    await rm(reservada, { recursive: true, force: true }).catch(() => {});
  }
}
