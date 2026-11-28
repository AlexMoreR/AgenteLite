import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Solo texto: no importa acciones ni datos.
const BOTONES: { nombre: string; texto: string }[] = [
  { nombre: "Tomarlo", texto: "Te asigna el chat a ti. Aparece cuando el chat está sin asignar y tu foto queda en la cabecera." },
  { nombre: "Tomar control", texto: "Pausa al agente de IA en este chat para que escribas tú. También se pausa solo si empiezas a escribir." },
  { nombre: "Devolverle el chat", texto: "Vuelve a dejar el chat en manos del agente, como estaba antes." },
  { nombre: "Pausar", texto: "Detiene los seguimientos automáticos de este chat sin borrar el próximo." },
  { nombre: "Cambiar hora", texto: "Mueve el próximo seguimiento a otra hora." },
  { nombre: "Cancelar", texto: "Quita el próximo seguimiento de este chat." },
  { nombre: "Resolver", texto: "Marca el chat como resuelto. En celular está dentro del menú de tres puntos." },
  { nombre: "Menú de tres puntos", texto: "Guarda lo menos usado: Etapa, Interruptor de IA, Seguimientos, Candado y Posponer. En celular suma Llamar y Resolver." },
];

const CAMBIOS: string[] = [
  "Se rehace la cabecera en src/components/chats/chat-conversation-panel.tsx y src/components/chats/chat-header-actions.tsx.",
  "La franja del agente usa fijarPausaDeIAEnChatAction; Tomarlo usa assignChatAction; Cancelar usa cancelarSeguimientoDelChatAction.",
  "Pausar usa el interruptor de seguimientos del chat que ya existe, sin migración.",
  "Cambiar hora necesita una acción nueva.",
  "La foto del asesor sale de User.image.",
  "El agente se apaga cuando escribe la asesora: ya pasa por WhatsApp normal y falta en la API oficial.",
  "Al devolverle el chat, el agente se porta como hoy con el interruptor de IA.",
  "La maqueta se borra en esa misma tarjeta.",
];

export function Explicacion() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Qué hace cada botón</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <ul className="space-y-2 text-sm">
          {BOTONES.map((b) => (
            <li key={b.nombre}>
              <span className="font-semibold">{b.nombre}:</span> {b.texto}
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Qué cambiará en el código real (otra tarjeta, después del sí de Alexander)</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {CAMBIOS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
