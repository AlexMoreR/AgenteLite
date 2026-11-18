// TARJETAS SIN LATIDO (18-nov-2026, decisión del dueño). El 18-nov había 17 tarjetas tomadas por el Coordinador (PLANEANDO,
// EN_CURSO, SUBIENDO), algunas desde el 9-nov, sin que ninguna sesión las trabajara: aizen1 estuvo apagado por un corte de luz,
// el Coordinador reiniciado no las soltó (/arranque soltó 0) y las SUBIENDO no vencen solas. Hubo que soltarlas a mano.
//
// El CRM no le da al Coordinador la lista de las tarjetas tomadas con su último latido (/candidatas solo trae las que se pueden
// tomar, /errores las de ERROR; el CRM guarda el candado `trabajoVenceEn`, no la hora del latido). Por eso el Coordinador lleva
// la suya: <carpetaTrabajo>/sin-latido.json, con cada tarjeta que toma y la hora de su último latido que el CRM aceptó.
//
//   1. Una tarjeta que lleva MÁS DE 2 HORAS sin latido y que ninguna sesión viva de este Coordinador trabaja se suelta sola
//      (/soltar, sin ERROR) y vuelve a la fila: un reintento.
//   2. Si en el segundo intento vuelve a quedar más de 2 h sin latido: /error ("sin latido más de 2 h, dos veces") y un
//      WhatsApp al dueño (aviso "necesita" con la tarjeta).
//   3. El contador vive en el archivo (sobrevive al reinicio). Si el archivo se perdió, sale de los intentos que trae /tomar:
//      el /soltar del paso 1 deja un intento con la marca MARCA_SIN_LATIDO en la causa.
//   4. Una tarjeta en las manos de una sesión viva (aizen1 o nube) nunca se toca: el reloj de 2 h corre desde su ÚLTIMO
//      latido, no desde que se tomó (una construcción de 180 min en la nube o una subida con 30 min de vigilancia laten cada minuto).
// Cuando una etapa termina bien, la tarjeta sale del archivo: avanzó, y el contador vuelve a empezar.
//
// Se revisa al arrancar, ANTES de /arranque (así la tarjeta sigue en su etapa y /soltar o /error la encuentran), y después en
// cada vuelta del bucle. Todo lo del sistema (reloj, crm, archivo) entra por parámetros para probarlo sin red.
import fs from "node:fs";
import path from "node:path";

/** Sin latido por más de esto, la tarjeta se suelta (o, la segunda vez, pasa a ERROR). */
export const HORAS_SIN_LATIDO = 2;

/** La marca que deja el /soltar del primer intento en la causa (así el contador sale también de los intentos del CRM). */
export const MARCA_SIN_LATIDO = "sin latido más de 2 h";

/** Lo que se suelta y no se vuelve a tomar se olvida a los 14 días (el archivo no crece para siempre). */
const DIAS_PARA_OLVIDAR = 14;

const HORA = 3_600_000;

export const rutaDeSinLatido = (carpetaTrabajo) => path.join(carpetaTrabajo, "sin-latido.json");

/** El archivo, o null si no existe o no se puede leer. */
export function leerSinLatido(carpetaTrabajo) {
  try {
    const datos = JSON.parse(fs.readFileSync(rutaDeSinLatido(carpetaTrabajo), "utf8").replace(/^﻿/, ""));
    return datos && typeof datos === "object" && datos.tarjetas && typeof datos.tarjetas === "object" ? datos : null;
  } catch {
    return null;
  }
}

function guardarSinLatido(carpetaTrabajo, datos) {
  fs.mkdirSync(carpetaTrabajo, { recursive: true });
  const ruta = rutaDeSinLatido(carpetaTrabajo);
  fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify(datos, null, 2)}\n`);
  fs.renameSync(`${ruta}.tmp`, ruta);
}

/** Cuántas veces ya se soltó por falta de latido en esta etapa, según los intentos que trae /tomar (0 a 1). */
export function vecesEnLosIntentos(tarjeta, hacer) {
  const intentos = Array.isArray(tarjeta?.ultimosIntentos) ? tarjeta.ultimosIntentos : [];
  return intentos.some((intento) => intento?.etapa === hacer && String(intento?.causa ?? "").includes(MARCA_SIN_LATIDO)) ? 1 : 0;
}

/** El motivo de ERROR para el dueño (3 líneas). "Necesita que" hace que el recogedor diario la deje al dueño y no la reintente. */
export function motivoDeDosVeces(entrada) {
  return [
    `${MARCA_SIN_LATIDO}, dos veces: nadie la trabajó al ${entrada.etapa ?? "trabajarla"} (¿aizen1 apagado o sin conexión?).`,
    "El Coordinador ya la soltó sola una vez y volvió a quedar quieta.",
    "Necesita que la revises: pulsa Reintentar cuando aizen1 esté bien.",
  ].join("\n");
}

export function textoDelAvisoDeDosVeces(entrada, horas) {
  return `⚠️ Tablero IA: "${entrada.titulo ?? entrada.id}" quedó en ERROR: lleva ${horas} h sin latido por segunda vez (al ${entrada.etapa ?? "trabajarla"}) y nadie la trabaja. Ya se había soltado sola una vez. Revísala y pulsa Reintentar.`;
}

/**
 * La guardia. `vivas()` -> los ids de las tarjetas que tienen ahora las sesiones de este Coordinador (aizen1 y nube).
 *   tomada(tarjeta, hacer)  al tomar una tarjeta (la anota con la hora y el contador).
 *   latio(id)               cada latido que el CRM aceptó.
 *   termino(id, { ok })     al terminar la etapa: ok la saca; si no, solo deja de estar en las manos.
 *   revisar()               suelta o pasa a ERROR las que llevan más de `horas` sin latido. -> { sueltas, errores }
 *   arranco(sueltas)        tras /arranque: las que el CRM ya soltó y llevaban menos de `horas` se olvidan (un reinicio corto).
 */
export function crearGuardiaSinLatido({ crm, config, registro, vivas = () => [], ahora = () => Date.now(), horas = HORAS_SIN_LATIDO }) {
  const carpeta = config.carpetaTrabajo;
  const limiteMs = horas * HORA;
  const leer = () => leerSinLatido(carpeta);
  const guardar = (datos) => {
    try {
      guardarSinLatido(carpeta, datos);
    } catch (error) {
      registro.aviso(`sin latido: no pude guardar ${rutaDeSinLatido(carpeta)} (${error?.message ?? error})`);
    }
  };
  const cambiar = (fn) => {
    const datos = leer() ?? { tarjetas: {} };
    fn(datos.tarjetas);
    guardar(datos);
  };
  const iso = () => new Date(ahora()).toISOString();
  const sinLatidoMs = (entrada) => ahora() - (Date.parse(entrada.ultimoLatido ?? entrada.tomadaEn ?? "") || ahora());

  return {
    tomada(tarjeta, hacer) {
      // Sin archivo (perdido o primera vez): el contador sale de los intentos del CRM.
      const previo = leer();
      cambiar((tarjetas) => {
        const antes = previo ? tarjetas[tarjeta.id] : null;
        const veces = previo ? (antes?.etapa === hacer ? Number(antes.veces) || 0 : 0) : vecesEnLosIntentos(tarjeta, hacer);
        tarjetas[tarjeta.id] = { titulo: tarjeta.titulo ?? null, etapa: hacer, tomadaEn: iso(), ultimoLatido: iso(), enLasManos: true, veces };
      });
    },
    latio(id) {
      cambiar((tarjetas) => {
        if (tarjetas[id]) tarjetas[id].ultimoLatido = iso();
      });
    },
    termino(id, { ok = false } = {}) {
      cambiar((tarjetas) => {
        const entrada = tarjetas[id];
        if (!entrada) return;
        if (ok || !(Number(entrada.veces) > 0)) delete tarjetas[id];
        else Object.assign(entrada, { enLasManos: false, sueltaEn: iso() });
      });
    },
    arranco(sueltas = []) {
      const soltadas = new Set(sueltas);
      cambiar((tarjetas) => {
        for (const [id, entrada] of Object.entries(tarjetas)) {
          if (!soltadas.has(id) || !entrada.enLasManos || sinLatidoMs(entrada) > limiteMs) continue;
          // Un reinicio corto no cuenta: si ya llevaba un intento sin latido, se conserva hasta que la vuelva a tomar.
          if (Number(entrada.veces) > 0) Object.assign(entrada, { enLasManos: false, sueltaEn: iso() });
          else delete tarjetas[id];
        }
      });
    },
    async revisar() {
      const datos = leer();
      const hechas = { sueltas: [], errores: [] };
      if (!datos) return hechas;
      const enManos = new Set(vivas());
      for (const [id, entrada] of Object.entries(datos.tarjetas)) {
        // Lo soltado que nadie volvió a tomar en DIAS_PARA_OLVIDAR se olvida.
        if (!entrada.enLasManos) {
          if (ahora() - (Date.parse(entrada.sueltaEn ?? "") || 0) > DIAS_PARA_OLVIDAR * 24 * HORA) cambiar((t) => delete t[id]);
          continue;
        }
        // Una sesión viva de este Coordinador la tiene: nunca se toca (su latido corre aparte).
        if (enManos.has(id)) continue;
        const quieta = sinLatidoMs(entrada);
        if (quieta <= limiteMs) continue;
        const llevaHoras = Math.floor(quieta / HORA);
        const etapa = entrada.etapa ?? undefined;
        const nombre = `"${entrada.titulo ?? id}" (${id})`;
        try {
          if (!(Number(entrada.veces) > 0)) {
            await crm.soltar(id, `El Coordinador la soltó sola: ${MARCA_SIN_LATIDO} (lleva ${llevaHoras} h) y nadie la trabaja. Vuelve a la fila (1 de 2).`, {
              categoria: "coordinador_cortado",
              causa: `${MARCA_SIN_LATIDO} y nadie la trabajaba: se suelta y se reintenta una vez (1 de 2).`,
              etapa,
            });
            registro.aviso(`sin latido: ${nombre} llevaba ${llevaHoras} h sin latido al ${etapa}: la solté y vuelve a la fila (1 de 2)`);
            cambiar((t) => Object.assign(t[id] ?? {}, { veces: 1, enLasManos: false, sueltaEn: iso() }));
            hechas.sueltas.push(id);
          } else {
            await crm.error(id, motivoDeDosVeces(entrada), undefined, undefined, {
              categoria: "coordinador_cortado",
              causa: `${MARCA_SIN_LATIDO}, dos veces: se pasa al dueño.`,
              etapa,
            });
            registro.aviso(`sin latido: ${nombre} volvió a quedar ${llevaHoras} h sin latido al ${etapa}: pasa a ERROR y le aviso al dueño`);
            cambiar((t) => delete t[id]);
            hechas.errores.push(id);
            try {
              await crm.aviso(textoDelAvisoDeDosVeces(entrada, llevaHoras), "necesita", id);
            } catch (error) {
              registro.aviso(`sin latido: no salió el WhatsApp al dueño de ${nombre} (${error?.message ?? error}); la tarjeta ya está en ERROR`);
            }
          }
        } catch (error) {
          // 409/404: la tarjeta ya no está en su etapa (el CRM la soltó o la pasó a ERROR, o terminó): no hay nada atascado.
          // Sin red (0) o el CRM caído (5xx): se reintenta en la próxima vuelta.
          if (error?.status === 409 || error?.status === 404) {
            registro.info(`sin latido: ${nombre} ya no está al ${etapa} en el CRM (${error.message}); la olvido`);
            cambiar((t) => delete t[id]);
          } else registro.aviso(`sin latido: no pude soltar ${nombre} (${error?.message ?? error}); lo intento en la próxima vuelta`);
        }
      }
      return hechas;
    },
  };
}
