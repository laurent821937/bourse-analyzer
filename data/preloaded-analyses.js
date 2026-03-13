export const PRELOADED_ANALYSES = {
  AAPL: {
    symbol: "AAPL",
    companyName: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    exchange: "NASDAQ",
    currency: "USD",
    price: 260.83,
    marketCap: 3833659654116.9995,
    metrics: {
      revenueGrowth1Y: 0.06425511782832749,
      revenueCagr3Y: 0.01812535743479393,
      netMargin: 0.2691506412181824,
      roe: 1.5191298333175105,
      roa: 0.3117962593356549,
      currentRatio: 0.8932929222186667,
      debtEquity: 1.5241072518411023,
      fcf: 98767000000,
      peRatio: null
    },
    scores: {
      global: 57,
      growth: 40,
      profitability: 92,
      cashflow: 78,
      balance: 33,
      valuation: 15,
      quality: 70
    },
    strengths: [
      "Rentabilité nette solide.",
      "Bon rendement sur les capitaux propres.",
      "Free cash flow positif."
    ],
    weaknesses: [
      "Liquidité court terme tendue.",
      "Endettement élevé par rapport aux fonds propres.",
      "Le marché paie cher le chiffre d’affaires."
    ],
    risks: [
      "Tension possible sur les engagements court terme.",
      "Aucun risque critique supplémentaire n’est visible avec les données disponibles.",
      "Aucun risque critique supplémentaire n’est visible avec les données disponibles."
    ],
    verdict: "Cette entreprise obtient un score de 57/100, ce qui correspond à un profil moyenne.",
    source: "preloaded"
  }
};

function normalize(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function findPreloadedAnalysis(query) {
  if (!query) return null;

  const raw = String(query).trim();
  const upper = raw.toUpperCase();

  if (PRELOADED_ANALYSES[upper]) return PRELOADED_ANALYSES[upper];

  const q = normalize(raw);

  for (const item of Object.values(PRELOADED_ANALYSES)) {
    const haystack = [
      item.symbol,
      item.companyName,
      item.sector,
      item.industry
    ].filter(Boolean).map(normalize).join(" ");

    if (haystack.includes(q)) return item;
  }

  return null;
}

export function listPreloadedCompanies() {
  return Object.values(PRELOADED_ANALYSES).map((item) => ({
    symbol: item.symbol,
    companyName: item.companyName,
    sector: item.sector || "",
    industry: item.industry || "",
    exchange: item.exchange || "",
    image: item.image || "",
    score: item.scores?.global ?? null,
    verdict: item.verdict || "",
    price: item.price ?? null,
    marketCap: item.marketCap ?? null,
    source: "preloaded"
  }));
}
