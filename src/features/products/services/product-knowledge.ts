import type { ProductKnowledgeRecord } from "@/features/products/types/product-knowledge";

function normalizeText(value: string | null | undefined) {
  return value?.trim() || "";
}

export function formatProductKnowledgePromptItem(product: ProductKnowledgeRecord) {
  const lines = [
    `Codigo: ${normalizeText(product.code) || "sin codigo"}`,
    `Slug: ${normalizeText(product.slug) || "sin slug"}`,
    `Nombre: ${normalizeText(product.name) || "sin nombre"}`,
    `Descripcion: ${normalizeText(product.description) || "sin descripcion"}`,
    `Precio: ${normalizeText(product.price) || "sin precio"}`,
    `Categoria: ${normalizeText(product.categoryName) || "sin categoria"}`,
    `Imagen: ${normalizeText(product.thumbnailUrl) || "sin imagen"}`,
    `Instruccion: ${normalizeText(product.instructions) || "sin instruccion"}`,
  ];

  return lines.join(" | ");
}

export function buildProductKnowledgeReplyText(product: ProductKnowledgeRecord) {
  const name = normalizeText(product.name) || "este producto";
  const parts = [
    `Te comparto la informacion de ${name}:`,
    `Codigo: ${normalizeText(product.code) || "No disponible"}`,
    `Slug: ${normalizeText(product.slug) || "No disponible"}`,
    `Descripcion: ${normalizeText(product.description) || "No disponible"}`,
    `Precio: ${normalizeText(product.price) || "No disponible"}`,
    `Categoria: ${normalizeText(product.categoryName) || "No disponible"}`,
  ];

  return parts.join("\n");
}

export function buildProductKnowledgeImageCaption(product: ProductKnowledgeRecord) {
  const name = normalizeText(product.name) || "este producto";
  return `Te comparto la imagen de ${name}.`;
}

