This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Respaldo de la base

Cada noche queda una copia completa de la base de AizenCRM (clientes, chats, etapas, agentes, flujos,
libro V3, tableros) en Google Drive y otra en aizen1.

### Cómo funciona

- El servicio `aizenbot_respaldo` del stack (misma imagen que la app, ver `docker-compose.portainer.yml`)
  corre `docker/respaldo/respaldo.sh reloj`. Cada minuto mira la hora y a las **2:00 a. m. de Colombia**,
  una sola vez por noche:
  1. copia la base con `pg_dump` (formato comprimido, sesión de **solo lectura**) en
     `aizencrm-AAAA-MM-DD.dump`;
  2. revisa la copia: que tenga tamaño y que `pg_restore --list` la pueda abrir;
  3. la sube con `rclone` a Google Drive, carpeta **Respaldos/AizenCRM**;
  4. en esa carpeta borra solo los `aizencrm-AAAA-MM-DD.dump` de más de 30 días (no entra a subcarpetas);
  5. en el servidor (volumen `aizenbot_respaldos`) deja solo las 3 últimas copias.
- Si falla copiar, revisar o subir, llega un correo a `RESPALDO_AVISO_A` con el paso y el error. Sale por
  el mismo correo (`SMTP_*`) con que la app avisa cuando se cae una línea.
- En aizen1, la tarea "Respaldo AizenCRM" (4:00 a. m.) baja la copia del día y guarda las últimas 30. Si
  la copia del día no está en Drive, también manda el correo.
- El permiso de Drive es `drive.file`: rclone solo ve los archivos que él mismo subió. No puede tocar nada
  más del Drive.

Probar sin base ni internet: `npm run test:respaldo`.

### Configuración (una sola vez)

Las claves van solo en Portainer y en `config.local.json` de aizen1 (no se sube al repositorio). Nunca en
el código.

1. **Permiso de Drive.** En aizen1, instalar [rclone](https://rclone.org/downloads/) y correr
   `rclone authorize "drive" --drive-scope drive.file`. Entrar con gestionmagilus@gmail.com y copiar el
   token (el JSON `{"access_token":...}`) que imprime.
2. **Portainer**, en el stack, agregar (o actualizar desde el repositorio) el servicio `aizenbot_respaldo`
   con estas variables:
   - `RCLONE_CONFIG_DRIVE_TOKEN`: el token del paso 1, completo.
   - `RESPALDO_DATABASE_URL`: la conexión a la base (ideal: el usuario de solo lectura del paso 3).
   - `RESPALDO_AVISO_A=gestionmagilus@gmail.com`.
   - `SMTP_*` ya están en el stack (son las de la app).

   Poner las variables **antes** de levantar el servicio: sin `RESPALDO_AVISO_A` falla cada noche sin
   mandar correo (solo lo detecta la revisión de aizen1). Si la contraseña de la base tiene `@ : / #`,
   en la URL va codificada (`%40`, `%3A`, `%2F`, `%23`). No crear a mano la carpeta "Respaldos" en Drive:
   con el permiso `drive.file` rclone no la vería y crearía otra con el mismo nombre; la crea él solo.
   Lo que borra pasa a la papelera de Drive (ocupa espacio hasta que Drive la vacía a los 30 días).
3. **Usuario de solo lectura (opcional y recomendado).** Para que el respaldo no pueda escribir ni por
   error. En el servidor, `docker exec -it <contenedor de postgres> psql -U postgres -d <base>`:

   ```sql
   CREATE ROLE respaldo_lectura LOGIN PASSWORD 'una-clave-larga';
   GRANT pg_read_all_data TO respaldo_lectura;
   ALTER ROLE respaldo_lectura SET default_transaction_read_only = on;
   ```

   (`pg_read_all_data` existe desde Postgres 14.) No cambia ningún dato ni ninguna tabla. Después:
   `RESPALDO_DATABASE_URL=postgresql://respaldo_lectura:una-clave-larga@<host de la base>:5432/<base>`.
4. **Probar a mano**: en la consola del contenedor de `aizenbot_respaldo`,
   `sh ./docker/respaldo/respaldo.sh ahora`, y ver el archivo en Drive. Para probar el aviso, correrlo una
   vez con una contraseña de base equivocada y ver que llega el correo.

Si la versión del Postgres del servidor es más nueva que el `pg_dump` de la imagen (ver
`pg_dump --version` en la consola del servicio), el respaldo falla con "server version mismatch" y llega
el correo: hay que subir la versión del cliente en el `Dockerfile`.

### Copia en aizen1

1. Copiar `docker/respaldo/aizen1/config.example.json` a `config.local.json` (misma carpeta) y completar:
   la ruta de `rclone.exe`, la carpeta local y el correo (`smtp`, con contraseña de aplicación).
2. Configurar el remoto `drive` en aizen1: `rclone config create drive drive scope drive.file` (abre el
   navegador; entrar con gestionmagilus@gmail.com).
3. Registrar la tarea: `powershell -ExecutionPolicy Bypass -File docker\respaldo\aizen1\instalar-tarea-respaldo.ps1`.
   Probar ya: `Start-ScheduledTask -TaskName "Respaldo AizenCRM"`. El registro queda en la carpeta
   local, subcarpeta `logs`. La tarea corre con la sesión de Alexander: si aizen1 se reinició y nadie
   entró, corre apenas se inicie sesión.
4. La carpeta local tiene datos privados de los clientes: dejarla solo para el usuario de Alexander
   (Propiedades > Seguridad).

### Cómo restaurar un respaldo

**Nunca sobre producción.** Una restauración sobre la base real borra o duplica lo que entró después de
la copia. Siempre en una base de pruebas aparte.

**Prueba de restauración (en el servidor).** Arma una base desechable sin red (no puede llegar a la base
real), carga la copia, cuenta las tablas principales y, si `aizenbot_respaldo` está corriendo, compara con
producción en una sesión de solo lectura. Al terminar borra la base de prueba.

```sh
# la copia de anoche está en el volumen del servicio
sh docker/respaldo/restaurar-prueba.sh /var/lib/docker/volumes/aizenlite_aizenbot_respaldos/_data/aizencrm-AAAA-MM-DD.dump
```

(El guion también viaja en la imagen: `docker cp <contenedor de aizenbot_respaldo>:/app/docker/respaldo/restaurar-prueba.sh .`)
Tiene que decir "Carga sin errores" y los conteos tienen que coincidir con producción, salvo lo que
entró después de la copia.

**A mano**, si alguna vez hay que recuperar la base:

1. Bajar la copia de Drive (`Respaldos/AizenCRM/aizencrm-AAAA-MM-DD.dump`) o tomarla de aizen1.
2. Crear una base **nueva y vacía** (nunca la de producción) en un Postgres de la misma versión o más
   nueva, sin red para que no pueda tocar nada más, por ejemplo:
   `docker run -d --name restaurada --network none -e POSTGRES_PASSWORD=prueba -e POSTGRES_DB=restaurada postgres:18-alpine`,
   y esperar a que arranque: `until docker exec restaurada pg_isready -U postgres; do sleep 1; done`.
3. Cargarla:
   `docker cp aizencrm-AAAA-MM-DD.dump restaurada:/tmp/r.dump` y
   `docker exec restaurada pg_restore -U postgres -d restaurada --no-owner --no-privileges /tmp/r.dump`.
4. Revisar los datos en esa base. Pasar la app a esa base (cambiar `DATABASE_URL`) es una decisión
   aparte, que se toma con el sistema detenido.
