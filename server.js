const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   API KEYS
========================================================= */
const API_KEYS = [
  "AIzaSyBjrYzYtPT18QFUSdsU41TpfG9EDL7w2X8",
  "AIzaSyDtU91Gk9UXNZuf0W7p2bLM0ZkVV1DI2bk",
  "AIzaSyA15fCYtqR7dMMuyx194HBoIrtW-9DyHPQ"
];

let currentKeyIndex = 0;

function getApiKey() {
  return API_KEYS[currentKeyIndex];
}

function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.log("🔄 Trocando para API KEY:", currentKeyIndex + 1);
}

async function youtubeFetch(urlWithoutKey) {
  let attempts = 0;

  while (attempts < API_KEYS.length) {
    const key = getApiKey();
    const url = `${urlWithoutKey}&key=${key}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        const reason = data.error?.errors?.[0]?.reason || data.error?.message || "unknownError";
        console.log("❌ Erro YouTube API:", reason);

        if (
          reason === "quotaExceeded" ||
          reason === "dailyLimitExceeded" ||
          reason === "rateLimitExceeded"
        ) {
          rotateKey();
          attempts++;
          continue;
        }

        throw new Error(reason);
      }

      return data;
    } catch (error) {
      console.log("⚠️ Falha na requisição:", error.message);
      rotateKey();
      attempts++;
    }
  }

  throw new Error("Todas as API keys falharam.");
}

/* =========================================================
   HELPERS
========================================================= */
function parseVideoId(input = "") {
  const value = input.trim();

  if (!value) return "";

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);

    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return v;

      const parts = url.pathname.split("/").filter(Boolean);
      const shortsIndex = parts.indexOf("shorts");
      if (shortsIndex !== -1 && parts[shortsIndex + 1]) {
        return parts[shortsIndex + 1];
      }

      const liveIndex = parts.indexOf("live");
      if (liveIndex !== -1 && parts[liveIndex + 1]) {
        return parts[liveIndex + 1];
      }
    }

    if (url.hostname.includes("youtu.be")) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0]) return parts[0];
    }
  } catch {
    return "";
  }

  return "";
}

function parseChannelInput(input = "") {
  const value = input.trim();

  if (!value) {
    return { type: "unknown", value: "" };
  }

  if (value.startsWith("UC") && value.length >= 20) {
    return { type: "channelId", value };
  }

  if (value.startsWith("@")) {
    return { type: "handle", value: value.slice(1) };
  }

  try {
    const url = new URL(value);

    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "channel" && parts[1]) {
      return { type: "channelId", value: parts[1] };
    }

    if (parts[0] && parts[0].startsWith("@")) {
      return { type: "handle", value: parts[0].slice(1) };
    }

    if (parts[0] === "c" && parts[1]) {
      return { type: "searchName", value: parts[1] };
    }

    if (parts[0] === "user" && parts[1]) {
      return { type: "searchName", value: parts[1] };
    }
  } catch {
    return { type: "searchName", value };
  }

  return { type: "searchName", value };
}

function calcVideoScore(v) {
  const views = Number(v.views || 0);
  const likes = Number(v.likes || 0);
  const comments = Number(v.comments || 0);
  const subscribers = Number(v.subscribers || 0);

  const eng = views > 0 ? ((likes + comments * 2) / views) * 100 : 0;
  const perf = subscribers > 0 ? views / subscribers : views / 1000;

  const ageDays = v.publishedAt
    ? Math.max(1, (Date.now() - new Date(v.publishedAt).getTime()) / 86400000)
    : 365;

  const fresh = Math.max(0, 60 - ageDays) * 0.5;

  return Math.round(perf * 100 + eng * 20 + Math.log10(Math.max(views, 1)) * 30 + fresh);
}

function buildVideoAnalysis(data) {
  const views = Number(data.views || 0);
  const likes = Number(data.likes || 0);
  const comments = Number(data.comments || 0);
  const subscribers = Number(data.subscribers || 0);

  const score = Math.min(calcVideoScore(data), 1000);
  const engagement = views > 0 ? ((likes / views) * 100).toFixed(2) : "0.00";
  const commentRate = views > 0 ? ((comments / views) * 100).toFixed(2) : "0.00";

  const strongPoints = [];
  const weakPoints = [];

  if (views > 10000) strongPoints.push("Bom volume de visualizações para chamar atenção no nicho.");
  if (Number(engagement) >= 3) strongPoints.push("Taxa de likes acima da média.");
  if (Number(commentRate) >= 0.2) strongPoints.push("Boa chance de gerar discussão e retenção.");
  if (subscribers > 0 && views > subscribers) strongPoints.push("Vídeo performando acima da base de inscritos.");

  if (views < 1000) weakPoints.push("Baixo alcance inicial.");
  if (Number(engagement) < 1.5) weakPoints.push("Engajamento pode melhorar com thumbnail e gancho mais forte.");
  if (comments < 10) weakPoints.push("Pouca conversa nos comentários.");
  if (subscribers > 0 && views < subscribers * 0.1) weakPoints.push("Desempenho abaixo do potencial do canal.");

  if (!strongPoints.length) strongPoints.push("Tema com potencial para ser refinado e reposicionado.");
  if (!weakPoints.length) weakPoints.push("Pode testar título, thumbnail e CTA para aumentar CTR.");

  return {
    score,
    scoreExplicacao: `O score considera views, engajamento, relação entre visualizações e inscritos, e frescor do conteúdo.`,
    desempenho: `O vídeo tem ${views.toLocaleString("pt-BR")} views, ${likes.toLocaleString("pt-BR")} likes e ${comments.toLocaleString("pt-BR")} comentários. A taxa de engajamento por likes está em ${engagement}%.`,
    monetizacao: `Se o conteúdo mantiver boa retenção, ele pode ser útil para monetização com anúncios, afiliados ou captação de audiência para outros vídeos relacionados.`,
    pontosFortres: strongPoints,
    pontosFragos: weakPoints,
    titulo: {
      otimizado: `${data.title} | Versão Melhorada para Mais Cliques`,
      explicacao: "O título otimizado tenta deixar a proposta mais clara e aumentar curiosidade sem perder o contexto original."
    },
    descricao: `Confira este conteúdo: ${data.title}\n\nNeste vídeo você encontra um tema com potencial para atrair audiência interessada. Se a thumbnail e o gancho estiverem alinhados, a chance de clique e retenção pode aumentar.\n\n#youtube #tubescanner #viral`,
    tags: [
      "youtube growth",
      "youtube seo",
      "video viral",
      "tube scan",
      "youtube analysis",
      "thumbnail tips",
      "video strategy"
    ],
    gancho: "Nos primeiros 30 segundos, deixe claro o benefício principal do vídeo, entregue uma promessa objetiva e mostre por que vale a pena continuar assistindo.",
    thumbnail: "Use pouco texto, contraste alto, foco visual claro e um elemento principal fácil de entender em menos de 1 segundo.",
    melhorHorario: "Teste publicar entre 18h e 22h e compare os primeiros 60 minutos de desempenho.",
    ideias: [
      { titulo: "Versão 2 com abordagem mais direta", motivo: "Pode melhorar o CTR com promessa mais objetiva." },
      { titulo: "Comparação ou reação sobre o mesmo tema", motivo: "Conteúdo comparativo costuma aumentar curiosidade." },
      { titulo: "Top erros sobre esse assunto", motivo: "Formato com problema + solução tende a gerar clique." }
    ]
  };
}

function buildChannelAnalysis(data) {
  const subs = Number(data.subscribers || 0);
  const videos = Number(data.videoCount || 0);

  let saude = "Regular";
  if (subs >= 100000) saude = "Excelente";
  else if (subs >= 10000) saude = "Bom";
  else if (subs < 1000) saude = "Fraco";

  return {
    saude,
    resumo: `O canal tem ${subs.toLocaleString("pt-BR")} inscritos e ${videos.toLocaleString("pt-BR")} vídeos publicados. A análise considera tamanho, volume de conteúdo e potencial de crescimento.`,
    monetizacao: "O canal pode monetizar melhor com consistência, séries de conteúdo, thumbnails mais fortes e foco claro no nicho.",
    crescimento: "Para crescer, foque em temas repetíveis, títulos melhores e análise dos vídeos que performam acima da média.",
    nicho: "O nicho deve ser trabalhado com consistência visual, promessa clara e vídeos que atendam a uma dor ou interesse específico.",
    pontosFortres: [
      "Base inicial de conteúdo publicada.",
      "Estrutura pronta para evoluir com estratégia.",
      "Canal pode se beneficiar muito de SEO e consistência."
    ],
    melhorias: [
      "Melhorar títulos e thumbnails.",
      "Publicar com frequência previsível.",
      "Criar séries de vídeos sobre subtemas vencedores."
    ],
    estrategia: "Escolha 1 nicho principal, repita o mesmo tipo de promessa vencedora nos próximos vídeos e acompanhe quais conteúdos puxam mais views por inscrito.",
    ideias: [
      { titulo: "3 temas que mais podem crescer no canal", motivo: "Ajuda a encontrar formatos repetíveis." },
      { titulo: "Análise dos vídeos que mais performaram", motivo: "Permite duplicar padrões vencedores." },
      { titulo: "Série de vídeos com mesmo formato visual", motivo: "Aumenta reconhecimento do público." }
    ],
    frequencia: "O ideal é publicar pelo menos 2 a 3 vezes por semana para gerar histórico e aprendizado mais rápido.",
    melhorHorario: "Teste horários fixos entre 18h e 22h para criar hábito de audiência."
  };
}

/* =========================================================
   SEARCH
========================================================= */
app.get("/api/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    if (!q) {
      return res.json({ error: "Digite algo para buscar." });
    }

    const maxResults = 12;
    const regionCode =
      req.query.regionCode && req.query.regionCode !== "all"
        ? req.query.regionCode
        : "";
    const relevanceLanguage =
      req.query.relevanceLanguage && req.query.relevanceLanguage !== "all"
        ? req.query.relevanceLanguage
        : "";

    const searchParams = new URLSearchParams({
      part: "snippet",
      q,
      type: "video",
      maxResults: String(maxResults)
    });

    if (regionCode) searchParams.set("regionCode", regionCode);
    if (relevanceLanguage) searchParams.set("relevanceLanguage", relevanceLanguage);

    const searchData = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`
    );

    const items = searchData.items || [];
    if (!items.length) {
      return res.json({ results: [] });
    }

    const videoIds = items.map(i => i.id.videoId).filter(Boolean).join(",");
    const channelIds = [...new Set(items.map(i => i.snippet.channelId).filter(Boolean))].join(",");

    const videosData = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}`
    );

    const channelsData = channelIds
      ? await youtubeFetch(
          `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${channelIds}`
        )
      : { items: [] };

    const videoMap = new Map();
    for (const v of videosData.items || []) {
      videoMap.set(v.id, v);
    }

    const channelMap = new Map();
    for (const c of channelsData.items || []) {
      channelMap.set(c.id, c);
    }

    const minViews = Number(req.query.minViews || 0);
    const minLikes = Number(req.query.minLikes || 0);
    const minSubs = Number(req.query.minSubs || 0);
    const maxSubs = req.query.maxSubs ? Number(req.query.maxSubs) : null;
    const dateFrom = req.query.dateFrom || "";
    const dateTo = req.query.dateTo || "";
    const channelCreatedAfter = req.query.channelCreatedAfter || "";
    const channelCreatedBefore = req.query.channelCreatedBefore || "";

    let results = items.map(item => {
      const video = videoMap.get(item.id.videoId);
      const channel = channelMap.get(item.snippet.channelId);

      return {
        videoId: item.id.videoId,
        title: item.snippet.title || "",
        thumbnail:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          "",
        channel: item.snippet.channelTitle || "",
        publishedAt: item.snippet.publishedAt || "",
        views: Number(video?.statistics?.viewCount || 0),
        likes: Number(video?.statistics?.likeCount || 0),
        comments: Number(video?.statistics?.commentCount || 0),
        subscribers: Number(channel?.statistics?.subscriberCount || 0),
        channelCreatedAt: channel?.snippet?.publishedAt || "",
        channelId: item.snippet.channelId || ""
      };
    });

    results = results.filter(v => {
      if (v.views < minViews) return false;
      if (v.likes < minLikes) return false;
      if (v.subscribers < minSubs) return false;
      if (maxSubs !== null && v.subscribers > maxSubs) return false;

      if (dateFrom) {
        const from = new Date(dateFrom);
        if (new Date(v.publishedAt) < from) return false;
      }

      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(v.publishedAt) > to) return false;
      }

      if (channelCreatedAfter && v.channelCreatedAt) {
        if (new Date(v.channelCreatedAt) < new Date(channelCreatedAfter)) return false;
      }

      if (channelCreatedBefore && v.channelCreatedAt) {
        const before = new Date(channelCreatedBefore);
        before.setHours(23, 59, 59, 999);
        if (new Date(v.channelCreatedAt) > before) return false;
      }

      return true;
    });

    return res.json({ results });
  } catch (error) {
    console.log("❌ /api/search:", error.message);
    return res.json({ error: error.message });
  }
});

/* =========================================================
   VIDEO
========================================================= */
app.get("/api/video", async (req, res) => {
  try {
    const input = req.query.url || "";
    const videoId = parseVideoId(input);

    if (!videoId) {
      return res.json({ error: "URL ou ID de vídeo inválido." });
    }

    const videoData = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}`
    );

    const item = videoData.items?.[0];
    if (!item) {
      return res.json({ error: "Vídeo não encontrado." });
    }

    const channelId = item.snippet.channelId;
    const channelData = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}`
    );

    const ch = channelData.items?.[0];

    return res.json({
      videoId,
      title: item.snippet.title || "",
      thumbnail:
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        "",
      channelName: item.snippet.channelTitle || "",
      publishedAt: item.snippet.publishedAt || "",
      views: Number(item.statistics?.viewCount || 0),
      likes: Number(item.statistics?.likeCount || 0),
      comments: Number(item.statistics?.commentCount || 0),
      subscribers: Number(ch?.statistics?.subscriberCount || 0),
      channel: {
        channelId: ch?.id || channelId,
        title: ch?.snippet?.title || item.snippet.channelTitle || "",
        subscribers: Number(ch?.statistics?.subscriberCount || 0),
        thumbnail:
          ch?.snippet?.thumbnails?.high?.url ||
          ch?.snippet?.thumbnails?.medium?.url ||
          ch?.snippet?.thumbnails?.default?.url ||
          ""
      }
    });
  } catch (error) {
    console.log("❌ /api/video:", error.message);
    return res.json({ error: error.message });
  }
});

/* =========================================================
   CHANNEL
========================================================= */
app.get("/api/channel", async (req, res) => {
  try {
    const input = (req.query.input || "").trim();

    if (!input) {
      return res.json({ error: "Digite um canal, @handle, URL ou channelId." });
    }

    const parsed = parseChannelInput(input);
    let channelId = "";

    if (parsed.type === "channelId") {
      channelId = parsed.value;
    } else {
      let searchTerm = parsed.value;
      if (parsed.type === "handle") {
        searchTerm = parsed.value;
      }

      const searchData = await youtubeFetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(searchTerm)}`
      );

      channelId = searchData.items?.[0]?.snippet?.channelId || "";
    }

    if (!channelId) {
      return res.json({ error: "Canal não encontrado." });
    }

    const channelData = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}`
    );

    const ch = channelData.items?.[0];
    if (!ch) {
      return res.json({ error: "Canal não encontrado." });
    }

    return res.json({
      channelId: ch.id,
      title: ch.snippet?.title || "",
      thumbnail:
        ch.snippet?.thumbnails?.high?.url ||
        ch.snippet?.thumbnails?.medium?.url ||
        ch.snippet?.thumbnails?.default?.url ||
        "",
      subscribers: Number(ch.statistics?.subscriberCount || 0),
      videoCount: Number(ch.statistics?.videoCount || 0),
      createdAt: ch.snippet?.publishedAt || ""
    });
  } catch (error) {
    console.log("❌ /api/channel:", error.message);
    return res.json({ error: error.message });
  }
});

/* =========================================================
   ANALYZE
========================================================= */
app.post("/api/analyze", async (req, res) => {
  try {
    const { type, data } = req.body || {};

    if (!type || !data) {
      return res.json({ error: "Dados inválidos para análise." });
    }

    if (type === "video") {
      return res.json(buildVideoAnalysis(data));
    }

    if (type === "channel") {
      return res.json(buildChannelAnalysis(data));
    }

    return res.json({ error: "Tipo de análise inválido." });
  } catch (error) {
    console.log("❌ /api/analyze:", error.message);
    return res.json({ error: error.message });
  }
});

/* =========================================================
   START
========================================================= */
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});