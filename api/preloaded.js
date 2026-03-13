import { listPreloadedCompanies } from "../data/preloaded-analyses.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Méthode non autorisée"
    });
  }

  try {
    const companies = listPreloadedCompanies()
      .sort((a, b) => {
        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return String(a.companyName || "").localeCompare(String(b.companyName || ""));
      });

    return res.status(200).json({
      success: true,
      count: companies.length,
      companies
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erreur serveur sur /api/preloaded",
      details: error.message || "Erreur inconnue"
    });
  }
}
