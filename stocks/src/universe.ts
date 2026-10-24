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
/** Liquid NSE names that usually trade under ₹500 (Abhishek, 24 Oct 2026). The price filter is applied live, so names that cross ₹500 drop out of the under-₹500 section on their own. */
export const UNDER500: Record<string, string> = {
  ONGC: 'ONGC', COALINDIA: 'Coal India', POWERGRID: 'Power Grid', IOC: 'Indian Oil', BPCL: 'BPCL', GAIL: 'GAIL', SAIL: 'SAIL', NMDC: 'NMDC',
  BHEL: 'BHEL', PNB: 'Punjab National Bank', BANKBARODA: 'Bank of Baroda', CANBK: 'Canara Bank', UNIONBANK: 'Union Bank', IDFCFIRSTB: 'IDFC First Bank',
  FEDERALBNK: 'Federal Bank', YESBANK: 'Yes Bank', BANDHANBNK: 'Bandhan Bank', IRFC: 'IRFC', RVNL: 'RVNL', NHPC: 'NHPC', SJVN: 'SJVN', IREDA: 'IREDA',
  HUDCO: 'HUDCO', RECLTD: 'REC', PFC: 'Power Finance Corp', ETERNAL: 'Eternal (Zomato)', NYKAA: 'Nykaa', IDEA: 'Vodafone Idea', TATAPOWER: 'Tata Power',
  ADANIPOWER: 'Adani Power', VEDL: 'Vedanta', ASHOKLEY: 'Ashok Leyland', MOTHERSON: 'Samvardhana Motherson', BIOCON: 'Biocon', WIPRO: 'Wipro',
  JIOFIN: 'Jio Financial', GMRAIRPORT: 'GMR Airports', NBCC: 'NBCC', NATIONALUM: 'NALCO', HINDCOPPER: 'Hindustan Copper', IEX: 'IEX', TRIDENT: 'Trident',
};
Object.assign(NAMES, UNDER500);
export const INDEXES = new Set(['NIFTY', 'BANKNIFTY']);
export const watchList = (): string[] => {
  const env = process.env.ALERT_STOCKS;
  const l = env ? env.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : Object.keys(NAMES);
  return [...new Set(l)].slice(0, 120);
};
