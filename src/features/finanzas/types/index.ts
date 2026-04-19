import type { SupportedCurrencyCode } from "@/lib/currency";

export type FinanceTransactionType = "INCOME" | "EXPENSE";

export type FinanceTransaction = {
  id: string;
  type: FinanceTransactionType;
  amount: number;
  description: string;
  category: string | null;
  date: string;
  source: string;
  createdAt: string;
};

export type FinanceGoogleSheet = {
  id: string;
  sheetUrl: string;
  sheetId: string;
  lastSyncAt: string | null;
};

export type FinanzasData = {
  transactions: FinanceTransaction[];
  googleSheet: FinanceGoogleSheet | null;
  workspaceId: string;
  serviceAccountEmail: string | null;
  currency: SupportedCurrencyCode;
};

export type ParsedTransaction = {
  type: FinanceTransactionType;
  amount: number;
  description: string;
};
