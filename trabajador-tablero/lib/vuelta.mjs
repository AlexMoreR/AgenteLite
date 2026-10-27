// LA VUELTA QUE NO SE CUELGA (27-oct-2026). El 27-oct el Coordinador quedó 25 min mudo con el proceso vivo: el bucle
// estaba en `await planificador.esperarTodas()` esperando a que terminaran 2 tarjetas de la nube (hasta 120 min cada
// una) para autoactualizarse, sin tomar ni subir nada. Dos arreglos:
//
//   1. `crearTareasConTope`: cada trabajo de la vuelta (llenar, rescate, notas, autoactualizar…) corre con un tope de
//      tiempo. Si se pasa, la vuelta sigue sin él y queda "en vuelo": la próxima vuelta no lo vuelve a lanzar hasta
//      que termine (así nunca hay dos llenar a la vez).
//   2. `marcarVivo`: la marca de vida <carpetaTrabajo>/vivo.json. El bucle la escribe al terminar cada vuelta
//      (`ultimaVuelta`) y antes de cada trabajo con tope o de dormir (`ocupadoHasta`: hasta cuándo puede tardar sin
//      estar colgado). El lanzador (lanzador.mjs, perro guardián) reinicia el Coordinador si
//      max(ultimaVuelta, ocupadoHasta) tiene más de `perroGuardianMinutos`.
import fs from "node:fs";
import path from "node:path";

export const rutaDeVivo = (carpetaTrabajo) => path.join(carpetaTrabajo, "vivo.json");

/** Escribe vivo.json (atómico). Nunca lanza: un disco lleno no tumba el bucle. */
export function marcarVivo(carpetaTrabajo, datos, { ahora = Date.now() } = {}) {
  try {
    fs.mkdirSync(carpetaTrabajo, { recursive: true });
    const ruta = rutaDeVivo(carpetaTrabajo);
    const cuerpo = { pid: process.pid, en: new Date(ahora).toISOString(), ...datos };
    fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify(cuerpo, null, 2)}\n`);
    fs.renameSync(`${ruta}.tmp`, ruta);
    return cuerpo;
  } catch {
    return null;
  }
}

/**
 * La marca de vida del bucle. `vueltaCompleta()` al final de cada vuelta; `ocupado(que, ms)` antes de algo que puede
 * tardar hasta `ms` (un trabajo con tope, dormir).
 */
export function crearMarcaDeVida(carpetaTrabajo, { ahora = () => Date.now() } = {}) {
  let ultimaVuelta = null;
  const escribir = (extra) => marcarVivo(carpetaTrabajo, { ultimaVuelta, ...extra }, { ahora: ahora() });
  return {
    vueltaCompleta() {
      ultimaVuelta = new Date(ahora()).toISOString();
      return escribir({ ocupadoEn: null, ocupadoHasta: null });
    },
    ocupado(que, ms) {
      return escribir({ ocupadoEn: que, ocupadoHasta: new Date(ahora() + Math.max(0, ms)).toISOString() });
    },
  };
}

/**
 * Corre trabajos con tope de tiempo. `correr(nombre, fn, { topeMs })` -> { estado, valor?, error? }
 *   "hecha":   terminó dentro del tope (valor) — o lanzó (error), igual que antes con try/catch.
 *   "tope":    se pasó del tope; sigue corriendo por su cuenta y queda en vuelo.
 *   "ocupada": la vez anterior todavía no termina; no se lanza otra.
 * `antes(nombre, topeMs)` se llama justo antes de lanzar (la marca de vida).
 */
export function crearTareasConTope({ registro, antes = () => undefined } = {}) {
  const enVuelo = new Map();
  return {
    enVuelo: (nombre) => enVuelo.has(nombre),
    algunaEnVuelo: (...nombres) => nombres.some((nombre) => enVuelo.has(nombre)),
    async correr(nombre, fn, { topeMs }) {
      if (enVuelo.has(nombre)) return { estado: "ocupada" };
      antes(nombre, topeMs);
      const inicio = Date.now();
      const promesa = Promise.resolve()
        .then(fn)
        .then(
          (valor) => ({ estado: "hecha", valor }),
          (error) => ({ estado: "hecha", error }),
        );
      enVuelo.set(nombre, promesa);
      let reloj;
      const tope = new Promise((resolver) => {
        reloj = setTimeout(() => resolver({ estado: "tope" }), Math.max(1, topeMs));
      });
      const resultado = await Promise.race([promesa, tope]);
      clearTimeout(reloj);
      if (resultado.estado === "tope") {
        registro?.aviso?.(`${nombre}: lleva más de ${Math.round(topeMs / 1000)} s sin terminar; la vuelta sigue sin esperarlo (no lo lanzo otra vez hasta que termine)`);
        void promesa.then((final) => {
          enVuelo.delete(nombre);
          const segundos = Math.round((Date.now() - inicio) / 1000);
          if (final.error) registro?.aviso?.(`${nombre}: terminó tarde (${segundos} s) con error: ${String(final.error?.message ?? final.error).split("\n")[0]}`);
          else registro?.info?.(`${nombre}: terminó tarde (${segundos} s)`);
        });
      } else {
        enVuelo.delete(nombre);
      }
      return resultado;
    },
  };
}
