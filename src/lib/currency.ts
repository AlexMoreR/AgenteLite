export const DEFAULT_SYSTEM_CURRENCY = "COP" as const;

export const SUPPORTED_CURRENCIES = [
  { code: "COP", label: "Peso colombiano (COP)", locale: "es-CO" },
  { code: "USD", label: "Dolar estadounidense (USD)", locale: "en-US" },
  { code: "EUR", label: "Euro (EUR)", locale: "es-ES" },
  { code: "MXN", label: "Peso mexicano (MXN)", locale: "es-MX" },
  { code: "PEN", label: "Sol peruano (PEN)", locale: "es-PE" },
  { code: "CLP", label: "Peso chileno (CLP)", locale: "es-CL" },
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

function getCurrencyLocale(currency: SupportedCurrencyCode): string {
  return SUPPORTED_CURRENCIES.find((item) => item.code === currency)?.locale ?? "es-CO";
}

export function isSupportedCurrency(code: string): code is SupportedCurrencyCode {
  return SUPPORTED_CURRENCIES.some((item) => item.code === code);
}

export function formatMoney(value: number | string, currency: SupportedCurrencyCode): string {
  const numericValue = Number(value);
  const locale = getCurrencyLocale(currency);
  const moneyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (!Number.isFinite(numericValue)) {
    return moneyFormatter.format(0);
  }

  return moneyFormatter.format(numericValue);
}
