/**
 * CHANGE GUARDIAN: pruebas de regresión del libro V3 (código puro, sin red y sin IA).
 *
 * Un conjunto de ESCENARIOS DORADOS —lo que escribe la gente de verdad— con lo que se espera y lo
 * que está prohibido. Se corren contra el MISMO motor que atiende a los clientes (`decidir` de
 * agente-v3/motor/decidir.ts) con un libro dado, y se comparan la versión anterior y la candidata.
 *
 * Límite honesto: las reglas de INTENCIÓN las decide la IA en vivo. Aquí no se llama a la IA: un
 * escenario puede decir qué intención reconocería ("intencionesPorNombre") y el reporte lo marca
 * como "depende de la IA". Las reglas de frase, el orden, los pesos y las condiciones sí se prueban
 * exactamente igual que en producción, y fueron ellas las que fallaron el 7-oct-2026.
 */

import { pesoDeLaRegla, type Accion, type LibroDeReglas, type PasoDelEmbudo } from "../../agente-v3/domain/reglas";
import { decidir, siguienteEstado, type EstadoDeLaCharla } from "../../agente-v3/motor/decidir";
import { pidePorMayor } from "../../agente-v3/servicios/mayorista";
import { preguntaLaCiudad } from "./lead";

export type FlujoConocido = { titulo?: string; pasos: number; textos: string[]; fotosOVideos?: number };

export type Escenario = {
  id: string;
  nombre: string;
  /** Si falla, el cambio NO debería salir (aunque ya fallara antes se reporta como crítico). */
  critico: boolean;
  mensaje: string;
  /** Estado de la charla antes del mensaje. Por defecto: primer mensaje, sin producto. */
  estado?: Partial<EstadoDeLaCharla> & { productoActivo?: string | null };
  /** Simula lo que reconocería la IA: nombres (o pedazos) de reglas de intención. */
  intencionesPorNombre?: string[];
  espera?: {
    reglaNombreIncluye?: string[];
    pasoDespues?: PasoDelEmbudo;
    activaProducto?: boolean;
    avisaAsesora?: boolean;
    /** Algún mensaje que sale debe cumplir esta expresión (texto, sin barras). */
    preguntaQueCumpla?: string;
  };
  prohibido?: {
    /** Un flujo (fotos, catálogo) en la respuesta, sin contar el saludo del primer mensaje. */
    flujoEnRespuesta?: boolean;
    /** Fotos o video en la respuesta (según el flujo conocido). */
    fotos?: boolean;
    precio?: boolean;
    /** Expresiones prohibidas en lo que se le manda (texto, sin barras, sin distinguir mayúsculas). */
    textos?: string[];
    maxMensajes?: number;
    preguntarCiudad?: boolean;
  };
  /** Por qué existe este escenario (incidente, auditoría). */
  origen?: string;
};

export type ResultadoDeEscenario = {
  id: string;
  nombre: string;
  critico: boolean;
  pasa: boolean;
  fallas: string[];
  regla: string | null;
  reglaId: string | null;
  acciones: string[];
  mensajesEstimados: number;
  dependeDeLaIa: boolean;
  /** Otras reglas que también encajaban CON EL MISMO PESO (el orden del libro decidió). */
  empatadas: string[];
  textos: string[];
};

const RE_PRECIO = /\$\s?\d|\d{3}[.,]\d{3}/;


function textoDeAcciones(acciones: Accion[], flujos: Record<string, FlujoConocido>): { textos: string[]; mensajes: number; fotos: number } {
  const textos: string[] = [];
  let mensajes = 0;
  let fotos = 0;
  for (const accion of acciones) {
    if (accion.tipo === "mensaje") {
      textos.push(accion.texto);
      mensajes += 1;
    } else if (accion.tipo === "flujo") {
      const flujo = flujos[accion.flujoId];
      mensajes += flujo ? flujo.pasos : 1;
      fotos += flujo?.fotosOVideos ?? 0;
      if (flujo) textos.push(...flujo.textos);
    } else if (accion.tipo === "responder_con_ia") {
      mensajes += 1;
    }
  }
  return { textos, mensajes, fotos };
}

export function evaluarEscenario(libro: LibroDeReglas, escenario: Escenario, flujos: Record<string, FlujoConocido> = {}): ResultadoDeEscenario {
  const estado: EstadoDeLaCharla = {
    productoActivo: null,
    pasoActual: null,
    flujosEnviados: [],
    esPrimerMensaje: true,
    ...escenario.estado,
  } as EstadoDeLaCharla;
  const fallas: string[] = [];

  // Lo mismo que hace el ejecutor ANTES del motor: compra por cantidad la atiende una persona.
  if (pidePorMayor(escenario.mensaje)) {
    // Responde un texto fijo sin precio y avisa a una asesora: solo falla si se esperaba otra regla.
    const esperada = escenario.espera?.reglaNombreIncluye;
    const fallasMayor =
      esperada?.length && !esperada.some((parte) => "compra por cantidad".includes(parte.toLowerCase()))
        ? [`ganó "Compra por cantidad" y se esperaba una regla con "${esperada.join('" o "')}"`]
        : [];
    return {
      id: escenario.id,
      nombre: escenario.nombre,
      critico: escenario.critico,
      pasa: fallasMayor.length === 0,
      fallas: fallasMayor,
      regla: "Compra por cantidad",
      reglaId: null,
      acciones: ["mensaje", "avisar_asesor"],
      mensajesEstimados: 1,
      dependeDeLaIa: false,
      empatadas: [],
      textos: [],
    };
  }

  const nombres = escenario.intencionesPorNombre ?? [];
  const intenciones = libro.reglas
    .filter((r) => r.cuando.tipo === "intencion" && nombres.some((n) => r.nombre.toLowerCase().includes(n.toLowerCase())))
    .map((r) => r.id);
  const decision = decidir({ libro, mensaje: escenario.mensaje, estado, intencionesReconocidas: intenciones });
  const despues = siguienteEstado(estado, [...decision.saludo, ...decision.acciones]);

  const respuesta = textoDeAcciones(decision.acciones, flujos);
  const saludo = textoDeAcciones(decision.saludo, flujos);
  const textos = [...saludo.textos, ...respuesta.textos];
  const mensajesEstimados = saludo.mensajes + respuesta.mensajes;
  const tipos = [...decision.saludo, ...decision.acciones].map((a) => a.tipo);

  const espera = escenario.espera ?? {};
  if (espera.reglaNombreIncluye?.length) {
    const nombre = (decision.regla?.nombre ?? "").toLowerCase();
    if (!espera.reglaNombreIncluye.some((parte) => nombre.includes(parte.toLowerCase()))) {
      fallas.push(`ganó "${decision.regla?.nombre ?? "ninguna"}" y se esperaba una regla con "${espera.reglaNombreIncluye.join('" o "')}"`);
    }
  }
  if (espera.pasoDespues && despues.pasoActual !== espera.pasoDespues) {
    fallas.push(`quedó en el paso ${despues.pasoActual ?? "ninguno"} y se esperaba ${espera.pasoDespues}`);
  }
  if (espera.activaProducto && !despues.productoActivo) fallas.push("no tomó el producto");
  if (espera.avisaAsesora && !tipos.includes("avisar_asesor")) fallas.push("no avisó a una asesora");
  if (espera.preguntaQueCumpla && !textos.some((t) => new RegExp(espera.preguntaQueCumpla as string, "i").test(t))) {
    fallas.push(`no hizo la pregunta esperada (/${espera.preguntaQueCumpla}/)`);
  }

  const prohibido = escenario.prohibido ?? {};
  if (prohibido.flujoEnRespuesta && decision.acciones.some((a) => a.tipo === "flujo")) {
    const flujo = decision.acciones.find((a) => a.tipo === "flujo") as Extract<Accion, { tipo: "flujo" }>;
    fallas.push(`mandó el flujo "${flujo.titulo ?? flujo.flujoId}" (fotos/catálogo) en la respuesta`);
  }
  if (prohibido.fotos && respuesta.fotos > 0) fallas.push(`mandó ${respuesta.fotos} foto(s)/video(s)`);
  if (prohibido.precio && respuesta.textos.some((t) => RE_PRECIO.test(t))) fallas.push("dio precio");
  for (const expresion of prohibido.textos ?? []) {
    const re = new RegExp(expresion, "i");
    const culpable = textos.find((t) => re.test(t.normalize("NFD").replace(/[̀-ͯ]/g, "")) || re.test(t));
    if (culpable) fallas.push(`dice algo prohibido (/${expresion}/): "${culpable.slice(0, 90)}"`);
  }
  if (prohibido.maxMensajes !== undefined && mensajesEstimados > prohibido.maxMensajes) {
    fallas.push(`manda ${mensajesEstimados} mensajes (máximo ${prohibido.maxMensajes})`);
  }
  if (prohibido.preguntarCiudad && respuesta.textos.some(preguntaLaCiudad)) fallas.push("vuelve a preguntar la ciudad");

  const ganadora = decision.regla;
  const empatadas = ganadora
    ? decision.tambienEncajaban
        .map((t) => libro.reglas.find((r) => r.id === t.id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r) && pesoDeLaRegla(r!) === pesoDeLaRegla(ganadora))
        .map((r) => r.nombre)
    : [];

  return {
    id: escenario.id,
    nombre: escenario.nombre,
    critico: escenario.critico,
    pasa: fallas.length === 0,
    fallas,
    regla: decision.regla?.nombre ?? (decision.saludo.length ? "Saludo" : null),
    reglaId: decision.regla?.id ?? null,
    acciones: tipos,
    mensajesEstimados,
    dependeDeLaIa: intenciones.length > 0,
    empatadas,
    textos,
  };
}

export type Veredicto = "PASA" | "PASA_CON_AVISOS" | "FALLA";

export type InformeDelGuardian = {
  veredicto: Veredicto;
  versionAnterior: number | null;
  versionCandidata: number;
  resultados: ResultadoDeEscenario[];
  /** Pasaban con la versión anterior y fallan con la candidata. */
  regresiones: Array<{ id: string; nombre: string; critico: boolean; antes: string | null; ahora: string | null; fallas: string[] }>;
  /** Fallan en las dos (problema conocido, no lo causó este cambio). */
  yaFallaban: Array<{ id: string; nombre: string; critico: boolean; fallas: string[] }>;
  /** Arreglados por la candidata. */
  arreglados: Array<{ id: string; nombre: string }>;
  /** Cambió la regla ganadora (aunque pase). */
  cambiosDeRegla: Array<{ id: string; nombre: string; antes: string | null; ahora: string | null }>;
  resumen: string;
};

/**
 * Corre los escenarios con la versión candidata (y la anterior, si se da) y dice PASA / FALLA.
 *
 * FALLA si hay una REGRESIÓN (algo que pasaba deja de pasar) o, sin versión anterior, si falla un
 * escenario crítico. Lo que ya fallaba antes no frena el cambio: queda como aviso.
 */
export function correrGuardian(input: {
  candidato: LibroDeReglas;
  anterior?: LibroDeReglas | null;
  escenarios: Escenario[];
  flujos?: Record<string, FlujoConocido>;
}): InformeDelGuardian {
  const flujos = input.flujos ?? {};
  const ahora = input.escenarios.map((e) => evaluarEscenario(input.candidato, e, flujos));
  const antes = input.anterior ? input.escenarios.map((e) => evaluarEscenario(input.anterior as LibroDeReglas, e, flujos)) : null;

  const regresiones: InformeDelGuardian["regresiones"] = [];
  const yaFallaban: InformeDelGuardian["yaFallaban"] = [];
  const arreglados: InformeDelGuardian["arreglados"] = [];
  const cambiosDeRegla: InformeDelGuardian["cambiosDeRegla"] = [];
  ahora.forEach((r, i) => {
    const previo = antes?.[i];
    if (previo && previo.regla !== r.regla) cambiosDeRegla.push({ id: r.id, nombre: r.nombre, antes: previo.regla, ahora: r.regla });
    if (!r.pasa && previo?.pasa) regresiones.push({ id: r.id, nombre: r.nombre, critico: r.critico, antes: previo.regla, ahora: r.regla, fallas: r.fallas });
    else if (!r.pasa) yaFallaban.push({ id: r.id, nombre: r.nombre, critico: r.critico, fallas: r.fallas });
    else if (previo && !previo.pasa) arreglados.push({ id: r.id, nombre: r.nombre });
  });

  const criticoSinBase = !antes && ahora.some((r) => !r.pasa && r.critico);
  const veredicto: Veredicto = regresiones.length > 0 || criticoSinBase ? "FALLA" : yaFallaban.length > 0 ? "PASA_CON_AVISOS" : "PASA";
  const pasan = ahora.filter((r) => r.pasa).length;
  const resumen =
    `${veredicto === "FALLA" ? "FALLA" : veredicto === "PASA" ? "PASA" : "PASA con avisos"}: ${pasan}/${ahora.length} escenarios pasan` +
    (regresiones.length ? `; ${regresiones.length} regresión(es): ${regresiones.map((r) => `"${r.nombre}"`).join(", ")}` : "") +
    (yaFallaban.length ? `; ${yaFallaban.length} ya fallaban antes` : "") +
    (arreglados.length ? `; ${arreglados.length} arreglado(s)` : "");

  return {
    veredicto,
    versionAnterior: input.anterior?.version ?? null,
    versionCandidata: input.candidato.version,
    resultados: ahora,
    regresiones,
    yaFallaban,
    arreglados,
    cambiosDeRegla,
    resumen,
  };
}
