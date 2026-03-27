const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   FETCH SAFE (corrige: fetch is not a function)
========================================================= */
const fetchFn =
  typeof global.fetch === "function"
    ? global.fetch.bind(global)
    : async (...args) => {
        const mod = await import("node-fetch");
        return mod.default(...args);
      };

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
  console.log(`🔄 Trocando para API KEY ${currentKeyIndex + 1}`);
}

/* =========================================================
   LIMITE DE USO / CUSTO
   Meta: ~60 buscas por dia
========================================================= */
const DAILY_SEARCH_LIMIT = 60;
const DAILY_QUOTA_LIMIT = 10000;

let usageState = {
  day: new Date().toISOString().slice(0, 10),
  searches: 0,
  estimatedUnits: 0
};

function resetUsageIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (usageState.day !== today) {
    usageState = {
      day: today,
      searches: 0,
      estimatedUnits: 0
    };
  }
}

function canConsumeSearch() {
  resetUsageIfNeeded();

  if (usageState.searches >= DAILY_SEARCH_LIMIT) {
    return {
      ok: false,
      reason: `Limite diário atingido. Máximo de ${DAILY_SEARCH_LIMIT} buscas por dia.`
    };
  }

  if (usageState.estimatedUnits >= DAILY_QUOTA_LIMIT) {
    return {
      ok: false,
      reason: `Cota diária estimada atingida. Máximo de ${DAILY_QUOTA_LIMIT} unidades por dia.`
    };
  }

  return { ok: true };
}

function registerSearchUsage(units) {
  resetUsageIfNeeded();
  usageState.searches += 1;
  usageState.estimatedUnits += Math.max(0, Number(units || 0));
}

function registerExtraUnits(units) {
  resetUsageIfNeeded();
  usageState.estimatedUnits += Math.max(0, Number(units || 0));
}

/* =========================================================
   YOUTUBE FETCH COM DIAGNÓSTICO
========================================================= */
async function youtubeFetch(urlWithoutKey) {
  let attempts = 0;
  let lastError = "Erro desconhecido";

  while (attempts < API_KEYS.length) {
    const key = getApiKey();
    const keyNumber = currentKeyIndex + 1;
    const url = `${urlWithoutKey}&key=${key}`;

    try {
      const response = await fetchFn(url);
      const data = await response.json();

      if (data.error) {
        const reason = data.error?.errors?.[0]?.reason || "unknownError";
        const message = data.error?.message || "Sem mensagem";
        lastError = `${reason} - ${message}`;

        console.log(`❌ KEY ${keyNumber} falhou: ${lastError}`);

        rotateKey();
        attempts++;
        continue;
      }

      console.log(`✅ KEY ${keyNumber} funcionou`);
      return data;
    } catch (error) {
      lastError = error.message || "Falha de rede";
      console.log(`⚠️ KEY ${keyNumber} erro de rede: ${lastError}`);

      rotateKey();
      attempts++;
    }
  }

  throw new Error(`Todas as API keys falharam. Último erro: ${lastError}`);
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

  const eng = views > 0 ? (likes / views) * 100 : 0;
  const perf = subscribers > 0 ? views / subscribers : views / 1000;

  const ageDays = v.publishedAt
    ? Math.max(1, (Date.now() - new Date(v.publishedAt).getTime()) / 86400000)
    : 365;

  const fresh = Math.max(0, 60 - ageDays) * 0.5;

  return Math.round(
    perf * 100 + eng * 20 + Math.log10(Math.max(views, 1)) * 30 + fresh
  );
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

  if (views > 10000) strongPoints.push("Bom volume de visualizações para chamar atenção.");
  if (Number(engagement) >= 3) strongPoints.push("Taxa de likes acima da média.");
  if (Number(commentRate) >= 0.2) strongPoints.push("Boa interação nos comentários.");
  if (subscribers > 0 && views > subscribers) strongPoints.push("Vídeo acima da base de inscritos.");

  if (views < 1000) weakPoints.push("Alcance inicial ainda baixo.");
  if (Number(engagement) < 1.5) weakPoints.push("Engajamento pode melhorar com título e thumbnail mais fortes.");
  if (comments < 10) weakPoints.push("Pouca conversa nos comentários.");
  if (subscribers > 0 && views < subscribers * 0.1) weakPoints.push("Desempenho abaixo do potencial do canal.");

  if (!strongPoints.length) strongPoints.push("Tema com potencial para ser melhor posicionado.");
  if (!weakPoints.length) weakPoints.push("Pode testar nova thumbnail e gancho inicial.");

  return {
    score,
    scoreExplicacao:
      "O score considera views, engajamento, relação entre visualizações e inscritos e frescor do conteúdo.",
    desempenho: `O vídeo tem ${views.toLocaleString("pt-BR")} views, ${likes.toLocaleString("pt-BR")} likes e ${comments.toLocaleString("pt-BR")} comentários. A taxa de engajamento por likes está em ${engagement}%.`,
    monetizacao:
      "Se o conteúdo tiver boa retenção, pode ajudar em anúncios, afiliados e crescimento de audiência.",
    pontosFortres: strongPoints,
    pontosFragos: weakPoints,
    titulo: {
      otimizado: `${data.title} | Versão Melhorada para Mais Cliques`,
      explicacao: "O título foi ajustado para ficar mais claro e mais clicável."
    },
    descricao: `Confira este conteúdo: ${data.title}\n\nEste vídeo tem potencial para atrair audiência interessada no tema. Ajustes em thumbnail, título e gancho podem melhorar ainda mais o desempenho.\n\n#youtube #tubescanner #viral`,
    tags: [
      "youtube growth",
      "youtube seo",
      "video viral",
      "tube scan",
      "youtube analysis",
      "thumbnail tips",
      "video strategy"
    ],
    gancho:
      "Nos primeiros 30 segundos, entregue a promessa principal e explique por que vale a pena continuar assistindo.",
    thumbnail:
      "Use pouco texto, contraste alto, foco visual claro e uma promessa simples de entender.",
    melhorHorario: "Teste publicar entre 18h e 22h e compare os primeiros 60 minutos.",
    ideias: [
      { titulo: "Versão 2 com promessa mais forte", motivo: "Pode aumentar CTR rapidamente." },
      { titulo: "Comparação sobre o mesmo tema", motivo: "Conteúdo comparativo gera curiosidade." },
      { titulo: "Top erros sobre esse assunto", motivo: "Formato problema + solução costuma performar bem." }
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
    resumo: `O canal tem ${subs.toLocaleString("pt-BR")} inscritos e ${videos.toLocaleString("pt-BR")} vídeos publicados.`,
    monetizacao:
      "O canal pode monetizar melhor com consistência, séries de conteúdo e thumbnails mais fortes.",
    crescimento:
      "Para crescer, foque nos temas que performam acima da média e repita os padrões vencedores.",
    nicho:
      "O nicho deve ser trabalhado com promessa clara, identidade visual forte e temas repetíveis.",
    pontosFortres: [
      "Base inicial de conteúdo já publicada.",
      "Estrutura pronta para crescer com estratégia.",
      "Pode melhorar bastante com SEO e consistência."
    ],
    melhorias: [
      "Melhorar títulos e thumbnails.",
      "Publicar em frequência previsível.",
      "Criar séries com o mesmo formato vencedor."
    ],
    estrategia:
      "Escolha 1 nicho principal, repita o mesmo tipo de promessa vencedora e acompanhe os vídeos que trazem mais views por inscrito.",
    ideias: [
      { titulo: "3 temas com mais potencial de crescimento", motivo: "Ajuda a escolher formatos repetíveis." },
      { titulo: "Análise dos vídeos que mais performaram", motivo: "Permite copiar padrões vencedores." },
      { titulo: "Série com o mesmo estilo visual", motivo: "Aumenta reconhecimento do público." }
    ],
    frequencia: "O ideal é publicar 2 a 3 vezes por semana para acelerar o aprendizado do canal.",
    melhorHorario: "Teste horários entre 18h e 22h para criar padrão de audiência."
  };
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function uniqueBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    map.set(keyFn(item), item);
  }
  return [...map.values()];
}

async function fetchVideoDetails(videoIds) {
  const ids = uniqueBy(videoIds.filter(Boolean), v => v);
  if (!ids.length) return [];

  const chunks = chunkArray(ids, 50);
  const items = [];

  for (const chunk of chunks) {
    const data = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${chunk.join(",")}`
    );
    registerExtraUnits(1);
    items.push(...(data.items || []));
  }

  return items;
}

async function fetchChannelDetails(channelIds) {
  const ids = uniqueBy(channelIds.filter(Boolean), v => v);
  if (!ids.length) return [];

  const chunks = chunkArray(ids, 50);
  const items = [];

  for (const chunk of chunks) {
    const data = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${chunk.join(",")}`
    );
    registerExtraUnits(1);
    items.push(...(data.items || []));
  }

  return items;
}

async function fetchRecentChannelVideos(channelId, maxResults = 10) {
  const params = new URLSearchParams({
    part: "snippet",
    channelId,
    order: "date",
    type: "video",
    maxResults: String(Math.min(maxResults, 10))
  });

  const data = await youtubeFetch(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`
  );

  registerExtraUnits(100);

  const items = data.items || [];
  const videoIds = items.map(i => i.id?.videoId).filter(Boolean);

  if (!videoIds.length) return [];

  const videos = await fetchVideoDetails(videoIds);

  const map = new Map();
  for (const v of videos) map.set(v.id, v);

  return items.map(item => {
    const full = map.get(item.id.videoId);
    return {
      videoId: item.id.videoId,
      title: item.snippet?.title || "",
      publishedAt: item.snippet?.publishedAt || "",
      views: Number(full?.statistics?.viewCount || 0),
      likes: Number(full?.statistics?.likeCount || 0),
      comments: Number(full?.statistics?.commentCount || 0)
    };
  });
}

async function enrichResults(items) {
  if (!items.length) return [];

  const videoIds = items.map(i => i.id?.videoId).filter(Boolean);
  const channelIds = items.map(i => i.snippet?.channelId).filter(Boolean);

  const videosData = await fetchVideoDetails(videoIds);
  const channelsData = await fetchChannelDetails(channelIds);

  const videoMap = new Map();
  for (const v of videosData) videoMap.set(v.id, v);

  const channelMap = new Map();
  for (const c of channelsData) channelMap.set(c.id, c);

  return items.map(item => {
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
}

function applyBaseFilters(results, filters) {
  const {
    minViews,
    minLikes,
    minSubs,
    maxSubs,
    dateFrom,
    dateTo,
    channelCreatedAfter,
    channelCreatedBefore
  } = filters;

  return results.filter(v => {
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
}

async function applyAdvancedChannelFilters(results, filters) {
  const {
    minQualifiedVideos,
    qualifiedViews,
    recentVideosDays,
    minAverageViews,
    minViewsPerSubscriber
  } = filters;

  const needAdvanced =
    minQualifiedVideos > 0 ||
    qualifiedViews > 0 ||
    recentVideosDays > 0 ||
    minAverageViews > 0 ||
    minViewsPerSubscriber > 0;

  if (!needAdvanced) return results;

  const uniqueChannels = uniqueBy(
    results.filter(r => r.channelId),
    r => r.channelId
  );

  const approvedChannelIds = new Set();

  for (const channel of uniqueChannels) {
    const recentVideos = await fetchRecentChannelVideos(channel.channelId, 10);

    const recentLimitDate =
      recentVideosDays > 0 ? getDateDaysAgo(recentVideosDays) : null;

    const filteredRecent = recentVideos.filter(v => {
      if (recentLimitDate && new Date(v.publishedAt) < recentLimitDate) return false;
      return true;
    });

    const targetViews = qualifiedViews > 0 ? qualifiedViews : 0;
    const qualifiedCount = filteredRecent.filter(v => v.views >= targetViews).length;

    const avgViews =
      filteredRecent.length > 0
        ? filteredRecent.reduce((sum, v) => sum + Number(v.views || 0), 0) / filteredRecent.length
        : 0;

    const subs = Number(channel.subscribers || 0);
    const bestViews = filteredRecent.length
      ? Math.max(...filteredRecent.map(v => Number(v.views || 0)))
      : 0;

    const viewsPerSubscriber =
      subs > 0 ? bestViews / subs : bestViews > 0 ? bestViews : 0;

    let pass = true;

    if (minQualifiedVideos > 0 && qualifiedCount < minQualifiedVideos) pass = false;
    if (minAverageViews > 0 && avgViews < minAverageViews) pass = false;
    if (minViewsPerSubscriber > 0 && viewsPerSubscriber < minViewsPerSubscriber) pass = false;

    if (pass) {
      approvedChannelIds.add(channel.channelId);
    }
  }

  return results.filter(r => approvedChannelIds.has(r.channelId));
}

function sortResults(results, sortBy) {
  const arr = [...results];

  switch (sortBy) {
    case "views":
      return arr.sort((a, b) => b.views - a.views);

    case "likes":
      return arr.sort((a, b) => b.likes - a.likes);

    case "subs":
      return arr.sort((a, b) => b.subscribers - a.subscribers);

    case "newest":
      return arr.sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );

    case "oldest":
      return arr.sort(
        (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()
      );

    case "score":
      return arr.sort((a, b) => calcVideoScore(b) - calcVideoScore(a));

    default:
      return arr;
  }
}

/* =========================================================
   SEARCH
========================================================= */
app.get("/api/search", async (req, res) => {
  try {
    const usageCheck = canConsumeSearch();
    if (!usageCheck.ok) {
      return res.json({
        error: usageCheck.reason,
        usage: usageState
      });
    }

    const q = (req.query.q || "").trim();

    if (!q) {
      return res.json({ error: "Digite algo para buscar." });
    }

    const regionCode =
      req.query.regionCode && req.query.regionCode !== "all"
        ? req.query.regionCode
        : "";

    const relevanceLanguage =
      req.query.relevanceLanguage && req.query.relevanceLanguage !== "all"
        ? req.query.relevanceLanguage
        : "";

    const order =
      req.query.order && req.query.order !== "default"
        ? req.query.order
        : "";

    const minViews = toNumber(req.query.minViews, 0);
    const minLikes = toNumber(req.query.minLikes, 0);
    const minSubs = toNumber(req.query.minSubs, 0);
    const maxSubs = req.query.maxSubs !== undefined && req.query.maxSubs !== ""
      ? toNumber(req.query.maxSubs, null)
      : null;

    const dateFrom = req.query.dateFrom || "";
    const dateTo = req.query.dateTo || "";
    const channelCreatedAfter = req.query.channelCreatedAfter || "";
    const channelCreatedBefore = req.query.channelCreatedBefore || "";

    const minQualifiedVideos = toNumber(req.query.minQualifiedVideos, 0);
    const qualifiedViews = toNumber(req.query.qualifiedViews, 0);
    const recentVideosDays = toNumber(req.query.recentVideosDays, 0);
    const minAverageViews = toNumber(req.query.minAverageViews, 0);
    const minViewsPerSubscriber = toNumber(req.query.minViewsPerSubscriber, 0);

    const maxSearchPagesRaw = toNumber(req.query.maxSearchPages, 2);
    const maxSearchPages = Math.min(Math.max(maxSearchPagesRaw, 1), 3);

    const desiredResults = toNumber(req.query.desiredResults, 12);
    const targetEnough = Math.min(Math.max(desiredResults, 12), 30);

    let nextPageToken = "";
    let page = 0;
    let allItems = [];
    let lastEstimatedUnits = 0;

    while (page < maxSearchPages) {
      const searchParams = new URLSearchParams({
        part: "snippet",
        q,
        type: "video",
        maxResults: "50"
      });

      if (regionCode) searchParams.set("regionCode", regionCode);
      if (relevanceLanguage) searchParams.set("relevanceLanguage", relevanceLanguage);
      if (order) searchParams.set("order", order);
      if (dateFrom) {
        searchParams.set("publishedAfter", new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        searchParams.set("publishedBefore", to.toISOString());
      }
      if (nextPageToken) searchParams.set("pageToken", nextPageToken);

      const searchData = await youtubeFetch(
        `https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`
      );

      lastEstimatedUnits += 100;

      const items = searchData.items || [];
      allItems.push(...items);

      const uniqueItems = uniqueBy(
        allItems.filter(i => i.id?.videoId),
        i => i.id.videoId
      );

      const enriched = await enrichResults(uniqueItems);

      let filtered = applyBaseFilters(enriched, {
        minViews,
        minLikes,
        minSubs,
        maxSubs,
        dateFrom,
        dateTo,
        channelCreatedAfter,
        channelCreatedBefore
      });

      filtered = await applyAdvancedChannelFilters(filtered, {
        minQualifiedVideos,
        qualifiedViews,
        recentVideosDays,
        minAverageViews,
        minViewsPerSubscriber
      });

      if (filtered.length >= targetEnough) {
        allItems = uniqueItems;
        nextPageToken = searchData.nextPageToken || "";
        break;
      }

      nextPageToken = searchData.nextPageToken || "";
      allItems = uniqueItems;
      page += 1;

      if (!nextPageToken) break;
    }

    registerSearchUsage(lastEstimatedUnits);

    const enrichedFinal = await enrichResults(allItems);

    let results = applyBaseFilters(enrichedFinal, {
      minViews,
      minLikes,
      minSubs,
      maxSubs,
      dateFrom,
      dateTo,
      channelCreatedAfter,
      channelCreatedBefore
    });

    results = await applyAdvancedChannelFilters(results, {
      minQualifiedVideos,
      qualifiedViews,
      recentVideosDays,
      minAverageViews,
      minViewsPerSubscriber
    });

    const sortBy = req.query.sortBy || "";
    results = sortResults(results, sortBy);

    return res.json({
      results,
      meta: {
        q,
        pagesUsed: Math.min(maxSearchPages, Math.max(1, page + 1)),
        estimatedUnitsUsed: usageState.estimatedUnits,
        searchesUsedToday: usageState.searches,
        searchesLeftToday: Math.max(0, DAILY_SEARCH_LIMIT - usageState.searches),
        quotaLeftToday: Math.max(0, DAILY_QUOTA_LIMIT - usageState.estimatedUnits),
        appliedFilters: {
          minViews,
          minLikes,
          minSubs,
          maxSubs,
          dateFrom,
          dateTo,
          channelCreatedAfter,
          channelCreatedBefore,
          minQualifiedVideos,
          qualifiedViews,
          recentVideosDays,
          minAverageViews,
          minViewsPerSubscriber,
          order,
          sortBy
        }
      }
    });
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
    registerExtraUnits(1);

    const item = videoData.items?.[0];
    if (!item) {
      return res.json({ error: "Vídeo não encontrado." });
    }

    const channelId = item.snippet.channelId;
    const channelData = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}`
    );
    registerExtraUnits(1);

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
      registerExtraUnits(100);

      channelId = searchData.items?.[0]?.snippet?.channelId || "";
    }

    if (!channelId) {
      return res.json({ error: "Canal não encontrado." });
    }

    const channelData = await youtubeFetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}`
    );
    registerExtraUnits(1);

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
   USAGE
========================================================= */
app.get("/api/usage", async (req, res) => {
  try {
    resetUsageIfNeeded();

    return res.json({
      day: usageState.day,
      searchesUsed: usageState.searches,
      searchesLimit: DAILY_SEARCH_LIMIT,
      searchesLeft: Math.max(0, DAILY_SEARCH_LIMIT - usageState.searches),
      estimatedUnitsUsed: usageState.estimatedUnits,
      estimatedUnitsLimit: DAILY_QUOTA_LIMIT,
      estimatedUnitsLeft: Math.max(0, DAILY_QUOTA_LIMIT - usageState.estimatedUnits)
    });
  } catch (error) {
    console.log("❌ /api/usage:", error.message);
    return res.json({ error: error.message });
  }
});

/* =========================================================
   START
========================================================= */
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});