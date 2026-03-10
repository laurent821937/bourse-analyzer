export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const query = req.query.query;

    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: "Query manquante" });
    }

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Clé API FMP absente côté serveur" });
    }

    const BASE = "https://financialmodelingprep.com/stable";

    async function fmp(path, params = {}) {
      const url = new URL(BASE + path);
      Object.entries({ ...params, apikey: apiKey }).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });

      const response = await fetch(url.toString());
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`FMP ${response.status}: ${text}`);
      }
      return response.json();
    }

    function safe(n) {
      return n === null || n === undefined || Number.isNaN(Number(n)) ? null : Number(n);
    }

    function average(list) {
      const valid = list.filter(v => v !== null && v !== undefined && !Number.isNaN(Number(v)));
      if (!valid.length) return null;
      return valid.reduce((a, b) => a + Number(b), 0) / valid.length;
    }

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    function cagr(latest, oldest, years) {
      if (!latest || !oldest || latest <= 0 || oldest <= 0 || years <= 0) return null;
      return Math.pow(latest / oldest, 1 / years) - 1;
    }

    function scoreFromThresholds(value, thresholds, reverse = false) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
      const v = Number(value);
      let score = 0;

      if (!reverse) {
        if (v >= thresholds[4]) score = 100;
        else if (v >= thresholds[3]) score = 80;
        else if (v >= thresholds[2]) score = 60;
        else if (v >= thresholds[1]) score = 40;
        else if (v >= thresholds[0]) score = 20;
        else score = 0;
      } else {
        if (v <= thresholds[0]) score = 100;
        else if (v <= thresholds[1]) score = 80;
        else if (v <= thresholds[2]) score = 60;
        else if (v <= thresholds[3]) score = 40;
        else if (v <= thresholds[4]) score = 20;
        else score = 0;
      }

      return score;
    }

    function buildVerdict(score, ctx) {
      let band = "moyenne";
      if (score >= 80) band = "de grande qualité";
      else if (score >= 65) band = "plutôt solide";
      else if (score >= 50) band = "mitigée";
      else band = "fragile";

      const growthText =
        ctx.revenueCagr3Y === null
          ? "La trajectoire de croissance est difficile à confirmer."
          : ctx.revenueCagr3Y >= 0.10
            ? "La croissance ressort comme un point d’appui du dossier."
            : ctx.revenueCagr3Y >= 0.03
              ? "La croissance paraît correcte mais pas exceptionnelle."
              : "La dynamique de croissance paraît faible ou irrégulière.";

      const profitabilityText =
        ctx.netMargin === null && ctx.roe === null
          ? "La rentabilité est incomplètement documentée."
          : ((ctx.netMargin ?? 0) >= 0.10 || (ctx.roe ?? 0) >= 0.15)
            ? "La rentabilité montre une base économique intéressante."
            : "La rentabilité ne ressort pas comme un avantage compétitif évident.";

      const balanceText =
        ctx.debtEquity === null
          ? "Le niveau de levier doit être vérifié plus finement."
          : ctx.debtEquity <= 0.8
            ? "Le bilan semble plutôt maîtrisé."
            : ctx.debtEquity <= 1.5
              ? "Le bilan reste acceptable mais demande une surveillance."
              : "Le bilan paraît plus tendu, ce qui augmente le risque en cas de ralentissement.";

      const valuationText =
        ctx.peRatio === null
          ? "La valorisation n’est pas parfaitement lisible avec les données actuelles."
          : ctx.peRatio <= 20
            ? "Le prix paraît raisonnable sur la base du PER."
            : ctx.peRatio <= 30
              ? "Le marché valorise déjà une partie des qualités de l’entreprise."
              : "La valorisation est exigeante et réduit la marge de sécurité.";

      const cashText =
        ctx.fcf === null
          ? "La lecture du cash-flow reste partielle."
          : ctx.fcf > 0
            ? "La génération de cash soutient le dossier."
            : "Le cash-flow libre est un point de vigilance.";

      return `Cette entreprise obtient un score de ${score}/100, ce qui la classe comme société ${band}. ${growthText} ${profitabilityText} ${balanceText} ${cashText} ${valuationText} Pour un débutant, cela signifie qu’il faut distinguer la qualité de l’entreprise du prix payé : une bonne société peut devenir un investissement moyen si elle est achetée trop cher.`;
    }

    const searchData = await fmp("/search-name", { query, limit: 1 });

    if (!Array.isArray(searchData) || !searchData.length) {
      return res.status(404).json({ error: "Entreprise introuvable" });
    }

    const symbol = searchData[0].symbol;

    const [
      profileRaw,
      incomeRaw,
      balanceRaw,
      cashRaw,
      metricsRaw,
      ratiosRaw
    ] = await Promise.all([
      fmp("/profile", { symbol }),
      fmp("/income-statement", { symbol, limit: 5, period: "annual" }),
      fmp("/balance-sheet-statement", { symbol, limit: 5, period: "annual" }),
      fmp("/cash-flow-statement", { symbol, limit: 5, period: "annual" }),
      fmp("/key-metrics", { symbol, limit: 5, period: "annual" }),
      fmp("/ratios", { symbol, limit: 5, period: "annual" })
    ]);

    const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
    const income = Array.isArray(incomeRaw) ? incomeRaw : [];
    const balance = Array.isArray(balanceRaw) ? balanceRaw : [];
    const cash = Array.isArray(cashRaw) ? cashRaw : [];
    const metrics = Array.isArray(metricsRaw) ? metricsRaw : [];
    const ratios = Array.isArray(ratiosRaw) ? ratiosRaw : [];

    if (!profile || !Object.keys(profile).length) {
      return res.status(404).json({ error: "Profil entreprise introuvable" });
    }

    const latestIncome = income[0] || {};
    const prevIncome = income[1] || {};
    const oldIncome = income[3] || {};
    const latestBalance = balance[0] || {};
    const latestCash = cash[0] || {};
    const latestMetrics = metrics[0] || {};
    const latestRatios = ratios[0] || {};

    const revenueGrowth1Y =
      safe(latestIncome.revenue) && safe(prevIncome.revenue) && safe(prevIncome.revenue) > 0
        ? safe(latestIncome.revenue) / safe(prevIncome.revenue) - 1
        : null;

    const revenueCagr3Y =
      safe(latestIncome.revenue) && safe(oldIncome.revenue)
        ? cagr(safe(latestIncome.revenue), safe(oldIncome.revenue), 3)
        : null;

    const netMargin =
      safe(latestRatios.netProfitMargin) ??
      ((safe(latestIncome.netIncome) && safe(latestIncome.revenue))
        ? safe(latestIncome.netIncome) / safe(latestIncome.revenue)
        : null);

    const operatingMargin =
      safe(latestRatios.operatingProfitMargin) ??
      ((safe(latestIncome.operatingIncome) && safe(latestIncome.revenue))
        ? safe(latestIncome.operatingIncome) / safe(latestIncome.revenue)
        : null);

    const grossMargin =
      safe(latestRatios.grossProfitMargin) ??
      ((safe(latestIncome.grossProfit) && safe(latestIncome.revenue))
        ? safe(latestIncome.grossProfit) / safe(latestIncome.revenue)
        : null);

    const roe = safe(latestRatios.returnOnEquity);
    const roa = safe(latestRatios.returnOnAssets);
    const currentRatio = safe(latestRatios.currentRatio);
    const debtEquity = safe(latestRatios.debtEquityRatio);
    const interestCoverage = safe(latestRatios.interestCoverage);
    const peRatio = safe(latestMetrics.peRatio);
    const pbRatio = safe(latestMetrics.pbRatio);
    const evEbitda = safe(latestMetrics.enterpriseValueOverEBITDA);
    const pFcf = safe(latestMetrics.pfcfRatio || latestMetrics.priceToFreeCashFlowsRatio);
    const fcf = safe(latestCash.freeCashFlow);
    const opCashFlow = safe(latestCash.operatingCashFlow);
    const netIncome = safe(latestIncome.netIncome);
    const fcfMargin =
      fcf !== null && safe(latestIncome.revenue) ? fcf / safe(latestIncome.revenue) : null;
    const cashConversion =
      opCashFlow !== null && netIncome && netIncome !== 0 ? opCashFlow / netIncome : null;
    const totalDebt = safe(latestBalance.totalDebt);
    const cashAndEquivalents = safe(latestBalance.cashAndCashEquivalents);
    const cashToDebt =
      cashAndEquivalents !== null && totalDebt && totalDebt !== 0
        ? cashAndEquivalents / totalDebt
        : null;
    const beta = safe(profile.beta);

    const sRevenueGrowth = average([
      scoreFromThresholds(revenueGrowth1Y, [-0.05, 0, 0.05, 0.10, 0.15], false),
      scoreFromThresholds(revenueCagr3Y, [-0.02, 0.03, 0.06, 0.10, 0.15], false)
    ]);

    const sProfitability = average([
      scoreFromThresholds(grossMargin, [0.15, 0.25, 0.35, 0.50, 0.65], false),
      scoreFromThresholds(operatingMargin, [0.03, 0.08, 0.12, 0.18, 0.25], false),
      scoreFromThresholds(netMargin, [0.02, 0.06, 0.10, 0.15, 0.20], false),
      scoreFromThresholds(roe, [0.05, 0.10, 0.15, 0.20, 0.25], false),
      scoreFromThresholds(roa, [0.02, 0.04, 0.07, 0.10, 0.14], false)
    ]);

    const sCashFlow = average([
      scoreFromThresholds(fcfMargin, [-0.02, 0.02, 0.05, 0.10, 0.15], false),
      scoreFromThresholds(cashConversion, [0.5, 0.8, 1.0, 1.2, 1.5], false),
      fcf !== null ? (fcf > 0 ? 85 : 15) : null,
      opCashFlow !== null ? (opCashFlow > 0 ? 85 : 15) : null
    ]);

    const sBalanceSheet = average([
      scoreFromThresholds(currentRatio, [0.8, 1.0, 1.3, 1.8, 2.5], false),
      scoreFromThresholds(debtEquity, [0.3, 0.6, 1.0, 1.8, 3.0], true),
      scoreFromThresholds(cashToDebt, [0.1, 0.25, 0.5, 0.8, 1.2], false),
      scoreFromThresholds(interestCoverage, [1.5, 3, 5, 8, 12], false)
    ]);

    const sValuation = average([
      scoreFromThresholds(peRatio, [12, 18, 25, 35, 50], true),
      scoreFromThresholds(pbRatio, [1.5, 3, 5, 8, 12], true),
      scoreFromThresholds(evEbitda, [8, 12, 16, 22, 30], true),
      scoreFromThresholds(pFcf, [10, 18, 25, 35, 50], true)
    ]);

    const sQuality = average([
      scoreFromThresholds(grossMargin, [0.15, 0.25, 0.35, 0.50, 0.65], false),
      scoreFromThresholds(roe, [0.05, 0.10, 0.15, 0.20, 0.25], false),
      scoreFromThresholds(revenueCagr3Y, [-0.02, 0.03, 0.06, 0.10, 0.15], false),
      beta !== null ? scoreFromThresholds(beta, [0.8, 1.0, 1.2, 1.5, 2.0], true) : null
    ]);

    const riskPenalty = average([
      revenueGrowth1Y !== null ? (revenueGrowth1Y < 0 ? 30 : 80) : null,
      fcf !== null ? (fcf < 0 ? 25 : 85) : null,
      debtEquity !== null ? scoreFromThresholds(debtEquity, [0.3, 0.6, 1.0, 1.8, 3.0], true) : null,
      beta !== null ? scoreFromThresholds(beta, [0.8, 1.0, 1.2, 1.5, 2.0], true) : null
    ]);

    const weights = {
      growth: 15,
      profitability: 22,
      cashflow: 18,
      balance: 18,
      valuation: 15,
      quality: 12
    };

    const weightedScore =
      ((sRevenueGrowth ?? 50) * weights.growth +
        (sProfitability ?? 50) * weights.profitability +
        (sCashFlow ?? 50) * weights.cashflow +
        (sBalanceSheet ?? 50) * weights.balance +
        (sValuation ?? 50) * weights.valuation +
        (sQuality ?? 50) * weights.quality) / 100;

    const finalScore = Math.round(
      clamp((weightedScore * 0.92) + ((riskPenalty ?? 50) * 0.08), 0, 100)
    );

    const strengths = [];
    const weaknesses = [];
    const risks = [];

    if (revenueCagr3Y !== null && revenueCagr3Y >= 0.10) strengths.push("Croissance du chiffre d’affaires solide sur 3 ans.");
    if (netMargin !== null && netMargin >= 0.12) strengths.push("Rentabilité nette confortable.");
    if (roe !== null && roe >= 0.15) strengths.push("Retour sur capitaux propres élevé.");
    if (fcf !== null && fcf > 0) strengths.push("Free cash flow positif.");
    if (currentRatio !== null && currentRatio >= 1.3) strengths.push("Liquidité court terme correcte.");
    if (debtEquity !== null && debtEquity <= 0.8) strengths.push("Effet de levier globalement maîtrisé.");
    if (peRatio !== null && peRatio <= 20) strengths.push("Valorisation raisonnable au regard du PER.");
    if (cashConversion !== null && cashConversion >= 1) strengths.push("Bonne conversion du résultat en trésorerie.");

    if (revenueGrowth1Y !== null && revenueGrowth1Y < 0) weaknesses.push("Baisse récente du chiffre d’affaires.");
    if (netMargin !== null && netMargin < 0.05) weaknesses.push("Marge nette faible.");
    if (roe !== null && roe < 0.10) weaknesses.push("ROE modeste.");
    if (fcf !== null && fcf < 0) weaknesses.push("Free cash flow négatif.");
    if (currentRatio !== null && currentRatio < 1) weaknesses.push("Liquidité court terme tendue.");
    if (debtEquity !== null && debtEquity > 1.5) weaknesses.push("Endettement élevé par rapport aux fonds propres.");
    if (peRatio !== null && peRatio > 30) weaknesses.push("Valorisation exigeante.");
    if (beta !== null && beta > 1.4) weaknesses.push("Titre potentiellement plus volatil que le marché.");

    if (debtEquity !== null && debtEquity > 2) risks.push("Levier financier important à surveiller.");
    if (interestCoverage !== null && interestCoverage < 3) risks.push("Couverture des intérêts limitée.");
    if (revenueGrowth1Y !== null && revenueGrowth1Y < -0.05) risks.push("Contraction du chiffre d’affaires significative.");
    if (fcf !== null && fcf < 0) risks.push("La génération de cash ne couvre pas correctement les besoins de l’entreprise.");
    if (peRatio !== null && peRatio > 35) risks.push("Le marché paie déjà cher le dossier, ce qui réduit la marge d’erreur.");
    if (beta !== null && beta > 1.6) risks.push("Volatilité élevée : parcours boursier potentiellement heurté.");

    while (strengths.length < 3) strengths.push("Données disponibles insuffisantes pour renforcer davantage le diagnostic.");
    while (weaknesses.length < 3) weaknesses.push("Aucune faiblesse majeure supplémentaire ne ressort avec les données actuelles.");
    while (risks.length < 3) risks.push("Aucun risque critique supplémentaire n’est visible avec les données actuelles.");

    return res.status(200).json({
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
        fcf,
        peRatio
      },
      scores: {
        global: finalScore,
        growth: Math.round(sRevenueGrowth ?? 50),
        profitability: Math.round(sProfitability ?? 50),
        cashflow: Math.round(sCashFlow ?? 50),
        balance: Math.round(sBalanceSheet ?? 50),
        valuation: Math.round(sValuation ?? 50),
        quality: Math.round(sQuality ?? 50)
      },
      strengths: strengths.slice(0, 5),
      weaknesses: weaknesses.slice(0, 5),
      risks: risks.slice(0, 5),
      verdict: buildVerdict(finalScore, {
        revenueCagr3Y,
        netMargin,
        roe,
        debtEquity,
        peRatio,
        fcf
      })
    });
  } catch (error) {
    return res.status(500).json({
      error: "Erreur backend",
      details: error.message || "Erreur inconnue"
    });
  }
}
