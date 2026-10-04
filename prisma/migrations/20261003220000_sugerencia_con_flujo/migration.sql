-- La estrella ahora puede proponer un flujo (boton "Enviar flujo"): se guarda cual propuso y si la
-- vendedora lo envio. Solo agrega dos columnas que admiten vacio a una tabla nueva: no toca nada mas.
ALTER TABLE "SugerenciaDeRespuesta" ADD COLUMN IF NOT EXISTS "flujoId" TEXT;
ALTER TABLE "SugerenciaDeRespuesta" ADD COLUMN IF NOT EXISTS "flujoEnviadoEn" TIMESTAMP(3);
