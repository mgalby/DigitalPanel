// DigitalPanel – ponte dati verso Yahoo Finance (Cloudflare Worker)
// In corso (non ancora consolidato, resta 4.4): /sport/italy legge ESPN un mese alla volta (gli intervalli
//   lunghi davano HTTP 400 e la Nazionale risultava senza partite) e restituisce group, il girone di Nations League.
// Versione 4.4 (13 nov 2026): la traduzione si ferma dopo 6 secondi per richiesta (il resto alla successiva),
//   così la prima lettura non va oltre l'attesa massima del pannello.
// Versione 4.3 (13 nov 2026): traduzione frase per frase (m2m100 tagliava i testi lunghi), prefissi come RUMOR: non tradotti,
//   sommari dei blog ripuliti da inviti a iscriversi e da "The post …".
// Versione 4.2 (13 nov 2026): traduzione in italiano con Workers AI. /news, /rss e /read accettano lang=it:
//   titoli, sommari e testo degli articoli tornano tradotti, gli originali restano in "orig".
//   Serve il binding Workers AI con nome AI (Settings › Bindings › Add › Workers AI). Senza binding
//   tutto funziona come prima, in inglese. Le traduzioni si conservano 30 giorni: ogni testo si traduce una volta.
//   Al massimo TR_MAX_NEW testi nuovi per richiesta: il resto arriva alla richiesta successiva (tr.pending).
// Versione 4.1 (13 nov 2026): /flickr accetta ttl (durata della copia salvata, 60–3600 s) e fresh=1
//   (pulsante «Aggiorna» del pannello: rilegge Flickr senza usare la copia salvata).
// Versione 4.0 (12 nov 2026): /sport/* per la pagina Sport (serve il segreto FD_TOKEN, vedi sotto);
// già presenti: /quotes, /earnings, /news, /spark, /tmdb/* (segreto TMDB_TOKEN), /flickr, /rss, /read.
//
// GET /quotes?symbols=AAPL,ENEL.MI,1211.HK,EURUSD=X,^GSPC
//   { updated, quotes: [ {symbol, name, price, prevClose, change, changePct,
//                         currency, exchange, marketTime,
//                         session:{start, end, gmtoffset, tz}} | {symbol, error} ] }
//   session = seduta regolare corrente o prossima secondo Yahoo (festività e ora legale incluse)
//
// GET /spark?symbols=^GSPC,FTSEMIB.MI         (max 12 simboli)
//   andamento dell'ultima seduta a 5 minuti, al massimo 80 punti
//   { updated, spark: [ {symbol, prevClose, points:[...], start, end} | {symbol, error} ] }
//
// GET /earnings?symbols=AAPL,ENEL.MI          (max 12 simboli, solo azioni)
//   { updated, earnings: [ {symbol, nextDate, nextDateEnd, dateEstimated,
//       callDate, currency, next:{epsAvg,epsLow,epsHigh,revAvg,revLow,revHigh},
//       history:[{quarter, label, epsActual, epsEstimate, surprisePct, revenue}],
//       trend:[{period, endDate, epsAvg, revAvg, growth}] } | {symbol, error} ] }
//
// GET /news?symbols=AAPL,ENEL.MI&names=Apple Inc.|Enel SpA&days=30   (max 10 simboli)
//   Solo notizie che nominano la società (nome o ticker). rel: 2 nel titolo, 1 nel sommario;
//   earnings: true se parla di conti/call.
//   { updated, news: [ {symbol, items:[{title, summary, link, source, time, rel, earnings}]}
//                      | {symbol, error} ] }
//
// GET /debug/crumb   diagnostica dell'accesso Yahoo usato da /earnings
//
// ---- Intrattenimento (TMDB, titoli in italiano, disponibilità in Italia) ----
// Il token di lettura TMDB (v4) va salvato nel Worker come segreto: Settings ›
// Variables and Secrets › Add › tipo Secret, nome TMDB_TOKEN. Mai nel codice.
// GET /tmdb/cinema                       film nelle sale italiane e in uscita
// GET /tmdb/streaming?p=netflix,prime&ex=kids,reality   novità sulle piattaforme (ordine = priorità),
//     senza i generi esclusi (ex), con almeno qualche voto e gradimento; serie partite da ≤ 5 anni
//     piattaforme: netflix, prime, sky, raiplay, apple, disney
// GET /tmdb/tv?ids=1399,94997            prossimo episodio delle serie (max 20)
// GET /tmdb/search?q=titolo              ricerca serie per le impostazioni
// GET /tmdb/searchperson?q=nome          ricerca registi/attori per le impostazioni
// GET /tmdb/people?ids=525,1892          uscite recenti e prossime di registi/attori (max 20):
//     ultimi 24 mesi e prossimi 24; regia, o attore nei ruoli principali; per i titoli già usciti, piattaforme in Italia
// GET /tmdb/title?type=movie&id=123      scheda completa: trama, cast, dove vederlo in Italia, recensioni utenti
// GET /tmdb/providers                    piattaforme TMDB riconosciute in Italia (diagnostica)
//
// ---- Fotografia (Flickr, senza chiave: feed pubblico) ----
// GET /flickr?user=marco_galb&tag=digitalportfolio&ttl=900&fresh=1
//     foto pubbliche dell'utente con quel tag (le ultime 20 caricate), a 1024 px; user = alias o NSID
//     ttl = secondi di validità della copia salvata (60–3600, predefinito 1800); fresh=1 = rilettura immediata
// GET /rss?src=fuji,leica,nikon         novità dai siti di fotografia (feed noti, uniti e ordinati per data)
// GET /read?url=https://...             testo di un articolo in "modalità lettura" (solo testo, niente pagina grezza)
//
// ---- Sport (calcio: Serie A, Champions League, Nazionale) ----
// Il token di football-data.org (piano Free) va salvato come segreto FD_TOKEN, come TMDB_TOKEN.
// GET /sport/live?lg=sa,cl,nat           partite di oggi (ora italiana) da ESPN: dirette con minuto,
//     marcatori ed espulsioni, finite e in programma; per "nat" solo le partite dell'Italia. Cache 25 s
// GET /sport/fixtures?c=sa|cl            calendario e risultati (ultimi 12 giorni, prossimi 35);
//     football-data, se non va ESPN. Cache 10 min
// GET /sport/table?c=sa|cl               classifica (football-data, se non va ESPN). Cache 30 min
// GET /sport/italy                       ultime e prossime partite dell'Italia (ESPN) e girone di Nations League
//     (group: {name, rows}). Cache 3 h, classifica 1 h
// GET /sport/debug?code=ita.1            diagnostica dei dati ESPN di una competizione
//   partita: {id, lg, comp, date, state: pre|in|post|off, ht, clock, detail,
//             home:{n, k, s}, away:{n, k, s}, ev:[{t: goal|pg|og|red|pmiss, m, side: h|a, who}], venue}
//   n = nome italiano breve, k = chiave per riconoscere la squadra, s = gol
//
// Note:
// - Valuta e nome delle quotazioni arrivano da Yahoo, non dal suffisso.
// - I titoli quotati in pence (GBp) vengono convertiti in GBP.
// - Cache sulla rete Cloudflare: quotazioni 60 s, trimestrali 12 h, notizie 15 min.
// - /earnings usa una parte di Yahoo che richiede cookie + "crumb": il Worker
//   li ottiene da solo e li conserva 6 ore.

const MAX_SYMBOLS = 50;
const MAX_EARN_SYMBOLS = 12;
const MAX_NEWS_SYMBOLS = 10;
const CACHE_SECONDS = 60;
const EARN_CACHE_SECONDS = 12 * 3600;
const NEWS_CACHE_SECONDS = 15 * 60;
const SPARK_CACHE_SECONDS = 5 * 60;
const MAX_SPARK_SYMBOLS = 12;
const CRUMB_CACHE_SECONDS = 6 * 3600;
const SYMBOL_RE = /^[A-Za-z0-9.\-=^]{1,20}$/;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

// ---------------------------------------------------------------- cache utility

// force = true: non usa la copia salvata, rilegge e la sostituisce
async function cachedText(key, seconds, ctx, producer, force) {
  const cache = caches.default;
  const cacheKey = new Request("https://cache.digitalpanel/" + encodeURIComponent(key));
  if (!force) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.text();
  }
  const text = await producer(); // lancia un errore se non va: niente cache
  const res = new Response(text, {
    headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=" + seconds },
  });
  ctx.waitUntil(cache.put(cacheKey, res));
  return text;
}

// ---------------------------------------------------------------- /quotes (invariato)

async function fetchQuote(symbol, ctx) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    "?range=5d&interval=1d";

  const cache = caches.default;
  const cacheKey = new Request(url, { method: "GET" });
  let res = await cache.match(cacheKey);

  if (!res) {
    const upstream = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!upstream.ok) {
      return { symbol, error: "HTTP " + upstream.status };
    }
    const text = await upstream.text();
    res = new Response(text, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + CACHE_SECONDS },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { symbol, error: "risposta non valida" };
  }

  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result || !result.meta) {
    const msg = data && data.chart && data.chart.error && data.chart.error.description;
    return { symbol, error: msg || "simbolo non trovato" };
  }

  const meta = result.meta;
  let price = meta.regularMarketPrice;

  // Chiusura precedente: penultima chiusura giornaliera valida.
  const closesRaw =
    (result.indicators && result.indicators.quote && result.indicators.quote[0] &&
      result.indicators.quote[0].close) || [];
  const closes = closesRaw.filter((v) => typeof v === "number");
  let prevClose = closes.length >= 2 ? closes[closes.length - 2] : meta.chartPreviousClose;

  let currency = meta.currency || null;
  if (currency === "GBp" || currency === "GBX") {
    price = price != null ? price / 100 : price;
    prevClose = prevClose != null ? prevClose / 100 : prevClose;
    currency = "GBP";
  }

  const change = price != null && prevClose != null ? price - prevClose : null;
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;

  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    price,
    prevClose,
    change,
    changePct,
    currency,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    session: sessionOf(meta),
  };
}

function sessionOf(meta) {
  const r = meta.currentTradingPeriod && meta.currentTradingPeriod.regular;
  if (!r || !r.start || !r.end) return null;
  return {
    start: new Date(r.start * 1000).toISOString(),
    end: new Date(r.end * 1000).toISOString(),
    gmtoffset: typeof r.gmtoffset === "number" ? r.gmtoffset : meta.gmtoffset != null ? meta.gmtoffset : null,
    tz: r.timezone || meta.exchangeTimezoneName || null,
  };
}

// ---------------------------------------------------------------- /spark

async function fetchSpark(symbol, ctx) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=1d&interval=5m";
  const text = await cachedText("spark:" + symbol, SPARK_CACHE_SECONDS, ctx, async () => {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
  const data = JSON.parse(text);
  const res = data && data.chart && data.chart.result && data.chart.result[0];
  if (!res || !res.meta) return { symbol, error: "nessun dato" };
  const closes = ((res.indicators && res.indicators.quote && res.indicators.quote[0] &&
    res.indicators.quote[0].close) || []).filter((v) => typeof v === "number");
  // al massimo 80 punti, tenendo sempre l'ultimo
  const step = Math.max(1, Math.ceil(closes.length / 80));
  const points = closes.filter((_, i) => i % step === 0);
  if (closes.length && points[points.length - 1] !== closes[closes.length - 1]) points.push(closes[closes.length - 1]);
  const ts = res.timestamp || [];
  return {
    symbol,
    prevClose: res.meta.chartPreviousClose != null ? res.meta.chartPreviousClose : res.meta.previousClose || null,
    points: points.map((v) => Math.round(v * 10000) / 10000),
    start: ts.length ? new Date(ts[0] * 1000).toISOString() : null,
    end: ts.length ? new Date(ts[ts.length - 1] * 1000).toISOString() : null,
  };
}

// ---------------------------------------------------------------- accesso Yahoo (cookie + crumb)

let AUTH = null; // { cookie, crumb, at } in memoria finché l'istanza resta viva

function extractCookies(res) {
  let list = [];
  if (typeof res.headers.getSetCookie === "function") list = res.headers.getSetCookie();
  else if (typeof res.headers.getAll === "function") {
    try { list = res.headers.getAll("Set-Cookie"); } catch (e) { list = []; }
  }
  if (!list.length) {
    const joined = res.headers.get("set-cookie");
    if (joined) list = joined.split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  }
  return list
    .map((c) => c.split(";")[0].trim())
    .filter((c) => /^[A-Za-z0-9_\-]+=/.test(c));
}

async function newAuth(diag) {
  // 1) cookie dal dominio di servizio di Yahoo (risponde 404 ma imposta il cookie)
  const r1 = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
  const cookies = extractCookies(r1);
  if (diag) { diag.cookieStatus = r1.status; diag.cookieNames = cookies.map((c) => c.split("=")[0]); }
  if (!cookies.length) throw new Error("Yahoo non ha fornito il cookie");
  const cookie = cookies.join("; ");

  // 2) crumb legato al cookie
  const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" },
  });
  const crumb = (await r2.text()).trim();
  if (diag) { diag.crumbStatus = r2.status; diag.crumbOk = r2.ok && crumb.length > 0 && crumb.length < 40; }
  if (!r2.ok || !crumb || crumb.length >= 40 || /[<{]/.test(crumb)) {
    throw new Error("crumb non ottenuto (HTTP " + r2.status + ")");
  }
  return { cookie, crumb, at: Date.now() };
}

async function getAuth(ctx, force) {
  if (!force && AUTH && Date.now() - AUTH.at < CRUMB_CACHE_SECONDS * 1000) return AUTH;
  const cache = caches.default;
  const key = new Request("https://cache.digitalpanel/yahoo-auth");
  if (!force) {
    const hit = await cache.match(key);
    if (hit) {
      try { AUTH = await hit.json(); return AUTH; } catch (e) { /* rifà */ }
    }
  }
  AUTH = await newAuth(null);
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(AUTH), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + CRUMB_CACHE_SECONDS },
  })));
  return AUTH;
}

// ---------------------------------------------------------------- /earnings

const raw = (o) => (o && typeof o === "object" ? (typeof o.raw === "number" ? o.raw : null) : typeof o === "number" ? o : null);
const isoDay = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : null);
const isoTime = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);

async function quoteSummary(symbol, ctx) {
  const modules = "calendarEvents,earnings,earningsHistory,earningsTrend,price";
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await getAuth(ctx, attempt === 1);
    const url =
      "https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(symbol) +
      "?modules=" + modules + "&crumb=" + encodeURIComponent(auth.crumb);
    const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: auth.cookie, Accept: "application/json" } });
    if ((r.status === 401 || r.status === 403) && attempt === 0) continue; // crumb scaduto: rinnova
    const text = await r.text();
    if (r.status === 404) throw new Error("simbolo non trovato");
    if (!r.ok) throw new Error("HTTP " + r.status);
    return text;
  }
  throw new Error("accesso Yahoo rifiutato");
}

function parseEarnings(symbol, text) {
  const data = JSON.parse(text);
  const res = data && data.quoteSummary && data.quoteSummary.result && data.quoteSummary.result[0];
  if (!res) {
    const msg = data && data.quoteSummary && data.quoteSummary.error && data.quoteSummary.error.description;
    return { symbol, error: msg || "nessun dato trimestrale" };
  }
  const cal = (res.calendarEvents && res.calendarEvents.earnings) || {};
  const ern = res.earnings || {};
  const price = res.price || {};

  const dates = (cal.earningsDate || []).map(raw).filter(Boolean).sort((a, b) => a - b);
  const callDates = (cal.earningsCallDate || []).map(raw).filter(Boolean).sort((a, b) => a - b);

  // Ricavi effettivi per trimestre (es. "3Q2025") dal grafico finanziario
  const revByLabel = {};
  ((ern.financialsChart && ern.financialsChart.quarterly) || []).forEach((q) => {
    if (q && q.date) revByLabel[String(q.date)] = raw(q.revenue);
  });

  const hist = ((res.earningsHistory && res.earningsHistory.history) || [])
    .map((h) => {
      const qSec = raw(h.quarter);
      // Etichetta ricavata dalla data di fine trimestre (es. 2026-09-30 → "3Q2026")
      const d = qSec ? new Date(qSec * 1000) : null;
      const label = d ? Math.floor(d.getUTCMonth() / 3) + 1 + "Q" + d.getUTCFullYear() : null;
      // Sorpresa in %: calcolata da effettivo e stima; altrimenti quella di Yahoo (che è una frazione)
      const a = raw(h.epsActual), s = raw(h.epsEstimate);
      let sp = a != null && s ? ((a - s) / Math.abs(s)) * 100 : raw(h.surprisePercent);
      if (sp != null && !(a != null && s)) sp = sp * 100;
      if (sp != null) sp = Math.round(sp * 10) / 10;
      return {
        quarter: isoDay(qSec),
        label,
        epsActual: raw(h.epsActual),
        epsEstimate: raw(h.epsEstimate),
        surprisePct: sp,
        revenue: label && label in revByLabel ? revByLabel[label] : null,
      };
    })
    .filter((h) => h.quarter || h.epsActual != null)
    .sort((a, b) => (a.quarter || "").localeCompare(b.quarter || ""));

  const trend = ((res.earningsTrend && res.earningsTrend.trend) || [])
    // "0q" escluso: Yahoo a volte ha una data di fine sbagliata; per il prossimo
    // trimestre fanno fede le stime del calendario (campo next)
    .filter((t) => ["+1q", "0y", "+1y"].includes(t.period))
    .map((t) => ({
      period: t.period,
      endDate: t.endDate || null,
      epsAvg: raw(t.earningsEstimate && t.earningsEstimate.avg),
      revAvg: raw(t.revenueEstimate && t.revenueEstimate.avg),
      growth: raw(t.growth),
    }));

  // Data della call solo se vicina (± 3 giorni) alla prossima data dei conti
  let call = callDates.find((c) => dates[0] && Math.abs(c - dates[0]) <= 3 * 86400) || null;

  return {
    symbol,
    name: price.longName || price.shortName || symbol,
    nextDate: isoTime(dates[0]),
    nextDateEnd: dates.length > 1 ? isoTime(dates[dates.length - 1]) : null,
    dateEstimated: cal.isEarningsDateEstimate === true || dates.length > 1,
    callDate: isoTime(call),
    currency: ern.financialCurrency || price.currency || null,
    next: {
      epsAvg: raw(cal.earningsAverage),
      epsLow: raw(cal.earningsLow),
      epsHigh: raw(cal.earningsHigh),
      revAvg: raw(cal.revenueAverage),
      revLow: raw(cal.revenueLow),
      revHigh: raw(cal.revenueHigh),
    },
    history: hist,
    trend,
  };
}

async function fetchEarnings(symbol, ctx) {
  const text = await cachedText("earn:" + symbol, EARN_CACHE_SECONDS, ctx, () => quoteSummary(symbol, ctx));
  return parseEarnings(symbol, text);
}

// ---------------------------------------------------------------- /news

function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
function cleanText(s, max) {
  let t = decodeEntities(decodeEntities(s)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return t;
}
function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1] : "";
}

function parseRss(xml) {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[0];
    const title = cleanText(tag(b, "title"), 200);
    if (!title) continue;
    const t = Date.parse(decodeEntities(tag(b, "pubDate")).trim());
    items.push({
      title,
      summary: cleanText(tag(b, "description"), 400),
      link: decodeEntities(tag(b, "link")).trim() || null,
      source: cleanText(tag(b, "source"), 60) || null,
      time: isNaN(t) ? null : new Date(t).toISOString(),
    });
  }
  return items;
}

function parseSearchNews(text) {
  const data = JSON.parse(text);
  return ((data && data.news) || []).map((n) => ({
    title: cleanText(n.title, 200),
    summary: "",
    link: n.link || null,
    source: n.publisher || null,
    time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
  })).filter((n) => n.title);
}

async function fetchNewsRaw(symbol) {
  // 1) feed RSS per titolo (ha anche un breve sommario)
  try {
    const r = await fetch(
      "https://feeds.finance.yahoo.com/rss/2.0/headline?s=" + encodeURIComponent(symbol) + "&region=US&lang=en-US",
      { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" } }
    );
    if (r.ok) {
      const items = parseRss(await r.text());
      if (items.length) return JSON.stringify({ via: "rss", items });
    }
  } catch (e) { /* passa alla ricerca */ }
  // 2) riserva: ricerca Yahoo (solo titoli, fonte e ora)
  const r2 = await fetch(
    "https://query2.finance.yahoo.com/v1/finance/search?q=" + encodeURIComponent(symbol) +
      "&quotesCount=0&newsCount=10&enableFuzzyQuery=false",
    { headers: { "User-Agent": UA, Accept: "application/json" } }
  );
  if (!r2.ok) throw new Error("HTTP " + r2.status);
  return JSON.stringify({ via: "search", items: parseSearchNews(await r2.text()) });
}

// Parole chiave per riconoscere le notizie che parlano davvero della società
const LEGAL = /\b(incorporated|inc|corp|corporation|company|co|ltd|limited|plc|spa|s\.p\.a|sa|s\.a|se|nv|n\.v|ag|ab|asa|oyj|holdings?|group|gruppo|class [a-c]|adr)\b\.?/gi;
const GENERIC = new Set(["bank", "banca", "banco", "international", "general", "first", "american", "united",
  "national", "global", "the", "new", "royal", "china", "japan", "industries", "technologies", "energy"]);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function keywords(symbol, name) {
  const words = [];
  const base = symbol.split(/[.=]/)[0].replace(/^\^/, "");
  if (base.length >= 3 && /[A-Z]/.test(base) && !/^\d+$/.test(base)) words.push({ re: new RegExp("\\b" + escRe(base) + "\\b") }); // ticker, maiuscolo
  if (name) {
    const clean = name.replace(LEGAL, " ").replace(/[,()&]/g, " ").replace(/\s+/g, " ").trim();
    if (clean.length >= 3) words.push({ re: new RegExp("\\b" + escRe(clean) + "\\b", "i") });
    const first = clean.split(" ")[0];
    if (first && first.length >= 4 && first !== clean && !GENERIC.has(first.toLowerCase()))
      words.push({ re: new RegExp("\\b" + escRe(first) + "\\b", "i") });
  }
  return words;
}

const EARN_RE = /\b(earnings?|results?|quarter(ly)?|q[1-4]\b|guidance|outlook|conference call|earnings call|transcript|revenue|profit|ebitda|trimestr\w*|risultati|conti|utile|ricavi)\b/i;

async function fetchNews(symbol, days, ctx, name) {
  const text = await cachedText("news:" + symbol, NEWS_CACHE_SECONDS, ctx, () => fetchNewsRaw(symbol));
  const data = JSON.parse(text);
  const limit = Date.now() - days * 86400000;
  const kw = keywords(symbol, name);
  const hits = (s) => kw.some((k) => k.re.test(s || ""));
  const items = (data.items || [])
    .filter((n) => !n.time || Date.parse(n.time) >= limit)
    .map((n) => {
      // rel 2 = nome nel titolo, 1 = solo nel sommario, 0 = non pertinente
      const rel = hits(n.title) ? 2 : hits(n.summary) ? 1 : 0;
      return { ...n, rel, earnings: rel === 2 && EARN_RE.test(n.title + " " + n.summary) };
    })
    .filter((n) => n.rel > 0 || !kw.length)
    .sort((a, b) => b.rel - a.rel || (b.time || "").localeCompare(a.time || ""))
    .slice(0, 15);
  return { symbol, via: data.via, items };
}

// ---------------------------------------------------------------- traduzione in italiano (Workers AI)
// Modello di traduzione dedicato (m2m100, Meta): rapido ed economico. Le traduzioni di ogni gruppo
// (le notizie di un titolo, i feed di fotografia, un articolo) stanno in un'unica voce della cache:
// una lettura e una scrittura per gruppo, qualunque sia il numero di testi.

const TR_MODEL = "@cf/meta/m2m100-1.2b";
const TR_CACHE_SECONDS = 30 * 86400;
const TR_MAX_NEW = 30;       // pezzi nuovi tradotti al massimo per richiesta (/news e /rss)
const TR_MAX_NEW_READ = 40;  // per un articolo in vista lettura
const TR_PARALLEL = 8;       // chiamate al modello in contemporanea
const TR_TIME_MS = 6000;     // tempo massimo di traduzione per richiesta: il resto alla richiesta successiva
const TR_CHUNK = 260;        // m2m100 tronca i testi lunghi: si traduce a pezzi di una o due frasi

function wantsIt(url) { return (url.searchParams.get("lang") || "").toLowerCase() === "it"; }

// testo già in italiano o senza parole da tradurre: si lascia com'è
function skipTr(t) {
  if (!t || t.length < 3 || !/[a-z]{2}/i.test(t)) return true;
  return /\b(il|lo|gli|della|degli|nel|sono|anche|perché|però|questo|quella)\b/i.test(t) && !/\b(the|and|of|with|for)\b/i.test(t);
}

// spezza un testo in pezzi di frasi intere; un prefisso in maiuscolo (RUMOR:, UPDATE:) resta a parte, non tradotto
const KEEP_PREFIX = /^((?:[A-Z][A-Z0-9]{2,}[ !]*)+:)\s*/;
function splitText(t) {
  const pre = t.match(KEEP_PREFIX);
  if (pre) return [{ keep: pre[1] }].concat(splitText(t.slice(pre[0].length)));
  if (t.length <= TR_CHUNK) return [t];
  const out = [];
  let cur = "";
  (t.match(/[^.!?]+[.!?]+["»”')\]]*\s*|[^.!?]+$/g) || [t]).forEach((s) => {
    if (cur && (cur + s).length > TR_CHUNK) { out.push(cur.trim()); cur = ""; }
    cur += s;
  });
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// traduce un elenco di testi; budget = { left } condiviso tra i gruppi di una stessa richiesta.
// Restituisce { out (stesso ordine, originale dove la traduzione manca), pending, error }
async function translateList(env, ctx, bucket, texts, budget) {
  const out = texts.slice();
  if (!env || !env.AI) return { out, pending: 0, error: "binding AI mancante nel Worker" };
  const cache = caches.default;
  const key = new Request("https://cache.digitalpanel/tr-it2/" + encodeURIComponent(bucket));
  let map = {};
  const hit = await cache.match(key);
  if (hit) { try { map = await hit.json(); } catch (e) { map = {}; } }

  const todo = [...new Set(texts.filter((t) => !skipTr(t) && !map[t]))];
  const now = todo.slice(0, Math.max(0, budget.left));
  budget.left -= now.length;
  if (!budget.until) budget.until = Date.now() + TR_TIME_MS; // vale per tutti i gruppi della richiesta

  let changed = false, error = null;
  for (let k = 0; k < now.length && !error && Date.now() < budget.until; k += TR_PARALLEL) {
    await Promise.all(now.slice(k, k + TR_PARALLEL).map(async (t) => {
      try {
        const r = await env.AI.run(TR_MODEL, { text: t, source_lang: "en", target_lang: "it" });
        const tr = r && typeof r.translated_text === "string" ? r.translated_text.trim() : "";
        if (tr && !/^ERROR/i.test(tr)) { map[t] = tr; changed = true; }
      } catch (e) { error = String((e && e.message) || e); }
    }));
  }

  texts.forEach((t, i) => { if (map[t]) out[i] = map[t]; });
  if (changed) {
    // si conservano solo le traduzioni dei testi attuali: la voce non cresce all'infinito
    const keep = {};
    texts.forEach((t) => { if (map[t]) keep[t] = map[t]; });
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(keep), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + TR_CACHE_SECONDS },
    })));
  }
  return { out, pending: todo.filter((t) => !map[t]).length, error };
}

// traduce più testi spezzandoli in frasi e li ricompone: { out, pending, error }
async function translateTexts(env, ctx, bucket, texts, budget) {
  const pieces = [], owner = [], keep = [];
  texts.forEach((t, i) => (t ? splitText(t) : []).forEach((s) => {
    if (typeof s === "object") { keep.push([pieces.length, s.keep]); pieces.push(""); }
    else pieces.push(s);
    owner.push(i);
  }));
  const r = await translateList(env, ctx, bucket, pieces, budget);
  keep.forEach(([k, v]) => { r.out[k] = v; });
  const out = texts.map(() => "");
  owner.forEach((o, k) => { if (r.out[k]) out[o] += (out[o] ? " " : "") + r.out[k]; });
  return { out: out.map((t, i) => t || texts[i]), pending: r.pending, error: r.error };
}

// titolo e sommario di un elenco di notizie
async function translateItems(env, ctx, bucket, items, budget) {
  const texts = [];
  items.forEach((n) => { texts.push(n.title || ""); texts.push(n.summary || ""); });
  const r = await translateTexts(env, ctx, bucket, texts, budget);
  return {
    items: items.map((n, i) => {
      const title = r.out[2 * i] || n.title, summary = r.out[2 * i + 1] || n.summary;
      if (title === n.title && summary === n.summary) return n;
      return Object.assign({}, n, { title, summary, orig: { title: n.title, summary: n.summary } });
    }),
    pending: r.pending,
    error: r.error,
  };
}

// articolo in vista lettura: titolo e paragrafi (quelli lunghi a pezzi, poi ricomposti)
async function translateArticle(env, ctx, art) {
  const texts = [art.title || ""].concat((art.paras || []).map((p) => p.t));
  const r = await translateTexts(env, ctx, "read:" + art.url, texts, { left: TR_MAX_NEW_READ });
  const paras = (art.paras || []).map((p, i) => ({ h: p.h, t: r.out[i + 1] }));
  return Object.assign({}, art, { title: r.out[0] || art.title, paras, orig: { title: art.title },
    tr: { lang: "it", pending: r.pending, error: r.error } });
}

// ---------------------------------------------------------------- router

function readSymbols(url, max) {
  const rawList = (url.searchParams.get("symbols") || "").trim();
  if (!rawList) return { error: json({ error: "parametro symbols mancante" }, 400) };
  const symbols = [...new Set(rawList.split(",").map((s) => s.trim()).filter(Boolean))];
  if (symbols.length > max) return { error: json({ error: "massimo " + max + " simboli per richiesta" }, 400) };
  const invalid = symbols.filter((s) => !SYMBOL_RE.test(s));
  if (invalid.length) return { error: json({ error: "simboli non validi: " + invalid.join(", ") }, 400) };
  return { symbols };
}

// ---------------------------------------------------------------- TMDB

const TMDB_CACHE = 6 * 3600;
// nomi delle piattaforme come li scrive TMDB per l'Italia (riconosciute per nome, non per numero)
const PROVIDERS = {
  netflix: { label: "Netflix", re: /^netflix$/i },
  prime: { label: "Prime Video", re: /^amazon prime video$/i },
  sky: { label: "Sky / NOW", re: /^(sky go|now|now tv|sky)$/i },
  raiplay: { label: "RaiPlay", re: /^rai ?play$/i },
  apple: { label: "Apple TV+", re: /^apple tv(\+| plus)?$/i },
  disney: { label: "Disney+", re: /^disney(\+| plus)$/i },
};

// generi escludibili: chiave → [id film, id serie] secondo TMDB
const GENRES = {
  kids: [[10751], [10762, 10751]], anim: [[16], [16]], reality: [[], [10764]], talk: [[], [10767]],
  soap: [[], [10766]], news: [[], [10763]], doc: [[99], [99]], horror: [[27], []], romance: [[10749], []],
  music: [[10402], []], war: [[10752], [10768]], western: [[37], [37]], scifi: [[878, 14], [10765]],
  comedy: [[35], [35]], crime: [[80], [80]], thriller: [[53, 9648], [9648]],
};
function genreIds(keys, i) { const o = []; keys.forEach((k) => (GENRES[k] ? GENRES[k][i] : []).forEach((g) => o.indexOf(g) < 0 && o.push(g))); return o; }

async function tmdb(env, path, params) {
  if (!env || !env.TMDB_TOKEN) throw new Error("token TMDB mancante: aggiungi il segreto TMDB_TOKEN al Worker");
  const u = new URL("https://api.themoviedb.org/3" + path);
  Object.entries(Object.assign({ language: "it-IT" }, params || {})).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u.toString(), { headers: { Authorization: "Bearer " + env.TMDB_TOKEN, Accept: "application/json" } });
  if (r.status === 401) throw new Error("token TMDB non valido");
  if (!r.ok) throw new Error("TMDB HTTP " + r.status);
  return r.json();
}
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86400000);
const slimMovie = (m) => ({
  id: m.id, type: "movie", title: m.title, original: m.original_title !== m.title ? m.original_title : null,
  poster: m.poster_path || null, date: m.release_date || null, vote: m.vote_average || null,
  votes: m.vote_count || 0, overview: (m.overview || "").slice(0, 500), pop: m.popularity || 0,
});
const slimTv = (t) => ({
  id: t.id, type: "tv", title: t.name, original: t.original_name !== t.name ? t.original_name : null,
  poster: t.poster_path || null, date: t.first_air_date || null, vote: t.vote_average || null,
  votes: t.vote_count || 0, overview: (t.overview || "").slice(0, 500), pop: t.popularity || 0,
});

async function tmdbCinema(env) {
  const [now, up] = await Promise.all([
    tmdb(env, "/movie/now_playing", { region: "IT", page: 1 }),
    tmdb(env, "/movie/upcoming", { region: "IT", page: 1 }),
  ]);
  const today = day(new Date());
  const seen = {};
  const keep = (m) => { if (seen[m.id]) return false; seen[m.id] = 1; return true; };
  const inSala = (now.results || []).filter((m) => m.release_date && m.release_date <= today).filter(keep)
    .sort((a, b) => b.popularity - a.popularity).slice(0, 15).map(slimMovie);
  const prossimi = (up.results || []).filter((m) => m.release_date && m.release_date > today && m.release_date <= day(addDays(45)))
    .filter(keep).sort((a, b) => a.release_date.localeCompare(b.release_date) || b.popularity - a.popularity).slice(0, 15).map(slimMovie);
  return { now: inSala, upcoming: prossimi };
}

async function providerIds(env, ctx) {
  const text = await cachedText("tmdb:providers:IT", 7 * 86400, ctx, async () => {
    const [m, t] = await Promise.all([
      tmdb(env, "/watch/providers/movie", { watch_region: "IT" }),
      tmdb(env, "/watch/providers/tv", { watch_region: "IT" }),
    ]);
    const all = {};
    (m.results || []).concat(t.results || []).forEach((p) => { all[p.provider_id] = p.provider_name; });
    return JSON.stringify(all);
  });
  const all = JSON.parse(text);
  const out = {};
  Object.keys(PROVIDERS).forEach((k) => {
    out[k] = Object.keys(all).filter((id) => PROVIDERS[k].re.test(all[id])).map(Number);
  });
  return { ids: out, names: all };
}

async function tmdbStreaming(env, ctx, keys, ex) {
  const exM = genreIds(ex, 0), exT = genreIds(ex, 1);
  const okG = (gs, bad) => !(gs || []).some((g) => bad.indexOf(g) >= 0);
  const { ids } = await providerIds(env, ctx);
  const from = day(addDays(-45)), to = day(new Date());
  const jobs = [];
  keys.forEach((k, rank) => {
    const list = ids[k] || [];
    if (!list.length) return;
    const base = { watch_region: "IT", with_watch_providers: list.join("|"), with_watch_monetization_types: "flatrate",
      sort_by: "popularity.desc", page: 1, include_adult: "false" };
    jobs.push(tmdb(env, "/discover/movie", Object.assign({}, base, { "primary_release_date.gte": from, "primary_release_date.lte": to,
        "vote_count.gte": 8, "vote_average.gte": 5.8 }, exM.length ? { without_genres: exM.join(",") } : {}))
      .then((d) => (d.results || []).filter((m) => okG(m.genre_ids, exM)).slice(0, 10).map((m) => Object.assign(slimMovie(m), { prov: k, rank }))).catch(() => []));
    // serie con episodi usciti nel periodo: comprende le nuove stagioni di serie già esistenti
    jobs.push(tmdb(env, "/discover/tv", Object.assign({}, base, { "air_date.gte": from, "air_date.lte": to, "first_air_date.gte": day(addDays(-5 * 365)),
        "vote_count.gte": 8, "vote_average.gte": 6 }, exT.length ? { without_genres: exT.join(",") } : {}))
      .then((d) => (d.results || []).filter((t) => okG(t.genre_ids, exT)).slice(0, 10).map((t) => Object.assign(slimTv(t), { prov: k, rank }))).catch(() => []));
  });
  const lists = await Promise.all(jobs);
  const byKey = {};
  lists.flat().forEach((x) => {
    const key = x.type + x.id;
    if (!byKey[key]) byKey[key] = Object.assign({}, x, { provs: [x.prov] });
    else { if (byKey[key].provs.indexOf(x.prov) < 0) byKey[key].provs.push(x.prov); byKey[key].rank = Math.min(byKey[key].rank, x.rank); }
  });
  const items = Object.values(byKey).map((x) => { delete x.prov; x.provs.sort((a, b) => keys.indexOf(a) - keys.indexOf(b)); return x; });
  return { providers: keys.map((k) => ({ key: k, label: (PROVIDERS[k] || {}).label || k, found: (ids[k] || []).length > 0 })), items };
}

async function tmdbTv(env, ctx, id) {
  const text = await cachedText("tmdb:tv:" + id, TMDB_CACHE, ctx, async () => JSON.stringify(await tmdb(env, "/tv/" + id)));
  const t = JSON.parse(text);
  const ep = (e) => (e ? { date: e.air_date || null, s: e.season_number, e: e.episode_number, name: e.name || null } : null);
  // dati della stagione dell'ultimo e del prossimo episodio: servono a capire le uscite "tutte insieme"
  const season = (n) => { const x = (t.seasons || []).find((z) => z.season_number === n); return x ? { s: n, air: x.air_date || null, count: x.episode_count || null } : null; };
  const last = t.last_episode_to_air, next = t.next_episode_to_air;
  const ls = last ? season(last.season_number) : null;
  return {
    lastSeason: ls,
    nextSeason: next ? season(next.season_number) : null,
    // stagione uscita completa in un giorno solo (stile Netflix)
    binge: !!(ls && last && ls.count && last.episode_number === ls.count && ls.air && ls.air === last.air_date && ls.count > 1),
    id: t.id, title: t.name, poster: t.poster_path || null, status: t.status || null,
    inProduction: !!t.in_production, next: ep(t.next_episode_to_air), last: ep(t.last_episode_to_air),
    seasons: t.number_of_seasons || null, networks: (t.networks || []).map((n) => n.name).slice(0, 3),
    overview: (t.overview || "").slice(0, 500), vote: t.vote_average || null,
  };
}

// uscite di registi/attori preferiti: un'unica chiamata per persona (crediti combinati)
async function personWorks(env, ctx, id) {
  const text = await cachedText("tmdb:person3:" + id, 12 * 3600, ctx, async () => {
    const [p, c] = await Promise.all([tmdb(env, "/person/" + id), tmdb(env, "/person/" + id + "/combined_credits")]);
    const from = day(addDays(-730)), to = day(addDays(730)), out = {}; // ultimi 24 mesi e prossimi 24
    const add = (x, role) => {
      const date = x.release_date || x.first_air_date || "";
      if (!date || date < from || date > to) return;
      const key = x.media_type + x.id;
      if (out[key]) { if (out[key].roles.indexOf(role) < 0) out[key].roles.push(role); return; }
      const base = x.media_type === "tv" ? slimTv(x) : slimMovie(x);
      out[key] = Object.assign(base, { roles: [role] });
    };
    (c.crew || []).forEach((x) => { if (x.job === "Director" || (x.media_type === "tv" && x.job === "Creator")) add(x, "regia"); });
    (c.cast || []).forEach((x) => {
      // ruoli principali: nei film i primi 6 del cast; nelle serie solo se non è un'ospitata
      if (x.media_type === "movie" && x.order != null && x.order > 5) return;
      if (x.media_type === "tv" && (x.episode_count || 0) < 3) return;
      // niente apparizioni come sé stessi (interviste, documentari, filmati d'archivio)
      if ((x.genre_ids || []).indexOf(99) >= 0 || (x.genre_ids || []).indexOf(10767) >= 0) return;
      if (/\b(self|himself|herself|themselves|narrator|interviewee|archive|s[eé] stess[oaie]|voce narrante|intervistat[oa]|filmati d'archivio)\b/i.test(x.character || "")) return;
      add(x, "attore");
    });
    return JSON.stringify({ id: p.id, name: p.name, dept: p.known_for_department || null, works: Object.values(out) });
  });
  return JSON.parse(text);
}

async function moviePlatforms(env, ctx, id, type) {
  const text = await cachedText("tmdb:wp:" + type + id, 24 * 3600, ctx, async () => {
    const d = await tmdb(env, "/" + type + "/" + id + "/watch/providers", { language: "" });
    const it = (d.results && d.results.IT) || {};
    return JSON.stringify((it.flatrate || []).map((p) => p.provider_name));
  });
  const names = JSON.parse(text), keys = [];
  names.forEach((n) => Object.keys(PROVIDERS).forEach((k) => { if (PROVIDERS[k].re.test(n) && keys.indexOf(k) < 0) keys.push(k); }));
  return keys;
}

async function tmdbPeople(env, ctx, ids) {
  const people = await Promise.all(ids.map((id) => personWorks(env, ctx, id).catch((e) => ({ id: +id, error: String((e && e.message) || e) }))));
  const byKey = {};
  people.forEach((p) => (p.works || []).forEach((w) => {
    const key = w.type + w.id;
    if (!byKey[key]) byKey[key] = Object.assign({}, w, { who: [] });
    byKey[key].who.push({ id: p.id, name: p.name, roles: w.roles });
  }));
  const today = day(new Date());
  // in arrivo dal più vicino; già usciti dal più recente
  const all = Object.values(byKey).map((w) => { delete w.roles; return w; });
  const upcoming = all.filter((w) => w.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
  const past = all.filter((w) => w.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
  const items = upcoming.concat(past);
  // piattaforme in Italia solo per i titoli già usciti più recenti (al massimo 15 chiamate)
  const released = past.slice(0, 15);
  await Promise.all(released.map((w) => moviePlatforms(env, ctx, w.id, w.type).then((k) => { w.provs = k; }).catch(() => {})));
  return { people: people.map((p) => ({ id: p.id, name: p.name, error: p.error })), items };
}

// ---------------------------------------------------------------- Flickr

async function flickrNsid(user, ctx) {
  if (/^\d+@N\d+$/.test(user)) return user;
  const text = await cachedText("flickr:nsid:" + user.toLowerCase(), 30 * 86400, ctx, async () => {
    const r = await fetch("https://www.flickr.com/photos/" + encodeURIComponent(user) + "/", { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!r.ok) throw new Error("profilo Flickr non trovato (HTTP " + r.status + ")");
    const html = await r.text();
    const m = html.match(/photostreams\/(\d+@N\d+)/) || html.match(/"nsid":"(\d+@N\d+)"/) || html.match(/(\d{5,}@N\d{2})/);
    if (!m) throw new Error("identificativo Flickr non trovato");
    return m[1];
  });
  return text;
}

function flickrDesc(html) {
  // il feed antepone "X ha pubblicato una foto" e la miniatura: restano solo i paragrafi successivi
  const ps = String(html || "").split(/<\/p>/i).map((p) => p.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const rest = ps.filter((p, i) => !(i === 0 && /posted a photo|ha (pubblicato|postato)/i.test(p)));
  return decodeEntities(rest.join("\n")).slice(0, 600);
}

async function flickrPhotos(user, tag, ctx, ttl, fresh) {
  const nsid = await flickrNsid(user, ctx);
  const url = "https://www.flickr.com/services/feeds/photos_public.gne?id=" + encodeURIComponent(nsid) +
    (tag ? "&tags=" + encodeURIComponent(tag) : "") + "&format=json&nojsoncallback=1&lang=it-it" +
    (fresh ? "&_=" + Date.now() : "");
  // una copia per ogni durata: cambiando la frequenza nel pannello non resta in uso quella vecchia
  const text = await cachedText("flickr:feed:" + nsid + ":" + tag + ":" + ttl, ttl, ctx, async () => {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) throw new Error("Flickr HTTP " + r.status);
    return r.text();
  }, fresh);
  // il feed JSON di Flickr a volte contiene \' (non valido in JSON)
  const data = JSON.parse(text.replace(/\\'/g, "'"));
  const items = (data.items || []).map((it) => {
    const m = (it.media && it.media.m) || "";
    return {
      title: it.title && it.title.trim() ? it.title.trim() : null,
      img: m.replace(/_m\.(jpg|png)$/, "_b.$1"),
      thumb: m.replace(/_m\.(jpg|png)$/, "_q.$1"),
      link: it.link || null,
      taken: it.date_taken || null,
      published: it.published || null,
      desc: flickrDesc(it.description),
      tags: (it.tags || "").split(" ").filter(Boolean),
    };
  }).filter((x) => x.img);
  return { nsid, user, tag, ttl, fresh: !!fresh, items };
}

// ---------------------------------------------------------------- feed RSS dei siti di fotografia
// solo fonti note (niente indirizzi arbitrari: il Worker non fa da proxy aperto)
const FEEDS = {
  fuji: { label: "Fuji Rumors", url: "https://www.fujirumors.com/feed/" },
  leica: { label: "Leica Rumors", url: "https://leicarumors.com/feed/" },
  nikon: { label: "Nikon Rumors", url: "https://nikonrumors.com/feed/" },
  sony: { label: "Sony Alpha Rumors", url: "https://www.sonyalpharumors.com/feed/" },
  canon: { label: "Canon Rumors", url: "https://www.canonrumors.com/feed/" },
  photo: { label: "Photo Rumors", url: "https://photorumors.com/feed/" },
  petapixel: { label: "PetaPixel", url: "https://petapixel.com/feed/" },
};

async function feedItems(key, ctx) {
  const f = FEEDS[key];
  const text = await cachedText("rss:" + key, 30 * 60, ctx, async () => {
    const r = await fetch(f.url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return JSON.stringify(parseRss(await r.text()).slice(0, 15));
  });
  return JSON.parse(text).map((it) => Object.assign(it, { src: key, source: f.label, summary: cleanFeedSummary(it.summary) }));
}
// toglie dai sommari dei blog le righe ripetute: inviti a iscriversi in testa, "The post … appeared first on …" in coda
function cleanFeedSummary(s) {
  return String(s || "")
    .replace(/^\s*Join (Now|us)\b[^🔥]{0,120}🔥\s*/i, "")
    .replace(/\s*The post\b[\s\S]*$/, "")
    .trim();
}

// ---------------------------------------------------------------- vista lettura degli articoli

function metaOf(html, prop) {
  const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', "i");
  const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', "i");
  const m = html.match(re) || html.match(re2);
  return m ? decodeEntities(m[1]).trim() : "";
}

function readable(html) {
  // tolgo le parti che non sono testo dell'articolo
  let h = html.replace(/<(script|style|noscript|svg|form|nav|header|footer|aside|figure|iframe|button)[\s\S]*?<\/\1>/gi, " ");
  const pick = (re) => { const m = h.match(re); return m ? m[0] : null; };
  const scope = pick(/<article[\s\S]*<\/article>/i) || pick(/<main[\s\S]*<\/main>/i) || h;
  const paras = [];
  const re = /<(p|h2|h3|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(scope))) {
    const t = cleanText(m[2], 0);
    if (!t) continue;
    const isHead = /^h[23]$/i.test(m[1]);
    if (!isHead && t.length < 40 && !/[.!?:»"]$/.test(t)) continue; // didascalie, pulsanti, frammenti
    if (/^(advertisement|pubblicità|read more|leggi anche|related|sign up|subscribe|iscriviti)/i.test(t)) continue;
    if (paras.length && paras[paras.length - 1].t === t) continue;
    paras.push({ h: isHead, t });
  }
  let total = 0;
  const out = [];
  for (const p of paras) { if (total > 14000) break; out.push(p); total += p.t.length; }
  return out;
}

async function readArticle(target, ctx) {
  const text = await cachedText("read:" + target, 24 * 3600, ctx, async () => {
    const r = await fetch(target, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "it-IT,it;q=0.9,en;q=0.8" }, redirect: "follow" });
    if (!r.ok) throw new Error("il sito ha risposto HTTP " + r.status);
    const type = r.headers.get("content-type") || "";
    if (!/html/i.test(type)) throw new Error("non è una pagina web");
    const html = (await r.text()).slice(0, 1500000);
    const paras = readable(html);
    return JSON.stringify({
      url: r.url || target,
      title: metaOf(html, "og:title") || cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "", 200),
      site: metaOf(html, "og:site_name") || null,
      image: metaOf(html, "og:image") || null,
      paras,
      chars: paras.reduce((a, p) => a + p.t.length, 0),
    });
  });
  return JSON.parse(text);
}

// scheda completa di un film o di una serie
async function tmdbTitle(env, ctx, type, id) {
  const text = await cachedText("tmdb:title:" + type + id, 24 * 3600, ctx, async () => {
    const d = await tmdb(env, "/" + type + "/" + id, { append_to_response: "credits,watch/providers,reviews" });
    let reviews = (d.reviews && d.reviews.results) || [];
    if (reviews.length < 3) {
      const en = await tmdb(env, "/" + type + "/" + id + "/reviews", { language: "en-US", page: 1 }).catch(() => ({ results: [] }));
      reviews = reviews.concat((en.results || []).filter((r) => !reviews.some((x) => x.id === r.id)));
    }
    const cr = d.credits || {};
    const prov = (((d["watch/providers"] || {}).results || {}).IT) || {};
    const names = (a) => (a || []).map((p) => p.provider_name);
    return JSON.stringify({
      id: d.id, type, title: d.title || d.name, original: (d.original_title || d.original_name) !== (d.title || d.name) ? (d.original_title || d.original_name) : null,
      tagline: d.tagline || null, overview: d.overview || "", poster: d.poster_path || null, backdrop: d.backdrop_path || null,
      date: d.release_date || d.first_air_date || null, runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null,
      seasons: d.number_of_seasons || null, episodes: d.number_of_episodes || null, status: d.status || null,
      genres: (d.genres || []).map((g) => g.name), countries: (d.production_countries || d.origin_country || []).map((c) => c.iso_3166_1 || c).slice(0, 3),
      vote: d.vote_average || null, votes: d.vote_count || 0,
      directors: type === "tv" ? (d.created_by || []).map((p) => ({ id: p.id, name: p.name })) : (cr.crew || []).filter((c) => c.job === "Director").map((p) => ({ id: p.id, name: p.name })),
      cast: (cr.cast || []).slice(0, 8).map((p) => ({ id: p.id, name: p.name, character: p.character || null })),
      where: { flatrate: names(prov.flatrate), rent: names(prov.rent), buy: names(prov.buy) },
      reviews: reviews.slice(0, 3).map((r) => ({
        author: r.author || (r.author_details && r.author_details.username) || "anonimo",
        rating: r.author_details && r.author_details.rating != null ? r.author_details.rating : null,
        date: r.created_at || null, content: String(r.content || "").replace(/\r/g, "").slice(0, 6000), url: r.url || null,
        lang: /[àèéìòù]/i.test(r.content || "") ? "it" : "en",
      })),
    });
  });
  return JSON.parse(text);
}

// ---------------------------------------------------------------- Sport
// Dirette, partite di oggi e Nazionale: ESPN (pubblico, senza chiave, non ufficiale).
// Classifiche e calendario: football-data.org (segreto FD_TOKEN, piano Free), con ripiego su ESPN.

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
const ESPN_V2 = "https://site.api.espn.com/apis/v2/sports/soccer/";
const LEAGUES = {
  sa: { espn: "ita.1", fd: "SA", label: "Serie A" },
  cl: { espn: "uefa.champions", fd: "CL", label: "Champions League" },
};
// competizioni della Nazionale: [codice ESPN, nome, giorni indietro, giorni avanti]
const NAT_LEAGUES = [
  ["uefa.nations", "Nations League", 75, 120],
  ["fifa.friendly", "Amichevole", 75, 90],
  ["uefa.euroq", "Qualificazioni Euro", 30, 150],
];
const NAT_WINDOW = 30; // ESPN rifiuta (HTTP 400) gli intervalli di date troppo lunghi: si chiede un mese alla volta

// nomi italiani brevi: le due fonti scrivono le squadre in modo diverso
const TEAM_ALIAS = {
  "internazionale": "Inter", "inter milan": "Inter", "fc internazionale milano": "Inter", "inter": "Inter",
  "ac milan": "Milan", "milan": "Milan", "as roma": "Roma", "ssc napoli": "Napoli", "juventus fc": "Juventus",
  "ss lazio": "Lazio", "atalanta bc": "Atalanta", "bologna fc 1909": "Bologna", "acf fiorentina": "Fiorentina",
  "torino fc": "Torino", "genoa cfc": "Genoa", "como 1907": "Como", "udinese calcio": "Udinese", "us lecce": "Lecce",
  "cagliari calcio": "Cagliari", "hellas verona fc": "Verona", "hellas verona": "Verona", "parma calcio 1913": "Parma",
  "us sassuolo calcio": "Sassuolo", "us cremonese": "Cremonese", "ac pisa 1909": "Pisa", "pisa sporting club": "Pisa",
  "venezia fc": "Venezia", "empoli fc": "Empoli", "ac monza": "Monza", "frosinone calcio": "Frosinone",
  "fc bayern munchen": "Bayern", "bayern munich": "Bayern", "paris saint-germain fc": "PSG", "paris saint-germain": "PSG",
  "fc barcelona": "Barcellona", "barcelona": "Barcellona", "barca": "Barcellona", "real madrid cf": "Real Madrid",
  "club atletico de madrid": "Atlético Madrid", "atletico madrid": "Atlético Madrid", "atleti": "Atlético Madrid",
  "manchester city fc": "Manchester City", "man city": "Manchester City", "manchester united fc": "Manchester United",
  "man united": "Manchester United", "arsenal fc": "Arsenal", "liverpool fc": "Liverpool", "chelsea fc": "Chelsea",
  "tottenham hotspur fc": "Tottenham", "tottenham hotspur": "Tottenham", "newcastle united fc": "Newcastle",
  "newcastle united": "Newcastle", "aston villa fc": "Aston Villa", "borussia dortmund": "Dortmund",
  "bv borussia 09 dortmund": "Dortmund", "bayer 04 leverkusen": "Leverkusen", "bayer leverkusen": "Leverkusen",
  "rb leipzig": "Lipsia", "eintracht frankfurt": "Eintracht", "vfb stuttgart": "Stoccarda",
  "sport lisboa e benfica": "Benfica", "sl benfica": "Benfica", "sporting clube de portugal": "Sporting",
  "sporting cp": "Sporting", "fc porto": "Porto", "psv eindhoven": "PSV", "afc ajax": "Ajax",
  "feyenoord rotterdam": "Feyenoord", "club brugge kv": "Club Brugge", "galatasaray sk": "Galatasaray",
  "olympiacos fc": "Olympiacos", "olympiakos piraeus": "Olympiacos", "as monaco fc": "Monaco", "as monaco": "Monaco",
  "olympique de marseille": "Marsiglia", "marseille": "Marsiglia", "lille osc": "Lille", "celtic fc": "Celtic",
  "sk slavia praha": "Slavia Praga", "slavia prague": "Slavia Praga", "fk bodo/glimt": "Bodø/Glimt",
  "bodo/glimt": "Bodø/Glimt", "fc kobenhavn": "Copenaghen", "fc copenhagen": "Copenaghen", "copenhagen": "Copenaghen",
  "royale union saint-gilloise": "Union SG", "union st.-gilloise": "Union SG", "union saint-gilloise": "Union SG",
  "qarabag agdam fk": "Qarabağ", "qarabag": "Qarabağ", "athletic club": "Athletic Bilbao", "villarreal cf": "Villarreal",
  "sevilla fc": "Siviglia", "girona fc": "Girona", "fc red bull salzburg": "Salisburgo", "red bull salzburg": "Salisburgo",
  "gnk dinamo zagreb": "Dinamo Zagabria", "dinamo zagreb": "Dinamo Zagabria", "fk crvena zvezda": "Stella Rossa",
  "red star belgrade": "Stella Rossa", "fc shakhtar donetsk": "Shakhtar", "shakhtar donetsk": "Shakhtar",
  "bsc young boys": "Young Boys", "fenerbahce sk": "Fenerbahçe", "besiktas jk": "Beşiktaş", "pafos fc": "Pafos",
  "fc kairat": "Kairat", "kairat almaty": "Kairat",
  italy: "Italia", germany: "Germania", france: "Francia", spain: "Spagna", england: "Inghilterra",
  portugal: "Portogallo", netherlands: "Olanda", belgium: "Belgio", croatia: "Croazia", switzerland: "Svizzera",
  austria: "Austria", denmark: "Danimarca", norway: "Norvegia", sweden: "Svezia", finland: "Finlandia",
  poland: "Polonia", czechia: "Repubblica Ceca", "czech republic": "Repubblica Ceca", slovakia: "Slovacchia",
  slovenia: "Slovenia", hungary: "Ungheria", romania: "Romania", serbia: "Serbia",
  "bosnia-herzegovina": "Bosnia ed Erzegovina", "bosnia and herzegovina": "Bosnia ed Erzegovina",
  montenegro: "Montenegro", albania: "Albania", "north macedonia": "Macedonia del Nord", greece: "Grecia",
  turkey: "Turchia", turkiye: "Turchia", ukraine: "Ucraina", israel: "Israele", scotland: "Scozia", wales: "Galles",
  "republic of ireland": "Irlanda", ireland: "Irlanda", "northern ireland": "Irlanda del Nord", iceland: "Islanda",
  estonia: "Estonia", latvia: "Lettonia", lithuania: "Lituania", moldova: "Moldavia", georgia: "Georgia",
  armenia: "Armenia", azerbaijan: "Azerbaigian", kazakhstan: "Kazakistan", cyprus: "Cipro", malta: "Malta",
  luxembourg: "Lussemburgo", andorra: "Andorra", "san marino": "San Marino", liechtenstein: "Liechtenstein",
  "faroe islands": "Isole Fær Øer", gibraltar: "Gibilterra", kosovo: "Kosovo", belarus: "Bielorussia",
  bulgaria: "Bulgaria", brazil: "Brasile", argentina: "Argentina", uruguay: "Uruguay", colombia: "Colombia",
  mexico: "Messico", "united states": "Stati Uniti", usa: "Stati Uniti", japan: "Giappone",
  "south korea": "Corea del Sud", morocco: "Marocco", senegal: "Senegal", nigeria: "Nigeria", egypt: "Egitto",
  canada: "Canada", australia: "Australia", chile: "Cile", ecuador: "Ecuador", peru: "Perù", paraguay: "Paraguay",
  tunisia: "Tunisia", algeria: "Algeria", "ivory coast": "Costa d'Avorio", "cote d'ivoire": "Costa d'Avorio",
  ghana: "Ghana", cameroon: "Camerun", "saudi arabia": "Arabia Saudita", qatar: "Qatar", iran: "Iran",
};
const deacc = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function teamName(full, short) {
  for (const c of [full, short]) {
    if (!c) continue;
    const a = TEAM_ALIAS[deacc(c).toLowerCase().trim()];
    if (a) return a;
  }
  const base = String(short || full || "?").trim();
  const n = base.replace(/\b(FC|CF|AC|AS|SS|SSC|US|ACF|AFC|SC|BC|CFC|FK|SK|KV|OSC|Calcio)\b\.?/g, " ")
    .replace(/\b(18|19|20)\d\d\b/g, " ").replace(/\s+/g, " ").trim();
  return n || base;
}
const teamKey = (n) => deacc(n).toLowerCase().replace(/[^a-z0-9]/g, "");

// giorno in ora italiana: compact = AAAAMMGG (ESPN), altrimenti AAAA-MM-GG
function romeDay(offsetDays, compact) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return compact === false ? s : s.replace(/-/g, "");
}

async function espnJSON(url, seconds, ctx) {
  const text = await cachedText("espn:" + url, seconds, ctx, async () => {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) throw new Error("ESPN HTTP " + r.status);
    return r.text();
  });
  return JSON.parse(text);
}

function espnScore(s) {
  if (s == null || s === "") return null;
  const v = typeof s === "object" ? (s.value != null ? s.value : s.displayValue) : s;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function espnMatch(e, lg, comp) {
  const c = (e.competitions && e.competitions[0]) || {};
  const st = e.status || c.status || {};
  const ty = st.type || {};
  const list = c.competitors || [];
  const H = list.find((t) => t.homeAway === "home") || list[0] || {};
  const A = list.find((t) => t.homeAway === "away") || list[1] || {};
  const team = (t) => {
    const tm = t.team || {};
    const n = teamName(tm.displayName || tm.name, tm.shortDisplayName);
    return { n, k: teamKey(n), s: espnScore(t.score) };
  };
  const hid = H.team && H.team.id, aid = A.team && A.team.id;
  const ev = (c.details || []).map((d) => {
    const tx = ((d.type && d.type.text) || "").toLowerCase();
    let t = null;
    if (d.ownGoal || /own goal/.test(tx)) t = "og";
    else if (d.scoringPlay || /^goal|penalty - scored/.test(tx)) t = d.penaltyKick || /penalty/.test(tx) ? "pg" : "goal";
    else if (d.redCard || /red card/.test(tx)) t = "red";
    else if (/penalty - (missed|saved)/.test(tx)) t = "pmiss";
    if (!t) return null;
    const who = (d.athletesInvolved || [])[0] || {};
    const tid = d.team && d.team.id;
    return { t, m: (d.clock && d.clock.displayValue) || "", side: tid && tid === hid ? "h" : tid && tid === aid ? "a" : null,
      who: who.shortName || who.displayName || "" };
  }).filter(Boolean);
  const name = ty.name || "";
  const off = /POSTPONED|CANCEL|ABANDON|SUSPEND|DELAY/.test(name);
  return {
    id: "e" + e.id, lg, comp: comp || null,
    date: e.date ? new Date(e.date).toISOString() : null,
    state: off ? "off" : ty.state || "pre",
    ht: /HALFTIME/.test(name),
    clock: st.displayClock || "", detail: ty.shortDetail || ty.detail || "",
    home: team(H), away: team(A), ev,
    venue: (c.venue && (c.venue.fullName || (c.venue.address && c.venue.address.city))) || null,
  };
}

const hasItaly = (m) => m.home.k === "italia" || m.away.k === "italia";
function dedupe(list) {
  const seen = {};
  return list.filter((m) => (seen[m.id] ? false : (seen[m.id] = 1)));
}

// partite di oggi (ora italiana): dirette, finite e in programma
async function sportLive(lgs, ctx) {
  const day = romeDay(0);
  const jobs = [];
  ["sa", "cl"].forEach((k) => { if (lgs.indexOf(k) >= 0) jobs.push([k, LEAGUES[k].espn, LEAGUES[k].label]); });
  if (lgs.indexOf("nat") >= 0) NAT_LEAGUES.forEach((n) => jobs.push(["nat", n[0], n[1]]));
  const res = await Promise.all(jobs.map((j) =>
    espnJSON(ESPN_SITE + j[1] + "/scoreboard?dates=" + day, 25, ctx)
      .then((d) => ({ lg: j[0], code: j[1], matches: (d.events || []).map((e) => espnMatch(e, j[0], j[2])) }))
      .catch((e) => ({ lg: j[0], code: j[1], error: String((e && e.message) || e), matches: [] }))));
  let matches = [];
  res.forEach((r) => r.matches.forEach((m) => { if (r.lg !== "nat" || hasItaly(m)) matches.push(m); }));
  matches = dedupe(matches).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return { day, sources: res.map((r) => ({ lg: r.lg, code: r.code, n: r.matches.length, error: r.error || null })), matches };
}

async function fdJSON(env, path, seconds, ctx) {
  if (!env || !env.FD_TOKEN) throw new Error("token football-data mancante: aggiungi il segreto FD_TOKEN al Worker");
  const text = await cachedText("fd:" + path, seconds, ctx, async () => {
    const r = await fetch("https://api.football-data.org/v4" + path, { headers: { "X-Auth-Token": env.FD_TOKEN, Accept: "application/json" } });
    if (r.status === 429) throw new Error("football-data: troppe richieste, riprova tra un minuto");
    if (!r.ok) {
      let m = "";
      try { m = (await r.json()).message || ""; } catch (e) { /* niente */ }
      throw new Error("football-data HTTP " + r.status + (m ? ": " + m : ""));
    }
    return r.text();
  });
  return JSON.parse(text);
}

const FD_STATE = { SCHEDULED: "pre", TIMED: "pre", IN_PLAY: "in", PAUSED: "in", LIVE: "in", FINISHED: "post",
  AWARDED: "post", POSTPONED: "off", SUSPENDED: "off", CANCELLED: "off" };
function fdTeam(t, s) {
  const n = teamName(t && t.name, t && t.shortName);
  return { n, k: teamKey(n), s: s != null ? s : null };
}
function fdMatch(m, lg) {
  const ft = (m.score && m.score.fullTime) || {};
  return { id: "f" + m.id, lg, date: m.utcDate || null, state: FD_STATE[m.status] || "pre", ht: m.status === "PAUSED",
    matchday: m.matchday || null, stage: m.stage || null, home: fdTeam(m.homeTeam, ft.home), away: fdTeam(m.awayTeam, ft.away) };
}

// calendario e risultati: dagli ultimi 12 giorni ai prossimi 35
async function sportFixtures(env, c, ctx) {
  const L = LEAGUES[c];
  const from = romeDay(-12, false), to = romeDay(35, false);
  try {
    const d = await fdJSON(env, "/competitions/" + L.fd + "/matches", 600, ctx); // stagione intera, filtrata qui
    const all = d.matches || [];
    const cur = all.length && all[0].season ? all[0].season.currentMatchday : null;
    const matches = all.filter((m) => { const day = (m.utcDate || "").slice(0, 10); return day >= from && day <= to; }).map((m) => fdMatch(m, c));
    return { src: "football-data", competition: L.label, currentMatchday: cur, matches };
  } catch (e) {
    const d = await espnJSON(ESPN_SITE + L.espn + "/scoreboard?dates=" + romeDay(-12) + "-" + romeDay(35) + "&limit=400", 900, ctx);
    return { src: "espn", warn: String((e && e.message) || e), competition: L.label, currentMatchday: null,
      matches: (d.events || []).map((ev) => espnMatch(ev, c, L.label)) };
  }
}

async function sportTable(env, c, ctx) {
  const L = LEAGUES[c];
  try {
    const d = await fdJSON(env, "/competitions/" + L.fd + "/standings", 1800, ctx);
    const st = (d.standings || []).find((s) => s.type === "TOTAL") || (d.standings || [])[0] || {};
    const rows = (st.table || []).map((r) => {
      const n = teamName(r.team && r.team.name, r.team && r.team.shortName);
      return { pos: r.position, n, k: teamKey(n), pts: r.points, pg: r.playedGames, w: r.won, d: r.draw, l: r.lost,
        gf: r.goalsFor, ga: r.goalsAgainst, gd: r.goalDifference, form: r.form || null };
    });
    return { src: "football-data", competition: L.label, matchday: d.season ? d.season.currentMatchday : null, stage: st.stage || null, rows };
  } catch (e) {
    const d = await espnJSON(ESPN_V2 + L.espn + "/standings", 1800, ctx);
    const kid = (d.children && d.children[0]) || d;
    const entries = (kid.standings && kid.standings.entries) || [];
    const stat = (en, nm) => { const s = (en.stats || []).find((x) => x.name === nm || x.type === nm); return s ? s.value : null; };
    const rows = entries.map((en) => {
      const n = teamName(en.team && en.team.displayName, en.team && en.team.shortDisplayName);
      return { pos: stat(en, "rank"), n, k: teamKey(n), pts: stat(en, "points"), pg: stat(en, "gamesPlayed"), w: stat(en, "wins"),
        d: stat(en, "ties"), l: stat(en, "losses"), gf: stat(en, "pointsFor"), ga: stat(en, "pointsAgainst"),
        gd: stat(en, "pointDifferential"), form: null };
    }).sort((a, b) => (a.pos || 99) - (b.pos || 99));
    return { src: "espn", warn: String((e && e.message) || e), competition: L.label, matchday: null, rows };
  }
}

// partite dell'Italia: ultime e prossime
// partite di una competizione in finestre di un mese; errore solo se nessuna finestra risponde
async function natMatches(n, ctx) {
  const wins = [];
  for (let a = -n[2]; a < n[3]; a += NAT_WINDOW) wins.push([a, Math.min(a + NAT_WINDOW - 1, n[3])]);
  const res = await Promise.all(wins.map((w) =>
    espnJSON(ESPN_SITE + n[0] + "/scoreboard?dates=" + romeDay(w[0]) + "-" + romeDay(w[1]) + "&limit=300", 3 * 3600, ctx)
      .then((d) => ({ matches: (d.events || []).map((e) => espnMatch(e, "nat", n[1])).filter(hasItaly) }))
      .catch((e) => ({ error: String((e && e.message) || e), matches: [] }))));
  const bad = res.filter((r) => r.error);
  return { code: n[0], matches: res.flatMap((r) => r.matches), windows: wins.length,
    error: bad.length === res.length ? bad[0].error : bad.length ? bad.length + " finestre su " + res.length + " non lette" : null };
}

// girone dell'Italia in Nations League (classifiche ESPN, gironi annidati a più livelli)
async function natGroup(ctx) {
  const d = await espnJSON(ESPN_V2 + "uefa.nations/standings", 3600, ctx);
  const groups = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.standings && Array.isArray(node.standings.entries) && node.standings.entries.length) groups.push(node);
    (node.children || []).forEach(walk);
  })(d);
  const stat = (en, nm) => { const s = (en.stats || []).find((x) => x.name === nm || x.type === nm); return s ? s.value : null; };
  for (const g of groups) {
    const rows = g.standings.entries.map((en) => {
      const n = teamName(en.team && en.team.displayName, en.team && en.team.shortDisplayName);
      return { pos: stat(en, "rank"), n, k: teamKey(n), pts: stat(en, "points"), pg: stat(en, "gamesPlayed"), w: stat(en, "wins"),
        d: stat(en, "ties"), l: stat(en, "losses"), gf: stat(en, "pointsFor"), ga: stat(en, "pointsAgainst"), gd: stat(en, "pointDifferential") };
    });
    if (!rows.some((r) => r.k === "italia")) continue;
    rows.sort((a, b) => (a.pos || 99) - (b.pos || 99));
    const name = String(g.name || g.abbreviation || "").replace(/^UEFA Nations League,?\s*/i, "")
      .replace(/League\s+([A-D])/i, "Lega $1").replace(/Group\s+(\d+)/i, "Girone $1").replace(/,\s*/g, " · ");
    return { name: name || "Girone", rows };
  }
  return { name: null, rows: [], groups: groups.length };
}

async function sportItaly(ctx) {
  const [res, group] = await Promise.all([
    Promise.all(NAT_LEAGUES.map((n) => natMatches(n, ctx))),
    natGroup(ctx).catch((e) => ({ name: null, rows: [], error: String((e && e.message) || e) })),
  ]);
  const all = dedupe(res.flatMap((r) => r.matches)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const now = Date.now();
  return {
    sources: res.map((r) => ({ code: r.code, n: r.matches.length, windows: r.windows, error: r.error || null })),
    next: all.filter((m) => m.state !== "post" && Date.parse(m.date) > now - 4 * 3600000).slice(0, 6),
    last: all.filter((m) => m.state === "post").reverse().slice(0, 6),
    group,
  };
}

// diagnostica: forma dei dati ESPN per una competizione
async function sportDebug(code, ctx) {
  const d = await espnJSON(ESPN_SITE + code + "/scoreboard?dates=" + romeDay(-3) + "-" + romeDay(3), 60, ctx);
  const e = (d.events || [])[0];
  const c = e && e.competitions && e.competitions[0];
  return {
    code, events: (d.events || []).length, topKeys: Object.keys(d),
    sample: e ? { id: e.id, date: e.date, name: e.name, status: e.status, competitorKeys: c ? (c.competitors || []).map((t) => ({
      homeAway: t.homeAway, score: t.score, team: t.team && { id: t.team.id, displayName: t.team.displayName, shortDisplayName: t.team.shortDisplayName } })) : null,
      details: c ? (c.details || []).slice(0, 4) : null } : null,
    parsed: (d.events || []).slice(0, 3).map((x) => espnMatch(x, "debug", code)),
  };
}


const errOf = (s, e) => ({ symbol: s, error: String((e && e.message) || e) });

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return json({ error: "metodo non ammesso" }, 405);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/") {
      return json({
        service: "DigitalPanel data bridge",
        version: "4.4",
        usage: ["/quotes?symbols=AAPL,ENEL.MI,EURUSD=X", "/earnings?symbols=AAPL,ENEL.MI", "/news?symbols=AAPL,ENEL.MI&days=30", "/spark?symbols=^GSPC,FTSEMIB.MI", "/tmdb/cinema", "/tmdb/streaming?p=netflix,prime", "/tmdb/tv?ids=1399", "/tmdb/search?q=titolo", "/flickr?user=marco_galb&tag=digitalportfolio&ttl=900", "/rss?src=fuji,leica,nikon", "/sport/live", "/sport/fixtures?c=sa", "/sport/table?c=sa", "/sport/italy"],
        tmdb: !!(env && env.TMDB_TOKEN),
        footballData: !!(env && env.FD_TOKEN),
        translate: !!(env && env.AI),
      });
    }

    if (path === "/quotes") {
      const p = readSymbols(url, MAX_SYMBOLS);
      if (p.error) return p.error;
      const quotes = await Promise.all(p.symbols.map((s) => fetchQuote(s, ctx).catch((e) => errOf(s, e))));
      return json({ updated: new Date().toISOString(), quotes }, 200, { "Cache-Control": "public, max-age=30" });
    }

    if (path === "/earnings") {
      const p = readSymbols(url, MAX_EARN_SYMBOLS);
      if (p.error) return p.error;
      // un primo accesso condiviso, così le richieste parallele non chiedono il crumb 12 volte
      try { await getAuth(ctx, false); } catch (e) {
        return json({ updated: new Date().toISOString(), error: "accesso Yahoo: " + e.message,
          earnings: p.symbols.map((s) => errOf(s, "accesso Yahoo non riuscito")) }, 502);
      }
      const earnings = await Promise.all(p.symbols.map((s) => fetchEarnings(s, ctx).catch((e) => errOf(s, e))));
      return json({ updated: new Date().toISOString(), earnings }, 200, { "Cache-Control": "public, max-age=600" });
    }

    if (path === "/news") {
      const p = readSymbols(url, MAX_NEWS_SYMBOLS);
      if (p.error) return p.error;
      const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") || "30", 10) || 30));
      // names facoltativo, nello stesso ordine dei simboli e separato da | (es. names=Apple Inc.|Enel SpA)
      const names = (url.searchParams.get("names") || "").split("|").map((n) => n.trim().slice(0, 60));
      const nameOf = (s) => names[(url.searchParams.get("symbols") || "").split(",").map((x) => x.trim()).indexOf(s)] || "";
      let news = await Promise.all(p.symbols.map((s) => fetchNews(s, days, ctx, nameOf(s)).catch((e) => errOf(s, e))));
      let tr = null;
      if (wantsIt(url)) {
        const budget = { left: TR_MAX_NEW };
        tr = { lang: "it", pending: 0, error: null };
        news = await Promise.all(news.map(async (n) => {
          if (!n.items || !n.items.length) return n;
          const r = await translateItems(env, ctx, "news:" + n.symbol, n.items, budget);
          tr.pending += r.pending; tr.error = tr.error || r.error;
          return Object.assign({}, n, { items: r.items });
        }));
      }
      return json({ updated: new Date().toISOString(), news, tr }, 200,
        { "Cache-Control": tr && tr.pending ? "no-store" : "public, max-age=300" });
    }

    if (path === "/spark") {
      const p = readSymbols(url, MAX_SPARK_SYMBOLS);
      if (p.error) return p.error;
      const spark = await Promise.all(p.symbols.map((s) => fetchSpark(s, ctx).catch((e) => errOf(s, e))));
      return json({ updated: new Date().toISOString(), spark }, 200, { "Cache-Control": "public, max-age=120" });
    }

    if (path.startsWith("/sport/")) {
      try {
        const sub = path.slice(7);
        const now = new Date().toISOString();
        if (sub === "live") {
          const lgs = (url.searchParams.get("lg") || "sa,cl,nat").split(",").map((s) => s.trim().toLowerCase());
          return json(Object.assign({ updated: now }, await sportLive(lgs, ctx)), 200, { "Cache-Control": "public, max-age=15" });
        }
        if (sub === "fixtures") {
          const c = url.searchParams.get("c") === "cl" ? "cl" : "sa";
          return json(Object.assign({ updated: now }, await sportFixtures(env, c, ctx)), 200, { "Cache-Control": "public, max-age=300" });
        }
        if (sub === "table") {
          const c = url.searchParams.get("c") === "cl" ? "cl" : "sa";
          return json(Object.assign({ updated: now }, await sportTable(env, c, ctx)), 200, { "Cache-Control": "public, max-age=600" });
        }
        if (sub === "italy") {
          return json(Object.assign({ updated: now }, await sportItaly(ctx)), 200, { "Cache-Control": "public, max-age=1800" });
        }
        if (sub === "debug") {
          const code = (url.searchParams.get("code") || "ita.1").trim();
          if (!/^[a-z0-9.]{2,30}$/i.test(code)) return json({ error: "parametro code non valido" }, 400);
          return json(await sportDebug(code, ctx));
        }
        return json({ error: "percorso non trovato" }, 404);
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 502);
      }
    }

    if (path.startsWith("/tmdb/")) {
      try {
        const sub = path.slice(6);
        if (sub === "cinema") {
          const text = await cachedText("tmdb:cinema", TMDB_CACHE, ctx, async () => JSON.stringify(await tmdbCinema(env)));
          return json(Object.assign({ updated: new Date().toISOString() }, JSON.parse(text)), 200, { "Cache-Control": "public, max-age=600" });
        }
        if (sub === "streaming") {
          const keys = (url.searchParams.get("p") || "netflix,prime").split(",").map((k) => k.trim().toLowerCase()).filter((k) => PROVIDERS[k]).slice(0, 6);
          const ex = (url.searchParams.get("ex") || "").split(",").map((k) => k.trim().toLowerCase()).filter((k) => GENRES[k]).sort();
          const text = await cachedText("tmdb:stream2:" + keys.join(",") + "|" + ex.join(","), TMDB_CACHE, ctx, async () => JSON.stringify(await tmdbStreaming(env, ctx, keys, ex)));
          return json(Object.assign({ updated: new Date().toISOString() }, JSON.parse(text)), 200, { "Cache-Control": "public, max-age=600" });
        }
        if (sub === "tv") {
          const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map((x) => x.trim()).filter((x) => /^\d{1,9}$/.test(x)))].slice(0, 20);
          if (!ids.length) return json({ error: "parametro ids mancante" }, 400);
          const tv = await Promise.all(ids.map((id) => tmdbTv(env, ctx, id).catch((e) => ({ id: +id, error: String((e && e.message) || e) }))));
          return json({ updated: new Date().toISOString(), tv }, 200, { "Cache-Control": "public, max-age=600" });
        }
        if (sub === "search") {
          const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
          if (!q) return json({ error: "parametro q mancante" }, 400);
          const d = await tmdb(env, "/search/tv", { query: q, page: 1, include_adult: "false" });
          return json({ results: (d.results || []).slice(0, 8).map(slimTv) });
        }
        if (sub === "searchperson") {
          const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
          if (!q) return json({ error: "parametro q mancante" }, 400);
          const d = await tmdb(env, "/search/person", { query: q, page: 1, include_adult: "false" });
          return json({ results: (d.results || []).slice(0, 8).map((p) => ({ id: p.id, name: p.name, dept: p.known_for_department || null,
            known: (p.known_for || []).map((k) => k.title || k.name).filter(Boolean).slice(0, 2) })) });
        }
        if (sub === "people") {
          const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map((x) => x.trim()).filter((x) => /^\d{1,9}$/.test(x)))].slice(0, 20);
          if (!ids.length) return json({ error: "parametro ids mancante" }, 400);
          return json(Object.assign({ updated: new Date().toISOString() }, await tmdbPeople(env, ctx, ids)), 200, { "Cache-Control": "public, max-age=600" });
        }
        if (sub === "title") {
          const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
          const id = (url.searchParams.get("id") || "").trim();
          if (!/^\d{1,9}$/.test(id)) return json({ error: "parametro id non valido" }, 400);
          return json(await tmdbTitle(env, ctx, type, id), 200, { "Cache-Control": "public, max-age=3600" });
        }
        if (sub === "providers") {
          const p = await providerIds(env, ctx);
          return json({ matched: p.ids, labels: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label])), all: p.names });
        }
        return json({ error: "percorso non trovato" }, 404);
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, /token/.test(String(e && e.message)) ? 503 : 502);
      }
    }

    if (path === "/read") {
      const target = (url.searchParams.get("url") || "").trim();
      let u;
      try { u = new URL(target); } catch (e) { return json({ error: "indirizzo non valido" }, 400); }
      // solo pagine web pubbliche: niente indirizzi locali o numerici
      if (!/^https?:$/.test(u.protocol) || !/\./.test(u.hostname) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.port) {
        return json({ error: "indirizzo non ammesso" }, 400);
      }
      try {
        let art = await readArticle(u.toString(), ctx);
        if (wantsIt(url) && art.paras && art.paras.length) art = await translateArticle(env, ctx, art);
        return json(art, 200, { "Cache-Control": art.tr && art.tr.pending ? "no-store" : "public, max-age=3600" });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 502);
      }
    }

    if (path === "/rss") {
      const keys = [...new Set((url.searchParams.get("src") || "fuji").split(",").map((k) => k.trim().toLowerCase()).filter((k) => FEEDS[k]))].slice(0, 7);
      const res = await Promise.all(keys.map((k) => feedItems(k, ctx).then((items) => ({ k, items })).catch((e) => ({ k, error: String((e && e.message) || e) }))));
      let items = res.flatMap((r) => r.items || []).sort((a, b) => (b.time || "").localeCompare(a.time || "")).slice(0, 40);
      let tr = null;
      if (wantsIt(url) && items.length) {
        // le più recenti per prime: sono quelle che il pannello mostra nel riquadro
        const r = await translateItems(env, ctx, "rss:" + keys.slice().sort().join(","), items, { left: TR_MAX_NEW });
        items = r.items;
        tr = { lang: "it", pending: r.pending, error: r.error };
      }
      return json({ updated: new Date().toISOString(), sources: res.map((r) => ({ key: r.k, label: FEEDS[r.k].label, error: r.error || null })), items, tr },
        200, { "Cache-Control": tr && tr.pending ? "no-store" : "public, max-age=300" });
    }

    if (path === "/flickr") {
      const user = (url.searchParams.get("user") || "").trim();
      const tag = (url.searchParams.get("tag") || "").trim().toLowerCase();
      if (!/^[A-Za-z0-9_\-]{2,40}$/.test(user) && !/^\d+@N\d+$/.test(user)) return json({ error: "parametro user non valido" }, 400);
      if (tag && !/^[a-z0-9_\-]{1,40}$/.test(tag)) return json({ error: "parametro tag non valido" }, 400);
      const ttl = Math.min(3600, Math.max(60, parseInt(url.searchParams.get("ttl") || "1800", 10) || 1800));
      const fresh = url.searchParams.get("fresh") === "1";
      try {
        return json(Object.assign({ updated: new Date().toISOString() }, await flickrPhotos(user, tag, ctx, ttl, fresh)), 200,
          { "Cache-Control": fresh ? "no-store" : "public, max-age=" + Math.min(300, ttl) });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 502);
      }
    }

    if (path === "/debug/crumb") {
      const diag = {};
      try { await newAuth(diag); diag.result = "ok"; } catch (e) { diag.result = "errore: " + e.message; }
      return json(diag);
    }

    return json({ error: "percorso non trovato" }, 404);
  },
};
