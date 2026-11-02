// Límite de intentos y lógica de "¿Olvidaste tu contraseña?" (/recuperar-contrasena).
//
// Este archivo no importa la base ni el correo: la acción del servidor le pasa esas piezas.
// Así las pruebas corren sin base (src/lib/limite-recuperacion-de-clave.test.ts).

// El aviso es SIEMPRE el mismo, exista o no el correo, para no revelar qué correos están registrados.
export const AVISO_RECUPERACION =
  "Si el correo está registrado, te llegó un link para cambiar la contraseña. Revisa también la carpeta de spam.";

// Por correo: máximo 3 enlaces por hora. Se cuentan en la tabla EmailAuthToken, así que no se pierde al reiniciar.
export const MAXIMO_ENLACES_POR_CORREO = 3;
export const VENTANA_POR_CORREO_MS = 60 * 60 * 1000;

// Por IP: máximo 10 pedidos cada 15 minutos. Vive en la memoria del servidor: se reinicia al desplegar.
export const MAXIMO_PEDIDOS_POR_IP = 10;
export const VENTANA_POR_IP_MS = 15 * 60 * 1000;

// Tope de IPs guardadas, para que la memoria no crezca sin fin si alguien manda pedidos desde muchas IPs.
const MAXIMO_IPS_GUARDADAS = 5000;

export type LimitePorIp = {
  // Anota el pedido y dice si se puede atender (true) o ya pasó el límite (false).
  permitir: (ip: string, ahora: number) => boolean;
};

export function crearLimitePorIp(
  maximo = MAXIMO_PEDIDOS_POR_IP,
  ventanaMs = VENTANA_POR_IP_MS,
): LimitePorIp {
  const pedidosPorIp = new Map<string, number[]>();

  function limpiarViejos(ahora: number) {
    for (const [ip, momentos] of pedidosPorIp) {
      const vigentes = momentos.filter((momento) => ahora - momento < ventanaMs);
      if (vigentes.length === 0) pedidosPorIp.delete(ip);
      else pedidosPorIp.set(ip, vigentes);
    }
  }

  return {
    permitir(ip, ahora) {
      if (pedidosPorIp.size >= MAXIMO_IPS_GUARDADAS) limpiarViejos(ahora);

      const vigentes = (pedidosPorIp.get(ip) ?? []).filter((momento) => ahora - momento < ventanaMs);
      if (vigentes.length >= maximo) {
        pedidosPorIp.set(ip, vigentes);
        return false;
      }

      vigentes.push(ahora);
      pedidosPorIp.set(ip, vigentes);
      return true;
    },
  };
}

// La IP real viene primero en x-forwarded-for (la pone el proxy de producción).
export function leerIp(encabezados: { get: (nombre: string) => string | null }): string {
  const reenviada = encabezados.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (reenviada) return reenviada;
  return encabezados.get("x-real-ip")?.trim() || "desconocida";
}

export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

export type UsuarioParaRecuperar = { id: string; email: string; name: string | null };

export type PiezasDeRecuperacion = {
  ahora: () => number;
  limitePorIp: LimitePorIp;
  buscarUsuario: (correo: string) => Promise<UsuarioParaRecuperar | null>;
  contarEnlacesDesde: (userId: string, desde: Date) => Promise<number>;
  enviarEnlace: (usuario: UsuarioParaRecuperar) => Promise<void>;
  // En la acción es after() de Next: el trabajo corre después de responder,
  // así la respuesta tarda lo mismo exista o no el correo.
  despues: (trabajo: () => Promise<void>) => void;
  registrar: (mensaje: string, error?: unknown) => void;
};

// Usuarios con un envío en curso: si llegan varios pedidos a la vez del mismo correo, solo se atiende uno,
// para que no se salten el límite contando la tabla antes de que el primero guarde su enlace.
const enCurso = new Set<string>();

// Atiende un pedido ya validado. La respuesta es siempre el mismo aviso; lo que pasó solo queda en el registro.
export function atenderPedidoDeRecuperacion(
  pedido: { correo: string; ip: string },
  piezas: PiezasDeRecuperacion,
): { ok: true; message: string } {
  const correo = normalizarCorreo(pedido.correo);

  if (!piezas.limitePorIp.permitir(pedido.ip, piezas.ahora())) {
    piezas.registrar("Recuperación de clave: límite por IP alcanzado");
    return { ok: true, message: AVISO_RECUPERACION };
  }

  piezas.despues(async () => {
    try {
      const usuario = await piezas.buscarUsuario(correo);
      if (!usuario) return;

      if (enCurso.has(usuario.id)) return;
      enCurso.add(usuario.id);
      try {
        const desde = new Date(piezas.ahora() - VENTANA_POR_CORREO_MS);
        const enviados = await piezas.contarEnlacesDesde(usuario.id, desde);
        if (enviados >= MAXIMO_ENLACES_POR_CORREO) {
          piezas.registrar(`Recuperación de clave: límite por correo alcanzado (usuario ${usuario.id})`);
          return;
        }

        await piezas.enviarEnlace(usuario);
      } finally {
        enCurso.delete(usuario.id);
      }
    } catch (error) {
      piezas.registrar("Recuperación de clave: no se pudo enviar el enlace", error);
    }
  });

  return { ok: true, message: AVISO_RECUPERACION };
}
