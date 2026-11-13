import express from "express";

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT || 7000);
const BASE_URL = (process.env.MAGNETBR_BASE_URL || "https://magnetbr.flixbr.online").replace(/\/$/, "");
const SCRAPER_TYPES = (process.env.SCRAPER_TYPES || "db,hybrid,all,starck,rede,tfilme,comand,bludv,torrentclaw")
  .split(",").map(v => v.trim()).filter(Boolean);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 300);
const cache = new Map();

const manifest = {
  id: "com.mykael.magnetbr",
  version: "1.0.0",
  name: "MagnetBR Brasil",
  description: "Busca streams em indexadores brasileiros via MagnetBR.",
  logo: "https://raw.githubusercontent.com/mykaelandradee/magnetbr-addon/main/assets/logo.png",
  resources: ["catalog", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    {
      type: "movie",
      id: "magnetbr-search",
      name: "MagnetBR",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "magnetbr-search-series",
      name: "MagnetBR Séries",
      extra: [{ name: "search", isRequired: true }]
    }
  ],
  behaviorHints: { configurable: true, configurationRequired: false }
};

const clean = value => String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 250);
const cacheGet = key => {
  const item = cache.get(key);
  if (!item) return null;
  if (item.expires < Date.now()) { cache.delete(key); return null; }
  return item.value;
};
const cacheSet = (key, value) => {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_SECONDS * 1000 });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
};

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "accept": "application/json", "user-agent": "MagnetBR-Nuvio-Addon/1.0" }
    });
    if (!response.ok) throw new Error(`MagnetBR respondeu HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeResults(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
  return rows.map((item) => ({
    title: clean(item.title || item.original_title || "Resultado sem título"),
    originalTitle: clean(item.original_title),
    magnet: typeof item.magnet_link === "string" ? item.magnet_link : "",
    hash: clean(item.info_hash),
    size: item.size ?? null,
    seeders: Number(item.seed_count || 0),
    leechers: Number(item.leech_count || 0),
    date: clean(item.date),
    details: clean(item.details),
    imdb: clean(item.imdb)
  })).filter(item => item.magnet.startsWith("magnet:?") || item.hash);
}

async function searchIndexers(query, season, episode) {
  const key = [query.toLowerCase(), season ?? "", episode ?? ""].join("|");
  const cached = cacheGet(key);
  if (cached) return cached;

  const results = await Promise.allSettled(SCRAPER_TYPES.map(async type => {
    const url = new URL(`${BASE_URL}/indexers/${encodeURIComponent(type)}`);
    url.searchParams.set("q", query);
    if (season !== undefined) url.searchParams.set("season", String(season));
    if (episode !== undefined) url.searchParams.set("ep", String(episode));
    const payload = await fetchJson(url);
    return normalizeResults(payload);
  }));

  const merged = [];
  const seen = new Set();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      const key = item.hash || item.magnet;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  merged.sort((a, b) => b.seeders - a.seeders);
  cacheSet(key, merged);
  return merged;
}

async function getCinemetaMeta(type, id) {
  const safeType = type === "series" ? "series" : "movie";
  try {
    const data = await fetchJson(`https://cinemeta-live.strem.io/meta/${safeType}/${encodeURIComponent(id)}.json`);
    return data?.meta || null;
  } catch {
    return null;
  }
}

function titleForResult(item) {
  const title = item.title || item.originalTitle;
  const year = title.match(/\b(19|20)\d{2}\b/)?.[0];
  return { title, year };
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MagnetBR Brasil</title><style>body{font:16px system-ui;max-width:760px;margin:8vh auto;padding:24px;background:#101318;color:#edf1f7}a{color:#8bd5ff}.muted{color:#aab4c3}code{background:#202733;padding:3px 7px;border-radius:6px}</style><h1>MagnetBR Brasil</h1><p>Addon de busca para Stremio e Nuvio.</p><p><a href="/manifest.json">Instalar / abrir manifest</a></p><p class="muted">Para adicionar: use a URL <code>${BASE_URL === "https://magnetbr.flixbr.online" ? "URL_DO_SEU_RENDER" : ""}/manifest.json</code> do serviço publicado.</p><p class="muted">A disponibilidade dos resultados depende do serviço MagnetBR e dos indexadores configurados.</p></html>`);
});

app.get("/health", (_req, res) => res.json({ status: "ok", service: "magnetbr-addon" }));
app.get("/manifest.json", (_req, res) => res.json(manifest));

app.get("/catalog/:type/:id.json", async (req, res) => {
  const type = req.params.type === "series" ? "series" : "movie";
  const query = clean(req.query.search);
  if (!query) return res.json({ metas: [] });
  try {
    const results = await searchIndexers(query);
    const metas = [];
    const seen = new Set();
    for (const item of results) {
      const id = item.imdb.match(/tt\d+/)?.[0];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const title = titleForResult(item);
      metas.push({
        id, type, name: title.title,
        ...(title.year ? { year: Number(title.year) } : {}),
        posterShape: "poster"
      });
    }
    res.json({ metas });
  } catch (error) {
    res.status(200).json({ metas: [], error: error.message });
  }
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const type = req.params.type === "series" ? "series" : "movie";
  const id = clean(req.params.id).match(/tt\d+/)?.[0];
  if (!id) return res.json({ streams: [] });

  const meta = await getCinemetaMeta(type, id);
  if (!meta?.name) return res.json({ streams: [] });

  const season = req.query.season === undefined ? undefined : Number(req.query.season);
  const episode = req.query.episode === undefined ? undefined : Number(req.query.episode);
  const query = [meta.name, season !== undefined ? `S${String(season).padStart(2, "0")}` : "", episode !== undefined ? `E${String(episode).padStart(2, "0")}` : ""].filter(Boolean).join(" ");

  try {
    const results = await searchIndexers(query, season, episode);
    const streams = results.slice(0, 30).map(item => ({
      name: `MagnetBR • ${item.seeders} seeds`,
      title: [item.title, item.size ? `Tamanho: ${item.size}` : "", `Seeds: ${item.seeders} | Peers: ${item.leechers}`].filter(Boolean).join("\n"),
      infoHash: item.hash || undefined,
      url: item.magnet || undefined,
      behaviorHints: { notWebReady: true }
    })).filter(stream => stream.url || stream.infoHash);
    res.json({ streams });
  } catch (error) {
    res.status(200).json({ streams: [], error: error.message });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`MagnetBR addon ativo na porta ${PORT}`));
