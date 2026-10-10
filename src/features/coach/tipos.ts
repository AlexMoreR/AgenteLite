import type { MotivoDeNoCierre, Temperatura, TipoDeError } from "./reglas";

/** Lo que se guarda en los campos JSON de CoachInforme y CoachAsesora. Sin telefonos: solo …1234. */

export type ChatRef = {
  /** "#1234" (numero corto del chat) */
  ref: string;
  /** Para el enlace app.aizenbot.com/c/<numero>. */
  numero: number | null;
  ultimos4: string;
  nombre: string;
};

/** Donde se pierde la venta. Lo usa la habilidad del dia (politica.ts, `habilidad`). */
export type EtapaDeVenta = "antes_del_precio" | "despues_del_precio" | "despues_de_cotizar" | "seguimiento";

export type ErrorDelCoach = ChatRef & {
  tipo: TipoDeError;
  detalle: string;
  /** Desde habilidad-v1. Los informes viejos no los traen. */
  etapa?: EtapaDeVenta | null;
  temperatura?: Temperatura | null;
  minutos?: number | null;
};

export type ClaveDeHabilidad =
  | "no_dejar_sin_respuesta"
  | "responder_a_tiempo"
  | "mandar_cotizacion"
  | "cerrar_total_claro"
  | "aplicar_envio_y_pago"
  | "no_descartar_antes";

/** La habilidad del dia de UNA asesora: la elige el codigo; la IA solo puede redactar (c) y (d). */
export type HabilidadDelDia = {
  version: string;
  clave: ClaveDeHabilidad;
  /** (a) "Responder a tiempo" */
  nombre: string;
  impacto: number;
  /** El impacto de cada habilidad, para ver por que gano esta. */
  ranking: Array<{ clave: ClaveDeHabilidad; impacto: number }>;
  etapaCritica: EtapaDeVenta | null;
  /** Gano con errores que son del equipo (era claramente su error dominante). */
  incluyeErrorDelEquipo: boolean;
  /** (b) 2 o 3 casos de SUS chats. */
  evidencia: Array<ChatRef & { texto: string }>;
  /** (c) */
  queHacerDiferente: string;
  /** (d) mensaje modelo listo para usar */
  ejemplo: string;
  /** (e) lo que se mide mañana */
  metrica: { nombre: string; hoy: number; meta: number; sentido: "bajar" | "subir"; texto: string };
  redactadoPor: "ia" | "plantilla";
};

export type ProblemaDelEquipo = {
  tipo: TipoDeError;
  nombre: string;
  total: number;
  porAsesora: Array<{ nombre: string; casos: number }>;
  porque: string;
  queHacer: string;
};

export type AciertoDelCoach = ChatRef & { texto: string };

export type PendienteDelCoach = ChatRef & {
  temperatura: Temperatura;
  /** El cliente quedo esperando a una persona (en horario). Va primero. */
  urgente: boolean;
  porque: string;
  siguienteMensaje: string;
  etapa: string;
};

export type PuntajesDelCoach = {
  /** Promedio de cada eje de la rubrica en los chats del dia (null = no aplica). */
  ejes: Partial<Record<"V" | "N" | "A" | "S" | "C", number | null>>;
  /** Resultado: se muestra aparte, no entra al puntaje. */
  ganados: number;
  porChat: Array<{ ref: string; ejes: Partial<Record<"V" | "N" | "A" | "S" | "C", number | null>>; puntaje: number | null }>;
};

export type ResumenDeAsesoraGuardado = {
  loQueHizoBien: string;
  /** Hasta el 9-oct lo escribia la IA. Desde habilidad-v1 es el resumen de `habilidad`. */
  unaCosaAMejorar: string;
  ejemplo: string;
  /** Desde habilidad-v1 (sin migracion: va en el JSON `resumen`). */
  habilidad?: HabilidadDelDia | null;
  metricas: {
    chats: number;
    chatsQuietos: number;
    demoras: number;
    sinRespuesta: number;
    primeraRespuestaMedianaMin: number | null;
    cotizaciones: number;
    ganados: number;
    atribucionIncierta: number;
  };
};

export type ResumenDelEquipo = {
  dia: string;
  iaDisponible: boolean;
  resumen: string;
  leads: number;
  chatsConActividad: number;
  sinAsesora: number;
  calientes: number;
  tibios: number;
  cotizaciones: number;
  ventas: number;
  motivos: Array<{ motivo: MotivoDeNoCierre; casos: number }>;
  erroresDeAsesoras: Array<{ userId: string; nombre: string; total: number; porTipo: Record<string, number> }>;
  fallasDelSistema: Array<{ texto: string; ref: string | null }>;
  /** Desde habilidad-v1: lo que es del equipo (o de un cambio de politica) va aca una sola vez. */
  problemasDelEquipo?: ProblemaDelEquipo[];
};
