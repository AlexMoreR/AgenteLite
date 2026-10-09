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

export type ErrorDelCoach = ChatRef & { tipo: TipoDeError; detalle: string };

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
  unaCosaAMejorar: string;
  ejemplo: string;
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
};
