import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { buscarEnElCerebro, filasDelCerebro, leerDocumentoDelCerebro } from "@/features/cerebro/services/consultas";
import type { DocumentoLeido, FilaDelCerebro } from "@/features/cerebro/services/consultas";
import { driveDelNegocio } from "@/features/cerebro/services/conexion";
import type { ClienteDeDrive } from "@/features/cerebro/services/drive";
import { escribirConDependencias } from "@/features/cerebro/services/escribir";
import type { DependenciasDeEscritura } from "@/features/cerebro/services/escribir";
import type { PedazoDelCerebro } from "@/features/cerebro/services/reglas";
import {
  ETIQUETA_DE_AGENTE,
  FAMILIA_DE_LA_ALERTA,
  MAXIMO_ARCHIVO_DE_APRENDIZAJES,
  MAXIMO_DOCUMENTOS_LISTADOS,
  MAXIMO_RESULTADOS_DE_BUSQUEDA,
  MAXIMO_TEXTO_DE_DECISIONES,
  MAXIMO_TEXTO_POR_DOCUMENTO_LEIDO,
  ORIGEN_DE_ESCRITURA,
  SEVERIDAD_DE_LA_ALERTA,
  archivoDeAprendizajes,
  bloqueDeAprendizaje,
  carpetaDeAprendizajes,
  carpetasDeLectura,
  claveDeLaAlerta,
  esDocumentoDeDecisiones,
  normalizar,
  problemaDelAprendizaje,
  puedeAnotarEn,
  puedeLeerElArea,
  textoDeLaAlertaDeDatoViejo,
  tituloDeLaAlerta,
  type PedidoDeDatoViejo,
} from "../dominio/cerebro-del-area";
import { hoyEnBogota, type Area } from "../dominio/reglas";

/*
  EL CEREBRO PARA LOS AGENTES DE ÁREA: leer lo suyo, anotar lo que aprenden y marcar datos que chocan.

  Usa lo que el cerebro ya tiene (filasDelCerebro, leerDocumentoDelCerebro, buscarEnElCerebro, driveDelNegocio y
  escribirConDependencias) SIN cambiarlo. Los candados están aquí, en el servidor, no en la buena voluntad del agente:
    - leer: solo las carpetas de su área + Decisiones de Magilus + su carpeta de aprendizajes;
    - escribir: SOLO agregar al final de aprendizajes-AAAA-MM.md en "Aprendizajes de <área>"; nunca crea la carpeta,
      nunca reemplaza ni borra y queda en CerebroCambio con origen AGENTE_<ÁREA>;
    - dato viejo: solo crea o suma una alerta del Supervisor; no cambia ningún dato.
  Si el cerebro no está conectado, lo dice y el agente sigue como siempre.
*/

export const AVISO_NO_CONECTADO =
  "El cerebro no está conectado todavía (Mi empresa → Cerebro). Sigue con tu trabajo de siempre y di en tu resumen que no pudiste consultarlo; no inventes lo que diría el cerebro.";

/* ── Lo que se necesita de afuera (se cambia por falsos en las pruebas) ── */

export type DependenciasDeLectura = {
  /** ¿Hay una carpeta del cerebro elegida? */
  conectado(workspaceId: string): Promise<boolean>;
  filas(workspaceId: string): Promise<FilaDelCerebro[]>;
  leer(workspaceId: string, driveId: string, enVivo: boolean): Promise<DocumentoLeido>;
  buscar(workspaceId: string, consulta: string, maximo: number): Promise<PedazoDelCerebro[]>;
};

export type DependenciasDeAnotar = {
  conectado(workspaceId: string): Promise<boolean>;
  filas(workspaceId: string): Promise<FilaDelCerebro[]>;
  drive(workspaceId: string): Promise<{ drive: ClienteDeDrive; carpetaRaizId: string }>;
  puertos(datos: { workspaceId: string; userId: string; area: Area; carpetaRaizId: string; drive: ClienteDeDrive }): DependenciasDeEscritura;
  hoy(): string;
};

export type FilaDeAlerta = { id: string; vecesVista: number };

export type DependenciasDeDatoViejo = {
  buscarAbierta(claveAbierta: string): Promise<FilaDeAlerta | null>;
  crear(datos: {
    workspaceId: string;
    clave: string;
    claveAbierta: string;
    familia: string;
    severidad: string;
    titulo: string;
    texto: string;
    ahora: Date;
  }): Promise<FilaDeAlerta>;
  sumarVista(id: string, datos: { texto: string; ahora: Date; vecesVista: number }): Promise<void>;
  ahora(): Date;
};

/* ── Leer ── */

export type PedidoDeLectura = { area: Area; busqueda?: string; documentoId?: string; desdeDrive?: boolean };

const sinDecisiones = (fila: FilaDelCerebro) => !esDocumentoDeDecisiones(fila.ruta);

export async function leerCerebroDelArea(workspaceId: string, pedido: PedidoDeLectura, deps: DependenciasDeLectura = dependenciasDeLectura) {
  const { area } = pedido;
  if (!(await deps.conectado(workspaceId))) return { conectado: false, area, aviso: AVISO_NO_CONECTADO };

  const propias = (await deps.filas(workspaceId)).filter((fila) => fila.enDrive && !fila.esCarpeta && fila.legible && puedeLeerElArea(area, fila.ruta));
  const carpetas = carpetasDeLectura(area);

  if (pedido.documentoId) {
    const fila = propias.find((candidata) => candidata.driveId === pedido.documentoId);
    if (!fila) {
      throw new Error(
        `Ese documento no es de las carpetas que lee el ${ETIQUETA_DE_AGENTE[area]} (${carpetas.join(", ")}) o no se puede leer. Pide la lista con cerebro_del_area sin documento_id.`,
      );
    }
    const documento = await deps.leer(workspaceId, fila.driveId, pedido.desdeDrive === true);
    const texto = documento.texto ?? "";
    return {
      conectado: true,
      area,
      documento: {
        id: documento.driveId,
        ruta: documento.ruta,
        link: documento.linkDrive,
        modificado_en_drive: documento.modificadoEnDrive,
        leido_de: documento.leidoDe,
        texto: texto.slice(0, MAXIMO_TEXTO_POR_DOCUMENTO_LEIDO),
        texto_recortado: texto.length > MAXIMO_TEXTO_POR_DOCUMENTO_LEIDO || documento.textoTruncado,
        ...(documento.explicacion ? { explicacion: documento.explicacion } : {}),
      },
      recordatorio: "Cita este documento (su ruta) en tu recomendación.",
    };
  }

  const busqueda = pedido.busqueda?.trim();
  if (busqueda) {
    const permitidas = new Set(propias.map((fila) => fila.driveId));
    const pedazos = (await deps.buscar(workspaceId, busqueda, 40)).filter((pedazo) => permitidas.has(pedazo.driveId));
    return {
      conectado: true,
      area,
      busqueda,
      carpetas_que_lee: carpetas,
      resultados: pedazos.slice(0, MAXIMO_RESULTADOS_DE_BUSQUEDA).map((pedazo) => ({ id: pedazo.driveId, ruta: pedazo.ruta, fragmento: pedazo.fragmento })),
      ...(pedazos.length ? {} : { aviso: "No hay nada sobre eso en tus carpetas del cerebro. No inventes: di que el cerebro no lo tiene." }),
      recordatorio: "Cita el documento (su ruta) en tu recomendación. Para leerlo completo usa documento_id.",
    };
  }

  // Sin pedido: la lista de lo suyo y, siempre, lo que ya está decidido (todos lo leen antes de recomendar).
  let restante = MAXIMO_TEXTO_DE_DECISIONES;
  const decisiones: Array<{ id: string; ruta: string; link: string | null; texto: string; texto_recortado: boolean }> = [];
  for (const fila of propias.filter((candidata) => !sinDecisiones(candidata))) {
    if (restante <= 0) break;
    const documento = await deps.leer(workspaceId, fila.driveId, false);
    const texto = documento.texto ?? "";
    decisiones.push({
      id: fila.driveId,
      ruta: fila.ruta,
      link: fila.linkDrive,
      texto: texto.slice(0, restante),
      texto_recortado: texto.length > restante || documento.textoTruncado,
    });
    restante -= texto.length;
  }
  const lista = propias.filter(sinDecisiones);
  return {
    conectado: true,
    area,
    carpetas_que_lee: carpetas,
    decisiones,
    ...(decisiones.length ? {} : { aviso_decisiones: `No hay documentos en "Decisiones de Magilus" (o no se pueden leer todavía).` }),
    documentos: lista.slice(0, MAXIMO_DOCUMENTOS_LISTADOS).map((fila) => ({ id: fila.driveId, ruta: fila.ruta, modificado_en_drive: fila.modificadoEnDrive })),
    ...(lista.length > MAXIMO_DOCUMENTOS_LISTADOS ? { aviso: `Hay ${lista.length} documentos; se muestran ${MAXIMO_DOCUMENTOS_LISTADOS}. Usa busqueda para afinar.` } : {}),
    recordatorio: "Cita el documento (su ruta) en cada recomendación y no contradigas las decisiones. Para leer uno completo usa documento_id.",
  };
}

/* ── Anotar un aprendizaje ── */

export type ResultadoDeAnotar =
  | { anotado: true; area: Area; archivo: string; ruta: string; accion: "crear" | "agregar"; link: string | null }
  | { anotado: false; area: Area; conectado: boolean; aviso: string };

export async function anotarAprendizaje(
  datos: { workspaceId: string; userId: string; area: Area; texto: unknown },
  deps: DependenciasDeAnotar = dependenciasDeAnotar,
): Promise<ResultadoDeAnotar> {
  const { workspaceId, userId, area } = datos;
  const problema = problemaDelAprendizaje(datos.texto);
  if (problema) throw new Error(problema);
  const texto = datos.texto as string;
  const rechazo = (aviso: string): ResultadoDeAnotar => ({ anotado: false, area, conectado: true, aviso });

  if (!(await deps.conectado(workspaceId))) return { anotado: false, area, conectado: false, aviso: AVISO_NO_CONECTADO };

  const filas = (await deps.filas(workspaceId)).filter((fila) => fila.enDrive);
  const nombreCarpeta = carpetaDeAprendizajes(area);
  const carpeta = filas.find((fila) => fila.esCarpeta && !fila.ruta.includes("/") && normalizar(fila.nombre) === normalizar(nombreCarpeta));
  if (!carpeta) {
    return rechazo(`No existe la carpeta "${nombreCarpeta}" en el cerebro. No se creó nada: el dueño tiene que crearla en el Drive (dentro de la carpeta del cerebro) y esperar la sincronización.`);
  }

  const hoy = deps.hoy();
  const archivo = archivoDeAprendizajes(hoy);
  const existente = filas.find((fila) => !fila.esCarpeta && fila.padreId === carpeta.driveId && fila.nombre.toLowerCase() === archivo);
  const rutaFinal = existente?.ruta ?? `${carpeta.ruta}/${archivo}`;
  // El último candado: pase lo que pase arriba, solo se escribe en aprendizajes-AAAA-MM.md de SU carpeta.
  if (!puedeAnotarEn(area, rutaFinal)) return rechazo(`Un agente solo puede anotar en "${nombreCarpeta}/aprendizajes-AAAA-MM.md". No se escribió nada.`);
  if (existente && !existente.escribible) {
    return rechazo(`"${existente.ruta}" no es un texto .md que se pueda ampliar (¿es un Google Doc?). No se escribió nada: el dueño debe dejarlo como .md o borrarlo.`);
  }

  let conexion: { drive: ClienteDeDrive; carpetaRaizId: string };
  try {
    conexion = await deps.drive(workspaceId);
  } catch (fallo) {
    return { anotado: false, area, conectado: false, aviso: `${AVISO_NO_CONECTADO} (${fallo instanceof Error ? fallo.message : "sin acceso al Drive"})` };
  }
  const puertos = deps.puertos({ workspaceId, userId, area, carpetaRaizId: conexion.carpetaRaizId, drive: conexion.drive });
  const bloque = bloqueDeAprendizaje({ fecha: hoy, area, texto });

  if (existente) {
    const [actual, enDrive] = await Promise.all([
      conexion.drive.leerTexto(existente.driveId, existente.nombre, existente.tipo),
      conexion.drive.metadatos(existente.driveId),
    ]);
    if ((actual ?? "").length + bloque.length > MAXIMO_ARCHIVO_DE_APRENDIZAJES) {
      return rechazo(`El archivo "${existente.ruta}" ya llegó al tope de tamaño (${MAXIMO_ARCHIVO_DE_APRENDIZAJES} letras). No se escribió nada; avisa al dueño.`);
    }
    const resultado = await escribirConDependencias(
      { workspaceId, userId, origen: "MCP", modo: "agregar", driveId: existente.driveId, contenido: bloque, versionLeida: enDrive.versionDrive },
      puertos,
    );
    return { anotado: true, area, archivo: resultado.nombre, ruta: resultado.ruta, accion: "agregar", link: resultado.linkDrive };
  }

  const titulo = `# Aprendizajes de ${ETIQUETA_DE_AGENTE[area].replace("Agente de ", "")} — ${hoy.slice(0, 7)}`;
  const resultado = await escribirConDependencias(
    { workspaceId, userId, origen: "MCP", modo: "crear", carpetaId: carpeta.driveId, nombre: archivo, contenido: `${titulo}\n\n${bloque}` },
    puertos,
  );
  return { anotado: true, area, archivo: resultado.nombre, ruta: resultado.ruta, accion: "crear", link: resultado.linkDrive };
}

/* ── Marcar un dato que choca ── */

export async function marcarDatoViejo(
  workspaceId: string,
  pedido: PedidoDeDatoViejo,
  deps: DependenciasDeDatoViejo = dependenciasDeDatoViejo,
) {
  const ahora = deps.ahora();
  const fecha = hoyEnBogota(ahora);
  const clave = claveDeLaAlerta(pedido.documento, pedido.dato);
  const claveAbierta = `${workspaceId}:${clave}`;
  const sumar = async (abierta: FilaDeAlerta) => {
    const veces = abierta.vecesVista + 1;
    await deps.sumarVista(abierta.id, { texto: textoDeLaAlertaDeDatoViejo({ pedido, fecha, veces }), ahora, vecesVista: veces });
    return { marcada: true, nueva: false, vecesVista: veces, alerta_id: abierta.id };
  };
  const abierta = await deps.buscarAbierta(claveAbierta);
  if (abierta) return { ...(await sumar(abierta)), ...NADA_CAMBIO };
  let creada: FilaDeAlerta;
  try {
    creada = await deps.crear({
      workspaceId,
      clave,
      claveAbierta,
      familia: FAMILIA_DE_LA_ALERTA,
      severidad: SEVERIDAD_DE_LA_ALERTA,
      titulo: tituloDeLaAlerta(pedido),
      texto: textoDeLaAlertaDeDatoViejo({ pedido, fecha, veces: 1 }),
      ahora,
    });
  } catch (fallo) {
    // Dos agentes marcaron lo mismo a la vez: gana la que ya quedó abierta.
    const ya = await deps.buscarAbierta(claveAbierta);
    if (!ya) throw fallo;
    return { ...(await sumar(ya)), ...NADA_CAMBIO };
  }
  return { marcada: true, nueva: true, vecesVista: 1, alerta_id: creada.id, ...NADA_CAMBIO };
}

const NADA_CAMBIO = {
  nivel: "Observación (sin push ni WhatsApp: sale en la página del Supervisor y en el resumen)",
  nota: "No se cambió ningún dato, ni en el cerebro ni en el CRM ni en Gestión. El dueño decide cuál está al día.",
};

/* ── Las dependencias de verdad ── */

async function carpetaElegida(workspaceId: string) {
  const conexion = await prisma.cerebroConexion.findUnique({ where: { workspaceId }, select: { carpetaId: true } });
  return conexion?.carpetaId ?? null;
}

const dependenciasDeLectura: DependenciasDeLectura = {
  conectado: async (workspaceId) => Boolean(await carpetaElegida(workspaceId)),
  filas: filasDelCerebro,
  leer: leerDocumentoDelCerebro,
  buscar: buscarEnElCerebro,
};

/** Las mismas piezas que usa escribirEnElCerebro, pero el registro lleva el origen del agente (AGENTE_VENTAS...). */
function puertosDeEscritura(datos: { workspaceId: string; userId: string; area: Area; carpetaRaizId: string; drive: ClienteDeDrive }): DependenciasDeEscritura {
  const { workspaceId } = datos;
  return {
    drive: datos.drive,
    carpetaRaizId: datos.carpetaRaizId,
    copiaDe: (driveId) =>
      prisma.cerebroDocumento.findUnique({
        where: { workspaceId_driveId: { workspaceId, driveId } },
        select: { driveId: true, nombre: true, ruta: true, tipo: true, esCarpeta: true, enDrive: true, versionDrive: true },
      }),
    hermanoConNombre: async (carpetaId, nombre) =>
      Boolean(
        await prisma.cerebroDocumento.findFirst({
          where: { workspaceId, padreId: carpetaId, enDrive: true, nombre: { equals: nombre, mode: "insensitive" } },
          select: { id: true },
        }),
      ),
    carpetaDelCerebro: (carpetaId) =>
      prisma.cerebroDocumento.findFirst({ where: { workspaceId, driveId: carpetaId, esCarpeta: true, enDrive: true }, select: { ruta: true } }),
    guardarCopia: async (copia) => {
      const ficha = {
        padreId: copia.padreId,
        nombre: copia.nombre,
        ruta: copia.ruta,
        tipo: copia.tipo,
        esCarpeta: false,
        texto: copia.texto,
        textoTruncado: false,
        versionDrive: copia.versionDrive,
        modificadoEnDrive: copia.modificadoEnDrive ? new Date(copia.modificadoEnDrive) : null,
        linkDrive: copia.linkDrive,
        enDrive: true,
        sincronizadoEn: new Date(),
      };
      await prisma.cerebroDocumento.upsert({
        where: { workspaceId_driveId: { workspaceId, driveId: copia.driveId } },
        create: { workspaceId, driveId: copia.driveId, ...ficha },
        update: ficha,
      });
    },
    registrar: async (cambio) => {
      try {
        await prisma.cerebroCambio.create({
          data: {
            workspaceId,
            userId: datos.userId,
            quienNombre: ETIQUETA_DE_AGENTE[datos.area],
            origen: ORIGEN_DE_ESCRITURA[datos.area],
            driveId: cambio.driveId,
            nombreDocumento: cambio.nombreDocumento,
            accion: cambio.accion,
            antes: cambio.antes,
            despues: cambio.despues,
          },
        });
      } catch (fallo) {
        throw new Error(`Se escribió en el Drive, pero NO quedó el registro (${fallo instanceof Error ? fallo.message : "error"}). Avísale al dueño.`);
      }
    },
  };
}

const dependenciasDeAnotar: DependenciasDeAnotar = {
  conectado: async (workspaceId) => Boolean(await carpetaElegida(workspaceId)),
  filas: filasDelCerebro,
  drive: async (workspaceId) => {
    const { drive, conexion } = await driveDelNegocio(workspaceId);
    if (!conexion.carpetaId) throw new Error("Falta elegir la carpeta del cerebro en Mi empresa → Cerebro.");
    return { drive, carpetaRaizId: conexion.carpetaId };
  },
  puertos: puertosDeEscritura,
  hoy: () => hoyEnBogota(),
};

const dependenciasDeDatoViejo: DependenciasDeDatoViejo = {
  buscarAbierta: (claveAbierta) => prisma.supervisorAlerta.findUnique({ where: { claveAbierta }, select: { id: true, vecesVista: true } }),
  crear: async (datos) =>
    prisma.supervisorAlerta.create({
      data: {
        workspaceId: datos.workspaceId,
        clave: datos.clave,
        claveAbierta: datos.claveAbierta,
        familia: datos.familia,
        severidad: datos.severidad,
        estado: "ABIERTA",
        titulo: datos.titulo,
        producto: null,
        desde: datos.ahora,
        primeraVezEn: datos.ahora,
        ultimaVezEn: datos.ahora,
        vecesVista: 1,
        hallazgos: [] as Prisma.InputJsonValue,
        texto: datos.texto,
      },
      select: { id: true, vecesVista: true },
    }),
  sumarVista: async (id, datos) => {
    await prisma.supervisorAlerta.update({ where: { id }, data: { ultimaVezEn: datos.ahora, vecesVista: datos.vecesVista, texto: datos.texto } });
  },
  ahora: () => new Date(),
};
