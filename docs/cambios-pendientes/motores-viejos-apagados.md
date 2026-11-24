## Advertencias de operación
- `motores_viejos_volver`: el agente V1/V2 se pausa (sin borrarlo) con `node scripts/apagar-motores-viejos.mjs --aplicar` y se vuelve a dejar como estaba, con sus seguimientos "Sin responder …" y AGENT_NODE pendientes, con `node scripts/apagar-motores-viejos.mjs --volver` (lee el respaldo de AppSetting `motores-viejos:respaldo:<workspaceId>`).
- `motores_viejos_en_pausa`: con el agente V2 en pausa, un mensaje que no tiene regla en el libro del V3 ya no lo contesta el V2: lo atiende una asesora. Los seguimientos "Etapa …" del embudo siguen saliendo.

## Agentes
- `agente_que_atiende`: el que atiende a los clientes es el agente V3 (libro de reglas, `v3_ver_reglas`). El agente V2 "Magilus" está en pausa (motor viejo, sin borrar): el MCP lo muestra en `resumen_del_negocio` y `ver_agente` como "INACTIVO, no se usa", salvo que todavía atienda una línea sin V3. El embudo por producto y el diagrama del V2 son motores viejos inactivos.
