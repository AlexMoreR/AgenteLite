## Automatizaciones
- `demora_de_asesora`: si un chat de ventas asignado (canal WhatsApp viejo) lleva 5 minutos sin respuesta humana, la asesora recibe el push "Tienes un cliente esperando" (un aviso por espera, máximo 15 por vuelta). Corre cada minuto solo de 7:00 a 23:00; el reloj cuenta desde lo más reciente entre el mensaje de la clienta, la asignación a esa asesora, el momento de prender la regla y las 7:00 de hoy. Las esperas de antes de prenderla no avisan, y a la asesora fuera de su horario de reparto no se le avisa. Viene APAGADA: se prende con la fila `chats:demora-asesora:config:<negocio>` = `{"activo": true}` en AppSetting. No reasigna (eso es la parte 2) ni le escribe al cliente.

## Qué no existe hoy
- `demora_de_asesora_celular_sin_autor`: un mensaje mandado desde el celular (source=instance) no guarda qué asesora lo escribió. Cuenta como respuesta al cliente y detiene el reloj de la demora, pero no sirve para saber qué asesora está activa.
- `demora_de_asesora_linea_oficial`: la regla de la demora de la asesora no corre en la línea oficial: su asignación no deja nota con la hora y no se puede saber desde cuándo corre el reloj de la asesora.
