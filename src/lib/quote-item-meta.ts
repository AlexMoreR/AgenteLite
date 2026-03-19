export type QuoteItemMeta = {
  description: string;
  color: string;
  additionalCost: number;
  discount: number;
};

const EMPTY_QUOTE_ITEM_META: QuoteItemMeta = {
  description: "",
  color: "",
  additionalCost: 0,
  discount: 0,
};

export function parseQuoteItemMeta(value: string | null | undefined): QuoteItemMeta {
  const raw = value?.trim();
  if (!raw) {
    return EMPTY_QUOTE_ITEM_META;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<QuoteItemMeta> & { _type?: string };
    if (parsed?._type === "quote-item-meta") {
      return {
        description: typeof parsed.description === "string" ? parsed.description : "",
        color: typeof parsed.color === "string" ? parsed.color : "",
        additionalCost: typeof parsed.additionalCost === "number" ? parsed.additionalCost : 0,
        discount: typeof parsed.discount === "number" ? parsed.discount : 0,
      };
    }
  } catch {
    // Legacy plain-text notes.
  }

  return {
    ...EMPTY_QUOTE_ITEM_META,
    description: raw,
  };
}

export function stringifyQuoteItemMeta(meta: Partial<QuoteItemMeta>): string | null {
  const normalized: QuoteItemMeta = {
    description: meta.description?.trim() ?? "",
    color: meta.color?.trim() ?? "",
    additionalCost: Number.isFinite(meta.additionalCost) ? Number(meta.additionalCost) : 0,
    discount: Number.isFinite(meta.discount) ? Number(meta.discount) : 0,
  };

  if (!normalized.description && !normalized.color && normalized.additionalCost === 0 && normalized.discount === 0) {
    return null;
  }

  return JSON.stringify({
    _type: "quote-item-meta",
    ...normalized,
  });
}

export function calculateQuoteLineTotal(
  quantity: number,
  unitPrice: number,
  additionalCost = 0,
  discount = 0,
): number {
  return Number(Math.max(0, quantity * unitPrice + additionalCost - discount).toFixed(2));
}
