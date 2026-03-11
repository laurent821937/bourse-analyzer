const SEARCH_CACHE = {
  loadedAt: 0,
  data: []
};

const ONE_DAY = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit || 8), 20);

    if (!q || q.length < 2) {
      return res.status(200).json({
        results: [],
        source: "empty-query"
      });
    }

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Clé API FMP absente côté serveur" });
    }

    const now = Date.now();
    const cacheExpired = now - SEARCH_CACHE.loadedAt > ONE_DAY || !SEARCH_CACHE.data.length;

    if (cacheExpired) {
      const url = `https://financialmodelingprep.com/stable/financial-statement-symbol-list?apikey=${apiKey}`;
      const response = await fetch(url);
      const text = await response.text();

      if (!response.ok) {
        throw new Error(`FMP ${response.status}: ${text}`);
      }

      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error(`Réponse FMP invalide: ${text}`);
      }

      const filtered = (Array.isArray(raw) ? raw : [])
        .filter(item => {
          const ex = String(item.exchangeShortName || item.exchange || "").toUpperCase();
          return ex === "NASDAQ" || ex === "NYSE" || ex === "AMEX";
        })
        .map(item => ({
          symbol: item.symbol || "",
          name: item.name || item.companyName || "",
          exchange: item.exchangeShortName || item.exchange || "",
          type: item.type || ""
        }))
        .filter(item => item.symbol && item.name);

      SEARCH_CACHE.data = filtered;
      SEARCH_CACHE.loadedAt = now;
    }

    const results = SEARCH_CACHE.data
      .filter(item => {
        const name = item.name.toLowerCase();
        const symbol = item.symbol.toLowerCase();
        return name.includes(q) || symbol.includes(q);
      })
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aSymbol = a.symbol.toLowerCase();
        const bSymbol = b.symbol.toLowerCase();

        const aExact = aName === q || aSymbol === q ? 1 : 0;
        const bExact = bName === q || bSymbol === q ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        const aStarts = aName.startsWith(q) || aSymbol.startsWith(q) ? 1 : 0;
        const bStarts = bName.startsWith(q) || bSymbol.startsWith(q) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;

        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);

    return res.status(200).json({
      results,
      source: "cached-list",
      totalLoaded: SEARCH_CACHE.data.length
    });
  } catch (error) {
    return res.status(500).json({
      error: "Erreur backend search",
      details: error.message || "Erreur inconnue"
    });
  }
}
