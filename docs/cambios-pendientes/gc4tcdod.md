## Módulos
- `alertas_por_responsable`: cada alerta es de Sistemas o de Negocio (se calcula al leer con `responsableDeAlerta`, no se guarda). El responsable de Sistemas (Emanuel) se elige en /cliente/alertas (ajuste `alertas:responsable-sistemas:<workspaceId>` en AppSetting) y ve solo las de Sistemas más las personales suyas, aunque no sea jefe; Alexander ve por defecto las de Negocio y, con "Ver también las de Sistemas" (`?ver=todas`), todas. Sin el ajuste todo se ve como antes.

## Advertencias de operación
- `alertas_por_responsable`: el WhatsApp de las urgentes técnicas sigue yendo al teléfono del dueño (no cambió). Si el responsable no es dueño ni administrador, el menú no le muestra Alertas: entra por el link directo /cliente/alertas. Las cuentas de Marketplace caídas y las rutinas que no corrieron aún no generan alertas; la regla ya las manda a Sistemas por su origen ("CRM Marketplace", "Rutinas").
