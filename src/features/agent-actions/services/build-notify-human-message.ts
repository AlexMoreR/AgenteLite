export function buildNotifyHumanMessage(input: {
  agentName: string;
  customerLabel: string;
  customerPhoneNumber: string;
  latestUserMessage: string;
}) {
  const latestMessage = input.latestUserMessage.trim().slice(0, 240);

  return [
    "Solicitud de atencion humana",
    `Agente: ${input.agentName.trim() || "Agente"}`,
    `Cliente: ${input.customerLabel.trim() || "Cliente"}`,
    `Telefono: ${input.customerPhoneNumber.trim() || "No disponible"}`,
    `Mensaje: ${latestMessage || "Sin mensaje"}`,
  ].join("\n");
}

