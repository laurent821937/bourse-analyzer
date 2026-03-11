const ANALYZE_CACHE = {};
const ONE_DAY = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const rawQuery = String(req.query.query || "").trim();
    const rawSymbol = String(req.query.symbol || "").trim().toUpperCase();

    if (!rawQuery && !rawSymbol) {
      return res.status(400).json({ error: "Query ou symbol manquant" });
    }

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Clé API FMP absente côté serveur" });
    }

    const BASE = "https://financialmodelingprep.com/stable";

    async function fmp(path, params = {}) {
      const url = new URL(BASE + path);
      Object.entries({ ...params, apikey: apiKey }).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      });

      const response = await fetch(url.toString());
      const text = await response.text();

      if (!response.ok) {
        throw new Error(`FMP ${response.status}: ${text}`);
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Réponse FMP invalide: ${text}`);
      }
    }

    function n(v) {
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    }

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    function avg(arr) {
      const valid = arr.filter(v => v !== null && v !== undefined && Number.isFinite(v));
      if (!valid.length) return null;
      return valid.reduce((a, b) => a + b, 0) / valid.length;
    }

    function pct(part, total) {
      if (part === null || total === null || total === 0) return null;
      return part / total;
    }

    function cagr(latest, oldest, years) {
      if (!latest || !oldest || latest <= 0 || oldest <= 0 || years <= 0) return null;
      return Math.pow(latest / oldest, 1 / years) - 1;
    }

    function scoreHigherBetter(value, thresholds) {
      if (value === null) return null;
      if (value >= thresholds[4]) return 100;
      if (value >= thresholds[3]) return 80;
      if (value >= thresholds[2]) return 60;
      if (value >= thresholds[1]) return 40;
      if (value >= thresholds[0]) return 20;
      return 0;
    }

    function scoreLowerBetter(value, thresholds) {
      if (value === null) return null;
      if (value <= thresholds[0]) return 100;
      if (value <= thresholds[1]) return 80;
      if (value <= thresholds[2]) return 60;
      if (value <= thresholds[3]) return 40;
      if (value <= thresholds[4]) return 20;
      return 0;
    }

    function verdictLabel(score) {
      if (score >= 80) return "Excellente";
      if (score >= 65) return "Solide";
      if (score >= 50) return "Moyenne";
      return "Fragile";
    }

    let symbol = rawSymbol;

    if (!symbol) {
      const search = await fmp("/search-name", {
        query: rawQuery,
        limit: 10
      });

      if (!Array.isArray(search) || !search.length) {
        return res.status(404).json({ error: "Entreprise introuvable" });
      }

      const preferred =
        search.find(x => ["NASDAQ", "NYSE", "AMEX"].includes((x.exchangeShortName || x.exchange || "").toUpperCase())) ||
        search[0];

      symbol = preferred.symbol;
    }

    const cacheKey = symbol.toUpperCase();
    const now = Date.now();

    if (
      ANALYZE_CACHE[cacheKey] &&
      now - ANALYZE_CACHE[cacheKey].createdAt < ONE_DAY
    ) {
      return res.status(200).json({
        ...ANALYZE_CACHE[cacheKey].data,
        cache: true
      });
    }

    const [profileRaw, incomeRaw, balanceRaw, cashRaw] = await Promise.all([
      fmp("/profile", { symbol }),
      fmp("/income-statement", { symbol, limit: 5, period: "annual" }),
      fmp("/balance-sheet-statement", { symbol, limit: 5, period: "annual" }),
      fmp("/cash-flow-statement", { symbol, limit: 5, period: "annual" })
    ]);

    const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
    const income = Array.isArray(incomeRaw) ? incomeRaw : [];
    const balance = Array.isArray(balanceRaw) ? balanceRaw : [];
    const cash = Array.isArray(cashRaw) ? cashRaw : [];

    if (!profile || !income.length || !balance.length || !cash.length) {
      return res.status(404).json({ error: "Données financières insuffisantes pour cette société" });
    }

    const i0 = income[0] || {};
    const i1 = income[1] || {};
    const i3 = income[3] || {};
    const b0 = balance[0] || {};
    const c0 = cash[0] || {};

    const revenue = n(i0.revenue);
    const prevRevenue = n(i1.revenue);
    const oldRevenue = n(i3.revenue);

    const netIncome = n(i0.netIncome);
    const operatingIncome = n(i0.operatingIncome);
    const grossProfit = n(i0.grossProfit);

    const totalAssets = n(b0.totalAssets);
    const currentAssets = n(b0.totalCurrentAssets);
    const currentLiabilities = n(b0.totalCurrentLiabilities);
    const totalDebt = n(b0.totalDebt);
    const cashEq = n(b0.cashAndCashEquivalents);
    const equity = n(b0.totalStockholdersEquity);

    const operatingCashFlow = n(c0.operatingCashFlow);
    const capexRaw = n(c0.capitalExpenditure);
    const freeCashFlow = n(c0.freeCashFlow) ?? (
      operatingCashFlow !== null && capexRaw !== null ? operatingCashFlow - Math.abs(capexRaw) : null
    );

    const price = n(profile.price);
    const marketCap = n(profile.mktCap || profile.marketCap);
    const shares = n(profile.sharesOutstanding);

    const revenueGrowth1Y =
      revenue !== null && prevRevenue !== null && prevRevenue > 0
        ? revenue / prevRevenue - 1
        : null;

    const revenueCagr3Y =
      revenue !== null && oldRevenue !== null
        ? cagr(revenue, oldRevenue, 3)
        : null;

    const netMargin = pct(netIncome, revenue);
    const operatingMargin = pct(operatingIncome, revenue);
    const grossMargin = pct(grossProfit, revenue);

    const roe = pct(netIncome, equity);
    const roa = pct(netIncome, totalAssets);

    const currentRatio =
      currentAssets !== null && currentLiabilities !== null && currentLiabilities !== 0
        ? currentAssets / currentLiabilities
        : null;

    const debtEquity =
      totalDebt !== null && equity !== null && equity !== 0
        ? totalDebt / equity
        : null;

    const cashToDebt =
      cashEq !== null && totalDebt !== null && totalDebt !== 0
        ? cashEq / totalDebt
        : null;

    const fcfMargin = pct(freeCashFlow, revenue);

    const cashConversion =
      operatingCashFlow !== null && netIncome !== null && netIncome !== 0
        ? operatingCashFlow / netIncome
        : null;

    const eps =
      shares !== null && shares > 0 && netIncome !== null
        ? netIncome / shares
        : null;

    const peRatio =
      price !== null && eps !== null && eps > 0
        ? price / eps
        : null;

    const priceToSales =
      marketCap !== null && revenue !== null && revenue > 0
        ? marketCap / revenue
        : null;

    const priceToBook =
      marketCap !== null && equity !== null && equity > 0
        ? marketCap / equity
        : null;

    const priceToFcf =
      marketCap !== null && freeCashFlow !== null && freeCashFlow > 0
        ? marketCap / freeCashFlow
        : null;

    const fcfYield =
      marketCap !== null && freeCashFlow !== null && marketCap > 0
        ? freeCashFlow / marketCap
        : null;

    const sGrowth = avg([
      scoreHigherBetter(revenueGrowth1Y, [-0.05, 0, 0.05, 0.10, 0.15]),
      scoreHigherBetter(revenueCagr3Y, [-0.02, 0.02, 0.05, 0.08, 0.12])
    ]);

    const sProfitability = avg([
      scoreHigherBetter(grossMargin, [0.15, 0.25, 0.35, 0.50, 0.65]),
      scoreHigherBetter(operatingMargin, [0.03, 0.08, 0.12, 0.18, 0.25]),
      scoreHigherBetter(netMargin, [0.02, 0.05, 0.10, 0.15, 0.20]),
      scoreHigherBetter(roe, [0.05, 0.10, 0.15, 0.20, 0.25]),
      scoreHigherBetter(roa, [0.02, 0.04, 0.07, 0.10, 0.14])
    ]);

    const sCashflow = avg([
      scoreHigherBetter(fcfMargin, [-0.02, 0.02, 0.05, 0.10, 0.15]),
      scoreHigherBetter(cashConversion, [0.5, 0.8, 1.0, 1.2, 1.5]),
      freeCashFlow !== null ? (freeCashFlow > 0 ? 85 : 15) : null,
      operatingCashFlow !== null ? (operatingCashFlow > 0 ? 85 : 15) : null
    ]);

    const sBalance = avg([
      scoreHigherBetter(currentRatio, [0.8, 1.0, 1.3, 1.8, 2.5]),
      scoreLowerBetter(debtEquity, [0.3, 0.6, 1.0, 1.8, 3.0]),
      scoreHigherBetter(cashToDebt, [0.1, 0.25, 0.5, 0.8, 1.2])
    ]);

    const sValuation = avg([
      scoreLowerBetter(peRatio, [12, 18, 25, 35, 50]),
      scoreLowerBetter(priceToSales, [1.5, 3, 5, 8, 12]),
      scoreLowerBetter(priceToBook, [1.5, 3, 5, 8, 12]),
      scoreLowerBetter(priceToFcf, [10, 18, 25, 35, 50]),
      scoreHigherBetter(fcfYield, [0.01, 0.03, 0.05, 0.07, 0.10])
    ]);

    const sQuality = avg([
      scoreHigherBetter(grossMargin, [0.15, 0.25, 0.35, 0.50, 0.65]),
      scoreHigherBetter(roe, [0.05, 0.10, 0.15, 0.20, 0.25]),
      scoreHigherBetter(revenueCagr3Y, [-0.02, 0.02, 0.05, 0.08, 0.12]),
      scoreHigherBetter(fcfMargin, [-0.02, 0.02, 0.05, 0.10, 0.15])
    ]);

    const weighted =
      ((sGrowth ?? 50) * 15 +
        (sProfitability ?? 50) * 22 +
        (sCashflow ?? 50) * 18 +
        (sBalance ?? 50) * 18 +
        (sValuation ?? 50) * 15 +
        (sQuality ?? 50) * 12) / 100;

    const finalScore = Math.round(clamp(weighted, 0, 100));

    const strengths = [];
    const weaknesses = [];
    const risks = [];

    if (revenueCagr3Y !== null && revenueCagr3Y >= 0.08) strengths.push("Croissance du chiffre d’affaires saine sur plusieurs années.");
    if (netMargin !== null && netMargin >= 0.10) strengths.push("Rentabilité nette solide.");
    if (roe !== null && roe >= 0.15) strengths.push("Bon rendement sur les capitaux propres.");
    if (freeCashFlow !== null && freeCashFlow > 0) strengths.push("Free cash flow positif.");
    if (currentRatio !== null && currentRatio >= 1.2) strengths.push("Liquidité court terme correcte.");
    if (debtEquity !== null && debtEquity <= 0.8) strengths.push("Niveau d’endettement raisonnable.");
    if (peRatio !== null && peRatio <= 20) strengths.push("Valorisation plutôt modérée sur la base du PER.");
    if (fcfYield !== null && fcfYield >= 0.05) strengths.push("Rendement du free cash flow intéressant.");

    if (revenueGrowth1Y !== null && revenueGrowth1Y < 0) weaknesses.push("Baisse récente du chiffre d’affaires.");
    if (netMargin !== null && netMargin < 0.05) weaknesses.push("Marge nette faible.");
    if (roe !== null && roe < 0.10) weaknesses.push("ROE modeste.");
    if (freeCashFlow !== null && freeCashFlow < 0) weaknesses.push("Free cash flow négatif.");
    if (currentRatio !== null && currentRatio < 1) weaknesses.push("Liquidité court terme tendue.");
    if (debtEquity !== null && debtEquity > 1.5) weaknesses.push("Endettement élevé par rapport aux fonds propres.");
    if (peRatio !== null && peRatio > 30) weaknesses.push("Valorisation exigeante.");
    if (priceToSales !== null && priceToSales > 8) weaknesses.push("Le marché paie cher le chiffre d’affaires.");

    if (debtEquity !== null && debtEquity > 2) risks.push("Levier financier important à surveiller.");
    if (revenueGrowth1Y !== null && revenueGrowth1Y < -0.05) risks.push("Contraction notable du chiffre d’affaires.");
    if (freeCashFlow !== null && freeCashFlow < 0) risks.push("Génération de cash insuffisante actuellement.");
    if (peRatio !== null && peRatio > 35) risks.push("Valorisation élevée, donc marge d’erreur réduite.");
    if (currentRatio !== null && currentRatio < 1) risks.push("Tension possible sur les engagements court terme.");

    while (strengths.length < 3) strengths.push("Les données actuelles ne mettent pas en évidence davantage de points forts majeurs.");
    while (weaknesses.length < 3) weaknesses.push("Aucune faiblesse critique supplémentaire ne ressort à ce stade.");
    while (risks.length < 3) risks.push("Aucun risque critique supplémentaire n’est visible avec les données disponibles.");

    const result = {
      symbol,
      currency: profile.currency || "USD",
      profile,
      metrics: {
        revenueGrowth1Y,
        revenueCagr3Y,
        netMargin,
        roe,
        roa,
        currentRatio,
        debtEquity,
        fcf: freeCashFlow,
        peRatio
      },
      scores: {
        global: finalScore,
        growth: Math.round(sGrowth ?? 50),
        profitability: Math.round(sProfitability ?? 50),
        cashflow: Math.round(sCashflow ?? 50),
        balance: Math.round(sBalance ?? 50),
        valuation: Math.round(sValuation ?? 50),
        quality: Math.round(sQuality ?? 50)
      },
      strengths: strengths.slice(0, 5),
      weaknesses: weaknesses.slice(0, 5),
      risks: risks.slice(0, 5),
      verdict: `Cette entreprise obtient un score de ${finalScore}/100, ce qui correspond à un profil ${verdictLabel(finalScore).toLowerCase()}. Pour un débutant, il faut surtout regarder trois choses : la croissance du chiffre d’affaires, la capacité à générer du cash, et le niveau de dette. Une bonne entreprise reste un mauvais investissement si elle est achetée trop cher.`
    };

    ANALYZE_CACHE[cacheKey] = {
      createdAt: now,
      data: result
    };

    return res.status(200).json({
      ...result,
      cache: false
    });
  } catch (error) {
    return res.status(500).json({
      error: "Erreur backend",
      details: error.message || "Erreur inconnue"
    });
  }
}
