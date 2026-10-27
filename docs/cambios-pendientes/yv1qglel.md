## Módulos
- `embudo`: Embudo, Comparar embudos, Pauta, Recuperación e Informe pasaron del CRM al módulo Dirección: `/cliente/direccion/embudo`, `/cliente/direccion/comparar-embudos`, `/cliente/direccion/pauta`, `/cliente/direccion/recuperacion` y `/cliente/direccion/informe`. Las rutas viejas `/cliente/crm/<pantalla>` redirigen (307) con su query; `/cliente/crm?view=informe` va a Dirección → Informe. Quién ve cada una no cambió (solo dueño / administrador).

## Advertencias de operación
- `uso_por_ruta_direccion`: la herramienta `uso del sistema` cuenta las visitas por ruta. El historial de Embudo, Comparar embudos, Pauta, Recuperación e Informe queda bajo `/cliente/crm/...` y las rutas nuevas `/cliente/direccion/...` empiezan de cero.
