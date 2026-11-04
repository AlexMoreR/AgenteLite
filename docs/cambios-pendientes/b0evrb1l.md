## Qué no existe hoy
- `contraentrega_lista_envio`: la línea "Contraentrega: envío $X (paga al recibir $Y)" debajo de cada lugar de la lista del panel de Envío del chat depende del dato `contraentrega` que mande Gestión en `/api/transporte/ubicaciones` (con sus reglas `isCamillasCombo` y `contraentregaShippingFee`); mientras Gestión no lo mande, la lista no muestra contraentrega.
