"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { FacebookAdsAspectRatio } from "@/lib/marketing";
import { collectFacebookAdsFormInput, facebookAdsFormSchema } from "@/lib/marketing";
import {
  generateFacebookAdsCopy,
  generateMarketingImage,
  getMarketingAiDefaults,
  saveMarketingReferenceImage,
  saveGeneratedMarketingImage,
} from "@/lib/marketing-ai";
import { createMarketingGeneration, deleteMarketingGeneration, updateMarketingGeneration } from "@/lib/marketing-store";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export async function generateFacebookAdsCreativeAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/marketing-ia/facebook-ads?error=Debes+configurar+tu+negocio+primero");
  }

  const parsed = facebookAdsFormSchema.safeParse(collectFacebookAdsFormInput(formData));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Datos invalidos";
    redirect(`/cliente/marketing-ia/facebook-ads?error=${encodeURIComponent(message)}`);
  }

  const defaults = getMarketingAiDefaults();
  const rawReferenceImage = formData.get("referenceImage");
  const referenceImage = rawReferenceImage instanceof File && rawReferenceImage.size > 0 ? rawReferenceImage : null;
  let referenceImageUrl: string | null = null;

  if (referenceImage) {
    try {
      referenceImageUrl = await saveMarketingReferenceImage({
        file: referenceImage,
        workspaceSlug: membership.workspace.slug,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "No se pudo procesar la imagen del producto";
      redirect(`/cliente/marketing-ia/facebook-ads?error=${encodeURIComponent(message)}`);
    }
  }

  const generation = await createMarketingGeneration({
    id: randomUUID(),
    workspaceId: membership.workspace.id,
    tool: "FACEBOOK_ADS",
    provider: defaults.provider,
    status: "PENDING",
    model: defaults.model,
    imageModel: defaults.imageModel,
    input: {
      ...parsed.data,
      referenceImageUrl,
    },
  });

  let output: Awaited<ReturnType<typeof generateFacebookAdsCopy>> | null = null;

  try {
    output = await generateFacebookAdsCopy({
      workspaceName: membership.workspace.name,
      input: parsed.data,
    });

    await updateMarketingGeneration({
      id: generation.id,
      output,
    });

    const generatedImage = await generateMarketingImage({
      prompt: output.imagePrompt,
      aspectRatio: parsed.data.aspectRatio as FacebookAdsAspectRatio,
      input: parsed.data,
      output,
      referenceImage,
    });
    const imageUrl = await saveGeneratedMarketingImage({
      base64: generatedImage.base64,
      workspaceSlug: membership.workspace.slug,
    });

    await updateMarketingGeneration({
      id: generation.id,
      status: "SUCCEEDED",
      output,
      imageUrl,
      errorMessage: null,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "No se pudo generar el creativo";

    await updateMarketingGeneration({
      id: generation.id,
      status: "FAILED",
      output: output ?? undefined,
      errorMessage: message,
    });

    revalidatePath("/cliente/marketing-ia");
    revalidatePath("/cliente/marketing-ia/facebook-ads");
    redirect(
      `/cliente/marketing-ia/facebook-ads?historyId=${generation.id}&error=${encodeURIComponent(
        "No pudimos completar la generacion con OpenAI",
      )}`,
    );
  }

  revalidatePath("/cliente");
  revalidatePath("/cliente/marketing-ia");
  revalidatePath("/cliente/marketing-ia/facebook-ads");
  redirect(`/cliente/marketing-ia/facebook-ads?historyId=${generation.id}&ok=Creativo+generado`);
}

export async function deleteMarketingHistoryAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/marketing-ia/facebook-ads?error=Debes+configurar+tu+negocio+primero");
  }

  const historyId = String(formData.get("historyId") || "").trim();
  if (!historyId) {
    redirect("/cliente/marketing-ia/facebook-ads?error=No+encontramos+el+historial+a+eliminar");
  }

  const deleted = await deleteMarketingGeneration({
    id: historyId,
    workspaceId: membership.workspace.id,
  });

  revalidatePath("/cliente");
  revalidatePath("/cliente/marketing-ia");
  revalidatePath("/cliente/marketing-ia/facebook-ads");

  if (!deleted) {
    redirect("/cliente/marketing-ia/facebook-ads?error=No+se+pudo+eliminar+el+historial");
  }

  redirect("/cliente/marketing-ia/facebook-ads?ok=Historial+eliminado");
}
