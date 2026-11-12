// "Ver seguimientos" en la ventana de Agendar (Alex, 11-nov-2026: "ver los seguimientos de ese
// cliente"). Funciones puras, sin imports con alias: npm run test:seguimiento-con-adjuntos

export type PiezaDelSeguimiento = { tipo: "TEXT" | "IMAGE" | "VIDEO" | "DOC" | "AUDIO" | "FLUJO"; texto: string | null; url: string | null };

export type SeguimientoDelCliente = {
  id: string;
  /** "Desde el chat" (lo agendo una persona) o el nombre del automatico. */
  origen: string;
  deUnaPersona: boolean;
  cuando: string;
  estado: "PENDIENTE" | "ENVIADO" | "CANCELADO";
  /** Por que se cancelo o que fallo, si se sabe. */
  motivo: string | null;
  piezas: PiezaDelSeguimiento[];
};

type FilaDeSeguimiento = {
  id: string;
  name: string | null;
  followRuleId: string | null;
  executeAt: Date | string;
  status: string;
  executionError: string | null;
  messageType: string;
  content: string | null;
  mediaUrl: string | null;
  actions: ReadonlyArray<{ messageType: string; content: string | null; mediaUrl: string | null; flowId?: string | null }>;
};

const NOMBRE_DESDE_EL_CHAT = "Seguimiento desde el chat";

function tipoDePieza(tipo: string, flowId: string | null | undefined): PiezaDelSeguimiento["tipo"] {
  if (flowId) return "FLUJO";
  if (tipo === "IMAGE" || tipo === "VIDEO" || tipo === "DOC" || tipo === "AUDIO") return tipo;
  return "TEXT";
}

/** Una fila del motor de seguimientos, como la ve la asesora. */
export function aSeguimientoDelCliente(fila: FilaDeSeguimiento): SeguimientoDelCliente {
  const acciones = fila.actions.length
    ? fila.actions
    : [{ messageType: fila.messageType, content: fila.content, mediaUrl: fila.mediaUrl, flowId: null }];
  const nombre = (fila.name ?? "").trim();
  const deUnaPersona = !fila.followRuleId && (nombre === "" || nombre === NOMBRE_DESDE_EL_CHAT);
  const estado = fila.status === "PENDING" ? "PENDIENTE" : fila.status === "EXECUTED" ? "ENVIADO" : "CANCELADO";
  return {
    id: fila.id,
    origen: deUnaPersona ? "Desde el chat" : nombre || "Automático",
    deUnaPersona,
    cuando: new Date(fila.executeAt).toISOString(),
    estado,
    motivo: estado === "PENDIENTE" ? null : fila.executionError?.trim() || null,
    piezas: acciones.map((accion) => ({
      tipo: tipoDePieza(accion.messageType, accion.flowId),
      texto: accion.content?.trim() || null,
      url: accion.mediaUrl?.trim() || null,
    })),
  };
}

/** Primero los pendientes (el mas proximo arriba); despues los demas, del mas nuevo al mas viejo. */
export function ordenarSeguimientos(lista: readonly SeguimientoDelCliente[]): SeguimientoDelCliente[] {
  const pendientes = lista.filter((s) => s.estado === "PENDIENTE").sort((a, b) => a.cuando.localeCompare(b.cuando));
  const resto = lista.filter((s) => s.estado !== "PENDIENTE").sort((a, b) => b.cuando.localeCompare(a.cuando));
  return [...pendientes, ...resto];
}
