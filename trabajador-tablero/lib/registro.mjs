// El registro (log) del trabajador: un archivo por día en <carpetaTrabajo>/logs, y se guardan solo los
// últimos 14 días (rotación). También sale por la consola. Nunca escribe la clave del trabajador.
import fs from "node:fs";
import path from "node:path";

const DIAS_QUE_SE_GUARDAN = 14;

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

  return {
    info: (mensaje, extra) => escribir("INFO", mensaje, extra),
    aviso: (mensaje, extra) => escribir("AVISO", mensaje, extra),
    error: (mensaje, extra) => escribir("ERROR", mensaje, extra),
    carpeta,
  };
}
