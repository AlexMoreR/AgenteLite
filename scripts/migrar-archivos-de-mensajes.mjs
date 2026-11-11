#!/usr/bin/env node
/**
 * Saca el base64 de los mensajes VIEJOS (Message.rawPayload) a archivos, llamando por tandas a la ruta
 * interna POST /api/interno/archivos-de-mensajes (la que hace el trabajo adentro de la app).
 *
 * Se corre A MANO, en primer plano, desde aizen1 o el servidor, y termina solo. No es un vigilante.
 * Por defecto SIMULA (no escribe nada). Ver el plan P6 y docs/cambios-pendientes/opt-p6.md.
 *
 *   MIGRACION_SECRETO=... node scripts/migrar-archivos-de-mensajes.mjs --url=https://app.aizenbot.com
 *   MIGRACION_SECRETO=... node scripts/migrar-archivos-de-mensajes.mjs --url=... --de-verdad --tanda=20 --hasta=17:30
 *
 * Opciones:
 *   --simular | --dry-run     (por defecto) solo cuenta
 *   --de-verdad               migra
 *   --url=<base de la app>    por defecto http://127.0.0.1:3000
 *   --tanda=20                mensajes por llamada (la ruta pone el tope en 50)
 *   --pausa=5                 segundos entre tandas
 *   --mb-por-minuto=60        tope de MB pasados a archivo por minuto
 *   --mensajes-por-minuto=120 tope de mensajes por minuto
 *   --hasta=17:30             hora local en que deja de pedir tandas
 *   --desde=<id>              empezar despues de ese id (si no, la ruta sigue desde su progreso)
 *   --maximo-de-tandas=N      cortar despues de N tandas
 *   --espera-por-carga=60     segundos que espera si la app dice que esta cargada (a la 3.a seguida, termina)
 *   --tope-por-tanda=20       si una tanda tarda mas que esto (s), termina
 * El secreto sale de MIGRACION_SECRETO (o DAILY_REPORT_CRON_SECRET); es el mismo del reloj.
 */

function leerOpciones(argv) {
  const opciones = {
    simulacion: true,
    url: "http://127.0.0.1:3000",
    tanda: 20,
    pausa: 5,
    mbPorMinuto: 60,
    mensajesPorMinuto: 120,
    hasta: null,
    desde: null,
    maximoDeTandas: Infinity,
    esperaPorCarga: 60,
    topePorTanda: 20,
    // Largo de la "ventana" de los topes por minuto, en segundos. Solo lo cambian las pruebas.
    ventana: 60,
  };
  for (const arg of argv) {
    const [clave, valor = ""] = arg.replace(/^--/, "").split(/=(.*)/s);
    if (clave === "simular" || clave === "dry-run") opciones.simulacion = true;
    else if (clave === "de-verdad") opciones.simulacion = false;
    else if (clave === "url") opciones.url = valor.replace(/\/+$/, "");
    else if (clave === "tanda") opciones.tanda = Number(valor);
    else if (clave === "pausa") opciones.pausa = Number(valor);
    else if (clave === "mb-por-minuto") opciones.mbPorMinuto = Number(valor);
    else if (clave === "mensajes-por-minuto") opciones.mensajesPorMinuto = Number(valor);
    else if (clave === "hasta") opciones.hasta = valor;
    else if (clave === "desde") opciones.desde = valor;
    else if (clave === "maximo-de-tandas") opciones.maximoDeTandas = Number(valor);
    else if (clave === "espera-por-carga") opciones.esperaPorCarga = Number(valor);
    else if (clave === "tope-por-tanda") opciones.topePorTanda = Number(valor);
    else if (clave === "ventana") opciones.ventana = Number(valor);
    else throw new Error(`opcion desconocida: ${arg}`);
  }
  if (opciones.hasta && !/^\d{1,2}:\d{2}$/.test(opciones.hasta)) throw new Error("--hasta va como HH:MM");
  return opciones;
}

const dormir = (segundos) => new Promise((resolve) => setTimeout(resolve, Math.max(0, segundos) * 1000));

function pasoLaHora(hasta) {
  if (!hasta) return false;
  const [h, m] = hasta.split(":").map(Number);
  const ahora = new Date();
  return ahora.getHours() * 60 + ahora.getMinutes() >= h * 60 + m;
}

async function main() {
  const opciones = leerOpciones(process.argv.slice(2));
  const secreto = (process.env.MIGRACION_SECRETO || process.env.DAILY_REPORT_CRON_SECRET || "").trim();
  if (!secreto) {
    console.error("Falta MIGRACION_SECRETO (o DAILY_REPORT_CRON_SECRET).");
    process.exit(2);
  }

  const totales = { tandas: 0, procesados: 0, migrados: 0, mbAArchivo: 0, mbNuevosEnDisco: 0, mbLiberadosEnBase: 0 };
  const saltados = [];
  const casos = {};
  /** Lo hecho en el ultimo minuto, para los topes: [{ en, mensajes, mb }] */
  const ventana = [];
  let desdeId = opciones.desde;
  let cargasSeguidas = 0;
  let motivoDelFinal = "terminado: no quedan mensajes";
  let codigo = 0;

  console.log(
    `${opciones.simulacion ? "SIMULACION (no escribe nada)" : "MIGRACION DE VERDAD"} contra ${opciones.url} · tanda ${opciones.tanda} · pausa ${opciones.pausa}s`,
  );

  while (true) {
    if (totales.tandas >= opciones.maximoDeTandas) {
      motivoDelFinal = `se llego al maximo de ${opciones.maximoDeTandas} tandas`;
      break;
    }
    if (pasoLaHora(opciones.hasta)) {
      motivoDelFinal = `son las ${opciones.hasta} o mas`;
      break;
    }

    // Topes por minuto.
    const largoDeLaVentana = opciones.ventana * 1000;
    while (true) {
      const haceUnMinuto = Date.now() - largoDeLaVentana;
      while (ventana.length && ventana[0].en <= haceUnMinuto) ventana.shift();
      const mensajes = ventana.reduce((s, v) => s + v.mensajes, 0);
      const mb = ventana.reduce((s, v) => s + v.mb, 0);
      if (mensajes < opciones.mensajesPorMinuto && mb < opciones.mbPorMinuto) break;
      await dormir(Math.max(0.05, (ventana[0].en + largoDeLaVentana - Date.now()) / 1000));
    }

    const inicio = Date.now();
    let respuesta;
    try {
      const pedido = await fetch(`${opciones.url}/api/interno/archivos-de-mensajes`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secreto}` },
        body: JSON.stringify({ simulacion: opciones.simulacion, tanda: opciones.tanda, ...(desdeId ? { desdeId } : {}) }),
        signal: AbortSignal.timeout((opciones.topePorTanda + 10) * 1000),
      });
      respuesta = await pedido.json().catch(() => null);
      if (!pedido.ok || !respuesta?.ok) {
        motivoDelFinal = `la ruta respondio ${pedido.status}: ${respuesta?.error ?? "sin detalle"}`;
        codigo = 1;
        break;
      }
    } catch (error) {
      motivoDelFinal = `no se pudo llamar a la ruta: ${error instanceof Error ? error.message : String(error)}`;
      codigo = 1;
      break;
    }
    const segundos = (Date.now() - inicio) / 1000;

    if (respuesta.parado) {
      cargasSeguidas += 1;
      console.log(`· parado (${respuesta.parado}) ${cargasSeguidas}/3`);
      if (cargasSeguidas >= 3) {
        motivoDelFinal = `la app siguio cargada 3 veces seguidas (${respuesta.parado})`;
        break;
      }
      await dormir(opciones.esperaPorCarga);
      continue;
    }
    cargasSeguidas = 0;

    totales.tandas += 1;
    totales.procesados += respuesta.procesados ?? 0;
    totales.migrados += respuesta.migrados ?? 0;
    totales.mbAArchivo += respuesta.mbAArchivo ?? 0;
    totales.mbNuevosEnDisco += respuesta.mbNuevosEnDisco ?? 0;
    totales.mbLiberadosEnBase += respuesta.mbLiberadosEnBase ?? 0;
    saltados.push(...(respuesta.saltados ?? []));
    for (const [caso, n] of Object.entries(respuesta.casosDeMediaUrl ?? {})) casos[caso] = (casos[caso] ?? 0) + n;
    ventana.push({ en: Date.now(), mensajes: respuesta.procesados ?? 0, mb: respuesta.mbAArchivo ?? 0 });
    if (respuesta.ultimoId) desdeId = respuesta.ultimoId;

    console.log(
      `tanda ${totales.tandas}: ${respuesta.procesados} vistos, ${respuesta.migrados} migrados, ${respuesta.saltados?.length ?? 0} saltados, ` +
        `${respuesta.mbAArchivo} MB a archivo, ${respuesta.mbLiberadosEnBase} MB liberados, ${segundos.toFixed(1)}s · ultimo ${respuesta.ultimoId ?? "-"}`,
    );

    if (segundos > opciones.topePorTanda) {
      motivoDelFinal = `una tanda tardo ${segundos.toFixed(1)}s (tope ${opciones.topePorTanda}s)`;
      break;
    }
    if (respuesta.terminado) {
      motivoDelFinal = "terminado: no quedan mensajes";
      break;
    }
    await dormir(opciones.pausa);
  }

  const porMotivo = {};
  for (const s of saltados) {
    const motivo = String(s.motivo).replace(/\/uploads\/\S+/g, "<archivo>");
    porMotivo[motivo] = (porMotivo[motivo] ?? 0) + 1;
  }
  const redondear = (n) => Math.round(n * 100) / 100;
  console.log("");
  console.log(`=== REPORTE (${opciones.simulacion ? "simulacion" : "de verdad"}) ===`);
  console.log(`Fin: ${motivoDelFinal}`);
  console.log(`Tandas: ${totales.tandas} · mensajes vistos: ${totales.procesados} · ${opciones.simulacion ? "migrables" : "migrados"}: ${totales.migrados}`);
  console.log(`MB pasados a archivos: ${redondear(totales.mbAArchivo)} · MB nuevos en disco (sin repetidos): ${redondear(totales.mbNuevosEnDisco)} · MB liberados de la base: ${redondear(totales.mbLiberadosEnBase)}`);
  console.log(`mediaUrl: ${JSON.stringify(casos)}`);
  console.log(`Saltados: ${saltados.length}`);
  for (const [motivo, n] of Object.entries(porMotivo)) console.log(`  ${n} × ${motivo}`);
  if (saltados.length) console.log(`  primeros ids: ${saltados.slice(0, 10).map((s) => s.id).join(", ")}`);
  console.log(`Ultimo id: ${desdeId ?? "-"}`);
  process.exit(codigo);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
