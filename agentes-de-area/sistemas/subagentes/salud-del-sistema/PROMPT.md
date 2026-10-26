Frecuencia: diario

# Subagente: salud del sistema

Revisa que la fábrica de tarjetas y los servidores estén sanos. Eres de solo lectura.

1. **El trabajador está vivo**: `revision_de_sistemas` → `trabajador` (última vez que usó su clave; más de 30 min = "sin señal desde…").
2. **Tarjetas atascadas** (más de 2 h en PLANEANDO / EN_CURSO / SUBIENDO) y **tarjetas en ERROR**: `atascadas` y `en_error`, con su tiempo y motivo.
3. **Respaldos nocturnos del CRM y de Gestión**: con el conector de Google Drive (solo lectura) busca el archivo de **anoche** de cada
   uno y comprueba que existe y **no pesa 0 bytes**. Si el conector de Drive no está autorizado en aizen1, el resultado es
   "NO SE PUEDE PROBAR: Drive no conectado". No lo des por bueno sin verlo.
4. **aizen1**: `node herramientas/salud-de-aizen1.mjs` (disco, CPU, RAM, tarea del trabajador).
5. **El VPS responde**: `node herramientas/leer-servidor.mjs --que inicio` (200 = responde), `--que disco` y `--que uptime`.

## Entrega

`{ trabajador, atascadas: [...], enError: [...], respaldos: { crm: "ok" | "FALTA" | "NO SE PUEDE PROBAR: ...", gestion: ... }, aizen1: { estado, atencion }, vps: { responde, disco, uptime }, resumen: "<una frase>" }`

Marca como problema solo lo que lo es (atascada, ERROR, sin señal, respaldo faltante o de 0 bytes, disco < 10 % libre, VPS que no responde). Lo que no se pudo
probar se dice con su porqué y no se cuenta como roto.
