import { prisma } from "@/lib/prisma";

import { CLAVE_DEL_PROGRESO, type BaseDeLaMigracion, type Fila } from "./migrar-tanda";

/**
 * La base de verdad para la migracion: cada consulta va en su propia transaccion corta con
 * `statement_timeout = 5s` y `lock_timeout = 1s`. Si no consigue un bloqueo en 1 s, se cancela
 * sola y el mensaje queda para la proxima tanda: nunca hace esperar a un webhook.
 */
export const baseDeProduccion: BaseDeLaMigracion = {
  async consultar<T extends Fila = Fila>(sql: string, params: unknown[] = []) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '5s'`);
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);
        return tx.$queryRawUnsafe<T[]>(sql, ...params);
      },
      { maxWait: 2000, timeout: 8000 },
    );
  },
  async leerProgreso() {
    const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_DEL_PROGRESO }, select: { value: true } });
    return fila?.value ?? null;
  },
  async guardarProgreso(valor: string) {
    await prisma.appSetting.upsert({
      where: { key: CLAVE_DEL_PROGRESO },
      create: { key: CLAVE_DEL_PROGRESO, value: valor },
      update: { value: valor },
    });
  },
};
