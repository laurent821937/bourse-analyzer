export default async function handler(req, res) {

const query = req.query.query;

if(!query){
return res.status(400).json({error:"query manquante"});
}

const apiKey = process.env.FMP_API_KEY;

const search = await fetch(
`https://financialmodelingprep.com/stable/search-name?query=${encodeURIComponent(query)}&limit=1&apikey=${apiKey}`
);

const searchData = await search.json();

if(!searchData.length){
return res.status(404).json({error:"entreprise introuvable"});
}

const symbol = searchData[0].symbol;

const profile = await fetch(
`https://financialmodelingprep.com/stable/profile?symbol=${symbol}&apikey=${apiKey}`
);

const profileData = await profile.json();

return res.status(200).json({
symbol,
profile:profileData
});

}
