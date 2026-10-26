## Qué no existe hoy
- `reuniones_sin_grabar`: la opción "Sin grabar" solo se elige al crear la reunión; no se puede cambiar con la reunión ya empezada, y una reunión sin grabar no deja audio, transcripción ni acta.

## Advertencias de operación
- `reuniones_sin_grabar`: las reuniones sin grabar pasan directo a "Lista" al cerrarse la sala, sin pasar por la cola de transcripción (no gastan tokens de OpenAI ni disco).
