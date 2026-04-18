import { redirect } from "next/navigation";

export default async function OfficialApiFlowsPage() {
  redirect("/cliente/flujos?sourceType=official-api");
}
