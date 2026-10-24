// El registro (log) del trabajador: un archivo por día en <carpetaTrabajo>/logs, y se guardan solo los
// últimos 14 días (rotación). También sale por la consola. Nunca escribe la clave del trabajador.
import fs from "node:fs";
import path from "node:path";

import { idCorto } from "./git.mjs";

const DIAS_QUE_SE_GUARDAN = 14;

/** <carpetaTrabajo>/intentos/<idCorto>: el log de cada intento y el patch del trabajo de una tarjeta. */
export const carpetaDeIntentos = (carpetaTrabajo, tarjetaId) => path.join(carpetaTrabajo, "intentos", idCorto(tarjetaId));

export function crearRegistro(carpetaTrabajo, { consola = true, ocultar = [] } = {}) {
  const carpeta = path.join(carpetaTrabajo, "logs");
  fs.mkdirSync(carpeta, { recursive: true });
  let diaRotado = "";

  const limpiar = (texto) => ocultar.filter(Boolean).reduce((acumulado, secreto) => acumulado.split(secreto).join("***"), texto);

  function rotar(dia) {
    if (dia === diaRotado) return;
    diaRotado = dia;
    const archivos = fs
      .readdirSync(carpeta)
      .filter((nombre) => /^trabajador-\d{4}-\d{2}-\d{2}\.log$/.test(nombre))
      .sort();
    for (const viejo of archivos.slice(0, Math.max(0, archivos.length - DIAS_QUE_SE_GUARDAN))) {
      try {
        fs.unlinkSync(path.join(carpeta, viejo));
      } catch {
        // Si no se puede borrar, queda: no es motivo para parar.
      }
    }
  }

  function escribir(nivel, mensaje, extra) {
    const ahora = new Date();
    const dia = ahora.toISOString().slice(0, 10);
    rotar(dia);
    const linea = limpiar(
      `${ahora.toISOString()} [${nivel}] ${mensaje}${extra === undefined ? "" : ` ${typeof extra === "string" ? extra : JSON.stringify(extra)}`}`,
    );
    try {
      fs.appendFileSync(path.join(carpeta, `trabajador-${dia}.log`), `${linea}\n`);
    } catch {
      // Un disco lleno no tumba el trabajador.
    }
    if (consola) (nivel === "ERROR" ? console.error : console.log)(linea);
  }

  let intentosRotados = false;
  /** Borra las carpetas de intentos que no se tocan hace más de 14 días (el patch y los logs de tarjetas ya olvidadas). */
  function rotarIntentos() {
    if (intentosRotados) return;
    intentosRotados = true;
    const raiz = path.join(carpetaTrabajo, "intentos");
    try {
      for (const nombre of fs.readdirSync(raiz)) {
        const ruta = path.join(raiz, nombre);
        if (Date.now() - fs.statSync(ruta).mtimeMs > DIAS_QUE_SE_GUARDAN * 86_400_000) fs.rmSync(ruta, { recursive: true, force: true });
      }
    } catch {
      // No hay carpeta todavía o no se pudo borrar: no es motivo para parar.
    }
  }

  return {
    /**
     * Guarda el error completo y el log de un intento que falló en
     * <carpetaTrabajo>/intentos/<idCorto>/<fecha>-<etapa>.log (ANTES de diagnosticar). Devuelve la ruta (o null si no se pudo).
     */
    guardarIntento({ tarjetaId, etapa, texto }) {
      try {
        rotarIntentos();
        const carpetaIntento = carpetaDeIntentos(carpetaTrabajo, tarjetaId);
        fs.mkdirSync(carpetaIntento, { recursive: true });
        const fecha = new Date().toISOString().replace(/[:.]/g, "-");
        const ruta = path.join(carpetaIntento, `${fecha}-${etapa}.log`);
        fs.writeFileSync(ruta, limpiar(String(texto ?? "")));
        return ruta;
      } catch {
        return null;
      }
    },
    info: (mensaje, extra) => escribir("INFO", mensaje, extra),
    aviso: (mensaje, extra) => escribir("AVISO", mensaje, extra),
    error: (mensaje, extra) => escribir("ERROR", mensaje, extra),
    carpeta,
  };
}
