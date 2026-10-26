## Automatizaciones
- `etapa_automatica`: al asignar un chat a una asesora el lead pasa de NUEVO a Frío; al crear una cotización en Gestión desde el chat, o al ENVIAR al cliente el panel de envío con el total, pasa a Caliente. Nunca pone Ganado ni Perdido, nunca baja a un lead y no toca leads cerrados, fuera del CRM ni de la línea administrativa. Deja la nota "Etapa movida por el sistema: ..." en el chat y una fila en el historial de etapas (origen AUTOMATICO). Se apaga con el AppSetting `crm:etapa-automatica:<negocio>` = `off`.

## Advertencias de operación
- `etapa_automatica_seguimientos`: si algún día se crea una regla de seguimiento por etapa (CRM_STAGE) Frío o Caliente, se disparará en unos 90 leads al día, porque la etapa automática dispara las mismas reglas que mover la tarjeta a mano. Hoy las 2 reglas activas son por producto y por paso del agente.
- `etapa_automatica_nuevos_viejos`: los leads que ya estaban en NUEVO antes de prender la etapa automática no se mueven solos; las asesoras los clasifican desde el aviso de "Mi día".
