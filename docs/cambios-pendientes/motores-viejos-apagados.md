## Advertencias de operación
- `motores_viejos_volver`: el agente V1/V2 se pausa (sin borrarlo) con `node scripts/apagar-motores-viejos.mjs --aplicar` y se vuelve a dejar como estaba, con sus seguimientos "Sin responder …" y AGENT_NODE pendientes, con `node scripts/apagar-motores-viejos.mjs --volver` (lee el respaldo de AppSetting `motores-viejos:respaldo:<workspaceId>`).
- `motores_viejos_en_pausa`: con el agente V2 en pausa, un mensaje que no tiene regla en el libro del V3 ya no lo contesta el V2: lo atiende una asesora. Los seguimientos "Etapa …" del embudo siguen saliendo.
