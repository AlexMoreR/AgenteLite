-- EL CATALOGO PASA A SER DE CADA NEGOCIO (Alex, 29-09-2026)
--
-- Hasta hoy Category, Product y Quote no tenian dueño: eran una lista unica que compartian los
-- nueve workspaces. Nadie lo notaba porque solo Magilus cargaba productos. La hermana de Alex va a
-- vender plantas y articulos de vivero, que es otro catalogo entero, asi que hay que separarlos.
--
-- ESTA MIGRACION NO BORRA DATOS. Agrega una columna a cada tabla y reemplaza tres indices unicos
-- globales por su version por-negocio. Ni un DROP TABLE, ni un DELETE, ni un TRUNCATE.
--
-- Postgres corre cada migracion de Prisma dentro de UNA transaccion, asi que esto entra completo o
-- no entra nada. Importa mas que de costumbre: el contenedor corre `migrate deploy` al arrancar,
-- con `set -eu`, y el `npm start` va DESPUES. Una migracion que falla es la app caida, no un error
-- en los logs. Por eso cada columna se agrega PERMITIENDO NULOS, se rellena, y recien ahi se
-- exige: asi el paso que podria fallar ya no tiene con que fallar.

-- ---------------------------------------------------------------- Category
-- Hoy tiene CERO filas, asi que no hay nada que repartir.
ALTER TABLE "Category" ADD COLUMN "workspaceId" TEXT;

-- Si alguien creara una categoria entre esta revision y el despliegue, queda en Magilus en vez de
-- tumbar el arranque.
UPDATE "Category" SET "workspaceId" = 'cmnewn6l8004i2grj307j9woz' WHERE "workspaceId" IS NULL;

ALTER TABLE "Category" ALTER COLUMN "workspaceId" SET NOT NULL;

-- ---------------------------------------------------------------- Product
ALTER TABLE "Product" ADD COLUMN "workspaceId" TEXT;

-- De quien es cada producto: lo dice su playbook, que SI tiene workspaceId. Es el dato real de
-- quien lo cargo, no una suposicion.
UPDATE "Product" p
SET "workspaceId" = pb."workspaceId"
FROM "ProductPlaybook" pb
WHERE pb."productId" = p."id";

-- El "Combo Lavacabezas+Silla Neumatica" es el unico producto SIN playbook, asi que la base no
-- sabe de quien es. Es de Magilus: lo confirmo Alex el 29-09-2026. Queda escrito aca porque dentro
-- de un año nadie va a poder deducirlo mirando las tablas.
UPDATE "Product"
SET "workspaceId" = 'cmnewn6l8004i2grj307j9woz'
WHERE "slug" = 'combo-lavacabezas-silla-neumatica-cls-01' AND "workspaceId" IS NULL;

-- Red de seguridad: cualquier otro producto sin dueño -uno creado entre la revision y el
-- despliegue- va a Magilus tambien. Sin esto el SET NOT NULL de abajo falla y el contenedor NO
-- ARRANCA.
UPDATE "Product" SET "workspaceId" = 'cmnewn6l8004i2grj307j9woz' WHERE "workspaceId" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "workspaceId" SET NOT NULL;

-- ---------------------------------------------------------------- Quote
-- Hoy tiene CERO filas. Se scopea ahora justamente por eso.
ALTER TABLE "Quote" ADD COLUMN "workspaceId" TEXT;
UPDATE "Quote" SET "workspaceId" = 'cmnewn6l8004i2grj307j9woz' WHERE "workspaceId" IS NULL;
ALTER TABLE "Quote" ALTER COLUMN "workspaceId" SET NOT NULL;

-- ------------------------------------------------- las unicidades, ahora por negocio
-- El slug y el codigo eran unicos en toda la base. Podian serlo porque el slug era una direccion
-- de la tienda publica; esa tienda se borro (venia copiada de otro proyecto y no aplicaba), asi
-- que el slug es un identificador interno y dos negocios pueden repetirlo.
--
-- `shareToken` de Quote NO se toca: ese si es una direccion publica que se le manda al cliente.
DROP INDEX "Category_name_key";
DROP INDEX "Category_slug_key";
DROP INDEX "Product_slug_key";
DROP INDEX "Product_code_key";
DROP INDEX "Quote_code_key";

CREATE UNIQUE INDEX "Category_workspaceId_name_key" ON "Category"("workspaceId", "name");
CREATE UNIQUE INDEX "Category_workspaceId_slug_key" ON "Category"("workspaceId", "slug");
CREATE UNIQUE INDEX "Product_workspaceId_slug_key" ON "Product"("workspaceId", "slug");
CREATE UNIQUE INDEX "Product_workspaceId_code_key" ON "Product"("workspaceId", "code");
CREATE UNIQUE INDEX "Quote_workspaceId_code_key" ON "Quote"("workspaceId", "code");

CREATE INDEX "Category_workspaceId_idx" ON "Category"("workspaceId");
CREATE INDEX "Product_workspaceId_idx" ON "Product"("workspaceId");
CREATE INDEX "Quote_workspaceId_idx" ON "Quote"("workspaceId");

-- ---------------------------------------------------------------- las llaves foraneas
ALTER TABLE "Category" ADD CONSTRAINT "Category_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
