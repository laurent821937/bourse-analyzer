import { listPreloadedCompanies } from "../data/preloaded-analyses.js";

const SEARCH_CACHE = {};
const ONE_DAY = 24 * 60 * 60 * 1000;

function normalize(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit || 8), 10);

    if (!q || q.length < 2) {
      return res.status(200).json({
        results: [],
        source: "empty-query"
      });
    }

    const cacheKey = q.toLowerCase();
    const now = Date.now();

    if (
      SEARCH_CACHE[cacheKey] &&
      now - SEARCH_CACHE[cacheKey].createdAt < ONE_DAY
    ) {
      return res.status(200).json({
        results: SEARCH_CACHE[cacheKey].results,
        source: "cache"
      });
    }

    const queryNorm = normalize(q);

    /*
    ------------------------------
    1️⃣ Recherche locale preload
    ------------------------------
    */

    const preloaded = listPreloadedCompanies();

    let results = preloaded
      .filter((c) => {
        const haystack = normalize(
          `${c.symbol} ${c.companyName} ${c.sector} ${c.industry}`
        );

        return haystack.includes(queryNorm);
      })
      .slice(0, limit)
      .map((c) => ({
        symbol: c.symbol,
        name: c.companyName,
        exchange: "PRELOADED"
      }));

    if (results.length > 0) {
      SEARCH_CACHE[cacheKey] = {
        createdAt: now,
        results
      };

      return res.status(200).json({
        results,
        source: "preloaded"
      });
    }

    /*
    ------------------------------
    2️⃣ fallback FMP
    ------------------------------
    */

    const apiKey = process.env.FMP_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Clé API FMP absente côté serveur"
      });
    }

    const url = new URL(
      "https://financialmodelingprep.com/stable/search-name"
    );

    url.searchParams.set("query", q);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url.toString());
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

    results = (Array.isArray(raw) ? raw : [])
      .filter((item) => {
        const ex = String(
          item.exchangeShortName || item.exchange || ""
        ).toUpperCase();

        return ex === "NASDAQ" || ex === "NYSE" || ex === "AMEX";
      })
      .map((item) => ({
        symbol: item.symbol || "",
        name: item.name || item.companyName || "",
        exchange: item.exchangeShortName || item.exchange || ""
      }))
      .filter((item) => item.symbol && item.name);

    SEARCH_CACHE[cacheKey] = {
      createdAt: now,
      results
    };

    return res.status(200).json({
      results,
      source: "api"
    });
  } catch (error) {
    return res.status(500).json({
      error: "Erreur backend search",
      details: error.message || "Erreur inconnue"
    });
  }
}
