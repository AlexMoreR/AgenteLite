import { z } from "zod";

import { pesos } from "@/lib/contraentrega";
import { llaveDelHeader } from "@/lib/origen-de-venta";
import {
  CUERPO_DEMASIADO_GRANDE,
  bytesDeBase64,
  leerMarcaDeEnvio,
  limpiarBase64,
  marcaFrenaElEnvio,
  taparNumeros,
  telefonoParaWhatsApp,
  telefonoTapado,
  type MarcaDeEnvio,
} from "@/lib/recibo-de-caja";

/**
 * AVISO DE PAGO A PROVEEDORA POR WHATSAPP (parte del CRM de «Pago a proveedora: avisarle por WhatsApp
 * con el comprobante», pedido del dueño del 2-nov-2026).
 *
 * Gestión registra un pago a una proveedora en su orden de fabricación y, cuando se sube el comprobante,
 * lo entrega aquí (POST /api/gestion/pago-proveedora). El CRM se lo manda a la proveedora por la línea
 * Admin con el comprobante adjunto (foto o PDF).
 *
 * Mismo molde que el recibo de caja (`recibo-de-caja.ts`), con su propio modo y sus propias marcas: de
 * allá solo se usan piezas puras (base64, teléfonos, la marca de envío), sin cambiarlas.
 *
 * Nace APAGADO. En PRUEBA le llega solo al teléfono de prueba (el del dueño, guardado en AppSetting,
 * nunca escrito en el código). Para ACTIVO alguien tiene que guardar el modo a mano.
 *
 * La proveedora NO ve datos del cliente (regla de operación): el esquema no tiene ningún campo de la
 * clienta y lo que llegue de más se descarta (zod quita las claves que no conoce).
 *
 * Este archivo es lógica pura (sin red ni base): la prueba es `npm run test:pago-a-proveedora`. El envío
 * de verdad (base, WhatsApp, alertas) vive en `pago-a-proveedora-envio.ts` y se le pasa aquí como funciones.
 */

/* ───────────── Los datos que manda Gestión ───────────── */

/** Tope del comprobante (decisión del plan: 10 MB). */
export const COMPROBANTE_MAXIMO_BYTES = 10 * 1024 * 1024;

/** Tope del cuerpo entero: el archivo en base64 pesa ~4/3, más los datos. */
export const CUERPO_MAXIMO_BYTES = Math.ceil((COMPROBANTE_MAXIMO_BYTES * 4) / 3) + 64 * 1024;

/** Los tipos de comprobante que se aceptan, reconocidos por sus primeros bytes (no por lo que diga el nombre). */
export type TipoDeComprobante = "PDF" | "JPG" | "PNG" | "WEBP";

const MIME_DEL_TIPO: Record<TipoDeComprobante, string> = {
  PDF: "application/pdf",
  JPG: "image/jpeg",
  PNG: "image/png",
  WEBP: "image/webp",
};

const EXTENSION_DEL_TIPO: Record<TipoDeComprobante, string> = { PDF: ".pdf", JPG: ".jpg", PNG: ".png", WEBP: ".webp" };

/** Mira los primeros bytes del archivo: %PDF, JPEG (FF D8 FF), PNG (89 50 4E 47) o RIFF....WEBP. Otro → null. */
export function tipoDeComprobante(base64: string): TipoDeComprobante | null {
  const cabeza = Buffer.from(base64.slice(0, 24), "base64");
  if (cabeza.subarray(0, 4).toString("latin1") === "%PDF") return "PDF";
  if (cabeza[0] === 0xff && cabeza[1] === 0xd8 && cabeza[2] === 0xff) return "JPG";
  if (cabeza[0] === 0x89 && cabeza.subarray(1, 4).toString("latin1") === "PNG") return "PNG";
  if (cabeza.subarray(0, 4).toString("latin1") === "RIFF" && cabeza.subarray(8, 12).toString("latin1") === "WEBP") return "WEBP";
  return null;
}

/** Cómo sale por WhatsApp: el PDF como documento, la foto como imagen (y así queda en el chat). */
export function comoSeManda(tipo: TipoDeComprobante): { mediatype: "document" | "image"; mimetype: string; tipoMensaje: "DOCUMENT" | "IMAGE" } {
  return tipo === "PDF"
    ? { mediatype: "document", mimetype: MIME_DEL_TIPO.PDF, tipoMensaje: "DOCUMENT" }
    : { mediatype: "image", mimetype: MIME_DEL_TIPO[tipo], tipoMensaje: "IMAGE" };
}

/** Acepta 500000 o "500000" (Gestión puede mandar los montos como texto). Sin centavos. */
const monto = z.preprocess(
  (valor) => (typeof valor === "string" && /^\s*\d+(\.\d+)?\s*$/.test(valor) ? Number(valor) : valor),
  z.number({ error: "El monto debe ser un número" }).finite().min(0, { error: "El monto no puede ser negativo" }),
);

const textoCorto = (maximo: number, mensaje: string) => z.string({ error: mensaje }).trim().min(1, { error: mensaje }).max(maximo);

/** Un nombre de archivo seguro: sin carpetas ni caracteres raros y con la extensión de su tipo de verdad. */
export function nombreDeArchivoSeguro(valor: string | null | undefined, ofCodigo: string, tipo: TipoDeComprobante): string {
  const base = String(valor ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.(pdf|jpe?g|png|webp)$/i, "")
    .slice(0, 100)
    .trim();
  const respaldo = `Comprobante ${ofCodigo}`.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 100).trim();
  return `${base || respaldo || "Comprobante"}${EXTENSION_DEL_TIPO[tipo]}`;
}

export const esquemaDelPago = z.object({
  /** Único por pago: un pago nuevo trae otro pagoId y manda otro aviso. */
  pagoId: textoCorto(120, "Falta el pagoId"),
  ofCodigo: textoCorto(60, "Falta el código de la orden de fabricación"),
  proveedora: z.object({
    nombre: textoCorto(120, "Falta el nombre de la proveedora"),
    /** Puede venir vacío: entonces no se manda y queda la alerta "Proveedora sin WhatsApp". */
    telefono: z.string().trim().max(40).nullish(),
  }),
  /** Solo los nombres de los productos de la orden. */
  productos: z
    .array(textoCorto(120, "Un producto vino vacío"), { error: "Faltan los productos" })
    .min(1, { error: "Faltan los productos" })
    .max(30),
  valorPagado: monto.refine((valor) => valor > 0, { error: "El valor pagado debe ser mayor que cero" }),
  saldo: monto,
  comprobanteBase64: z
    .string({ error: "Falta el comprobante" })
    .transform(limpiarBase64)
    .refine((valor) => valor.length > 0, { error: "El comprobante está vacío" })
    .refine((valor) => /^[A-Za-z0-9+/]+={0,2}$/.test(valor), { error: "El comprobante no está en base64" })
    .refine((valor) => bytesDeBase64(valor) <= COMPROBANTE_MAXIMO_BYTES, { error: "El comprobante pasa de 10 MB" })
    .refine((valor) => tipoDeComprobante(valor) !== null, { error: "El comprobante no es PDF, JPG, PNG ni WEBP" }),
  nombreArchivo: z.string().trim().max(200).nullish(),
});

export type PagoAProveedora = Omit<z.infer<typeof esquemaDelPago>, "nombreArchivo"> & {
  nombreArchivo: string;
  tipoComprobante: TipoDeComprobante;
};

export type ResultadoDeValidacion = { ok: true; pago: PagoAProveedora } | { ok: false; error: string };

/** Revisa el cuerpo que manda Gestión. El error dice qué falta, pero nunca repite los datos. */
export function validarPago(cuerpo: unknown): ResultadoDeValidacion {
  const resultado = esquemaDelPago.safeParse(cuerpo);
  if (!resultado.success) {
    const problema = resultado.error.issues[0];
    const campo = problema?.path.join(".") || "cuerpo";
    return { ok: false, error: `${campo}: ${problema?.message ?? "no es válido"}` };
  }
  const datos = resultado.data;
  const tipo = tipoDeComprobante(datos.comprobanteBase64)!;
  return {
    ok: true,
    pago: { ...datos, tipoComprobante: tipo, nombreArchivo: nombreDeArchivoSeguro(datos.nombreArchivo, datos.ofCodigo, tipo) },
  };
}

/* ───────────── El texto (dictado por el dueño el 2-nov-2026) ───────────── */

export type DatosDelTexto = Pick<PagoAProveedora, "ofCodigo" | "productos" | "valorPagado" | "saldo"> & {
  proveedora: { nombre: string };
};

/** Solo usa el nombre de la proveedora, la OF, los productos y los montos: nada de la clienta. */
export function textoDelPago(datos: DatosDelTexto): string {
  const productos = datos.productos.map((producto) => producto.trim()).filter(Boolean).join(", ");
  return [
    `Hola, ${datos.proveedora.nombre.trim()} 😊 Te enviamos un pago de ${pesos(datos.valorPagado)} por la ${datos.ofCodigo.trim()} (${productos}). Adjunto el comprobante.`,
    datos.saldo > 0 ? `Saldo pendiente de esta orden: ${pesos(datos.saldo)}` : "Orden pagada completa ✅",
    "Gracias, Magilus.",
  ].join("\n");
}

/**
 * En PRUEBA el aviso le llega al dueño, no a la proveedora: va una primera línea que lo dice y a qué
 * número (tapado) le habría llegado. El resto es el texto exacto que vería la proveedora.
 */
export function textoDePrueba(texto: string, telefonoDeLaProveedora: string): string {
  return `[PRUEBA] para ${telefonoTapado(telefonoDeLaProveedora)}\n${texto}`;
}

/* ───────────── El modo y las claves de AppSetting ───────────── */

export type ModoDelPago = "APAGADO" | "PRUEBA" | "ACTIVO";

/** Lo guardado en AppSetting → modo. Cualquier cosa rara (o nada) es APAGADO. */
export function modoDelPago(valor: unknown): ModoDelPago {
  const texto = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  return texto === "PRUEBA" || texto === "ACTIVO" ? texto : "APAGADO";
}

export const claveModoDelPago = (workspaceId: string) => `pago-proveedora:modo:${workspaceId}`;
export const claveTelefonoDePrueba = (workspaceId: string) => `pago-proveedora:telefono-prueba:${workspaceId}`;
export const clavePagoEnviado = (workspaceId: string, pagoId: string) => `pago-proveedora:enviado:${workspaceId}:${pagoId}`;
/** El comienzo de todas las marcas de envío de un negocio (para el resumen del MCP). */
export const prefijoPagoEnviado = (workspaceId: string) => `pago-proveedora:enviado:${workspaceId}:`;
/** Una sola alerta por pago: si vuelve a fallar se refresca la misma. */
export const claveAlertaDelPago = (pagoId: string) => `pago-proveedora:fallo:${pagoId}`;
export const claveAlertaSinTelefono = (pagoId: string) => `pago-proveedora:sin-telefono:${pagoId}`;

/* ───────────── La decisión (con las dependencias inyectadas, para probarla sin base) ───────────── */

export type EstadoDelPago = "enviado" | "ya_enviado" | "apagado" | "sin_telefono" | "fallo";

export type DependenciasDelEnvio = {
  /** Lee una AppSetting (null si no existe). */
  leerAjuste: (clave: string) => Promise<string | null>;
  /**
   * Aparta el pago: guarda `nuevo` en la clave solo si hoy tiene `anterior` (null = no existe).
   * Devuelve false si otro pedido ganó (la clave cambió en el medio).
   */
  apartar: (clave: string, anterior: string | null, nuevo: string) => Promise<boolean>;
  /** Guarda la marca final (ENVIADO). */
  guardarAjuste: (clave: string, valor: string) => Promise<void>;
  /** Suelta el apartado después de una falla, para que un reintento de Gestión lo vuelva a probar. */
  soltar: (clave: string, valorApartado: string) => Promise<void>;
  /** Manda el comprobante con el texto por la línea Admin y lo guarda en el chat. Lanza si no salió. */
  enviar: (pedido: { telefono: string; texto: string; pago: PagoAProveedora; modo: ModoDelPago }) => Promise<void>;
  /** Alerta ALTA en el área Gestión (una por pago y motivo). */
  alertar: (pedido: { clave: string; titulo: string; detalle: string }) => Promise<void>;
  ahora?: () => Date;
};

export type ResultadoDelEnvio = { estado: EstadoDelPago; modo: ModoDelPago; motivo?: string };

export async function procesarPago(workspaceId: string, pago: PagoAProveedora, deps: DependenciasDelEnvio): Promise<ResultadoDelEnvio> {
  const ahora = deps.ahora ?? (() => new Date());
  const modo = modoDelPago(await deps.leerAjuste(claveModoDelPago(workspaceId)));
  if (modo === "APAGADO") return { estado: "apagado", modo };

  const alertar = async (pedido: { clave: string; titulo: string; detalle: string }) => {
    try {
      await deps.alertar(pedido);
    } catch {
      // La alerta nunca tumba la respuesta: Gestión igual recibe el estado.
    }
  };

  /** `motivo` va en la respuesta a Gestión; `detalle` (el error de adentro, con los números tapados) solo en la alerta. */
  const fallar = async (motivo: string, detalle = motivo): Promise<ResultadoDelEnvio> => {
    await alertar({
      clave: claveAlertaDelPago(pago.pagoId),
      titulo: `No salió el aviso de pago a ${pago.proveedora.nombre} (${pago.ofCodigo})`,
      detalle: `Pago ${pago.pagoId} (modo ${modo}): ${taparNumeros(detalle)}. Gestión puede volver a mandarlo y el CRM lo intenta de nuevo.`,
    });
    return { estado: "fallo", modo, motivo };
  };

  // Sin número válido en la ficha de la proveedora no sale nada (tampoco en PRUEBA): queda la alerta.
  const telefonoDeLaProveedora = telefonoParaWhatsApp(pago.proveedora.telefono);
  if (!telefonoDeLaProveedora) {
    await alertar({
      clave: claveAlertaSinTelefono(pago.pagoId),
      titulo: `Proveedora sin WhatsApp: ${pago.proveedora.nombre} (${pago.ofCodigo})`,
      detalle: `El pago ${pago.pagoId} no se le avisó porque su ficha en Gestión no tiene un número de WhatsApp válido. Ponle el número en Gestión y vuelve a subir el comprobante.`,
    });
    return { estado: "sin_telefono", modo, motivo: "la proveedora no tiene un teléfono válido" };
  }

  let telefono: string | null;
  if (modo === "PRUEBA") {
    telefono = telefonoParaWhatsApp(await deps.leerAjuste(claveTelefonoDePrueba(workspaceId)));
    // En PRUEBA nunca se cae al teléfono de la proveedora: sin teléfono de prueba no sale nada.
    if (!telefono) return fallar("el modo es PRUEBA y no hay teléfono de prueba guardado");
  } else {
    telefono = telefonoDeLaProveedora;
  }

  const clave = clavePagoEnviado(workspaceId, pago.pagoId);
  const anterior = await deps.leerAjuste(clave);
  if (marcaFrenaElEnvio(leerMarcaDeEnvio(anterior), modo, ahora())) return { estado: "ya_enviado", modo };

  const apartado = JSON.stringify({ fecha: ahora().toISOString(), telefono, modo, estado: "ENVIANDO" } satisfies MarcaDeEnvio);
  if (!(await deps.apartar(clave, anterior, apartado))) return { estado: "ya_enviado", modo };

  const textoBase = textoDelPago(pago);
  const texto = modo === "PRUEBA" ? textoDePrueba(textoBase, telefonoDeLaProveedora) : textoBase;
  try {
    await deps.enviar({ telefono, texto, pago, modo });
  } catch (error) {
    // No queda marcado: un reintento de Gestión lo vuelve a probar.
    await deps.soltar(clave, apartado).catch(() => undefined);
    return fallar("no salió por WhatsApp", error instanceof Error ? error.message : String(error));
  }

  const marca: MarcaDeEnvio = { fecha: ahora().toISOString(), telefono, modo, estado: "ENVIADO" };
  try {
    await deps.guardarAjuste(clave, JSON.stringify(marca));
  } catch {
    // El WhatsApp YA salió: se contesta "enviado" igual. El apartado (ENVIANDO) frena un reintento por 10 minutos.
  }
  return { estado: "enviado", modo };
}

/* ───────────── La puerta (POST /api/gestion/pago-proveedora) ───────────── */

export type RespuestaDeLaPuerta = { status: number; body: Record<string, unknown> };

/**
 * Lógica del POST con las dependencias inyectadas. Primero la llave y DESPUÉS se lee el cuerpo: sin llave
 * buena no se lee ni un byte del comprobante. Nunca devuelve la llave, el teléfono ni el archivo.
 */
export async function responderPagoAProveedora(
  input: { autorizacion: string | null; leerCuerpo: () => Promise<unknown> },
  deps: {
    workspacePorLlave: (llave: string) => Promise<string | null>;
    procesar: (workspaceId: string, pago: PagoAProveedora) => Promise<ResultadoDelEnvio>;
  },
): Promise<RespuestaDeLaPuerta> {
  const llave = llaveDelHeader(input.autorizacion);
  const workspaceId = llave ? await deps.workspacePorLlave(llave) : null;
  if (!workspaceId) return { status: 401, body: { error: "no_autorizado" } };

  const cuerpo = await input.leerCuerpo();
  if (cuerpo === CUERPO_DEMASIADO_GRANDE) {
    return { status: 400, body: { error: "cuerpo_invalido", detalle: "comprobanteBase64: El comprobante pasa de 10 MB" } };
  }
  const validacion = validarPago(cuerpo);
  if (!validacion.ok) return { status: 400, body: { error: "cuerpo_invalido", detalle: validacion.error } };

  const resultado = await deps.procesar(workspaceId, validacion.pago);
  return {
    status: 200,
    body: {
      estado: resultado.estado,
      modo: resultado.modo,
      pagoId: validacion.pago.pagoId,
      ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
    },
  };
}
