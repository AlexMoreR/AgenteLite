## Automatizaciones
- `etapa_automatica`: al asignar un chat a una asesora, el lead pasa de NUEVO a Frío; al crear una cotización desde el chat o enviar al cliente el panel de envío con el total, pasa a Caliente. Nunca pone Ganado ni Perdido ni baja a un lead, y deja la nota "Etapa movida por el sistema: ..." en el chat y una fila en el historial de etapas (origen AUTOMATICO). Interruptor: AppSetting `crm:etapa-automatica:<negocio>` = `off`.

## Advertencias de operación
- `etapa_automatica_seguimientos`: si algún día se crea una regla de seguimiento por etapa Frío o Caliente (CRM_STAGE), se dispara en unos 90 leads al día. Los ~1.900 leads que ya estaban en NUEVO no se mueven solos: las asesoras los clasifican desde el aviso de "Mi día".
