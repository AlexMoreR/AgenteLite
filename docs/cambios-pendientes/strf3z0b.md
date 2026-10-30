## Conceptos del negocio
- `bienvenida_v3`: en el libro V3, la bienvenida general es la regla "siempre" + "primer mensaje" y sale antes de la regla que gana. Una regla marcada "reemplaza la bienvenida" (`reemplazaLaBienvenida`, en el MCP `reemplaza_bienvenida`) trae su propia bienvenida: si gana en el primer mensaje, la general no sale. Si la regla que gana ya manda el mismo flujo que la general, tampoco se antepone. Al cliente nuevo le llega una sola. `v3_probar_mensaje` lo muestra en `bienvenida` y `v3_que_falta` avisa si hay dos bienvenidas generales o una regla marcada que no le dice nada al cliente.

## Advertencias de operación
- `bienvenida_v3_marca`: marcar "reemplaza la bienvenida" en una regla que no saluda deja a ese cliente sin bienvenida. Antes de marcarla, probar el mensaje con `v3_probar_mensaje`. `v3_probar_mensaje` no llama a la IA: las reglas por intención no se prueban ahí.
