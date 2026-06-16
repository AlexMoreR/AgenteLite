export function buildNotifyHumanMessage(input: {
  customerLabel: string;
  customerPhoneNumber: string;
  description: string;
}) {
  const description = input.description.trim().slice(0, 600) || "Sin descripción";
  const phone = input.customerPhoneNumber.replace(/[^\d]/g, "").trim();

  return [
    "✅ *Tienes Nueva Solicitud*:",
    "",
    `👤 *Nombre*: ${input.customerLabel.trim() || "Cliente"}`,
    "📝 *Descripción*:",
    description,
    "",
    `👉 +${phone || "Sin número"}`,
  ].join("\n");
}
