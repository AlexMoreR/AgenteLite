import { Prisma } from "@prisma/client";

import { ESTADOS_ABIERTOS } from "./chat-resuelto";

/**
 * Los pedazos de consulta de "chat resuelto = fuera del CRM de trabajo" (ver chat-resuelto.ts).
 *
 * Van en las listas de TRABAJO (tareas, Mi día, Recuperación de hoy, barridos que crean tareas o
 * automáticos). NO en las métricas de la semana: esas son historia y cuentan también los resueltos.
 */

/** `AND c."status" IN ('OPEN', 'PENDING')` (alias `c` = Conversation, como en todas esas consultas). */
export const SQL_CHAT_ABIERTO = Prisma.sql`AND c."status" IN ('OPEN', 'PENDING')`;

/** Lo mismo para Prisma. */
export const WHERE_CHAT_ABIERTO = { status: { in: [...ESTADOS_ABIERTOS] } } satisfies Prisma.ConversationWhereInput;
