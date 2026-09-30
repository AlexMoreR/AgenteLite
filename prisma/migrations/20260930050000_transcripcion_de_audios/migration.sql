-- Transcripcion de las notas de voz (pedido de Alex, 29-09-2026).
--
-- Dos columnas nuevas y vacias en "Message". Son aditivas y admiten null: Postgres las agrega sin
-- reescribir la tabla, asi que la migracion es instantanea y no hay forma de que falle por datos.
-- Verificado en produccion antes de subir: las columnas no existian y no habia migraciones a medias.

ALTER TABLE "Message" ADD COLUMN "transcripcion" TEXT;
ALTER TABLE "Message" ADD COLUMN "transcritoEn" TIMESTAMP(3);
