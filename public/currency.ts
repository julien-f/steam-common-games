import { formatMoney } from './utils.ts';

// Approximate exchange rates, for ordering and adding up prices in different currencies (a shop
// that only prices in USD, beside euro ones) — never shown as a price on their own, only as an
// "≈" hint. Per 1 EUR, as of 2026-09; stale rates only blur an order, so refresh them now and then
// rather than fetching them.
export const RATES_PER_EUR: Record<string, number> = {
  EUR: 1,
  USD: 1.17,
  GBP: 0.87,
  CAD: 1.62,
  AUD: 1.78,
  JPY: 173,
  BRL: 6.3,
  RUB: 95,
  TRY: 48,
  UAH: 48,
  ARS: 1600,
  INR: 103,
  CNY: 8.4,
  KRW: 1630,
  MXN: 21.6,
};

// region.ts's COUNTRY_OPTIONS, by the currency each prices in.
export const REGION_CURRENCY: Record<string, string> = {
  US: 'USD',
  GB: 'GBP',
  DE: 'EUR',
  CA: 'CAD',
  AU: 'AUD',
  JP: 'JPY',
  BR: 'BRL',
  RU: 'RUB',
  TR: 'TRY',
  UA: 'UAH',
  AR: 'ARS',
  IN: 'INR',
  CN: 'CNY',
  KR: 'KRW',
  MX: 'MXN',
};

// Null when either currency is unknown.
export function convert(amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  const a = RATES_PER_EUR[from];
  const b = RATES_PER_EUR[to];
  return a && b ? (amount / a) * b : null;
}

// A price in its own currency, plus "≈ €9.20" in `target`'s when they differ and a rate is known.
// `unit` follows the own-currency figure: "$1.17/game (≈ €1.00)".
export function formatWithEstimate(amount: number, currency: string, target: string, unit = ''): string {
  const own = formatMoney(amount, currency) + unit;
  const estimate = currency === target ? null : convert(amount, currency, target);
  return estimate == null ? own : `${own} (≈ ${formatMoney(estimate, target)})`;
}
