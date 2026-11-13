import express from "express";

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT || 7000);
const BASE_URL = (process.env.MAGNETBR_BASE_URL || "https://magnetbr.flixbr.online").replace(/\/$/, "");
const SCRAPER_TYPES = (process.env.SCRAPER_TYPES || "all")
  .split(",").map(v => v.trim()).filter(Boolean);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 300);
const cache = new Map();

const manifest = {
  id: "com.mykael.magnetbr",
  version: "1.0.0",
  name: "MagnetBR Brasil",
  description: "Busca streams em indexadores brasileiros via MagnetBR.",
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

app.get("/", (req, res) => {
  const installUrl = `${req.protocol}://${req.get("host")}/manifest.json`;
  const safeUrl = installUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const stremioUrl = `stremio://${req.get("host")}/manifest.json`;
  res.type("html").send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#090d13">
<meta name="description" content="MagnetBR Brasil — addon de busca de filmes e séries para Stremio e Nuvio.">
<title>MagnetBR Brasil — Addon</title>
<style>
:root{color-scheme:dark;--bg:#090d13;--panel:#111923;--line:#263442;--muted:#9aabba;--text:#f2f7fb;--cyan:#64e4d2;--lime:#c6f36b}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% -20%,#17413f 0,transparent 48%),radial-gradient(ellipse at 100% 70%,#152c39 0,transparent 35%),var(--bg);color:var(--text);font:15px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;padding:36px 18px}
a{color:inherit;text-decoration:none}.shell{width:min(100%,900px)}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:34px}
.brand{display:flex;align-items:center;gap:12px;font-weight:750;letter-spacing:.02em}.mark{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,var(--cyan),var(--lime));display:grid;place-items:center;color:#071311;font-size:20px;font-weight:900;box-shadow:0 8px 30px #64e4d233}
.status{font-size:12px;color:var(--cyan);border:1px solid #64e4d255;background:#64e4d20d;border-radius:99px;padding:6px 11px;letter-spacing:.08em;text-transform:uppercase}
.hero{text-align:center;padding:34px 12px 38px}.eyebrow{display:inline-flex;gap:8px;align-items:center;color:var(--lime);font-size:12px;font-weight:750;letter-spacing:.16em;text-transform:uppercase}.dot{width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 14px var(--lime)}
h1{font-size:clamp(38px,7vw,68px);line-height:1.03;letter-spacing:-.055em;margin:18px 0 16px}h1 span{background:linear-gradient(100deg,var(--cyan),var(--lime));background-clip:text;-webkit-background-clip:text;color:transparent}
.intro{max-width:590px;margin:0 auto;color:var(--muted);font-size:17px}.panel{background:linear-gradient(145deg,#15212cdd,#0f1720f2);border:1px solid var(--line);border-radius:24px;padding:clamp(22px,5vw,38px);box-shadow:0 24px 90px #0006}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:24px}h2{font-size:18px;margin:0;letter-spacing:-.02em}.version{font-size:12px;color:var(--muted);background:#ffffff0a;border:1px solid #ffffff12;padding:5px 9px;border-radius:8px}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.btn{min-height:52px;border-radius:13px;padding:13px 18px;display:flex;align-items:center;justify-content:center;gap:10px;font-weight:750;border:1px solid transparent;cursor:pointer;font:inherit;font-weight:750;transition:transform .18s,border-color .18s,background .18s}.btn:hover{transform:translateY(-2px)}
.primary{background:linear-gradient(100deg,var(--cyan),var(--lime));color:#071411}.secondary{background:#ffffff08;border-color:#ffffff20;color:var(--text)}
.url-label{display:block;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:26px 0 9px}.url-row{display:flex;gap:9px;align-items:stretch}
.url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#080e14;border:1px solid var(--line);border-radius:11px;padding:13px 14px;color:#c6d7e2;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.copy{background:#1c2b36;border:1px solid #344957;color:var(--text);border-radius:11px;padding:0 17px;font-weight:700;cursor:pointer}.copy:hover{background:#263b49}.hint{margin:10px 0 0;color:var(--muted);font-size:12px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.step{padding:17px;border:1px solid var(--line);border-radius:15px;background:#ffffff05}.num{font-size:11px;color:var(--cyan);font-weight:800;letter-spacing:.12em}.step strong{display:block;margin:7px 0 3px;font-size:14px}.step p{margin:0;color:var(--muted);font-size:12px;line-height:1.5}
footer{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:25px;color:#718392;font-size:12px}footer a{color:#a9c3cf}#notice{min-height:20px;margin-top:10px;color:var(--lime);font-size:12px}
@media(max-width:620px){body{padding:22px 14px}.top{margin-bottom:15px}.hero{padding:35px 4px 28px}.intro{font-size:15px}.actions{grid-template-columns:1fr}.steps{grid-template-columns:1fr}.step{display:grid;grid-template-columns:36px 1fr;column-gap:8px}.step .num{grid-row:span 2}.step strong{margin:0}.url-row{flex-direction:column}.copy{min-height:46px}}
</style>
</head>
<body><main class="shell">
<header class="top"><a class="brand" href="/"><span class="mark">M</span><span>MAGNETBR <span style="color:var(--cyan)">BRASIL</span></span></a><span class="status"><span class="dot" style="display:inline-block;margin-right:6px"></span> Serviço online</span></header>
<section class="hero"><div class="eyebrow"><span class="dot"></span> Busca brasileira de streams</div><h1>Seu conteúdo.<br><span>Em um só lugar.</span></h1><p class="intro">Encontre opções de filmes e séries usando os indexadores brasileiros do MagnetBR, direto no seu agregador favorito.</p></section>
<section class="panel"><div class="panel-head"><h2>Adicionar o MagnetBR</h2><span class="version">ADDON v1.0.0</span></div>
<div class="actions"><a class="btn primary" href="${stremioUrl}"><span aria-hidden="true">＋</span> Instalar no Stremio</a><button class="btn secondary" type="button" id="open-manifest">Visualizar manifest <span aria-hidden="true">↗</span></button></div>
<label class="url-label" for="addon-url">URL de instalação · Stremio / Nuvio</label><div class="url-row"><code class="url" id="addon-url">${safeUrl}</code><button class="copy" type="button" id="copy-url">Copiar URL</button></div>
<p class="hint">No Nuvio, copie a URL acima e adicione-a pela opção de instalação de addons por URL.</p><div id="notice" role="status" aria-live="polite"></div></section>
<section class="steps" aria-label="Como instalar"><article class="step"><span class="num">01</span><div><strong>Copie o endereço</strong><p>Use o botão para copiar a URL do manifesto.</p></div></article><article class="step"><span class="num">02</span><div><strong>Adicione ao app</strong><p>Cole o endereço na área de instalação de addons do Nuvio.</p></div></article><article class="step"><span class="num">03</span><div><strong>Pesquise e aproveite</strong><p>Busque filmes e séries para encontrar resultados disponíveis.</p></div></article></section>
<footer><span>MagnetBR Brasil · Addon comunitário</span><a href="/health">Status do serviço</a><a href="/manifest.json">Manifesto técnico</a></footer>
</main><script>
const url=document.getElementById("addon-url").textContent;const notice=document.getElementById("notice");
document.getElementById("copy-url").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(url);notice.textContent="URL copiada para a área de transferência."}catch{notice.textContent="Não foi possível copiar automaticamente. Selecione e copie a URL acima."}});
document.getElementById("open-manifest").addEventListener("click",()=>window.open("/manifest.json","_blank","noopener"));
</script></body></html>`);
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
