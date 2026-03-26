const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = 3000;

// 🔑 SUAS API KEYS
const API_KEYS = [
  "AIzaSyBjrYzYtPT18QFUSdsU41TpfG9EDL7w2X8",
  "AIzaSyDtU91Gk9UXNZuf0W7p2bLM0ZkVV1DI2bk",
  "AIzaSyA15fCYtqR7dMMuyx194HBoIrtW-9DyHPQ"
];

let currentKeyIndex = 0;

// 👉 pega key atual
function getApiKey() {
  return API_KEYS[currentKeyIndex];
}

// 👉 troca key
function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.log("🔄 Trocando para API KEY:", currentKeyIndex);
}

// 🔎 FUNÇÃO DE BUSCA COM ROTAÇÃO
async function fetchYouTube(query) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&maxResults=10&type=video&key=${getApiKey()}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // 🔥 CAPTURA ERRO
    if (data.error) {
      const reason = data.error.errors[0].reason;
      console.log("❌ Erro:", reason);

      if (
        reason === "quotaExceeded" ||
        reason === "dailyLimitExceeded"
      ) {
        rotateKey();
        return fetchYouTube(query); // tenta de novo
      }

      throw new Error(reason);
    }

    return data.items;

  } catch (err) {
    console.log("⚠️ Erro geral:", err.message);
    return [];
  }
}

// 🔎 ROTA API
app.get("/api/search", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.json({ error: "Digite algo para buscar" });
  }

  const result = await fetchYouTube(query);
  res.json(result);
});

// 🌐 FRONTEND
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`🚀 Rodando em http://localhost:${PORT}`);
});