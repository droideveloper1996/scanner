export const CATS = [
  { id: 'major', label: 'Majors', coins: ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'HYPE', 'CRO', 'LTC', 'BCH'] },
  { id: 'l1', label: 'Layer 1/2', coins: ['AVAX', 'DOT', 'NEAR', 'SUI', 'APT', 'ARB', 'OP', 'POL', 'ATOM', 'SEI', 'INJ', 'TIA', 'HBAR', 'ICP', 'XLM'] },
  { id: 'defi', label: 'DeFi', coins: ['UNI', 'AAVE', 'LINK', 'LDO', 'CRV', 'SKY', 'COMP', 'PENDLE', 'ENA', 'JUP', 'ONDO', 'RAY', 'SUSHI', 'DYDX', 'GMX'] },
  { id: 'meme', label: 'Meme', coins: ['DOGE', 'SHIB', 'PEPE', 'BONK', 'WIF', 'FLOKI', 'TRUMP', 'PENGU', 'POPCAT', 'FARTCOIN', 'MOG', 'SPX', 'TURBO', 'MOODENG'] },
  { id: 'ai', label: 'AI', coins: ['FET', 'RENDER', 'TAO', 'VIRTUAL', 'WLD', 'GRT'] },
] as const;

export const DEFAULT_ALERT_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'HYPE', 'DOGE', 'PEPE', 'BONK', 'WIF', 'TRUMP', 'LINK', 'AAVE', 'ENA', 'SUI'];

/** Coins the alert job watches. Set ALERT_COINS="BTC,ETH,DOGE" to change. */
export function alertCoins(): string[] {
  const env = process.env.ALERT_COINS;
  const list = env ? env.split(',').map(s => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean) : DEFAULT_ALERT_COINS;
  return [...new Set(list)].slice(0, 40);
}
