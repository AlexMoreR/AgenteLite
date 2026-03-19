export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateRetailPrice(baseCost: number, retailMarginPct: number): number {
  return roundMoney(baseCost * (1 + retailMarginPct / 100));
}

export function calculateWholesalePrice(baseCost: number, wholesaleMarginPct: number): number {
  return roundMoney(baseCost * (1 + wholesaleMarginPct / 100));
}

export function calculateMarginPctFromPrice(baseCost: number, finalPrice: number): number {
  if (baseCost <= 0) {
    return 0;
  }

  return roundMoney(((finalPrice - baseCost) / baseCost) * 100);
}

export function calculateProfit(baseCost: number, finalPrice: number): number {
  return roundMoney(finalPrice - baseCost);
}
