// SIMULACIÓN del aviso "Te paso con una asesora…" (src/lib/reparto-aviso-a-la-clienta.ts).
// Sin base, sin red y SIN ENVIAR NADA: la función de envío y la base están reemplazadas por unas
// que fallan si alguien las llama. Correr: node scripts/simular-aviso-paso-a-asesora.mjs [--detalle]
//
// Recorre cada chat de scripts/fixtures/aviso-paso-a-asesora/*.json (5 chats del 12-nov,
// anonimizados: sin teléfono completo ni nombres) paso por paso, como el webhook: cada mensaje de
// la clienta es un paso, y su `after()` corre cuando el bot terminó de responder (o, si el paso
// cedió la tanda, cuando llegó el mensaje siguiente). Ahí se llama a `debeAvisarPasoAAsesora` con lo
// que había en el chat en ese momento; si avisa, el aviso se agrega al chat y cuenta para después.
import fs from "node:fs";
import path from "node:path";

import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const prohibido = (que) => () => {
  throw new Error(`la simulación no puede usar ${que}`);
};
const baseProhibida = new Proxy({}, { get: (_, campo) => (campo === "then" ? undefined : new Proxy(prohibido(`prisma.${String(campo)}`), { get: prohibido(`prisma.${String(campo)}`) })) });

const modulo = cargar("src/lib/reparto-aviso-a-la-clienta.ts", {
  "@prisma/client": { Prisma: { PrismaClientKnownRequestError: class {} } },
  "@/lib/prisma": { prisma: baseProhibida },
  "@/lib/evolution-envio": {
    sendAndPersistEvolutionFlowStepResilient: prohibido("el envío de WhatsApp"),
    sendAndPersistEvolutionFlowStep: prohibido("el envío de WhatsApp"),
  },
});
const { debeAvisarPasoAAsesora, TEXTO_AVISO_PASO_A_ASESORA } = modulo;

const DETALLE = process.argv.includes("--detalle");
const CARPETA = path.join(RAIZ, "scripts/fixtures/aviso-paso-a-asesora");
const HUMANOS = ["manual", "instance"];
const SILENCIO_QUE_CORTA_MS = 60_000;

const hora = (fecha) =>
  fecha.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const describir = (m) => {
  if (!m) return "fin del chat";
  const quien = m.direccion === "IN" ? "clienta" : m.tipo === "SYSTEM" ? "nota" : HUMANOS.includes(m.origen) ? "asesora" : "bot";
  const que = m.tipo === "IMAGE" ? "foto" : JSON.stringify((m.texto ?? "").slice(0, 40));
  return `${quien} ${que} ${hora(m.en)}`;
};

function simular(chat) {
  const originales = chat.mensajes.map((m) => ({ ...m, en: new Date(m.en) })).sort((a, b) => a.en - b.en);
  const avisos = []; // { en, despuesDe, antesDe }
  const pasos = [];

  // El chat tal como estaba en el instante `hasta` (incluido), con los avisos ya mandados.
  const enEseMomento = (hasta) =>
    [...originales.filter((m) => m.en <= hasta), ...avisos.filter((a) => a.en <= hasta).map((a) => a.mensaje)].sort((a, b) => a.en - b.en);

  for (let i = 0; i < originales.length; i += 1) {
    const paso = originales[i];
    if (paso.direccion !== "IN") continue;
    // Hasta dónde llega la respuesta de este paso: los mensajes del bot y las notas que siguen.
    let fin = i;
    let siguiente = i + 1;
    if (originales[siguiente]?.direccion === "IN") {
      // Cedió la tanda: su after() corre cuando llega el mensaje siguiente de la clienta.
      fin = siguiente;
    } else {
      // La respuesta del bot sale seguida: un mensaje más de 1 minuto después (la nota de una
      // reasignación por demora, un seguimiento) ya no es parte de este paso.
      while (
        siguiente < originales.length &&
        originales[siguiente].direccion === "OUT" &&
        !HUMANOS.includes(originales[siguiente].origen) &&
        originales[siguiente].en - originales[fin].en <= SILENCIO_QUE_CORTA_MS
      ) {
        fin = siguiente;
        siguiente += 1;
      }
    }
    const hasta = originales[fin].en;
    const mensajes = enEseMomento(hasta);
    const notasDeAsignacion = mensajes.filter((m) => m.tipo === "SYSTEM" && m.kind === "assigned");
    const decision = debeAvisarPasoAAsesora({
      asignada: notasDeAsignacion.length > 0,
      lineaDeVentas: true,
      primeraAsignacionEn: notasDeAsignacion[0]?.en ?? null,
      yaSeMando: mensajes.some((m) => m.texto === TEXTO_AVISO_PASO_A_ASESORA),
      mensajes,
      externalIdDeEstePaso: paso.externalId,
    });
    pasos.push(`    paso ${describir(paso)} → ${decision.avisar ? "AVISA" : `no (${decision.motivo})`}`);
    if (decision.avisar) {
      const en = new Date(hasta.getTime() + 1000);
      avisos.push({
        en,
        despuesDe: originales[fin],
        antesDe: originales[fin + 1] ?? null,
        mensaje: { direccion: "OUT", tipo: "TEXT", origen: null, texto: TEXTO_AVISO_PASO_A_ASESORA, en },
      });
    }
  }

  const asignado = originales.some((m) => m.tipo === "SYSTEM" && m.kind === "assigned");
  const veces = avisos.length;
  const donde = avisos.map((a) => `a las ${hora(a.en)}, después de ${describir(a.despuesDe)} y antes de ${describir(a.antesDe)}`).join("; ");
  console.log(
    `${chat.chat} (${chat.telefono}) ${asignado ? "con asesora" : "sin asignación"} — aviso: ${veces === 1 ? "1 vez" : veces}${donde ? ` — ${donde}` : ""}`,
  );
  if (DETALLE) {
    console.log(`  ${chat.descripcion}`);
    for (const linea of pasos) console.log(linea);
  }
  return { asignado, veces };
}

const archivos = fs.readdirSync(CARPETA).filter((f) => f.endsWith(".json")).sort();
let malos = 0;
for (const archivo of archivos) {
  const chat = JSON.parse(fs.readFileSync(path.join(CARPETA, archivo), "utf8"));
  const { asignado, veces } = simular(chat);
  if (veces !== (asignado ? 1 : 0)) malos += 1;
}
console.log(`\n${archivos.length} chats simulados. Ningún mensaje se envió (la base y el envío están bloqueados).`);
if (malos) {
  console.error(`${malos} chat(s) con un número de avisos distinto al esperado (1 con asesora, 0 sin asignación).`);
  process.exit(1);
}
