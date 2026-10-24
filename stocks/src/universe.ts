/** NSE names the scanner watches (same list as the Markets Desk Levels page). Set ALERT_STOCKS="RELIANCE,TCS" to change. */
export const NAMES: Record<string, string> = {
  NIFTY: 'Nifty 50', BANKNIFTY: 'Bank Nifty', RELIANCE: 'Reliance Industries', HDFCBANK: 'HDFC Bank', ICICIBANK: 'ICICI Bank', INFY: 'Infosys',
  TCS: 'Tata Consultancy Services', SBIN: 'State Bank of India', BHARTIARTL: 'Bharti Airtel', ITC: 'ITC', LT: 'Larsen & Toubro', AXISBANK: 'Axis Bank',
  BAJFINANCE: 'Bajaj Finance', MARUTI: 'Maruti Suzuki', SUNPHARMA: 'Sun Pharma', TITAN: 'Titan Company', HINDUNILVR: 'Hindustan Unilever', 'M&M': 'Mahindra & Mahindra',
  NTPC: 'NTPC', ADANIPORTS: 'Adani Ports', BEL: 'Bharat Electronics', TATASTEEL: 'Tata Steel', WAAREEENER: 'Waaree Energies', PREMIERENE: 'Premier Energies',
  SUZLON: 'Suzlon Energy', NETWEB: 'Netweb Technologies', PERSISTENT: 'Persistent Systems', KPITTECH: 'KPIT Technologies', HCLTECH: 'HCL Technologies',
  HEROMOTOCO: 'Hero MotoCorp', JAMNAAUTO: 'Jamna Auto', CASTROLIND: 'Castrol India', KOTAKBANK: 'Kotak Mahindra Bank', GLAND: 'Gland Pharma',
  LGEINDIA: 'LG Electronics India', MEESHO: 'Meesho', AETHER: 'Aether Industries', GPPL: 'Gujarat Pipavav Port', HAL: 'Hindustan Aeronautics',
  SYNCOMF: 'Syncom Formulations', GRAUWEIL: 'Grauer & Weil', INDHOTEL: 'Indian Hotels', SWIGGY: 'Swiggy',
};
export const INDEXES = new Set(['NIFTY', 'BANKNIFTY']);
export const watchList = (): string[] => {
  const env = process.env.ALERT_STOCKS;
  const l = env ? env.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : Object.keys(NAMES);
  return [...new Set(l)].slice(0, 80);
};
