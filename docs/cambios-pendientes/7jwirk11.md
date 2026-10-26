## Automatizaciones
- `ci_de_rama`: el Coordinador sube la rama `tablero/*` y espera el resultado de GitHub Actions en vez de compilar en aizen1 (interruptor `ciDeRama` en la configuración del repositorio del Coordinador); si Actions no responde en 20 minutos, compila en aizen1.

## Advertencias de operación
- `ci_de_rama`: con `ciDeRama` prendido la rama se sube antes de probarla (es una rama de trabajo, no `main`); el ensayo de migraciones contra producción sigue en aizen1 porque las claves no van a GitHub, y la tarjeta guarda `linkWorkflow` y `verificadoEn`.
