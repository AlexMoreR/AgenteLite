import { z } from "zod";

import { pesos } from "@/lib/contraentrega";
import { diaEnBogota } from "@/lib/en-linea-reglas";
import { llaveDelHeader, variantesDeTelefono } from "@/lib/origen-de-venta";

/**
 * RECIBO DE CAJA POR WHATSAPP (parte 1 de 3 de «Venta confirmada: mandar recibo de caja»).
 *
 * Gestión registra un abono, arma el recibo en PDF y lo entrega aquí (POST /api/gestion/recibo-de-caja).
 * El CRM se lo manda al cliente por la línea Admin con el texto que aprobó el dueño el 2-nov-2026.
 *
 * Nace APAGADO. En PRUEBA le llega solo al teléfono de prueba (el del dueño, guardado en AppSetting,
 * nunca escrito en el código). Para ACTIVO alguien tiene que guardar el modo a mano.
 *
 * Parte 2: en ACTIVO, cuando el recibo sale bien, el contacto queda con la etiqueta Cliente y en GANADO
 * (ver `debeMarcarClienteGanado`). Si eso falla, el recibo sigue enviado y queda una alerta MEDIA aparte.
 *
 * Este archivo es lógica pura (sin red ni base): la prueba es `npm run test:recibo-de-caja`. El envío
 * de verdad (base, WhatsApp, alertas) vive en `recibo-de-caja-envio.ts` y se le pasa aquí como funciones.
 */

/* ───────────── Los datos que manda Gestión ───────────── */

/** Tope del PDF (decisión del plan: 10 MB). */
export const PDF_MAXIMO_BYTES = 10 * 1024 * 1024;

/** Tope del cuerpo entero: el PDF en base64 pesa ~4/3 del archivo, más los datos. */
export const CUERPO_MAXIMO_BYTES = Math.ceil((PDF_MAXIMO_BYTES * 4) / 3) + 64 * 1024;

/** Acepta 500000 o "500000" (Gestión puede mandar los montos como texto). Sin centavos. */
const monto = z.preprocess(
  (valor) => (typeof valor === "string" && /^\s*\d+(\.\d+)?\s*$/.test(valor) ? Number(valor) : valor),
  z.number({ error: "El monto debe ser un número" }).finite().min(0, { error: "El monto no puede ser negativo" }),
);

const textoCorto = (maximo: number, mensaje: string) => z.string({ error: mensaje }).trim().min(1, { error: mensaje }).max(maximo);

/** Quita el "data:application/pdf;base64," si viene, y los saltos de línea. */
export function limpiarBase64(valor: string): string {
  return valor.replace(/^data:[^,]*;base64,/i, "").replace(/\s+/g, "");
}

/** Bytes reales de un base64 (sin decodificarlo). */
export function bytesDeBase64(base64: string): number {
  const relleno = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - relleno;
}

/** Un nombre de archivo seguro: sin carpetas ni caracteres raros y terminado en .pdf. */
export function nombreDeArchivoSeguro(valor: string | null | undefined, ventaCodigo: string): string {
  const base = String(valor ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .slice(0, 100)
    .trim();
  const respaldo = `Recibo de caja ${ventaCodigo}`.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 100).trim();
  return `${base || respaldo || "Recibo de caja"}.pdf`;
}

export const esquemaDelRecibo = z.object({
  /** Único por abono: un abono nuevo trae otro reciboId y manda otro recibo. */
  reciboId: textoCorto(120, "Falta el reciboId"),
  ventaCodigo: textoCorto(60, "Falta el código de la venta"),
  cliente: z.object({
    nombre: textoCorto(120, "Falta el nombre del cliente"),
    telefono: z
      .string({ error: "Falta el teléfono del cliente" })
      .trim()
      .refine((valor) => variantesDeTelefono(valor).length > 0, { error: "El teléfono del cliente no es válido" }),
  }),
  producto: textoCorto(120, "Falta el producto"),
  valorAbonado: monto.refine((valor) => valor > 0, { error: "El valor abonado debe ser mayor que cero" }),
  saldo: monto,
  /** 'FABRICACION' | 'DESPACHADO' | 'ENTREGADO' | otro (cualquier otro se trata como en fabricación). */
  estadoPedido: z.string({ error: "Falta el estado del pedido" }).trim().max(40).transform((valor) => valor.toUpperCase()),
  asesora: z.string().trim().max(120).nullish(),
  fecha: textoCorto(40, "Falta la fecha"),
  pdfBase64: z
    .string({ error: "Falta el PDF" })
    .transform(limpiarBase64)
    .refine((valor) => valor.length > 0, { error: "El PDF está vacío" })
    .refine((valor) => /^[A-Za-z0-9+/]+={0,2}$/.test(valor), { error: "El PDF no está en base64" })
    .refine((valor) => bytesDeBase64(valor) <= PDF_MAXIMO_BYTES, { error: "El PDF pasa de 10 MB" })
    // Un PDF de verdad empieza por "%PDF" ("JVBER" en base64).
    .refine((valor) => valor.startsWith("JVBER"), { error: "El archivo no es un PDF" }),
  nombreArchivo: z.string().trim().max(200).nullish(),
});

export type ReciboDeCaja = Omit<z.infer<typeof esquemaDelRecibo>, "nombreArchivo"> & { nombreArchivo: string };

export type ResultadoDeValidacion = { ok: true; recibo: ReciboDeCaja } | { ok: false; error: string };

/** Revisa el cuerpo que manda Gestión. El error dice qué falta, pero nunca repite los datos. */
export function validarRecibo(cuerpo: unknown): ResultadoDeValidacion {
  const resultado = esquemaDelRecibo.safeParse(cuerpo);
  if (!resultado.success) {
    const problema = resultado.error.issues[0];
    const campo = problema?.path.join(".") || "cuerpo";
    return { ok: false, error: `${campo}: ${problema?.message ?? "no es válido"}` };
  }
  const datos = resultado.data;
  return { ok: true, recibo: { ...datos, nombreArchivo: nombreDeArchivoSeguro(datos.nombreArchivo, datos.ventaCodigo) } };
}

/* ───────────── El texto (aprobado por el dueño el 3-nov-2026) ───────────── */

export type DatosDelTexto = Pick<ReciboDeCaja, "producto" | "valorAbonado" | "saldo" | "estadoPedido"> & {
  cliente: { nombre: string };
};

/** Si el pedido ya salió (DESPACHADO) o ya llegó (ENTREGADO), no se le dice que está en fabricación ni que se le avisa del despacho. */
function pedidoYaSalio(estadoPedido: string): boolean {
  const estado = estadoPedido.trim().toUpperCase();
  return estado === "DESPACHADO" || estado === "ENTREGADO";
}

/**
 * Líneas cortas con emoji; el nombre y los montos en negrita de WhatsApp (*...*). El producto se sigue
 * recibiendo pero no va en el texto. Cada "" es una línea en blanco.
 */
export function textoDelRecibo(datos: DatosDelTexto): string {
  const nombre = datos.cliente.nombre.trim();
  const yaSalio = pedidoYaSalio(datos.estadoPedido);
  const lineas = [
    `Hola, *${nombre}* 😊`,
    "",
    `✅ Recibimos tu pago de *${pesos(datos.valorAbonado)}*.`,
    "📄 Te adjunto tu recibo de caja.",
    "",
    `💰 Saldo pendiente: *${pesos(datos.saldo)}*`,
  ];
  if (datos.saldo > 0) {
    if (!yaSalio) lineas.push("🛠️ Tu pedido ya entró a fabricación.", "🚚 Te avisamos cuando esté listo para despacho.");
  } else {
    lineas.push("🎉 *Pago completo*");
    if (!yaSalio) lineas.push("🚚 Te avisamos cuando tu pedido esté listo para despacho.");
  }
  lineas.push("", "¡Gracias por confiar en Magilus! 💜");
  return lineas.join("\n");
}

/**
 * En PRUEBA el recibo le llega al dueño, no al cliente: va una primera línea que lo dice y a quién le
 * habría llegado, para que no lo confunda con un pago suyo. El resto es el texto exacto que vería el cliente.
 */
export function textoDePrueba(texto: string, telefonoDelCliente: string): string {
  return `[PRUEBA] para ${telefonoDelCliente}\n${texto}`;
}

/* ───────────── El modo y las claves de AppSetting ───────────── */

export type ModoDelRecibo = "APAGADO" | "PRUEBA" | "ACTIVO";

/** Lo guardado en AppSetting → modo. Cualquier cosa rara (o nada) es APAGADO. */
export function modoDelRecibo(valor: unknown): ModoDelRecibo {
  const texto = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  return texto === "PRUEBA" || texto === "ACTIVO" ? texto : "APAGADO";
}

export const claveModoDelRecibo = (workspaceId: string) => `recibo-caja:modo:${workspaceId}`;
export const claveTelefonoDePrueba = (workspaceId: string) => `recibo-caja:telefono-prueba:${workspaceId}`;
export const claveReciboEnviado = (workspaceId: string, reciboId: string) => `recibo-caja:enviado:${workspaceId}:${reciboId}`;
/** Una sola alerta por recibo: si vuelve a fallar se refresca la misma. */
export const claveAlertaDelRecibo = (reciboId: string) => `recibo-caja:fallo:${reciboId}`;
/** La alerta MEDIA cuando el recibo SÍ salió pero no se pudo marcar al cliente como Cliente/GANADO. */
export const claveAlertaDelMarcado = (reciboId: string) => `recibo-caja:marcar:${reciboId}`;
/** El comienzo de todas las marcas de envío de un negocio (para el resumen del MCP). */
export const prefijoReciboEnviado = (workspaceId: string) => `recibo-caja:enviado:${workspaceId}:`;

/** El teléfono como lo guarda el CRM ("573001234567"): 10 dígitos que empiezan por 3 → con 57 adelante. */
export function telefonoParaWhatsApp(valor: string | null | undefined): string | null {
  const variantes = variantesDeTelefono(valor);
  if (!variantes.length) return null;
  return variantes.find((v) => v.length === 12 && v.startsWith("57")) ?? variantes[0];
}

/** Para el log y las alertas: solo los últimos 4 dígitos. */
export function telefonoTapado(valor: string | null | undefined): string {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length > 4 ? `…${digitos.slice(-4)}` : "…";
}

/** Tapa cualquier número largo (un teléfono dentro de un error del gateway) antes de guardarlo en una alerta. */
export function taparNumeros(texto: string): string {
  return texto.replace(/\+?\d[\d\s-]{6,}\d/g, (numero) => telefonoTapado(numero)).slice(0, 500);
}

/** Lo que queda guardado en `recibo-caja:enviado:<negocio>:<reciboId>`. */
export type MarcaDeEnvio = {
  fecha: string;
  telefono: string;
  modo: ModoDelRecibo;
  /** ENVIANDO = apartado justo antes de mandar (frena dos pedidos iguales al mismo tiempo). */
  estado: "ENVIANDO" | "ENVIADO";
};

/** Un apartado (ENVIANDO) más viejo que esto quedó colgado (se cayó el servidor a mitad): se puede volver a probar. */
export const APARTADO_VENCE_MS = 10 * 60 * 1000;

export function leerMarcaDeEnvio(valor: string | null | undefined): MarcaDeEnvio | null {
  if (!valor) return null;
  try {
    const dato = JSON.parse(valor) as Partial<MarcaDeEnvio>;
    if (dato?.estado !== "ENVIANDO" && dato?.estado !== "ENVIADO") return null;
    return {
      fecha: String(dato.fecha ?? ""),
      telefono: String(dato.telefono ?? ""),
      modo: modoDelRecibo(dato.modo),
      estado: dato.estado,
    };
  } catch {
    return null;
  }
}

/**
 * ¿La marca que ya existe frena este envío?
 * - ENVIADO en ACTIVO: ya le llegó al cliente → no se repite nunca.
 * - ENVIADO en PRUEBA: frena otra prueba, pero no el envío real cuando el modo pase a ACTIVO (la prueba le llegó al dueño, no al cliente).
 * - ENVIANDO reciente: otro pedido igual lo está mandando ahora mismo.
 */
export function marcaFrenaElEnvio(marca: MarcaDeEnvio | null, modo: ModoDelRecibo, ahora: Date): boolean {
  if (!marca) return false;
  if (marca.estado === "ENVIANDO") {
    const desde = Date.parse(marca.fecha);
    return Number.isFinite(desde) && ahora.getTime() - desde < APARTADO_VENCE_MS;
  }
  return marca.modo === "ACTIVO" || marca.modo === modo;
}

/* ───────────── La decisión (con las dependencias inyectadas, para probarla sin base) ───────────── */

export type EstadoDelRecibo = "enviado" | "ya_enviado" | "apagado" | "fallo";

/**
 * ¿Se marca al cliente como Cliente/GANADO? Solo si el recibo de verdad le llegó a él: modo ACTIVO y
 * envío OK. En PRUEBA le llegó al dueño (el contacto es el suyo), y "ya_enviado" ya se marcó la primera vez.
 */
export function debeMarcarClienteGanado(modo: ModoDelRecibo, estado: EstadoDelRecibo): boolean {
  return modo === "ACTIVO" && estado === "enviado";
}

/** A quién le llegó el recibo en el CRM: el contacto y su conversación en la línea Admin. */
export type DestinoDelEnvio = { contactId: string; conversationId: string };

export type DependenciasDelEnvio = {
  /** Lee una AppSetting (null si no existe). */
  leerAjuste: (clave: string) => Promise<string | null>;
  /**
   * Aparta el recibo: guarda `nuevo` en la clave solo si hoy tiene `anterior` (null = no existe).
   * Devuelve false si otro pedido ganó (la clave cambió en el medio).
   */
  apartar: (clave: string, anterior: string | null, nuevo: string) => Promise<boolean>;
  /** Guarda la marca final (ENVIADO). */
  guardarAjuste: (clave: string, valor: string) => Promise<void>;
  /** Suelta el apartado después de una falla, para que un reintento de Gestión lo vuelva a probar. */
  soltar: (clave: string, valorApartado: string) => Promise<void>;
  /** Manda el PDF con el texto por la línea Admin y lo guarda en el chat. Lanza si no salió. */
  enviar: (pedido: { telefono: string; texto: string; recibo: ReciboDeCaja; modo: ModoDelRecibo }) => Promise<DestinoDelEnvio>;
  /** Alerta ALTA en el área Gestión (una por recibo). */
  alertar: (pedido: { clave: string; titulo: string; detalle: string }) => Promise<void>;
  /** Le pone al contacto la etiqueta Cliente y la etapa GANADO (salvo "fuera del CRM"). Lanza si falla. */
  marcarCliente: (pedido: DestinoDelEnvio & { recibo: ReciboDeCaja }) => Promise<void>;
  /** Alerta MEDIA en el área Gestión: el recibo salió, pero el marcado falló. */
  alertarMedia: (pedido: { clave: string; titulo: string; detalle: string }) => Promise<void>;
  ahora?: () => Date;
};

export type ResultadoDelEnvio = { estado: EstadoDelRecibo; modo: ModoDelRecibo; motivo?: string };

export async function procesarRecibo(workspaceId: string, recibo: ReciboDeCaja, deps: DependenciasDelEnvio): Promise<ResultadoDelEnvio> {
  const ahora = deps.ahora ?? (() => new Date());
  const modo = modoDelRecibo(await deps.leerAjuste(claveModoDelRecibo(workspaceId)));
  if (modo === "APAGADO") return { estado: "apagado", modo };

  const titulo = `No salió el recibo de caja ${recibo.ventaCodigo}`;
  /** `motivo` va en la respuesta a Gestión; `detalle` (el error de adentro, con los números tapados) solo en la alerta. */
  const fallar = async (motivo: string, detalle = motivo): Promise<ResultadoDelEnvio> => {
    try {
      await deps.alertar({
        clave: claveAlertaDelRecibo(recibo.reciboId),
        titulo,
        detalle: `Recibo ${recibo.reciboId} (modo ${modo}): ${taparNumeros(detalle)}. Gestión puede volver a mandarlo y el CRM lo intenta de nuevo.`,
      });
    } catch {
      // La alerta nunca tumba la respuesta: Gestión igual recibe "fallo".
    }
    return { estado: "fallo", modo, motivo };
  };

  const telefonoDelCliente = telefonoParaWhatsApp(recibo.cliente.telefono);
  let telefono: string | null;
  if (modo === "PRUEBA") {
    telefono = telefonoParaWhatsApp(await deps.leerAjuste(claveTelefonoDePrueba(workspaceId)));
    // En PRUEBA nunca se cae al teléfono del cliente: sin teléfono de prueba no sale nada.
    if (!telefono) return fallar("el modo es PRUEBA y no hay teléfono de prueba guardado");
  } else {
    telefono = telefonoDelCliente;
    if (!telefono) return fallar("el teléfono del cliente no es válido");
  }

  const clave = claveReciboEnviado(workspaceId, recibo.reciboId);
  const anterior = await deps.leerAjuste(clave);
  if (marcaFrenaElEnvio(leerMarcaDeEnvio(anterior), modo, ahora())) return { estado: "ya_enviado", modo };

  const apartado = JSON.stringify({ fecha: ahora().toISOString(), telefono, modo, estado: "ENVIANDO" } satisfies MarcaDeEnvio);
  if (!(await deps.apartar(clave, anterior, apartado))) return { estado: "ya_enviado", modo };

  const textoBase = textoDelRecibo(recibo);
  const texto = modo === "PRUEBA" ? textoDePrueba(textoBase, telefonoDelCliente ?? recibo.cliente.telefono) : textoBase;
  let destino: DestinoDelEnvio;
  try {
    destino = await deps.enviar({ telefono, texto, recibo, modo });
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

  if (debeMarcarClienteGanado(modo, "enviado")) {
    try {
      await deps.marcarCliente({ ...destino, recibo });
    } catch (error) {
      // El recibo YA le llegó: no se borra el "enviado" (no se reenvía). Solo queda la alerta MEDIA aparte.
      try {
        await deps.alertarMedia({
          clave: claveAlertaDelMarcado(recibo.reciboId),
          titulo: `El recibo ${recibo.ventaCodigo} salió, pero el cliente no quedó como Cliente/GANADO`,
          detalle: `Recibo ${recibo.reciboId}: ${taparNumeros(error instanceof Error ? error.message : String(error))}. Ponle a mano la etiqueta Cliente y la etapa Ganado en el chat de la línea Admin.`,
        });
      } catch {
        // La alerta nunca tumba la respuesta.
      }
    }
  }
  return { estado: "enviado", modo };
}

/* ───────────── El resumen para el MCP (cuántos salieron hoy y el último) ───────────── */

export type ResumenDeEnvios = { enviadosHoy: number; ultimo: { fecha: string; modo: ModoDelRecibo } | null };

/**
 * Resume las marcas `recibo-caja:enviado:*`: cuenta solo las ENVIADO de hoy (día de Bogotá) e ignora
 * los apartados (ENVIANDO) y los datos rotos. Nunca devuelve el teléfono.
 */
export function resumenDeEnvios(valores: (string | null | undefined)[], ahora: Date): ResumenDeEnvios {
  const hoy = diaEnBogota(ahora);
  let enviadosHoy = 0;
  let ultimo: { fecha: string; modo: ModoDelRecibo; ms: number } | null = null;
  for (const valor of valores) {
    const marca = leerMarcaDeEnvio(valor);
    if (marca?.estado !== "ENVIADO") continue;
    const ms = Date.parse(marca.fecha);
    if (!Number.isFinite(ms)) continue;
    const fecha = new Date(ms);
    if (diaEnBogota(fecha) === hoy) enviadosHoy += 1;
    if (!ultimo || ms > ultimo.ms) ultimo = { fecha: fecha.toISOString(), modo: marca.modo, ms };
  }
  return { enviadosHoy, ultimo: ultimo ? { fecha: ultimo.fecha, modo: ultimo.modo } : null };
}

/* ───────────── La puerta (POST /api/gestion/recibo-de-caja) ───────────── */

export type RespuestaDeLaPuerta = { status: number; body: Record<string, unknown> };

/** Señal de `leerCuerpoConTope`: el cuerpo pasó del tope. */
export const CUERPO_DEMASIADO_GRANDE = Symbol("cuerpo-demasiado-grande");

/**
 * Lee el cuerpo JSON por partes y corta apenas pasa de `maximo` bytes (sirve aunque el pedido no traiga
 * content-length, por ejemplo en trozos). JSON roto o vacío → null (y la validación contesta 400).
 */
export async function leerCuerpoConTope(
  cuerpo: ReadableStream<Uint8Array> | null,
  maximo: number,
): Promise<unknown | typeof CUERPO_DEMASIADO_GRANDE> {
  if (!cuerpo) return null;
  const lector = cuerpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximo) {
      await lector.cancel().catch(() => undefined);
      return CUERPO_DEMASIADO_GRANDE;
    }
    partes.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Lógica del POST con las dependencias inyectadas. Primero la llave y DESPUÉS se lee el cuerpo: sin llave
 * buena no se lee ni un byte del PDF. Nunca devuelve la llave, el teléfono ni el PDF.
 */
export async function responderReciboDeCaja(
  input: { autorizacion: string | null; leerCuerpo: () => Promise<unknown> },
  deps: {
    workspacePorLlave: (llave: string) => Promise<string | null>;
    procesar: (workspaceId: string, recibo: ReciboDeCaja) => Promise<ResultadoDelEnvio>;
  },
): Promise<RespuestaDeLaPuerta> {
  const llave = llaveDelHeader(input.autorizacion);
  const workspaceId = llave ? await deps.workspacePorLlave(llave) : null;
  if (!workspaceId) return { status: 401, body: { error: "no_autorizado" } };

  const cuerpo = await input.leerCuerpo();
  if (cuerpo === CUERPO_DEMASIADO_GRANDE) {
    return { status: 400, body: { error: "cuerpo_invalido", detalle: "pdfBase64: El PDF pasa de 10 MB" } };
  }
  const validacion = validarRecibo(cuerpo);
  if (!validacion.ok) return { status: 400, body: { error: "cuerpo_invalido", detalle: validacion.error } };

  const resultado = await deps.procesar(workspaceId, validacion.recibo);
  return {
    status: 200,
    body: {
      estado: resultado.estado,
      modo: resultado.modo,
      reciboId: validacion.recibo.reciboId,
      ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
    },
  };
}
