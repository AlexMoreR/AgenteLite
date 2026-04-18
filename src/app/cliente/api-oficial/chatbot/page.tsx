import { redirect } from "next/navigation";

export default async function OfficialApiChatbotPage() {
  redirect("/cliente/flujos?sourceType=official-api");
}
