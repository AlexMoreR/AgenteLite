// El LATIDO del Coordinador (24-oct-2026): cada 15 s le manda al CRM (POST /api/trabajador/latido, con la misma
// clave) lo que tiene en las manos y cómo está el PC, para la pestaña "Coordinador en vivo" del Tablero IA.
//
//   - Es solo información: si el CRM no contesta (o es uno viejo que no conoce la ruta), el Coordinador sigue
//     trabajando igual. Nunca lanza ni frena el bucle: el error se anota una vez por cambio.
//   - Nunca hay dos latidos en vuelo: si el anterior no volvió, se salta el turno.
//   - Si el CRM deja de recibirlo más de 2 minutos, el panel dice "Coordinador apagado o sin conexión".
//   - El uso de Claude (porcentaje de sesión y semana, "Pausado por uso", lectura fallida) viaja en `uso`. La respuesta del CRM
//     trae el interruptor y el umbral de la pausa por uso (`pausaPorUso`: { prendida, umbral }): se le pasan al planificador.
//     Un CRM viejo no lo manda: queda el valor de la configuración.
import { leerCarga } from "./recursos.mjs";

export const CADA_SEGUNDOS_DEL_LATIDO = 15;

/**
 * El cuerpo del latido: lo que da el planificador (`estado()`) más la carga del PC. `medidor` da CPU y memoria
 * en %, `carga` (leerCarga) memoria y disco en GB. Todo lo que no se pueda leer va en null.
 */
export function armarLatido({ estado, medidor, carga, nombre = "aizen1" }) {
  let medida = null;
  try {
    medida = medidor?.medir() ?? null;
  } catch {
    medida = null;
  }
  return {
    nombre,
    tareas: estado.tareas,
    carga: {
      cpu: medida?.cpu ?? null,
      memoriaPorciento: medida?.memoria ?? null,
      memoriaUsadaGb: carga?.memoriaUsadaGb ?? null,
      memoriaTotalGb: carga?.memoriaTotalGb ?? null,
      discoLibreGb: carga?.discoLibreGb ?? null,
      discoTotalGb: carga?.discoTotalGb ?? null,
      esperandoPc: estado.esperandoPc === true,
      motivoEspera: estado.motivoEspera ?? null,
    },
    uso: estado.uso,
    esperas: estado.esperas ?? [],
  };
}

/**
 * Arranca el latido. `planificador.estado()` sale de bucle.mjs y `medidor` de recursos.mjs; `leer` (la carga en GB)
 * se puede reemplazar en las pruebas. Devuelve { latirYa, parar }.
 */
export function crearLatido({ crm, config, registro, planificador, medidor, cadaSegundos = CADA_SEGUNDOS_DEL_LATIDO, leer = leerCarga }) {
  let enVuelo = false;
  let ultimoFallo = "";

  async function latirYa() {
    if (enVuelo) return false;
    enVuelo = true;
    try {
      const cuerpo = armarLatido({ estado: planificador.estado(), medidor, carga: leer(config.carpetaTrabajo) });
      const respuesta = await crm.latidoDelCoordinador(cuerpo);
      if (respuesta?.pausaPorUso) planificador.ajustarPausaPorUso?.(respuesta.pausaPorUso);
      if (ultimoFallo) registro.info("el latido al CRM volvió a funcionar");
      ultimoFallo = "";
      return true;
    } catch (error) {
      const mensaje = String(error?.message ?? error);
      if (mensaje !== ultimoFallo) registro.aviso(`latido al CRM: ${mensaje} (el Coordinador sigue trabajando; el panel puede decir que está apagado)`);
      ultimoFallo = mensaje;
      return false;
    } finally {
      enVuelo = false;
    }
  }

  const reloj = setInterval(() => void latirYa(), Math.max(1, cadaSegundos) * 1000);
  reloj.unref?.();
  void latirYa();

  return { latirYa, parar: () => clearInterval(reloj) };
}
