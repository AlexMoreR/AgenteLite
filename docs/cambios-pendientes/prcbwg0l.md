## Conceptos del negocio
- `ventas_por_asesora`: la línea Admin nunca suma venta en `numeros_de_ventas`; la venta cuenta en la línea de ventas, a nombre de quien vendió, y un teléfono es una sola venta aunque quede GANADO en dos líneas.

## Advertencias de operación
- `ventas_solo_en_admin`: un cliente que quede GANADO solo por la línea Admin (sin chat de ventas) no cuenta como venta en los números por asesora; el recibo de caja deja Cliente/GANADO en Admin y eso ya no suma a nadie.
