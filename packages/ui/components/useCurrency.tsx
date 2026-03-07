'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Symbol prefixes for known currencies
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '\u20ac', GBP: '\u00a3', JPY: '\u00a5', CAD: 'C$', AUD: 'A$',
  CHF: 'CHF ', CNY: '\u00a5', INR: '\u20b9', BRL: 'R$', KRW: '\u20a9',
  MXN: 'MX$', SEK: 'kr ', NOK: 'kr ', PLN: 'z\u0142', CZK: 'K\u010d ',
  HKD: 'HK$', SGD: 'S$', TWD: 'NT$', THB: '\u0e3f', PHP: '\u20b1',
  IDR: 'Rp ', MYR: 'RM ', VND: '\u20ab', ZAR: 'R ', TRY: '\u20ba',
  RUB: '\u20bd', UAH: '\u20b4', ILS: '\u20aa', AED: 'AED ', SAR: 'SAR ',
  NGN: '\u20a6', KES: 'KSh ', GHS: 'GH\u20b5', EGP: 'E\u00a3', PKR: 'Rs ',
  BDT: '\u09f3', LKR: 'Rs ', NPR: 'Rs ', ARS: 'AR$', CLP: 'CL$',
  COP: 'CO$', PEN: 'S/', UYU: '$U ', DKK: 'kr ', ISK: 'kr ',
  HUF: 'Ft ', RON: 'lei ', BGN: 'лв ', HRK: 'kn ', RSD: 'din ',
  NZD: 'NZ$', FJD: 'FJ$',
  BTC: '\u20bf', ETH: '\u039e', SOL: 'SOL ', XMR: 'XMR ', LTC: '\u0141',
  DOGE: '\u00d0', XRP: 'XRP ', ADA: 'ADA ', DOT: 'DOT ', AVAX: 'AVAX ',
  MATIC: 'MATIC ', LINK: 'LINK ', UNI: 'UNI ', ZEC: 'ZEC ',
};

// Crypto needs more decimal places
const CRYPTO_CODES = new Set(['BTC', 'ETH', 'SOL', 'XMR', 'LTC', 'DOGE', 'XRP', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'ZEC']);

export interface CurrencyFormatter {
  /** Format a USD amount in the user's primary currency */
  format: (usd: number) => string;
  /** Format in all selected currencies, joined by separator */
  formatAll: (usd: number, sep?: string) => string;
  /** The primary currency code (e.g. "EUR", "BTC") */
  code: string;
  /** All selected currency codes */
  codes: string[];
  /** The primary conversion rate from USD */
  rate: number;
  /** Whether rates are still loading */
  loading: boolean;
}

function formatInCurrency(usd: number, code: string, rate: number | null): string {
  if (code === 'USD' || rate === null) return formatUSD(usd);
  const converted = usd * rate;
  const sym = CURRENCY_SYMBOLS[code] ?? `${code} `;
  if (CRYPTO_CODES.has(code)) {
    if (converted < 0.0001) return `${sym}${converted.toExponential(2)}`;
    if (converted < 1) return `${sym}${converted.toPrecision(4)}`;
    return `${sym}${converted.toFixed(4)}`;
  }
  if (converted >= 1) return `${sym}${converted.toFixed(2)}`;
  if (converted >= 0.01) return `${sym}${converted.toFixed(2)}`;
  if (converted > 0) return `${sym}${converted.toFixed(4)}`;
  return `${sym}0.00`;
}

export function useCurrency(): CurrencyFormatter {
  const { data: settings } = useSWR('/api/settings', fetcher, { revalidateOnFocus: false });
  const raw = settings?.display_currency || 'USD';
  const codes = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
  const code = codes[0] || 'USD';

  const needsRates = codes.some((c: string) => c !== 'USD');
  const { data: rates, isLoading } = useSWR(
    needsRates ? '/api/mesh/rates' : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 3600_000 }
  );

  const getRate = (c: string) => c === 'USD' ? 1 : (rates?.fiat?.[c] ?? rates?.crypto?.[c] ?? null);

  const format = (usd: number): string => formatInCurrency(usd, code, getRate(code));

  const formatAll = (usd: number, sep = ' · '): string => {
    return codes.map((c: string) => formatInCurrency(usd, c, getRate(c))).join(sep);
  };

  return { format, formatAll, code, codes, rate: getRate(code) ?? 1, loading: isLoading };
}

function formatUSD(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd > 0) return `$${usd.toFixed(4)}`;
  return '$0.00';
}

export const AVAILABLE_CURRENCIES = [
  // Major fiat
  { code: 'USD', label: 'US Dollar', group: 'Major' },
  { code: 'EUR', label: 'Euro', group: 'Major' },
  { code: 'GBP', label: 'British Pound', group: 'Major' },
  { code: 'JPY', label: 'Japanese Yen', group: 'Major' },
  { code: 'CAD', label: 'Canadian Dollar', group: 'Major' },
  { code: 'AUD', label: 'Australian Dollar', group: 'Major' },
  { code: 'CHF', label: 'Swiss Franc', group: 'Major' },
  { code: 'CNY', label: 'Chinese Yuan', group: 'Major' },
  // Asia-Pacific
  { code: 'INR', label: 'Indian Rupee', group: 'Asia-Pacific' },
  { code: 'KRW', label: 'Korean Won', group: 'Asia-Pacific' },
  { code: 'HKD', label: 'Hong Kong Dollar', group: 'Asia-Pacific' },
  { code: 'SGD', label: 'Singapore Dollar', group: 'Asia-Pacific' },
  { code: 'TWD', label: 'Taiwan Dollar', group: 'Asia-Pacific' },
  { code: 'THB', label: 'Thai Baht', group: 'Asia-Pacific' },
  { code: 'PHP', label: 'Philippine Peso', group: 'Asia-Pacific' },
  { code: 'IDR', label: 'Indonesian Rupiah', group: 'Asia-Pacific' },
  { code: 'MYR', label: 'Malaysian Ringgit', group: 'Asia-Pacific' },
  { code: 'VND', label: 'Vietnamese Dong', group: 'Asia-Pacific' },
  { code: 'NZD', label: 'New Zealand Dollar', group: 'Asia-Pacific' },
  { code: 'PKR', label: 'Pakistani Rupee', group: 'Asia-Pacific' },
  { code: 'BDT', label: 'Bangladeshi Taka', group: 'Asia-Pacific' },
  { code: 'LKR', label: 'Sri Lankan Rupee', group: 'Asia-Pacific' },
  { code: 'NPR', label: 'Nepalese Rupee', group: 'Asia-Pacific' },
  // Americas
  { code: 'BRL', label: 'Brazilian Real', group: 'Americas' },
  { code: 'MXN', label: 'Mexican Peso', group: 'Americas' },
  { code: 'ARS', label: 'Argentine Peso', group: 'Americas' },
  { code: 'CLP', label: 'Chilean Peso', group: 'Americas' },
  { code: 'COP', label: 'Colombian Peso', group: 'Americas' },
  { code: 'PEN', label: 'Peruvian Sol', group: 'Americas' },
  { code: 'UYU', label: 'Uruguayan Peso', group: 'Americas' },
  // Europe
  { code: 'SEK', label: 'Swedish Krona', group: 'Europe' },
  { code: 'NOK', label: 'Norwegian Krone', group: 'Europe' },
  { code: 'DKK', label: 'Danish Krone', group: 'Europe' },
  { code: 'PLN', label: 'Polish Zloty', group: 'Europe' },
  { code: 'CZK', label: 'Czech Koruna', group: 'Europe' },
  { code: 'HUF', label: 'Hungarian Forint', group: 'Europe' },
  { code: 'RON', label: 'Romanian Leu', group: 'Europe' },
  { code: 'BGN', label: 'Bulgarian Lev', group: 'Europe' },
  { code: 'HRK', label: 'Croatian Kuna', group: 'Europe' },
  { code: 'RSD', label: 'Serbian Dinar', group: 'Europe' },
  { code: 'ISK', label: 'Icelandic Krona', group: 'Europe' },
  { code: 'TRY', label: 'Turkish Lira', group: 'Europe' },
  { code: 'RUB', label: 'Russian Ruble', group: 'Europe' },
  { code: 'UAH', label: 'Ukrainian Hryvnia', group: 'Europe' },
  // Middle East & Africa
  { code: 'ILS', label: 'Israeli Shekel', group: 'Middle East & Africa' },
  { code: 'AED', label: 'UAE Dirham', group: 'Middle East & Africa' },
  { code: 'SAR', label: 'Saudi Riyal', group: 'Middle East & Africa' },
  { code: 'EGP', label: 'Egyptian Pound', group: 'Middle East & Africa' },
  { code: 'ZAR', label: 'South African Rand', group: 'Middle East & Africa' },
  { code: 'NGN', label: 'Nigerian Naira', group: 'Middle East & Africa' },
  { code: 'KES', label: 'Kenyan Shilling', group: 'Middle East & Africa' },
  { code: 'GHS', label: 'Ghanaian Cedi', group: 'Middle East & Africa' },
  // Crypto
  { code: 'BTC', label: 'Bitcoin', group: 'Crypto' },
  { code: 'ETH', label: 'Ethereum', group: 'Crypto' },
  { code: 'SOL', label: 'Solana', group: 'Crypto' },
  { code: 'XMR', label: 'Monero', group: 'Crypto' },
  { code: 'LTC', label: 'Litecoin', group: 'Crypto' },
  { code: 'DOGE', label: 'Dogecoin', group: 'Crypto' },
  { code: 'XRP', label: 'XRP', group: 'Crypto' },
  { code: 'ADA', label: 'Cardano', group: 'Crypto' },
  { code: 'DOT', label: 'Polkadot', group: 'Crypto' },
  { code: 'AVAX', label: 'Avalanche', group: 'Crypto' },
  { code: 'MATIC', label: 'Polygon', group: 'Crypto' },
  { code: 'LINK', label: 'Chainlink', group: 'Crypto' },
  { code: 'UNI', label: 'Uniswap', group: 'Crypto' },
  { code: 'ZEC', label: 'Zcash', group: 'Crypto' },
];
