## Advertencias de operación
- `chats_automaticos`: el Supervisor detecta chats de robots (bancos, Nequi, Daviplata, códigos de verificación) que nadie ha respondido, los oculta del CRM (`excludedFromCrm`, nota en `metadata.chatAutomatico`) y no avisa por ellos. Si oculta a un cliente real, se muestra de nuevo desde Contactos y no se vuelve a ocultar.
