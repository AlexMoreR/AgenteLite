## Entidades
- `BaseDeDatosTarjeta`: (28-nov-2026) las columnas de una base de datos de un Espacio, 1 a 1 con su tarjeta del tipo «Base de datos» (`tarjetaId`). `columnas` es JSON `[{ id, nombre }]`, todas de texto; la columna # no se guarda: es el número de la fila. `siguienteNumero` da el # de la próxima fila y no se reusa.
- `FilaBaseDeDatos`: (28-nov-2026) una fila de esa base: `numero` (el #, único por base) y `valores` JSON `{ idColumna: texto }`. Quitar una columna borra su valor de todas las filas.

## Módulos
- `tablero-ia`: (28-nov-2026) en «+ Nuevo» del Espacio hay **Base de datos**: crea una tarjeta del tipo «Base de datos» (el tipo nace solo en el espacio, sin estados, y puede ir dentro de cualquier Área) con # y dos columnas de texto. Tocarla en el mapa (o en Tabla, Tablero o Calendario) abre su tabla: cambiar el nombre de la base y de las columnas escribiendo encima, «+ Columna», quitar columna (X), «+ Fila», editar celdas (se guardan al salir) y borrar fila. «Detalles» abre su ficha (mover, eliminar). Tocar un Área entra a ella aunque esté vacía.

## Advertencias de operación
- `bases_de_datos_del_espacio`: la IA NO lee las filas al mirar el espacio: `ver_tablero` solo marca la tarjeta con `base_de_datos: true`. Las filas se leen con `leer_base_de_datos` y se escriben con `escribir_en_base_de_datos`, y las dos dicen que solo se usan si la persona lo pide. Si alguien le cambia el nombre al tipo «Base de datos» en el panel Tipos, sus tarjetas dejan de abrir la tabla.
