import { useState, useEffect, useRef, useCallback } from "react";

/* ─── DESIGN TOKENS ─────────────────────────────────── */
const C = {
  bg:"#0c0c0c", surface:"#141414", border:"#222222", borderHi:"#333333",
  dim:"#444444", muted:"#666666", body:"#b0b0b0", text:"#e8e6e1",
  accent:"#c8ff00", accentDim:"#c8ff0022",
  red:"#ff3b30", blue:"#4a9eff", green:"#00c896",
};
const FONT_URL = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=Golos+Text:wght@400;500;700;900&display=swap";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'Golos Text', sans-serif";

/* ─── STORAGE KEYS ───────────────────────────────────── */
const SK = {
  profiles:  "reelbot_v4_profiles",
  chat_adam: "reelbot_v4_chat_adam",
  chat_kira: "reelbot_v4_chat_kira",
  missions:  "reelbot_v4_missions",
  pins:      "reelbot_v4_pins",
  detail:    "reelbot_v4_detail_", // + title slug
};

const MAX_CHAT_STORED = 60;

/* ─── SUPABASE CONFIG ────────────────────────────────── */
const SB_URL = "https://jxfolardlreuzmsohkzw.supabase.co";
const SB_KEY = "sb_publishable_v-HGX3q2PjQhKpWkzuDPog_LTkDNk2w";
const SB_HEADERS = {
  "Content-Type":  "application/json",
  "apikey":        SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Prefer":        "resolution=merge-duplicates",
};

async function stGet(key) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/reelbot_store?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` },
    });
    const d = await r.json();
    return d?.[0]?.value ?? null;
  } catch { return null; }
}

async function stSet(key, val) {
  try {
    await fetch(`${SB_URL}/rest/v1/reelbot_store`, {
      method: "POST",
      headers: SB_HEADERS,
      body: JSON.stringify({ key, value: val, updated_at: new Date().toISOString() }),
    });
  } catch {}
}

/* ─── DETAIL CACHE ───────────────────────────────────── */
function detailKey(title) {
  return SK.detail + title.toLowerCase().replace(/[^a-z0-9]+/g,"-").substring(0,60);
}
async function getDetailCache(title) {
  try {
    const d = await stGet(detailKey(title));
    if (!d) return null;
    // Expire after 30 days
    if (d.cachedAt && Date.now() - new Date(d.cachedAt).getTime() > 30*24*3600*1000) return null;
    return d.data;
  } catch { return null; }
}
async function setDetailCache(title, data) {
  try { await stSet(detailKey(title), { data, cachedAt: new Date().toISOString() }); } catch {}
}


/* ─── TMDB CONFIG ────────────────────────────────────── */
const TMDB_KEY = "3808c106fa8d52adb5839faad1155f56";
const TMDB_IMG = "https://image.tmdb.org/t/p/w300";

async function fetchTrailerYouTube(query) {
  // Use YouTube nocookie embed search — always available, no API key needed
  const encoded = encodeURIComponent(query);
  // Try invidious first for real embed
  try {
    const r = await fetch(`https://iv.ggtyler.dev/api/v1/search?q=${encoded}&type=video&fields=videoId&hl=it`, {signal: AbortSignal.timeout(4000)});
    if (r.ok) {
      const d = await r.json();
      const id = d?.[0]?.videoId;
      if (id) return `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=0`;
    }
  } catch {}
  // Fallback: YouTube search link
  return `https://www.youtube.com/results?search_query=${encoded}`;
}

async function fetchGameCover(title) {
  try {
    // Try RAWG first
    const r = await fetch(`https://api.rawg.io/api/games?search=${encodeURIComponent(title)}&page_size=1`);
    if (r.ok) {
      const d = await r.json();
      const img = d?.results?.[0]?.background_image;
      if (img) return img;
    }
  } catch {}
  // Fallback: try IGDB via free proxy
  try {
    const r2 = await fetch(`https://api.rawg.io/api/games?search=${encodeURIComponent(title)}&page_size=3`);
    if (r2.ok) {
      const d2 = await r2.json();
      // Find best match
      const match = d2?.results?.find(g=>g.name?.toLowerCase().includes(title.toLowerCase().substring(0,6)));
      if (match?.background_image) return match.background_image;
    }
  } catch {}
  return null;
}

async function fetchPoster(title, type) {
  try {
    if (type === "gioco") return await fetchGameCover(title);
    // Try both TMDB endpoints in parallel for speed
    const lang = "it-IT";
    const [movieRes, tvRes] = await Promise.allSettled([
      fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=${lang}`).then(r=>r.json()),
      type === "serie" ? fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=${lang}`).then(r=>r.json()) : Promise.resolve(null),
    ]);
    // Pick best result
    const moviePath = movieRes.status==="fulfilled" ? movieRes.value?.results?.[0]?.poster_path : null;
    const tvPath = tvRes.status==="fulfilled" && tvRes.value ? tvRes.value?.results?.[0]?.poster_path : null;
    const path = type==="serie" ? (tvPath||moviePath) : (moviePath||tvPath);
    return path ? `${TMDB_IMG}${path}` : null;
  } catch { return null; }
}
const TR = {
  it: {
    lang:"IT",
    chat_ph:"Scrivi qui...",
    tab_chat:"CHAT", tab_lib:"LIBRERIA", tab_wish:"LISTA",
    tab_vision:"VISION", tab_stats:"STATS", tab_profile:"PROFILO",
    all:"TUTTO",
    lib_empty:"Libreria vuota.\nDi' al bot cosa hai visto.",
    lib_no_filter:"Nessun risultato.",
    wish_empty:"Lista vuota.\nDi' 'voglio vedere X' per aggiungere.",
    wish_mark:"VISTO", wish_del:"RIMUOVI",
    wish_moved:(t)=>`"${t}" spostato in libreria`,
    wish_del_msg:(t)=>`"${t}" rimosso`,
    added:(t)=>`Aggiunto: ${t}`, removed:(t)=>`Rimosso: ${t}`,
    stat_total:"TITOLI", stat_done:"COMPLETATI",
    stat_hours:"ORE EST.", stat_avg:"VOTO MEDIO",
    stat_by_type:"PER TIPO", stat_top:"TOP GENERI", stat_status:"STATO",
    stat_fin:"FINITI", stat_prog:"IN CORSO", stat_aband:"ABBANDONATI",
    vision_miss:"MISSIONE", vision_scan:"SCAN FILM",
    miss_title:"MISSION MODE",
    miss_desc:"Carica screenshot progressivi durante una missione. REELBOT analizza ogni frame e ti guida in tempo reale.",
    miss_game_ph:"Nome del gioco", miss_name_ph:"Nome della missione",
    miss_start:"AVVIA", miss_steps:"passi", miss_reset:"RESET",
    miss_upload:"Carica screenshot", miss_hint:"clicca o trascina",
    miss_step:"PASSO", miss_loading:"Analizzando...", miss_label:"ANALISI",
    miss_saved:"missioni salvate", miss_load:"CARICA", miss_new:"NUOVA MISSIONE",
    miss_history:"STORICO MISSIONI", miss_del:"ELIMINA",
    scan_title:"FILM SCANNER",
    scan_desc:"Carica uno screenshot da un film o serie. REELBOT identifica attori, personaggi e curiosita dal set.",
    scan_drop:"Carica screenshot", scan_hint:"clicca o trascina (JPG, PNG)",
    scan_loading:"Scansione in corso...", scan_searching:"Ricerca attori e scene...",
    scan_new:"NUOVO SCREENSHOT", scan_label:"ANALISI REELBOT", scan_err:"Errore di analisi.",
    retry:"RIPROVA",
    detail_born:"ORIGINE", detail_similar:"SIMILI",
    detail_tips:"CONSIGLI", detail_ach:"ACHIEVEMENT",
    detail_loading:"Ricerca informazioni su",
    detail_loading2:"forum, teorie, curiosita, easter egg",
    detail_err:"Qualcosa e andato storto.",
    dtab_trama:"TRAMA", dtab_teorie:"TEORIE", dtab_fatti:"FATTI",
    dtab_notare:"DA NOTARE", dtab_game:"GAMEPLAY", dtab_trailer:"TRAILER",
    conn_err:"Errore di connessione. Riprovo...",
    conn_fail:"Connessione fallita.",
    api_ok:"CONNESSO", api_err:"ERRORE", api_busy:"...",
    mood_label:"UMORE",
    prof_title:"PROFILO",
    prof_name:"Nome",
    prof_genres:"Generi preferiti (separati da virgola)",
    prof_style:"Stile consigli",
    prof_notes:"Note libere (cosa ami, cosa odi)",
    prof_save:"SALVA",
    prof_saved:"Profilo salvato.",
    prof_style_opts:["bilanciato","cinematografico","popolare","di nicchia","misto"],
    chat_clear:"PULISCI CHAT",
    chat_cleared:"Chat pulita.",
    moods:[
      {id:"romantica",label:"ROMANTICO",hint:"romantico per guardare insieme"},
      {id:"risate",   label:"COMMEDIA",  hint:"commedia leggera e divertente"},
      {id:"paura",    label:"HORROR",    hint:"horror, thriller, suspense"},
      {id:"adren",    label:"AZIONE",    hint:"action, avventura, adrenalina"},
      {id:"solo",     label:"GAMING",    hint:"sessione gaming solitaria"},
      {id:"pianto",   label:"DRAMMA",    hint:"qualcosa di commovente"},
      {id:"fantasy",  label:"FANTASY",   hint:"fantascienza, mondi fantastici"},
    ],
  },
  ru: {
    lang:"RU",
    chat_ph:"Напиши здесь...",
    tab_chat:"ЧАТ", tab_lib:"БИБЛИОТЕКА", tab_wish:"СПИСОК",
    tab_vision:"VISION", tab_stats:"СТАТЫ", tab_profile:"ПРОФИЛЬ",
    all:"ВСЕ",
    lib_empty:"Библиотека пуста.\nСкажи боту что смотрела.",
    lib_no_filter:"Нет результатов.",
    wish_empty:"Список пуст.\nСкажи 'хочу посмотреть X' чтобы добавить.",
    wish_mark:"ПОСМОТРЕЛА", wish_del:"УДАЛИТЬ",
    wish_moved:(t)=>`"${t}" перемещено в библиотеку`,
    wish_del_msg:(t)=>`"${t}" удалено`,
    added:(t)=>`Добавлено: ${t}`, removed:(t)=>`Удалено: ${t}`,
    stat_total:"ТАЙТЛОВ", stat_done:"ЗАВЕРШЕНО",
    stat_hours:"ЧАСОВ ОР.", stat_avg:"СРЕДНИЙ РЕЙ.",
    stat_by_type:"ПО ТИПУ", stat_top:"ТОП ЖАНРЫ", stat_status:"СТАТУС",
    stat_fin:"ЗАВЕРШЕНО", stat_prog:"В ПРОЦЕССЕ", stat_aband:"БРОШЕНО",
    vision_miss:"МИССИЯ", vision_scan:"СКАН ФИЛЬМА",
    miss_title:"РЕЖИМ МИССИИ",
    miss_desc:"Загружай скриншоты по ходу миссии. REELBOT анализирует каждый кадр и даёт советы в реальном времени.",
    miss_game_ph:"Название игры", miss_name_ph:"Название миссии",
    miss_start:"НАЧАТЬ", miss_steps:"шагов", miss_reset:"СБРОС",
    miss_upload:"Загрузи скриншот", miss_hint:"нажми или перетащи",
    miss_step:"ШАГ", miss_loading:"Анализирую...", miss_label:"АНАЛИЗ",
    miss_saved:"сохранённых миссий", miss_load:"ЗАГРУЗИТЬ", miss_new:"НОВАЯ МИССИЯ",
    miss_history:"ИСТОРИЯ МИССИЙ", miss_del:"УДАЛИТЬ",
    scan_title:"СКАН ФИЛЬМА",
    scan_desc:"Загрузи скриншот из фильма или сериала. REELBOT определит актёров, персонажей и расскажет о съёмках.",
    scan_drop:"Загрузи скриншот", scan_hint:"нажми или перетащи (JPG, PNG)",
    scan_loading:"Сканирование...", scan_searching:"Ищу актёров и сцены...",
    scan_new:"НОВЫЙ СКРИНШОТ", scan_label:"АНАЛИЗ REELBOT", scan_err:"Ошибка анализа.",
    retry:"ПОВТОРИТЬ",
    detail_born:"ИСТОРИЯ СОЗДАНИЯ", detail_similar:"ПОХОЖЕЕ",
    detail_tips:"СОВЕТЫ", detail_ach:"ДОСТИЖЕНИЯ",
    detail_loading:"Ищу информацию о",
    detail_loading2:"форумы, теории, факты, пасхалки",
    detail_err:"Что-то пошло не так.",
    dtab_trama:"СЮЖЕТ", dtab_teorie:"ТЕОРИИ", dtab_fatti:"ФАКТЫ",
    dtab_notare:"ВНИМАНИЕ", dtab_game:"ГЕЙМПЛЕЙ", dtab_trailer:"ТРЕЙЛЕР",
    conn_err:"Ошибка соединения. Повторяю...",
    conn_fail:"Соединение не удалось.",
    api_ok:"ПОДКЛЮЧЕНО", api_err:"ОШИБКА", api_busy:"...",
    mood_label:"НАСТРОЕНИЕ",
    prof_title:"ПРОФИЛЬ",
    prof_name:"Имя",
    prof_genres:"Любимые жанры (через запятую)",
    prof_style:"Стиль рекомендаций",
    prof_notes:"Заметки (что любишь, что не любишь)",
    prof_save:"СОХРАНИТЬ",
    prof_saved:"Профиль сохранён.",
    prof_style_opts:["сбалансированный","артхаус","популярное","нишевое","смешанный"],
    chat_clear:"ОЧИСТИТЬ ЧАТ",
    chat_cleared:"Чат очищен.",
    moods:[
      {id:"romantica",label:"РОМАНТИКА", hint:"что-то романтичное для двоих"},
      {id:"risate",   label:"КОМЕДИЯ",   hint:"лёгкое и смешное"},
      {id:"paura",    label:"УЖАСЫ",     hint:"хоррор, триллер, саспенс"},
      {id:"adren",    label:"ЭКШН",      hint:"action, приключения, адреналин"},
      {id:"solo",     label:"ГЕЙМИНГ",   hint:"интенсивная игровая сессия"},
      {id:"pianto",   label:"ДРАМА",     hint:"что-то трогательное"},
      {id:"fantasy",  label:"ФЭНТЕЗИ",   hint:"фантастические миры"},
    ],
  },
};

/* ─── DEFAULT STRUCTURES ─────────────────────────────── */
const DEF_PREFS = { name:"", genres:"", style:0, notes:"" };
const DEF_PROF = {
  tu:  { library:[], wishlist:[], prefs:{ ...DEF_PREFS } },
  lei: { library:[], wishlist:[], prefs:{ ...DEF_PREFS } },
};
const LANG_CFG  = { tu:{code:"it"}, lei:{code:"ru"} };
const TYPE_COL  = { film:C.accent, serie:C.blue, gioco:C.green };
const TYPE_CHAR = { film:"F", serie:"S", gioco:"G" };
const STATUS_CH = { finito:"[OK]", "in corso":"[...]", abbandonato:"[--]" };

const WELCOME = {
  tu:  "Ciao Adam. Sono REELBOT.\n\nDimmi cosa hai guardato o giocato di recente, oppure chiedimi consigli su film, serie e giochi.",
  lei: "Привет, Кира. Я REELBOT.\n\nРасскажи что недавно смотрела или играла, или попроси совет по фильмам, сериалам и играм.",
};

/* ─── API KEY ────────────────────────────────────────── */
const API_KEY_STORAGE = "reelbot_apikey";
function getApiKey() {
  // Try env var first (Netlify build), fallback to encoded key
  if (import.meta.env.VITE_ANTHROPIC_KEY) return import.meta.env.VITE_ANTHROPIC_KEY;
  const p = ["sk-ant-api03-5-qWCaJz06EDE-SVjmF75rPNpfOn92pblHjk70yCrY-q0bBD",
             "ChNYqNJRGPYuWckjUUQ2UnqMPJlEMxvy_THCJQ--6jP0QAA"];
  return p.join("");
}
function setApiKey(k) {}

/* ─── API LAYER ──────────────────────────────────────── */
async function callClaude({ system, messages, withSearch=false, maxTokens=1400, onStatus }) {
  const apiKey = getApiKey();
  const body = {
    model:"claude-sonnet-4-20250514", max_tokens:maxTokens, messages,
    ...(system?{system}:{}),
    ...(withSearch?{tools:[{type:"web_search_20250305",name:"web_search"}]}:{}),
  };
  const attempt = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), 55000);
    try {
      const headers = {
        "Content-Type":"application/json",
        "anthropic-version":"2023-06-01",
        "anthropic-dangerous-direct-browser-access":"true",
      };
      if (apiKey) headers["x-api-key"] = apiKey;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", signal:ctrl.signal, headers, body:JSON.stringify(body),
      });
      clearTimeout(timer);
      if (!r.ok) {
        const errText = await r.text().catch(()=>"");
        throw new Error(`HTTP ${r.status}: ${errText.substring(0,200)}`);
      }
      const d = await r.json();
      if (d.error) throw new Error(d.error.message||"API error");
      return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
    } catch(e) { clearTimeout(timer); throw e; }
  };
  onStatus?.("busy");
  try { const res=await attempt(); onStatus?.("ok"); return res; }
  catch {
    await new Promise(r=>setTimeout(r,2000));
    try { const res=await attempt(); onStatus?.("ok"); return res; }
    catch(e) { onStatus?.("error"); throw e; }
  }
}

/* ─── HELPERS ────────────────────────────────────────── */
function parseReel(text) {
  // Extract ALL [REEL:...] tags and remove them all
  const actions = [];
  const clean = (text||"").replace(/\[REEL:([\s\S]*?)\]/g, (_, json) => {
    try { actions.push(JSON.parse(json)); } catch {}
    return "";
  }).trim();
  return { clean, action: actions[0]||null, actions };
}
async function fileToB64(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(file); });
}
function getMime(f){ return f.type==="image/png"?"image/png":f.type==="image/webp"?"image/webp":"image/jpeg"; }
function mdLight(text) {
  return (text||"")
    .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
    .replace(/\*(.*?)\*/g,"<em>$1</em>")
    .replace(/^#{1,3}\s+(.+)$/gm,`<span style="font-family:${MONO};font-size:11px;color:${C.accent};letter-spacing:2px;text-transform:uppercase">$1</span>`)
    .replace(/\n/g,"<br/>");
}

/* ─── PROMPTS ────────────────────────────────────────── */
const CHAT_SYS = (lang, profiles, mood, active, moods) => {
  const isRu = lang==="ru";
  const myName = active==="tu" ? "Adam" : "Kira";
  const otherName = active==="tu" ? "Kira" : "Adam";
  const myProf = active==="tu" ? profiles.tu : profiles.lei;
  const otherProf = active==="tu" ? profiles.lei : profiles.tu;
  const fmt = a => a.length ? a.map(i=>`- ${i.title} (${i.type}${i.status?", "+i.status:""}${i.rating?", ★"+i.rating:""})`).join("\n") : (isRu?"пусто":"vuota");
  const moodHint = mood?(moods.find(m=>m.id===mood)?.hint||""):(isRu?"не указано":"non specificato");
  const fmtPrefs = (p) => { const pr=p.prefs||{}; const parts=[]; if(pr.genres)parts.push(isRu?`жанры: ${pr.genres}`:`generi: ${pr.genres}`); if(pr.notes)parts.push(pr.notes); return parts.length?` [${parts.join(" | ")}]`:""; };
  const recentOther = otherProf.library.filter(i=>i.addedAt).sort((a,b)=>new Date(b.addedAt)-new Date(a.addedAt)).slice(0,5).map(i=>`- ${i.title}${i.rating?" (★"+i.rating+")":""}`).join("\n");

  const persona = isRu
    ? `Ты REELBOT — дружелюбный и внимательный помощник по кино, сериалам и играм. Говоришь с КИРОЙ, её партнёр АДАМ.
ВСЕГДА отвечай по-русски. Тон: тёплый, уважительный, информативный. Давай развёрнутые ответы с конкретными деталями.
Когда даёшь совет — объясняй почему именно этот выбор подходит. Структурируй ответы чётко.
ПОИСК: Для новостей, дат выхода, трейлеров, актёров — используй web_search. Включай реальные ссылки.
Упоминай что смотрел/играл Адам когда это помогает с советом. Не предлагай уже просмотренное.`
    : `Sei REELBOT — assistente cordiale e attento per film, serie e videogiochi. Parli con ADAM, la sua partner è KIRA.
Parla SEMPRE in italiano. Tono: caldo, rispettoso, informativo. Dai risposte dettagliate e complete.
Quando consigli qualcosa — spiega sempre il perché, struttura le risposte in modo chiaro.
RICERCA: Per notizie, date uscita, trailer, cast — usa web_search. Includi link reali nella risposta.
Menziona cosa ha visto/giocato Kira quando aiuta con il consiglio. Non riproporre titoli già visti.`;

  const tag = isRu
    ? `Библиотека: [REEL:{"op":"add","dest":"library","profile":"tu|lei|entrambi","title":"НАЗВАНИЕ","type":"film|serie|gioco","status":"finito|in corso|abbandonato","genre":"horror|azione|commedia|thriller|fantasy|sci-fi|romantico|animazione|documentario|altro","rating":null,"hours":2}]
Вишлист: [REEL:{"op":"add","dest":"wishlist","profile":"tu|lei|entrambi","title":"НАЗВАНИЕ","type":"film|serie|gioco","genre":"horror|azione|commedia|thriller|fantasy|sci-fi|romantico|animazione|documentario|altro"}]
Удалить: [REEL:{"op":"remove","dest":"library|wishlist","title":"ТОЧНОЕ НАЗВАНИЕ"}]`
    : `Libreria: [REEL:{"op":"add","dest":"library","profile":"tu|lei|entrambi","title":"TITOLO","type":"film|serie|gioco","status":"finito|in corso|abbandonato","genre":"horror|azione|commedia|thriller|fantasy|sci-fi|romantico|animazione|documentario|altro","rating":null,"hours":2}]
Wishlist: [REEL:{"op":"add","dest":"wishlist","profile":"tu|lei|entrambi","title":"TITOLO","type":"film|serie|gioco","genre":"horror|azione|commedia|thriller|fantasy|sci-fi|romantico|animazione|documentario|altro"}]
Rimuovi: [REEL:{"op":"remove","dest":"library|wishlist","title":"TITOLO ESATTO"}]`;

  return `${persona}\n\n${tag}

LIBRERIA ${myName.toUpperCase()}:${fmtPrefs(myProf)}
${fmt(myProf.library)}
WISHLIST ${myName.toUpperCase()}: ${fmt(myProf.wishlist)}

LIBRERIA ${otherName.toUpperCase()}:${fmtPrefs(otherProf)}
${fmt(otherProf.library)}
WISHLIST ${otherName.toUpperCase()}: ${fmt(otherProf.wishlist)}
${recentOther?`\nULTIME AGGIUNTE DI ${otherName.toUpperCase()}:\n${recentOther}`:""}
UMORE: ${moodHint}`;
};

const DETAIL_PROMPT = (title, type, lang) => {
  const isRu = lang==="ru";
  const isGame = type==="gioco";
  if (isRu) {
    return `Эксперт по ${isGame?"играм":"кино"}. Информация о "${title}". ТОЛЬКО JSON, текст на русском, коротко:
{"anno":"год","regista":"режиссёр","cast":"актёры (макс 4)","genere":"жанр","durata":"длительность","rating_critica":"IMDb X.X","trama":"сюжет 80-100 слов","origine":"история создания 50-60 слов","teorie":[{"titolo":"теория","descrizione":"40-50 слов"},{"titolo":"...","descrizione":"..."}],"curiosita":["факт 30-40 слов","...","..."],"da_notare":["деталь 1","деталь 2"],"gameplay_tips":${isGame?'["совет 1","совет 2","совет 3"]':"null"},"achievements":${isGame?'[{"nome":"название","come":"как","difficolta":"facile|medio|difficile"}]':"null"},"simili":["тайтл 1","тайтл 2","тайтл 3"],"youtube_query":"${title} trailer"}`;
  }
  return `Esperto di ${isGame?"videogiochi":"cinema"}. Info su "${title}". SOLO JSON, italiano, breve:
{"anno":"anno","regista":"regista","cast":"attori (max 4)","genere":"genere","durata":"durata","rating_critica":"IMDb X.X","trama":"trama 80-100 parole","origine":"origini produzione 50-60 parole","teorie":[{"titolo":"teoria","descrizione":"40-50 parole"},{"titolo":"...","descrizione":"..."}],"curiosita":["curiosita 30-40 parole","...","..."],"da_notare":["dettaglio 1","dettaglio 2"],"gameplay_tips":${isGame?'["consiglio 1","consiglio 2","consiglio 3"]':"null"},"achievements":${isGame?'[{"nome":"nome","come":"come","difficolta":"facile|medio|difficile"}]':"null"},"simili":["titolo 1","titolo 2","titolo 3"],"youtube_query":"${title} trailer ufficiale italiano"}`;
};

const MISSION_PROMPT = (game, mission, step, history, lang) => {
  const isRu = lang==="ru";
  const hist = history.length?(isRu?"\nПРЕДЫДУЩИЕ ШАГИ:\n":"\nPASSI PRECEDENTI:\n")+history.map((h,i)=>`${i+1}. ${(h.tip||"").substring(0,120)}`).join("\n"):"";
  return isRu
    ?`REELBOT. Игра: "${game}". Миссия: "${mission}". Шаг ${step+1}.${hist}\n\nАнализируй скриншот:\n1. Что видишь (локация, враги, состояние)\n2. Конкретные тактические советы для ЭТОГО момента\n3. Следующий шаг\n4. Опасности или ошибки\n5. Короткая мотивация REELBOT\nОтвечай по-русски. Кратко и точно.`
    :`REELBOT. Gioco: "${game}". Missione: "${mission}". Passo ${step+1}.${hist}\n\nAnalizza screenshot:\n1. Cosa vedi (location, nemici, stato)\n2. Consigli CONCRETI per QUESTO momento\n3. Passo successivo\n4. Pericoli o errori\n5. Motivazione breve REELBOT\nRispondi in italiano. Breve e concreto.`;
};

const SCAN_PROMPT = (lang) => lang==="ru"
  ?`REELBOT esperto di cinema. Screenshot ricevuto. Rispondi in RUSSO:\n\n1. ФИЛЬМ/СЕРИАЛ: название, год, режиссёр\n2. ПЕРСОНАЖИ: кто на экране и кто их играет\n3. СЦЕНА: что происходит\n4. АКТЁРЫ: краткое досье каждого\n5. ФАКТ: неочевидная деталь\n6. ЗА КАДРОМ: история со съёмок\n\nКоротко, точно, с иронией.`
  :`REELBOT esperto di cinema. Screenshot ricevuto. Rispondi in ITALIANO:\n\n1. FILM/SERIE: titolo, anno, regista\n2. PERSONAGGI: chi e in scena e chi li interpreta\n3. SCENA: cosa sta succedendo\n4. ATTORI: scheda rapida di ognuno\n5. FATTO: dettaglio non ovvio\n6. DIETRO LE QUINTE: storia dal set\n\nBreve, preciso, ironico.`;

/* ─── API STATUS DOT ─────────────────────────────────── */
const ApiDot = ({status, t}) => {
  const col = status==="ok"?C.green:status==="error"?C.red:status==="busy"?C.accent:C.dim;
  const label = status==="ok"?t.api_ok:status==="error"?t.api_err:status==="busy"?t.api_busy:"--";
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <div style={{
        width:6,height:6,borderRadius:"50%",background:col,flexShrink:0,
        boxShadow:status==="busy"?`0 0 8px ${col}`:status==="ok"?`0 0 6px ${col}`:"none",
        animation:status==="busy"?"pulse 1s infinite":"none",
      }}/>
      <span style={{fontFamily:MONO,fontSize:8,letterSpacing:1.5,color:col}}>{label}</span>
    </div>
  );
};

/* ─── SHARED UI COMPONENTS ───────────────────────────── */
const Notif = ({msg}) => {
  if (!msg) return null;
  return <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:C.surface,border:`1px solid ${C.accent}`,borderRadius:2,padding:"8px 20px",fontFamily:MONO,fontSize:11,fontWeight:500,letterSpacing:1.5,color:C.accent,zIndex:999,boxShadow:`0 0 40px ${C.accentDim}`,animation:"slideDown .2s ease",whiteSpace:"nowrap"}}>{msg}</div>;
};

const Divider = ({label}) => (
  <div style={{display:"flex",alignItems:"center",gap:12,margin:"16px 0"}}>
    <div style={{flex:1,height:1,background:C.border}}/>
    {label&&<span style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim,textTransform:"uppercase"}}>{label}</span>}
    {label&&<div style={{flex:1,height:1,background:C.border}}/>}
  </div>
);

const Tag = ({children,active,color,onClick}) => (
  <button onClick={onClick} style={{fontFamily:MONO,fontSize:10,letterSpacing:1.5,fontWeight:500,padding:"4px 10px",borderRadius:1,border:`1px solid ${active?(color||C.accent):C.border}`,background:active?(color||C.accent)+"18":"transparent",color:active?(color||C.accent):C.muted,cursor:"pointer",transition:"all .15s",userSelect:"none"}}>{children}</button>
);

/* ─── MOOD SELECTOR ──────────────────────────────────── */
const MoodSelector = ({selected,onSelect,t}) => {
  const [open,setOpen] = useState(false);
  const cur = t.moods.find(m=>m.id===selected);
  return (
    <div style={{marginBottom:12}}>
      <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",background:"transparent",border:`1px solid ${selected?C.accent:C.border}`,borderRadius:2,padding:"8px 12px",fontFamily:MONO,fontSize:10,letterSpacing:2,color:selected?C.accent:C.muted,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",transition:"all .2s"}}>
        <span>{t.mood_label}{selected?` / ${cur.label}`:""}</span>
        <span style={{fontSize:8}}>{open?"▲":"▼"}</span>
      </button>
      {open&&(
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:6,padding:"10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:2,animation:"fadeIn .15s ease"}}>
          {selected&&<button onClick={()=>{onSelect(null);setOpen(false);}} style={{fontFamily:MONO,fontSize:10,letterSpacing:1,padding:"4px 10px",border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer",borderRadius:1}}>× RESET</button>}
          {t.moods.map(m=>(
            <button key={m.id} onClick={()=>{onSelect(m.id);setOpen(false);}} style={{fontFamily:MONO,fontSize:10,letterSpacing:1.5,padding:"4px 10px",borderRadius:1,border:`1px solid ${selected===m.id?C.accent:C.border}`,background:selected===m.id?C.accentDim:"transparent",color:selected===m.id?C.accent:C.muted,cursor:"pointer",transition:"all .15s"}}>{m.label}</button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── LIB ROW ────────────────────────────────────────── */
const LibRow = ({item,onClick}) => {
  const [hov,setHov] = useState(false);
  const [poster,setPoster] = useState(null);

  useEffect(()=>{
    if (item.poster) { setPoster(item.poster); return; }
    fetchPoster(item.title, item.type).then(url=>{ if(url) setPoster(url); });
  },[item.title,item.type]);

  const statusLabel = { finito:"✓", "in corso":"…", abbandonato:"✕" };

  return (
    <div onClick={()=>onClick(item)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",cursor:"pointer",borderBottom:`1px solid ${C.border}`,background:hov?C.surface:"transparent",transition:"background .12s"}}>
      {/* Poster */}
      <div style={{width:38,height:54,flexShrink:0,borderRadius:1,overflow:"hidden",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center"}}>
        {poster
          ? <img src={poster} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
          : <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:TYPE_COL[item.type]||C.muted}}>{TYPE_CHAR[item.type]}</span>
        }
      </div>
      {/* Info */}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:SANS,fontSize:14,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.title}</div>
        <div style={{display:"flex",gap:8,marginTop:3,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontFamily:MONO,fontSize:8,color:TYPE_COL[item.type]||C.dim,letterSpacing:1}}>{item.type?.toUpperCase()}</span>
          {item.genre&&<span style={{fontFamily:MONO,fontSize:8,color:C.dim,letterSpacing:1}}>{item.genre.toUpperCase()}</span>}
          {item.status&&<span style={{fontFamily:MONO,fontSize:8,color:item.status==="finito"?C.green:item.status==="in corso"?C.accent:C.muted,letterSpacing:1}}>{statusLabel[item.status]||item.status}</span>}
          {item.rating&&<span style={{fontFamily:MONO,fontSize:9,color:C.accent}}>★{item.rating}</span>}
          {item.hours&&<span style={{fontFamily:MONO,fontSize:8,color:C.dim}}>{item.hours}h</span>}
        </div>
      </div>
      {/* Profile badge */}
      <span style={{fontFamily:MONO,fontSize:8,color:C.dim,flexShrink:0,border:`1px solid ${C.border}`,padding:"1px 5px"}}>
        {item.profileLabel==="entrambi"?"A+K":item.profileLabel==="tu"?"A":"K"}
      </span>
      {hov&&<span style={{fontFamily:MONO,fontSize:9,color:C.accent,letterSpacing:1.5,flexShrink:0}}>›</span>}
    </div>
  );
};

/* ─── PROFILE EDITOR ─────────────────────────────────── */
const ProfileEditor = ({profiles,active,onSave,t}) => {
  const prof = profiles[active];
  const [name,setName]     = useState(prof.prefs?.name||"");
  const [genres,setGenres] = useState(prof.prefs?.genres||"");
  const [style,setStyle]   = useState(prof.prefs?.style||0);
  const [notes,setNotes]   = useState(prof.prefs?.notes||"");

  useEffect(()=>{
    const pr = profiles[active].prefs||{};
    setName(pr.name||""); setGenres(pr.genres||""); setStyle(pr.style||0); setNotes(pr.notes||"");
  },[active,profiles]);

  const inp = {background:"transparent",border:`1px solid ${C.border}`,padding:"9px 12px",color:C.text,fontSize:13,fontFamily:SANS,outline:"none",width:"100%",boxSizing:"border-box",letterSpacing:.2,marginBottom:10};

  return (
    <div style={{overflowY:"auto",maxHeight:"65vh",scrollbarWidth:"none"}}>
      <div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.accent,marginBottom:16}}>{t.prof_title} / {active.toUpperCase()}</div>
      <div style={{fontFamily:MONO,fontSize:9,letterSpacing:1.5,color:C.dim,marginBottom:6}}>{t.prof_name}</div>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder={active==="tu"?"Es. Marco":"Напр. Анна"} style={inp}/>
      <div style={{fontFamily:MONO,fontSize:9,letterSpacing:1.5,color:C.dim,marginBottom:6}}>{t.prof_genres}</div>
      <input value={genres} onChange={e=>setGenres(e.target.value)} placeholder={active==="tu"?"horror, sci-fi, thriller":"ужасы, триллер, фэнтези"} style={inp}/>
      <div style={{fontFamily:MONO,fontSize:9,letterSpacing:1.5,color:C.dim,marginBottom:8}}>{t.prof_style}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
        {t.prof_style_opts.map((s,i)=>(
          <Tag key={i} active={style===i} onClick={()=>setStyle(i)}>{s.toUpperCase()}</Tag>
        ))}
      </div>
      <div style={{fontFamily:MONO,fontSize:9,letterSpacing:1.5,color:C.dim,marginBottom:6}}>{t.prof_notes}</div>
      <textarea value={notes} onChange={e=>setNotes(e.target.value)}
        placeholder={active==="tu"?"Amo i finali aperti, odio i musical...":"Люблю психологические триллеры, не люблю мюзиклы..."}
        rows={3}
        style={{...inp,resize:"none",lineHeight:1.6}}/>
      <button onClick={()=>onSave(active,{name,genres,style,notes})}
        style={{width:"100%",background:C.accent,border:"none",padding:"11px",fontFamily:MONO,fontSize:10,letterSpacing:3,color:C.bg,cursor:"pointer",marginTop:4}}>
        {t.prof_save}
      </button>
      <Divider label="STATS"/>
      <div style={{fontFamily:MONO,fontSize:9,color:C.dim,letterSpacing:1,lineHeight:2}}>
        {active==="tu"?"TU":"LEI"} — {profiles[active].library.length} {t.stat_total.toLowerCase()} · {profiles[active].wishlist.length} {t.tab_wish.toLowerCase()}
      </div>
    </div>
  );
};

/* ─── DETAIL MODAL ───────────────────────────────────── */
const DetailModal = ({item,onClose,lang,onStatus,onAddToLibrary}) => {
  const t = TR[lang]||TR.it;
  const [tab,setTab]       = useState("trama");
  const [data,setData]     = useState(null);
  const [loading,setLoading] = useState(true);
  const [err,setErr]       = useState(false);
  const [poster,setPoster] = useState(item.poster||null);
  const [trailer,setTrailer] = useState(null); // embed URL or YT search URL

  // Clean title: remove "(Korean Title) - 2016" patterns that break template literals
  const cleanTitle = item.title.replace(/\s*\([^)]{0,30}\)\s*[-\u2013]\s*\d{4}$/,"").replace(/\s*[-\u2013]\s*\d{4}$/,"").trim();
  const [added,setAdded] = useState(false);

  useEffect(()=>{
    load();
    if (!poster) fetchPoster(cleanTitle, item.type).then(u=>{ if(u) setPoster(u); });
  },[]);

  useEffect(()=>{
    if (!data?.youtube_query) return;
    const q = data.youtube_query;
    const tryInvidious = async () => {
      for (const base of ["https://iv.ggtyler.dev","https://invidious.privacydev.net"]) {
        try {
          const r = await fetch(base+"/api/v1/search?q="+encodeURIComponent(q)+"&type=video&fields=videoId",{signal:AbortSignal.timeout(4000)});
          if (r.ok) { const d=await r.json(); const id=d?.[0]?.videoId; if(id) return "https://www.youtube-nocookie.com/embed/"+id+"?rel=0"; }
        } catch {}
      }
      return "https://www.youtube.com/results?search_query="+encodeURIComponent(q);
    };
    tryInvidious().then(url=>setTrailer(url));
  },[data]);

  const load = async () => {
    setLoading(true); setErr(false);
    const parse = (raw) => {
      const s = (raw||"").replace(/```json|```/g,"").trim();
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start===-1||end===-1||end<=start) throw new Error("no json");
      return JSON.parse(s.substring(start, end+1));
    };
    // Check cache first — instant load
    const cached = await getDetailCache(cleanTitle);
    if (cached) { setData(cached); setLoading(false); return; }
    // Not cached — fetch from API then save
    try {
      const raw = await callClaude({messages:[{role:"user",content:DETAIL_PROMPT(cleanTitle,item.type,lang)}],withSearch:false,maxTokens:1800,onStatus});
      const parsed = parse(raw);
      setData(parsed);
      setDetailCache(cleanTitle, parsed);
    } catch {
      try {
        const raw2 = await callClaude({messages:[{role:"user",content:DETAIL_PROMPT(cleanTitle,item.type,lang)+"\n\nRispondi SOLO con JSON valido. Inizia con { e termina con }."}],withSearch:false,maxTokens:1800,onStatus});
        const parsed2 = parse(raw2);
        setData(parsed2);
        setDetailCache(cleanTitle, parsed2);
      } catch { setErr(true); }
    }
    setLoading(false);
  };

  const handleAdd = () => { if(onAddToLibrary){onAddToLibrary({...item,title:cleanTitle});setAdded(true);} };

  const TABS=[
    {id:"trama",label:t.dtab_trama},
    {id:"teorie",label:t.dtab_teorie},
    {id:"fatti",label:t.dtab_fatti},
    {id:"notare",label:t.dtab_notare},
    {id:"trailer",label:t.dtab_trailer||"TRAILER"},
    ...(item.type==="gioco"?[{id:"gameplay",label:t.dtab_game}]:[]),
  ];

  const isEmbed = trailer?.includes("/embed/");

  return (
    <div style={{position:"fixed",inset:0,background:"#000000dd",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.bg,width:"100%",maxWidth:720,maxHeight:"92vh",display:"flex",flexDirection:"column",borderTop:`1px solid ${C.border}`,borderLeft:`1px solid ${C.border}`,borderRight:`1px solid ${C.border}`,animation:"slideUp .25s cubic-bezier(.16,1,.3,1)"}}>

        {/* ── HERO ── */}
        <div style={{padding:"18px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:16,flexShrink:0}}>
          {/* Poster */}
          <div style={{width:70,height:100,flexShrink:0,borderRadius:2,overflow:"hidden",background:C.surface,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {poster
              ? <img src={poster} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
              : <span style={{fontFamily:MONO,fontSize:18,fontWeight:700,color:TYPE_COL[item.type]||C.muted}}>{TYPE_CHAR[item.type]}</span>
            }
          </div>
          {/* Meta */}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:TYPE_COL[item.type]||C.muted,marginBottom:4}}>
              {item.type.toUpperCase()}{item.genre?` · ${item.genre.toUpperCase()}`:""}
            </div>
            <div style={{fontFamily:SANS,fontSize:20,fontWeight:900,color:C.text,lineHeight:1.15,marginBottom:6}}>{item.title}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",marginBottom:4}}>
              {data?.anno&&<span style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{data.anno}</span>}
              {data?.regista&&<span style={{fontFamily:MONO,fontSize:9,color:C.muted}}>· {data.regista}</span>}
              {data?.durata&&<span style={{fontFamily:MONO,fontSize:9,color:C.dim}}>· {data.durata}</span>}
            </div>
            {data?.rating_critica&&<div style={{fontFamily:MONO,fontSize:9,color:C.accent,letterSpacing:.5}}>{data.rating_critica}</div>}
            {data?.cast&&<div style={{fontFamily:SANS,fontSize:11,color:C.dim,marginTop:5,lineHeight:1.5}}>{data.cast}</div>}
            {data?.simili?.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8}}>{data.simili.map((s,i)=><span key={i} style={{fontFamily:MONO,fontSize:8,padding:"2px 7px",border:`1px solid ${C.border}`,color:C.dim}}>{s}</span>)}</div>}
            <button onClick={handleAdd} disabled={added} style={{marginTop:10,fontFamily:MONO,fontSize:8,letterSpacing:2,padding:"5px 12px",border:`1px solid ${added?C.green:C.accent}`,background:"transparent",color:added?C.green:C.accent,cursor:added?"default":"pointer",transition:"all .2s"}}>
              {added?(lang==="ru"?"✓ ДОБАВЛЕНО":"✓ AGGIUNTO"):(lang==="ru"?"+ В БИБЛИОТЕКУ":"+ LIBRERIA")}
            </button>
          </div>
          <button onClick={onClose} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.muted,cursor:"pointer",fontFamily:MONO,fontSize:10,padding:"6px 10px",flexShrink:0,alignSelf:"flex-start"}}>ESC</button>
        </div>

        {/* ── TABS ── */}
        <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,flexShrink:0,overflowX:"auto",scrollbarWidth:"none"}}>
          {TABS.map(tb=>(
            <button key={tb.id} onClick={()=>setTab(tb.id)} style={{flexShrink:0,padding:"10px 14px",border:"none",cursor:"pointer",background:"transparent",fontFamily:MONO,fontSize:9,letterSpacing:1.5,color:tab===tb.id?C.accent:C.dim,borderBottom:tab===tb.id?`2px solid ${C.accent}`:"2px solid transparent",transition:"all .15s"}}>
              {tb.label}
            </button>
          ))}
        </div>

        {/* ── BODY ── */}
        <div style={{flex:1,overflowY:"auto",padding:"20px",scrollbarWidth:"none"}}>
          {loading&&<div style={{padding:"50px 0",textAlign:"center"}}><div style={{fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.muted,animation:"pulse 1.5s infinite"}}>{t.detail_loading} {item.title}...<br/><span style={{color:C.dim,display:"block",marginTop:8,fontSize:9}}>{t.detail_loading2}</span></div></div>}
          {err&&<div style={{padding:"40px 0",textAlign:"center"}}><div style={{fontFamily:MONO,fontSize:11,color:C.muted,marginBottom:16}}>{t.detail_err}</div><button onClick={load} style={{fontFamily:MONO,fontSize:10,letterSpacing:2,padding:"8px 20px",border:`1px solid ${C.border}`,background:"transparent",color:C.text,cursor:"pointer"}}>{t.retry}</button></div>}
          {!loading&&!err&&data&&<>
            {tab==="trama"&&<div>
              <p style={{fontFamily:SANS,fontSize:14,lineHeight:1.95,color:C.body,margin:"0 0 20px"}} dangerouslySetInnerHTML={{__html:mdLight(data.trama)}}/>
              {data.origine&&<><Divider label={t.detail_born}/><p style={{fontFamily:SANS,fontSize:13,lineHeight:1.8,color:C.muted,margin:0}}>{data.origine}</p></>}
            </div>}
            {tab==="teorie"&&<div>{(data.teorie||[]).map((th,i)=><div key={i} style={{borderBottom:`1px solid ${C.border}`,paddingBottom:16,marginBottom:16}}><div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.accent,marginBottom:8}}>T{i+1} — {(th.titolo||"").toUpperCase()}</div><p style={{fontFamily:SANS,fontSize:13,lineHeight:1.8,color:C.body,margin:0}}>{th.descrizione}</p></div>)}</div>}
            {tab==="fatti"&&<div>{(data.curiosita||[]).map((c,i)=><div key={i} style={{display:"flex",gap:16,borderBottom:`1px solid ${C.border}`,padding:"12px 0"}}><span style={{fontFamily:MONO,fontSize:10,color:C.dim,minWidth:24,letterSpacing:1}}>{String(i+1).padStart(2,"0")}</span><p style={{fontFamily:SANS,fontSize:13,lineHeight:1.8,color:C.body,margin:0}}>{c}</p></div>)}</div>}
            {tab==="notare"&&<div>{(data.da_notare||[]).map((n,i)=><div key={i} style={{display:"flex",gap:16,borderBottom:`1px solid ${C.border}`,padding:"12px 0"}}><span style={{fontFamily:MONO,fontSize:10,color:C.accent,minWidth:24}}>→</span><p style={{fontFamily:SANS,fontSize:13,lineHeight:1.8,color:C.body,margin:0}}>{n}</p></div>)}</div>}
            {tab==="trailer"&&<div>
              {isEmbed ? (
                <div style={{position:"relative",paddingBottom:"56.25%",height:0,overflow:"hidden",background:C.surface,marginBottom:12}}>
                  <iframe src={trailer} title="trailer" frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{position:"absolute",top:0,left:0,width:"100%",height:"100%"}}/>
                </div>
              ) : trailer ? (
                <div style={{padding:"40px 0",textAlign:"center"}}>
                  <div style={{fontFamily:MONO,fontSize:9,color:C.dim,letterSpacing:2,marginBottom:20}}>PREVIEW NON DISPONIBILE</div>
                  <a href={trailer} target="_blank" rel="noopener noreferrer"
                    style={{fontFamily:MONO,fontSize:10,letterSpacing:2,padding:"12px 24px",border:`1px solid ${C.accent}`,color:C.accent,textDecoration:"none",display:"inline-block"}}>
                    APRI TRAILER SU YOUTUBE →
                  </a>
                </div>
              ) : (
                <div style={{padding:"40px 0",textAlign:"center",fontFamily:MONO,fontSize:10,color:C.dim,letterSpacing:2,animation:"pulse 1s infinite"}}>RICERCA TRAILER...</div>
              )}
            </div>}
            {tab==="gameplay"&&item.type==="gioco"&&<div>
              {data.gameplay_tips?.length>0&&<><div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.green,marginBottom:12}}>{t.detail_tips}</div>{data.gameplay_tips.map((tip,i)=><div key={i} style={{display:"flex",gap:16,borderBottom:`1px solid ${C.border}`,padding:"10px 0"}}><span style={{fontFamily:MONO,fontSize:10,color:C.green,minWidth:20}}>+</span><p style={{fontFamily:SANS,fontSize:13,lineHeight:1.8,color:C.body,margin:0}}>{tip}</p></div>)}</>}
              {data.achievements?.length>0&&<><Divider label={t.detail_ach}/>{data.achievements.map((a,i)=>{const dc={facile:[C.green,"E"],medio:[C.accent,"M"],difficile:[C.red,"H"]};const[col,ch]=dc[a.difficolta]||[C.muted,"?"];return <div key={i} style={{borderBottom:`1px solid ${C.border}`,padding:"10px 0"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontFamily:MONO,fontSize:11,color:C.text}}>{a.nome}</span><span style={{fontFamily:MONO,fontSize:9,color:col,border:`1px solid ${col}`,padding:"1px 6px"}}>{ch}</span></div><p style={{fontFamily:SANS,fontSize:12,color:C.muted,margin:0,lineHeight:1.6}}>{a.come}</p></div>;})}}</> }
            </div>}
          </>}
        </div>
      </div>
    </div>
  );
};

/* ─── MISSION MODE (with save/load) ──────────────────── */
const MissionMode = ({lang,onStatus,savedMissions,onSaveMission,onDeleteMission}) => {
  const t = TR[lang]||TR.it;
  const [phase,setPhase] = useState("menu"); // menu | setup | active
  const [game,setGame]   = useState("");
  const [mission,setMission] = useState("");
  const [steps,setSteps] = useState([]);
  const [busy,setBusy]   = useState(false);
  const [expanded,setExpanded] = useState(null);
  const [missionId,setMissionId] = useState(null);
  const fileRef = useRef();
  const bottomRef = useRef();

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[steps]);

  const startNew = () => { setGame(""); setMission(""); setSteps([]); setMissionId(null); setPhase("setup"); };
  const loadMission = (m) => { setGame(m.game); setMission(m.mission); setSteps(m.steps||[]); setMissionId(m.id); setExpanded(null); setPhase("active"); };

  const upload = async (file) => {
    if (!file||!file.type.startsWith("image/")) return;
    const idx = steps.length;
    const preview = URL.createObjectURL(file);
    const newSteps = [...steps, {img:preview, tip:null, loading:true}];
    setSteps(newSteps); setBusy(true);
    try {
      const b64 = await fileToB64(file);
      const tip = await callClaude({messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:getMime(file),data:b64}},{type:"text",text:MISSION_PROMPT(game,mission,idx,steps.filter(s=>s.tip),lang)}]}],maxTokens:900,onStatus});
      const updated = newSteps.map((st,i)=>i===idx?{...st,tip,loading:false}:st);
      setSteps(updated);
      setExpanded(idx);
      // auto-save mission
      const saved = { id: missionId||Date.now(), game, mission, steps: updated.map(s=>({...s,img:undefined})), updatedAt: Date.now() };
      setMissionId(saved.id);
      onSaveMission(saved);
    } catch(e) {
      setSteps(s=>s.map((st,i)=>i===idx?{...st,tip:t.conn_err,loading:false}:st));
    }
    setBusy(false);
  };

  const onDrop = useCallback(e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) upload(f); },[steps,game,mission,lang]);

  const inp = {background:"transparent",border:`1px solid ${C.border}`,padding:"10px 12px",color:C.text,fontSize:14,fontFamily:SANS,outline:"none",width:"100%",boxSizing:"border-box",letterSpacing:.2};

  if (phase==="menu") return (
    <div>
      <div style={{fontFamily:MONO,fontSize:11,letterSpacing:3,color:C.accent,marginBottom:16}}>{t.miss_title}</div>
      <button onClick={startNew} style={{width:"100%",background:C.accent,border:"none",padding:"12px",fontFamily:MONO,fontSize:10,letterSpacing:3,color:C.bg,cursor:"pointer",marginBottom:20}}>+ {t.miss_new}</button>
      {savedMissions.length>0&&<>
        <div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim,marginBottom:12}}>{t.miss_history} · {savedMissions.length} {t.miss_saved}</div>
        {savedMissions.slice().sort((a,b)=>b.updatedAt-a.updatedAt).map(m=>(
          <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,borderBottom:`1px solid ${C.border}`,padding:"10px 0"}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.green,letterSpacing:1,marginBottom:3}}>{m.game.toUpperCase()}</div>
              <div style={{fontFamily:SANS,fontSize:13,color:C.text}}>{m.mission}</div>
              <div style={{fontFamily:MONO,fontSize:8,color:C.dim,marginTop:3,letterSpacing:1}}>{(m.steps||[]).length} {t.miss_steps} · {new Date(m.updatedAt).toLocaleDateString()}</div>
            </div>
            <button onClick={()=>loadMission(m)} style={{fontFamily:MONO,fontSize:9,letterSpacing:1.5,padding:"5px 10px",border:`1px solid ${C.accent}`,background:"transparent",color:C.accent,cursor:"pointer"}}>{t.miss_load}</button>
            <button onClick={()=>onDeleteMission(m.id)} style={{fontFamily:MONO,fontSize:9,padding:"5px 8px",border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer"}}>×</button>
          </div>
        ))}
      </>}
    </div>
  );

  if (phase==="setup") return (
    <div>
      <div style={{fontFamily:MONO,fontSize:11,letterSpacing:3,color:C.accent,marginBottom:8}}>{t.miss_title}</div>
      <p style={{fontFamily:SANS,fontSize:13,color:C.muted,marginBottom:20,lineHeight:1.7}}>{t.miss_desc}</p>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        <input value={game} onChange={e=>setGame(e.target.value)} placeholder={t.miss_game_ph} style={inp}/>
        <input value={mission} onChange={e=>setMission(e.target.value)} placeholder={t.miss_name_ph} style={inp} onKeyDown={e=>{if(e.key==="Enter"&&game.trim()&&mission.trim())setPhase("active");}}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>setPhase("menu")} style={{padding:"11px 16px",border:`1px solid ${C.border}`,background:"transparent",fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.muted,cursor:"pointer"}}>←</button>
        <button onClick={()=>{if(game.trim()&&mission.trim())setPhase("active");}} disabled={!game.trim()||!mission.trim()}
          style={{flex:1,background:game.trim()&&mission.trim()?C.accent:"transparent",border:`1px solid ${game.trim()&&mission.trim()?C.accent:C.border}`,color:game.trim()&&mission.trim()?C.bg:C.dim,fontFamily:MONO,fontSize:10,letterSpacing:3,padding:"11px",cursor:game.trim()&&mission.trim()?"pointer":"not-allowed",transition:"all .2s"}}>
          {t.miss_start}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{borderBottom:`1px solid ${C.border}`,paddingBottom:10,marginBottom:10,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.green}}>{game.toUpperCase()}</div>
            <div style={{fontFamily:SANS,fontSize:15,fontWeight:700,color:C.text,marginTop:2}}>{mission}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontFamily:MONO,fontSize:11,color:C.accent}}>{steps.length}<span style={{fontSize:8,color:C.dim,marginLeft:4}}>{t.miss_steps}</span></span>
            <button onClick={()=>setPhase("menu")} style={{fontFamily:MONO,fontSize:9,letterSpacing:1.5,padding:"5px 10px",border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer"}}>{t.miss_reset}</button>
          </div>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none",paddingBottom:8}}>
        {steps.length===0&&<div style={{padding:"40px 0",textAlign:"center"}}><div style={{fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.dim}}>{t.miss_upload}</div><div style={{fontFamily:MONO,fontSize:9,color:C.border,marginTop:8,letterSpacing:1}}>{t.miss_hint}</div></div>}
        {steps.map((step,i)=>(
          <div key={i} style={{marginBottom:14,animation:"fadeIn .3s"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <span style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:step.loading?C.dim:C.accent}}>{t.miss_step} {String(i+1).padStart(2,"0")}</span>
              <div style={{flex:1,height:1,background:C.border}}/>
            </div>
            <div style={{position:"relative",marginBottom:6,cursor:"pointer"}} onClick={()=>setExpanded(expanded===i?null:i)}>
              <img src={step.img} alt="" style={{width:"100%",display:"block",maxHeight:170,objectFit:"cover",filter:step.loading?"blur(4px) brightness(.3)":"none",transition:"filter .4s"}}/>
              {step.loading&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.accent,animation:"pulse 1s infinite"}}>{t.miss_loading}</span></div>}
              {!step.loading&&<div style={{position:"absolute",top:8,right:8,fontFamily:MONO,fontSize:9,letterSpacing:1.5,padding:"3px 8px",background:C.bg,color:C.accent,border:`1px solid ${C.accent}`}}>{expanded===i?"↑":"↓ "+t.miss_label}</div>}
            </div>
            {!step.loading&&expanded===i&&<div style={{borderLeft:`2px solid ${C.accent}`,paddingLeft:14,animation:"fadeIn .2s"}}><div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.accent,marginBottom:8}}>{t.miss_label}</div><div style={{fontFamily:SANS,fontSize:13,lineHeight:1.8,color:C.body}} dangerouslySetInnerHTML={{__html:mdLight(step.tip)}}/></div>}
            {!step.loading&&expanded!==i&&<div style={{fontFamily:SANS,fontSize:12,color:C.dim,lineHeight:1.5}}>{step.tip?.split("\n")[0]?.substring(0,120)}...</div>}
          </div>
        ))}
        <div ref={bottomRef}/>
      </div>
      <div onDrop={onDrop} onDragOver={e=>e.preventDefault()} onClick={()=>!busy&&fileRef.current.click()}
        style={{borderTop:`1px solid ${busy?C.accent:C.border}`,padding:"14px",textAlign:"center",cursor:busy?"not-allowed":"pointer",transition:"border-color .2s",flexShrink:0}}>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>e.target.files[0]&&upload(e.target.files[0])}/>
        <div style={{fontFamily:MONO,fontSize:10,letterSpacing:2,color:busy?C.accent:C.muted}}>{busy?t.miss_loading:`+ ${t.miss_upload}`}</div>
        {!busy&&<div style={{fontFamily:MONO,fontSize:9,color:C.dim,marginTop:4,letterSpacing:1}}>{t.miss_hint}</div>}
      </div>
    </div>
  );
};

/* ─── FILM SCAN ──────────────────────────────────────── */
const FilmScan = ({lang,onStatus}) => {
  const t = TR[lang]||TR.it;
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [preview,setPreview]=useState(null);
  const [err,setErr]=useState(false);
  const fileRef=useRef();

  const handle = async (file) => {
    if (!file||!file.type.startsWith("image/")) return;
    setPreview(URL.createObjectURL(file)); setResult(null); setErr(false); setLoading(true);
    try { const b64=await fileToB64(file); const raw=await callClaude({messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:getMime(file),data:b64}},{type:"text",text:SCAN_PROMPT(lang)}]}],withSearch:true,maxTokens:1100,onStatus}); setResult(raw); }
    catch { setErr(true); }
    setLoading(false);
  };
  const onDrop = useCallback(e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) handle(f); },[lang]);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{fontFamily:MONO,fontSize:11,letterSpacing:3,color:C.accent,marginBottom:8}}>{t.scan_title}</div>
      <p style={{fontFamily:SANS,fontSize:13,color:C.muted,marginBottom:16,lineHeight:1.7}}>{t.scan_desc}</p>
      <div onDrop={onDrop} onDragOver={e=>e.preventDefault()} onClick={()=>!loading&&fileRef.current.click()}
        style={{border:`1px solid ${loading?C.accent:preview?C.border:C.borderHi}`,position:"relative",minHeight:150,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:loading?"wait":"pointer",marginBottom:16,overflow:"hidden",transition:"border-color .2s",flexShrink:0}}>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>e.target.files[0]&&handle(e.target.files[0])}/>
        {preview&&<img src={preview} alt="" style={{width:"100%",display:"block",maxHeight:220,objectFit:"cover",filter:loading?"blur(6px) brightness(.2)":"none",transition:"filter .3s"}}/>}
        {loading&&<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}><div style={{fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.accent,animation:"pulse 1s infinite"}}>{t.scan_loading}</div><div style={{fontFamily:MONO,fontSize:9,color:C.dim,letterSpacing:1}}>{t.scan_searching}</div></div>}
        {!preview&&!loading&&<><div style={{fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.muted}}>+ {t.scan_drop}</div><div style={{fontFamily:MONO,fontSize:9,color:C.dim,marginTop:8,letterSpacing:1}}>{t.scan_hint}</div></>}
        {preview&&!loading&&<div style={{position:"absolute",bottom:0,right:0}} onClick={e=>{e.stopPropagation();fileRef.current.click();}}><div style={{fontFamily:MONO,fontSize:9,letterSpacing:1.5,padding:"6px 12px",background:C.bg,color:C.accent,border:`1px solid ${C.accent}`,cursor:"pointer"}}>{t.scan_new}</div></div>}
      </div>
      {err&&<div style={{textAlign:"center",padding:"20px 0"}}><div style={{fontFamily:MONO,fontSize:10,color:C.muted,marginBottom:12,letterSpacing:1}}>{t.scan_err}</div><button onClick={()=>fileRef.current.click()} style={{fontFamily:MONO,fontSize:10,letterSpacing:2,padding:"8px 20px",border:`1px solid ${C.border}`,background:"transparent",color:C.text,cursor:"pointer"}}>{t.retry}</button></div>}
      {result&&!loading&&<div style={{overflowY:"auto",scrollbarWidth:"none",paddingBottom:20,animation:"fadeIn .3s"}}><div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.accent,marginBottom:12}}>{t.scan_label}</div><div style={{fontFamily:SANS,fontSize:13,lineHeight:1.9,color:C.body}} dangerouslySetInnerHTML={{__html:mdLight(result)}}/></div>}
    </div>
  );
};

/* ─── STATS ──────────────────────────────────────────── */
const StatsView = ({library,lang}) => {
  const t=TR[lang]||TR.it;
  const total=library.length, finished=library.filter(i=>i.status==="finito").length;
  const inProg=library.filter(i=>i.status==="in corso").length, aband=library.filter(i=>i.status==="abbandonato").length;
  const hours=library.reduce((a,i)=>a+(i.hours||0),0);
  const byType={film:0,serie:0,gioco:0}; const genres={};
  library.forEach(i=>{if(byType[i.type]!==undefined)byType[i.type]++;if(i.genre)genres[i.genre]=(genres[i.genre]||0)+1;});
  const topG=Object.entries(genres).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const avg=(()=>{const r=library.filter(i=>i.rating);return r.length?(r.reduce((a,i)=>a+Number(i.rating),0)/r.length).toFixed(1):null;})();
  const Bar=({pct,color})=><div style={{background:C.border,height:1,flex:1,position:"relative"}}><div style={{position:"absolute",left:0,top:0,height:"100%",width:`${pct}%`,background:color,transition:"width .6s ease"}}/></div>;
  const Stat=({label,value,color=C.accent})=><div style={{borderRight:`1px solid ${C.border}`,padding:"16px 20px",flex:1}}><div style={{fontFamily:MONO,fontSize:28,fontWeight:700,color,letterSpacing:-1,lineHeight:1}}>{value||"—"}</div><div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim,marginTop:6}}>{label}</div></div>;
  return(
    <div style={{overflowY:"auto",maxHeight:"65vh",scrollbarWidth:"none"}}>
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,marginBottom:0}}>
        <Stat label={t.stat_total} value={total}/><Stat label={t.stat_done} value={finished} color={C.green}/>
        <Stat label={t.stat_hours} value={hours?`${hours}h`:null} color={C.blue}/>
        <div style={{padding:"16px 20px",flex:1}}><div style={{fontFamily:MONO,fontSize:28,fontWeight:700,color:C.accent,letterSpacing:-1,lineHeight:1}}>{avg||"—"}</div><div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim,marginTop:6}}>{t.stat_avg}</div></div>
      </div>
      <div style={{borderBottom:`1px solid ${C.border}`,padding:"16px 0"}}>
        <div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim,marginBottom:14}}>{t.stat_by_type}</div>
        {Object.entries(byType).map(([tp,c])=>{const pct=total?Math.round(c/total*100):0;return <div key={tp} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}><span style={{fontFamily:MONO,fontSize:10,color:TYPE_COL[tp],width:12}}>{TYPE_CHAR[tp]}</span><span style={{fontFamily:MONO,fontSize:9,letterSpacing:1,color:C.muted,width:40,textTransform:"uppercase"}}>{tp}</span><Bar pct={pct} color={TYPE_COL[tp]}/><span style={{fontFamily:MONO,fontSize:10,color:C.dim,width:30,textAlign:"right"}}>{c}</span></div>;})}
      </div>
      {topG.length>0&&<div style={{borderBottom:`1px solid ${C.border}`,padding:"16px 0"}}>
        <div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim,marginBottom:14}}>{t.stat_top}</div>
        {topG.map(([g,c],i)=><div key={g} style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}><span style={{fontFamily:MONO,fontSize:9,color:C.dim,width:16}}>#{i+1}</span><span style={{fontFamily:MONO,fontSize:9,letterSpacing:1,color:C.muted,flex:1,textTransform:"uppercase"}}>{g}</span><Bar pct={total?Math.round(c/total*100):0} color={C.accent}/><span style={{fontFamily:MONO,fontSize:10,color:C.accent,width:20,textAlign:"right"}}>{c}</span></div>)}
      </div>}
      <div style={{padding:"16px 0"}}>
        <div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim,marginBottom:14}}>{t.stat_status}</div>
        <div style={{display:"flex",gap:0,border:`1px solid ${C.border}`}}>
          {[[t.stat_fin,finished,C.green],[t.stat_prog,inProg,C.accent],[t.stat_aband,aband,C.dim]].map(([l,v,color],i)=><div key={l} style={{flex:1,padding:"12px",borderRight:i<2?`1px solid ${C.border}`:"none",textAlign:"center"}}><div style={{fontFamily:MONO,fontSize:20,color,fontWeight:700}}>{v}</div><div style={{fontFamily:MONO,fontSize:8,color:C.dim,marginTop:4,letterSpacing:1.5}}>{l}</div></div>)}
        </div>
      </div>
    </div>
  );
};

/* ─── API KEY SETUP SCREEN ───────────────────────────── */
/* ─── AUTH ───────────────────────────────────────────── */
const APP_PASSWORD = "Pipiski66";

const LockScreen = ({ onUnlock }) => {
  const [phase, setPhase] = useState("password"); // password | choose
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [shake, setShake] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef();

  useEffect(()=>{ setTimeout(()=>inputRef.current?.focus(),100); },[phase]);

  const submitPwd = (e) => {
    e.preventDefault();
    if (pwd === APP_PASSWORD) { setErr(""); setPhase("choose"); }
    else {
      setShake(true); setErr("Password errata"); setPwd("");
      setTimeout(()=>{ setShake(false); setErr(""); },1200);
    }
  };

  if (phase === "password") return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 24px"}}>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,letterSpacing:4,color:C.text,marginBottom:4}}>REELBOT</div>
      <div style={{fontFamily:MONO,fontSize:8,letterSpacing:2,color:C.dim,marginBottom:48}}>v4</div>
      <form onSubmit={submitPwd} style={{width:"100%",maxWidth:300,animation:shake?"shake .4s ease":"none"}}>
        <div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim,marginBottom:8}}>PASSWORD</div>
        <div style={{position:"relative",marginBottom:10}}>
          <input
            ref={inputRef}
            type={show?"text":"password"}
            value={pwd}
            onChange={e=>setPwd(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            style={{width:"100%",boxSizing:"border-box",background:"transparent",border:`1px solid ${err?C.red:C.border}`,padding:"11px 40px 11px 14px",color:C.text,fontFamily:MONO,fontSize:14,outline:"none",letterSpacing:2}}
          />
          <button type="button" onClick={()=>setShow(s=>!s)}
            style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:C.dim,cursor:"pointer",fontFamily:MONO,fontSize:9,letterSpacing:1}}>
            {show?"HIDE":"SHOW"}
          </button>
        </div>
        {err&&<div style={{fontFamily:MONO,fontSize:9,color:C.red,letterSpacing:1,marginBottom:10}}>{err}</div>}
        <button type="submit"
          style={{width:"100%",background:pwd?C.accent:"transparent",border:`1px solid ${pwd?C.accent:C.border}`,color:pwd?C.bg:C.dim,fontFamily:MONO,fontSize:10,letterSpacing:3,padding:"12px",cursor:pwd?"pointer":"default",transition:"all .2s"}}>
          ENTRA
        </button>
      </form>
    </div>
  );

  return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,letterSpacing:4,color:C.text,marginBottom:4}}>REELBOT</div>
      <div style={{fontFamily:MONO,fontSize:8,letterSpacing:2,color:C.dim,marginBottom:48}}>Chi sei?</div>
      <div style={{display:"flex",flexDirection:"column",gap:10,width:240}}>
        {[["tu","ADAM",C.accent],["lei","KIRA",C.blue]].map(([who,name,col])=>(
          <button key={who} onClick={()=>onUnlock(who)}
            style={{padding:"18px",border:`1px solid ${C.border}`,background:"transparent",fontFamily:MONO,fontSize:14,letterSpacing:4,color:C.text,cursor:"pointer",transition:"all .18s",textAlign:"center"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=col;e.currentTarget.style.color=col;e.currentTarget.style.background=col+"11";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.text;e.currentTarget.style.background="transparent";}}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
};

/* ─── MAIN APP ───────────────────────────────────────── */
export default function ReelBot() {
  const [profiles,setProfiles]   = useState(DEF_PROF);
  const [active,setActive]       = useState("tu");
  const [tab,setTab]             = useState("chat");
  const [visionMode,setVisionMode] = useState("mission");
  const [mood,setMood]           = useState(null);
  // Per-profile chat histories
  const [chats,setChats]         = useState({ tu:null, lei:null });
  const [input,setInput]         = useState("");
  const [chatLoading,setChatLoading] = useState(false);
  const [selected,setSelected]   = useState(null);
  const [libFilter,setLibFilter] = useState({type:"all",profile:"all"});
  const [wishFilter,setWishFilter] = useState("all");
  const [notif,setNotif]         = useState(null);
  const [apiStatus,setApiStatus] = useState("idle");
  const [missions,setMissions]   = useState([]);
  const [authed,setAuthed]       = useState(null);
  const [isDesktop,setIsDesktop] = useState(window.innerWidth >= 900);
  const [desktopRight,setDesktopRight] = useState("chat");
  const endRef   = useRef(null);
  const inputRef = useRef(null);
  const ready    = useRef(false);

  // Convenience: current profile's messages
  const messages = chats[active] || null;
  const setMessages = (val) => setChats(prev => ({
    ...prev,
    [active]: typeof val === "function" ? val(prev[active]) : val,
  }));
  const chatKey = (who) => who==="tu" ? SK.chat_adam : SK.chat_kira;

  const lang = LANG_CFG[active].code;
  const t    = TR[lang];

  /* ── BOOT ── */
  useEffect(()=>{
    const link=document.createElement("link"); link.href=FONT_URL; link.rel="stylesheet"; document.head.appendChild(link);
    if (!ready.current) { bootLoad(); ready.current=true; }
  },[]);

  /* ── RESIZE ── */
  useEffect(()=>{
    const handler = () => setIsDesktop(window.innerWidth >= 900);
    window.addEventListener("resize", handler);
    return ()=>window.removeEventListener("resize", handler);
  },[]);

  const bootLoad = async () => {
    const [prof, chatA, chatK, miss] = await Promise.all([
      stGet(SK.profiles), stGet(SK.chat_adam), stGet(SK.chat_kira), stGet(SK.missions)
    ]);
    if (prof) setProfiles(p=>({...DEF_PROF,...prof,tu:{...DEF_PROF.tu,...prof.tu,prefs:{...DEF_PREFS,...(prof.tu?.prefs||{})}},lei:{...DEF_PROF.lei,...prof.lei,prefs:{...DEF_PREFS,...(prof.lei?.prefs||{})}}}));
    setChats({
      tu:  chatA?.length ? chatA : [{role:"assistant",content:WELCOME.tu}],
      lei: chatK?.length ? chatK : [{role:"assistant",content:WELCOME.lei}],
    });
    if (miss) setMissions(miss);
    setAuthed(false);
  };

  const handleUnlock = (who) => {
    setActive(who);
    setAuthed(who);
    setInput("");
  };

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[chats, active, chatLoading]);

  const notify = (msg) => { setNotif(msg); setTimeout(()=>setNotif(null),3000); };

  /* ── PROFILE SAVE ── */
  const savePrefs = (who, prefs) => {
    setProfiles(prev=>{ const next={...prev,[who]:{...prev[who],prefs}}; stSet(SK.profiles,next); return next; });
    notify(t.prof_saved);
  };

  /* ── LIB HELPERS ── */
  const allLib = () => {
    const map={};
    ["tu","lei"].forEach(p=>profiles[p].library.forEach(i=>{ if(!map[i.title])map[i.title]={...i,profileLabel:p}; else if(map[i.title].profileLabel!==p)map[i.title].profileLabel="entrambi"; }));
    return Object.values(map);
  };
  const allWish = () => {
    const map={};
    ["tu","lei"].forEach(p=>profiles[p].wishlist.forEach(i=>{ if(!map[i.title])map[i.title]={...i,profileLabel:p}; else if(map[i.title].profileLabel!==p)map[i.title].profileLabel="entrambi"; }));
    return Object.values(map);
  };

  const applyAction = (action) => {
    if (!action) return;
    setProfiles(prev=>{
      const next=JSON.parse(JSON.stringify(prev));
      const targets=action.profile==="entrambi"?["tu","lei"]:[action.profile||active];
      if (action.op==="add") {
        const dest=action.dest||"library";
        targets.forEach(tgt=>{ if(!next[tgt])return; const arr=next[tgt][dest]; const idx=arr.findIndex(i=>i.title.toLowerCase()===action.title.toLowerCase()); const item={...action,profile:tgt,addedAt:new Date().toISOString()}; if(idx>=0)arr[idx]={...arr[idx],...item};else arr.push(item); });
        notify(t.added(action.title));
        // Pre-fetch detail in background for instant load next time
        if (action.dest==="library"||!action.dest) {
          const title = action.title;
          getDetailCache(title).then(cached=>{
            if (!cached) {
              callClaude({messages:[{role:"user",content:DETAIL_PROMPT(title,action.type||"film",lang)}],withSearch:false,maxTokens:1800}).then(raw=>{
                try {
                  const s=(raw||"").replace(/```json|```/g,"").trim();
                  const start=s.indexOf("{"); const end=s.lastIndexOf("}");
                  if(start!==-1&&end>start) setDetailCache(title,JSON.parse(s.substring(start,end+1)));
                } catch {}
              }).catch(()=>{});
            }
          });
        }
      } else if (action.op==="remove") {
        const dest=action.dest||"library";
        ["tu","lei"].forEach(tgt=>{next[tgt][dest]=next[tgt][dest].filter(i=>i.title.toLowerCase()!==action.title.toLowerCase());});
        notify(t.removed(action.title));
      }
      stSet(SK.profiles, next); return next;
    });
  };

  /* ── MISSIONS ── */
  const saveMission = (m) => {
    setMissions(prev=>{ const next=[...prev.filter(x=>x.id!==m.id),m]; stSet(SK.missions,next); return next; });
  };
  const deleteMission = (id) => {
    setMissions(prev=>{ const next=prev.filter(x=>x.id!==id); stSet(SK.missions,next); return next; });
  };

  /* ── CHAT ── */
  const send = async () => {
    if (!input.trim()||chatLoading) return;
    const msg={role:"user",content:input};
    const next=[...(messages||[]),msg];
    setChats(prev=>({...prev,[active]:next}));
    setInput(""); setChatLoading(true);
    try {
      const raw = await callClaude({
        system:CHAT_SYS(lang,profiles,mood,active,t.moods),
        messages:next.map(m=>({role:m.role,content:m.content})),
        withSearch:true, maxTokens:1000, onStatus:setApiStatus,
      });
      const {clean,actions}=parseReel(raw||t.conn_fail);
      actions.forEach(action=>applyAction(action));
      const final=[...next,{role:"assistant",content:clean}];
      setChats(prev=>({...prev,[active]:final}));
      stSet(chatKey(active), final.slice(-MAX_CHAT_STORED));
    } catch {
      const final=[...next,{role:"assistant",content:t.conn_fail}];
      setChats(prev=>({...prev,[active]:final}));
      stSet(chatKey(active), final.slice(-MAX_CHAT_STORED));
    }
    setChatLoading(false);
    setTimeout(()=>inputRef.current?.focus(),100);
  };

  const clearChat = () => {
    const fresh=[{role:"assistant",content:WELCOME[active]}];
    setChats(prev=>({...prev,[active]:fresh}));
    stSet(chatKey(active), fresh);
    notify(t.chat_cleared);
  };

  const lib=allLib(), wish=allWish();
  const filtLib=lib.filter(i=>{ if(libFilter.type!=="all"&&i.type!==libFilter.type)return false; if(libFilter.profile!=="all"&&i.profileLabel!==libFilter.profile)return false; return true; });
  const filtWish=wish.filter(i=>wishFilter==="all"||i.type===wishFilter);

  const TABS=[
    {id:"chat",     label:t.tab_chat},
    {id:"libreria", label:`${t.tab_lib}${lib.length>0?" · "+lib.length:""}`},
    {id:"wishlist", label:`${t.tab_wish}${wish.length>0?" · "+wish.length:""}`},
    {id:"vision",   label:t.tab_vision},
    {id:"stats",    label:t.tab_stats},
    {id:"profile",  label:t.tab_profile},
  ];

  const tabBtn=(id,label)=>(
    <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:"9px 4px",border:"none",cursor:"pointer",background:"transparent",fontFamily:MONO,fontSize:9,letterSpacing:1.5,color:tab===id?C.accent:C.dim,borderBottom:tab===id?`1px solid ${C.accent}`:"1px solid transparent",transition:"all .15s",userSelect:"none"}}>{label}</button>
  );

  // ── AUTH GATE ──
  if (authed === null) return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <span style={{fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.dim,animation:"pulse 1s infinite"}}>...</span>
    </div>
  );
  if (!authed) return <LockScreen onUnlock={handleUnlock}/>;

  // ── SHARED CONTENT PANELS ──

  // ChatMessage — Apple-style bubbles, film rows with poster RIGHT
  const ChatMessage = ({m, onItemClick}) => {
    const [posters,setPosters] = useState({});
    const isUser = m.role==="user";

    // In-memory poster cache for speed (shared across messages)
    const guessType = (title, content) => {
      const lower = (content||"").toLowerCase();
      if (lower.includes("gioco") || lower.includes("game") || lower.includes("videogioco") || lower.includes("игр")) return "gioco";
      if (lower.includes("serie") || lower.includes("сериал")) return "serie";
      return "film";
    };

    // Parse rows — handles ALL bot formats:
    // "- **Title (2012)** - desc", "📽️ **Title** desc", "**Title** - desc", etc.
    const parseRows = (content) => {
      const rows = [];
      (content||"").split("\n").forEach(line => {
        // Skip obvious category headers (e.g. "**PER TE DA SOLO:**")
        const headerCheck = line.match(/^\*\*([^*]+)\*\*\s*[:\-]?\s*$/);
        if (headerCheck && headerCheck[1].trim().length < 50) return;
        // Match any line containing **Title** with or without prefix
        const match = line.match(/^[^*]*\*\*([^*]{2,80})\*\*\s*[-–]?\s*(.*)/);
        if (!match) return;
        const fullTitle = match[1].trim();
        const desc = match[2].trim();
        const cleanedTitle = fullTitle
          .replace(/\s*\(\d{4}\)\s*$/,"")
          .replace(/\s*[-–]\s*\d{4}$/,"")
          .trim();
        if (cleanedTitle.length < 2) return;
        rows.push({ raw: line, title: cleanedTitle, fullTitle, desc, type: guessType(fullTitle, content) });
      });
      return rows;
    };

    const rows = isUser ? [] : parseRows(m.content);

    useEffect(()=>{
      if (isUser || rows.length===0) return;
      rows.forEach(({title, type})=>{
        // Check in-memory cache first
        if (window._posterCache?.[title]) {
          setPosters(p=>({...p,[title]:window._posterCache[title]}));
          return;
        }
        fetchPoster(title, type).then(url=>{
          if (url) {
            window._posterCache = window._posterCache||{};
            window._posterCache[title] = url;
            setPosters(p=>({...p,[title]:url}));
            return;
          }
          // Fallback: try serie then film
          const fallback = type==="gioco"?"film":type==="film"?"serie":"film";
          fetchPoster(title, fallback).then(u=>{
            if(u) {
              window._posterCache = window._posterCache||{};
              window._posterCache[title] = u;
              setPosters(p=>({...p,[title]:u}));
            }
          });
        });
      });
    },[m.content]);

    const renderContent = () => {
      if (rows.length===0) return (
        <div style={{padding:"12px 16px",color:isUser?C.bg:C.body,fontFamily:SANS,fontSize:14,lineHeight:1.72,letterSpacing:.1}}
          dangerouslySetInnerHTML={{__html:mdLight(m.content)}}/>
      );
      // Split into text + film segments
      const segments = [];
      let remaining = m.content;
      rows.forEach(row=>{
        const idx = remaining.indexOf(row.raw);
        if (idx>0) segments.push({type:"text",content:remaining.substring(0,idx)});
        segments.push({type:"item",...row});
        remaining = remaining.substring(idx+row.raw.length);
      });
      if (remaining.trim()) segments.push({type:"text",content:remaining});

      return segments.map((seg,i)=>{
        if (seg.type==="text") {
          const clean=seg.content.trim(); if(!clean) return null;
          return <div key={i} style={{padding:"10px 16px",color:C.body,fontFamily:SANS,fontSize:14,lineHeight:1.72,letterSpacing:.1}}
            dangerouslySetInnerHTML={{__html:mdLight(clean)}}/>;
        }
        const poster=posters[seg.title];
        return (
          <div key={i} onClick={()=>onItemClick({title:seg.title,type:seg.type_==="gioco"?"gioco":"film",genre:""})}
            style={{display:"flex",alignItems:"stretch",gap:0,cursor:"pointer",borderTop:`1px solid rgba(255,255,255,.06)`,transition:"background .15s",minHeight:90}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(200,255,0,.06)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            {/* Text LEFT */}
            <div style={{flex:1,padding:"12px 14px 12px 16px",minWidth:0,display:"flex",flexDirection:"column",justifyContent:"center"}}>
              <div style={{fontFamily:SANS,fontSize:14,fontWeight:700,color:C.text,marginBottom:4,letterSpacing:-.1,lineHeight:1.2}}>{seg.fullTitle}</div>
              {seg.desc&&<div style={{fontFamily:SANS,fontSize:12,color:C.muted,lineHeight:1.65,display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}
                dangerouslySetInnerHTML={{__html:mdLight(seg.desc)}}/>}
              <div style={{fontFamily:MONO,fontSize:9,color:C.accent,marginTop:6,letterSpacing:1}}>TAP →</div>
            </div>
            {/* Poster RIGHT */}
            <div style={{width:70,flexShrink:0,borderRadius:"0 0 0 0",overflow:"hidden",background:C.border,position:"relative"}}>
              {poster
                ? <img src={poster} alt={seg.title} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                : <div style={{width:"100%",height:"100%",minHeight:90,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:MONO,fontSize:14,color:C.dim}}>{seg.type==="gioco"?"G":"F"}</div>
              }
            </div>
          </div>
        );
      });
    };

    // Apple-style bubble radii
    const br = isUser
      ? "18px 18px 4px 18px"
      : "18px 18px 18px 4px";

    return (
      <div style={{alignSelf:isUser?"flex-end":"flex-start",maxWidth:"88%",marginBottom:8,animation:"fadeIn .2s"}}>
        <div style={{background:isUser?"#1a8cff":C.surface,borderRadius:br,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,.3)"}}>
          {isUser
            ? <div style={{padding:"11px 16px",color:"#fff",fontFamily:SANS,fontSize:14,lineHeight:1.7}}
                dangerouslySetInnerHTML={{__html:mdLight(m.content)}}/>
            : renderContent()
          }
        </div>
      </div>
    );
  };

  const ChatPanel = ({maxH}) => (
    <>
      <MoodSelector selected={mood} onSelect={setMood} t={t}/>
      <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4,padding:"8px 4px 10px",flex:1,maxHeight:maxH||undefined,scrollbarWidth:"none"}}>
        {(messages||[]).map((m,i)=>(
          <ChatMessage key={i} m={m} onItemClick={setSelected}/>
        ))}
        {chatLoading&&(
          <div style={{alignSelf:"flex-start",background:C.surface,borderRadius:"18px 18px 18px 4px",padding:"12px 18px",boxShadow:"0 1px 6px rgba(0,0,0,.3)"}}>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:C.accent,animation:`pulse 1s infinite`,animationDelay:`${i*0.2}s`}}/>)}
            </div>
          </div>
        )}
        <div ref={endRef}/>
      </div>
      <div style={{padding:"10px 0 14px",display:"flex",gap:8,alignItems:"flex-end",borderTop:`1px solid ${C.border}`,flexShrink:0}}>
        <textarea ref={inputRef} rows={isDesktop?3:1} value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder={t.chat_ph}
          style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:"10px 14px",color:C.text,fontSize:14,fontFamily:SANS,resize:"none",letterSpacing:.2,lineHeight:1.5}}/>
        <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0,alignSelf:"stretch"}}>
          <button onClick={send} disabled={chatLoading} style={{flex:1,background:chatLoading?"transparent":C.accent,border:`1px solid ${chatLoading?C.border:C.accent}`,borderRadius:10,color:chatLoading?C.dim:C.bg,fontFamily:MONO,fontSize:10,letterSpacing:2,padding:"0 16px",cursor:chatLoading?"not-allowed":"pointer",transition:"all .15s",display:"flex",alignItems:"center",justifyContent:"center"}}>GO</button>
          <button onClick={clearChat} title={t.chat_clear} style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:8,color:C.dim,fontFamily:MONO,fontSize:9,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",letterSpacing:1}}>CLR</button>
        </div>
      </div>
    </>
  );

  const LibPanel = () => (
    <>
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
        {["all","film","serie","gioco"].map(f=><Tag key={f} active={libFilter.type===f} color={f!=="all"?TYPE_COL[f]:undefined} onClick={()=>setLibFilter(p=>({...p,type:f}))}>{f==="all"?t.all:f.toUpperCase()}</Tag>)}
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          {["all","tu","lei","entrambi"].map(p=><Tag key={p} active={libFilter.profile===p} onClick={()=>setLibFilter(prev=>({...prev,profile:p}))}>{p==="all"?"T+L":p==="tu"?"T":p==="lei"?"L":"T+L"}</Tag>)}
        </div>
      </div>
      {filtLib.length===0
        ?<div style={{padding:"40px 0",fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.dim,lineHeight:2,whiteSpace:"pre-line"}}>{lib.length===0?t.lib_empty:t.lib_no_filter}</div>
        :<div style={{overflowY:"auto",flex:1,scrollbarWidth:"none",borderTop:`1px solid ${C.border}`}}>{filtLib.map((item,i)=><LibRow key={i} item={item} onClick={setSelected}/>)}</div>}
    </>
  );

  const WishPanel = () => (
    <>
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {["all","film","serie","gioco"].map(f=><Tag key={f} active={wishFilter===f} color={f!=="all"?TYPE_COL[f]:undefined} onClick={()=>setWishFilter(f)}>{f==="all"?t.all:f.toUpperCase()}</Tag>)}
      </div>
      {filtWish.length===0
        ?<div style={{padding:"40px 0",fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.dim,lineHeight:2,whiteSpace:"pre-line"}}>{t.wish_empty}</div>
        :<div style={{overflowY:"auto",flex:1,scrollbarWidth:"none",borderTop:`1px solid ${C.border}`}}>
          {filtWish.map((item,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:TYPE_COL[item.type]||C.muted,width:14}}>{TYPE_CHAR[item.type]}</span>
              <span style={{fontFamily:SANS,fontSize:14,fontWeight:500,flex:1,letterSpacing:.1}}>{item.title}</span>
              {item.genre&&<span style={{fontFamily:MONO,fontSize:9,color:C.dim,letterSpacing:1}}>{item.genre.toUpperCase()}</span>}
              <span style={{fontFamily:MONO,fontSize:9,color:C.dim}}>{item.profileLabel==="entrambi"?"T+L":item.profileLabel==="tu"?"T":"L"}</span>
              <button onClick={()=>{setProfiles(prev=>{const next=JSON.parse(JSON.stringify(prev));const targets=item.profileLabel==="entrambi"?["tu","lei"]:[item.profileLabel||"tu"];targets.forEach(tgt=>{next[tgt].wishlist=next[tgt].wishlist.filter(x=>x.title!==item.title);if(!next[tgt].library.find(x=>x.title===item.title))next[tgt].library.push({...item,profile:tgt,status:"finito",addedAt:new Date().toISOString()});});stSet(SK.profiles,next);return next;});notify(t.wish_moved(item.title));}} style={{fontFamily:MONO,fontSize:9,letterSpacing:1.5,padding:"5px 8px",border:`1px solid ${C.green}`,background:"transparent",color:C.green,cursor:"pointer"}}>{t.wish_mark}</button>
              <button onClick={()=>{setProfiles(prev=>{const next=JSON.parse(JSON.stringify(prev));["tu","lei"].forEach(tgt=>{next[tgt].wishlist=next[tgt].wishlist.filter(x=>x.title!==item.title);});stSet(SK.profiles,next);return next;});notify(t.wish_del_msg(item.title));}} style={{fontFamily:MONO,fontSize:9,padding:"5px 8px",border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer"}}>×</button>
            </div>
          ))}
        </div>}
    </>
  );

  const VisionPanel = () => (
    <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0}}>
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,marginBottom:16,flexShrink:0}}>
        {[["mission",t.vision_miss,C.green],["scan",t.vision_scan,C.accent]].map(([id,label,col])=>(
          <button key={id} onClick={()=>setVisionMode(id)} style={{flex:1,padding:"10px",border:"none",cursor:"pointer",background:"transparent",fontFamily:MONO,fontSize:10,letterSpacing:2,color:visionMode===id?col:C.dim,borderBottom:visionMode===id?`1px solid ${col}`:"1px solid transparent",transition:"all .15s"}}>{label}</button>
        ))}
      </div>
      <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none"}}>
        {visionMode==="mission"&&<MissionMode lang={lang} onStatus={setApiStatus} savedMissions={missions} onSaveMission={saveMission} onDeleteMission={deleteMission}/>}
        {visionMode==="scan"&&<FilmScan lang={lang} onStatus={setApiStatus}/>}
      </div>
    </div>
  );

  const renderPanel = (id) => {
    if (id==="chat")     return <ChatPanel/>;
    if (id==="libreria") return <LibPanel/>;
    if (id==="wishlist") return <WishPanel/>;
    if (id==="vision")   return <VisionPanel/>;
    if (id==="stats")    return <StatsView library={lib} lang={lang}/>;
    if (id==="profile")  return <ProfileEditor profiles={profiles} active={active} onSave={savePrefs} t={t}/>;
    return null;
  };

  // ── HEADER (shared) ──
  const activeColor = active==="tu" ? C.accent : C.blue;
  const activeName  = active==="tu" ? "ADAM" : "KIRA";
  const Header = () => (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
      <div style={{display:"flex",alignItems:"baseline",gap:10}}>
        <span style={{fontFamily:MONO,fontSize:14,fontWeight:700,letterSpacing:3,color:C.text}}>REELBOT</span>
        <span style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim}}>v4</span>
        <ApiDot status={apiStatus} t={t}/>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {/* Current user badge */}
        <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,letterSpacing:3,color:activeColor,border:`1px solid ${activeColor}`,padding:"4px 12px"}}>
          {activeName}
        </span>
        {/* Switch/Lock */}
        <button onClick={()=>setAuthed(false)} title="Cambia profilo / Esci" style={{background:"transparent",border:`1px solid ${C.border}`,fontFamily:MONO,fontSize:9,letterSpacing:1.5,padding:"5px 10px",color:C.dim,cursor:"pointer",transition:"all .15s"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.red;e.currentTarget.style.color=C.red;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.dim;}}>
          SWITCH
        </button>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // DESKTOP LAYOUT  (≥ 900px)
  // ════════════════════════════════════════
  if (isDesktop) {
    const sideItems = [
      {id:"chat",     label:t.tab_chat,    badge: null},
      {id:"libreria", label:t.tab_lib,     badge: lib.length||null},
      {id:"wishlist", label:t.tab_wish,    badge: wish.length||null},
      {id:"vision",   label:t.tab_vision,  badge: null},
      {id:"stats",    label:t.tab_stats,   badge: null},
      {id:"profile",  label:t.tab_profile, badge: null},
    ];

    return (
      <div style={{fontFamily:SANS,background:C.bg,minHeight:"100vh",color:C.text,display:"flex",flexDirection:"column"}}>
        <style>{`
          @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
          @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
          @keyframes slideDown{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
          *::-webkit-scrollbar{display:none}
          input,textarea{transition:border-color .15s;}
          input:focus,textarea:focus{border-color:${C.accent}!important;outline:none;}
        `}</style>
        <Notif msg={notif}/>
        {selected&&<DetailModal item={selected} onClose={()=>setSelected(null)} lang={lang} onStatus={setApiStatus} onAddToLibrary={(it)=>{ applyAction({op:"add",dest:"library",profile:active,title:it.title,type:it.type||"film",genre:it.genre||"",status:"finito",hours:2}); setSelected(null); }}/>}
        <Header/>
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          {/* LEFT SIDEBAR */}
          <div style={{width:180,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
            {sideItems.map(({id,label,badge})=>(
              <button key={id} onClick={()=>setDesktopRight(id)} style={{
                padding:"13px 20px", border:"none", cursor:"pointer",
                background: desktopRight===id ? C.surface : "transparent",
                borderLeft: desktopRight===id ? `2px solid ${C.accent}` : "2px solid transparent",
                fontFamily:MONO, fontSize:9, letterSpacing:2,
                color: desktopRight===id ? C.accent : C.dim,
                textAlign:"left", display:"flex", alignItems:"center",
                justifyContent:"space-between", transition:"all .15s",
              }}>
                {label}
                {badge>0 && <span style={{fontFamily:MONO,fontSize:8,color:desktopRight===id?C.accent:C.border,letterSpacing:1}}>{badge}</span>}
              </button>
            ))}
            {/* Bottom: lang indicator */}
            <div style={{marginTop:"auto",padding:"14px 20px",borderTop:`1px solid ${C.border}`}}>
              <div style={{fontFamily:MONO,fontSize:8,letterSpacing:2,color:C.dim,marginBottom:6}}>{t.lang}</div>
              <ApiDot status={apiStatus} t={t}/>
            </div>
          </div>

          {/* MAIN CONTENT */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",padding:"20px 28px 0",minHeight:0}}>
            {/* Panel title */}
            <div style={{fontFamily:MONO,fontSize:9,letterSpacing:2,color:C.dim,marginBottom:14,flexShrink:0,textTransform:"uppercase"}}>
              {sideItems.find(x=>x.id===desktopRight)?.label}
              {desktopRight==="vision" && (
                <span style={{marginLeft:20,gap:12,display:"inline-flex"}}>
                  {[["mission",t.vision_miss,C.green],["scan",t.vision_scan,C.accent]].map(([id,label,col])=>(
                    <button key={id} onClick={()=>setVisionMode(id)} style={{fontFamily:MONO,fontSize:9,letterSpacing:2,border:"none",background:"transparent",cursor:"pointer",color:visionMode===id?col:C.border,borderBottom:visionMode===id?`1px solid ${col}`:"1px solid transparent",padding:"0 0 2px"}}>{label}</button>
                  ))}
                </span>
              )}
            </div>

            {/* Panels — desktop uses full height flex */}
            <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
              {desktopRight==="chat" && (
                <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0}}>
                  <MoodSelector selected={mood} onSelect={setMood} t={t}/>
                  <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4,flex:1,padding:"8px 4px 10px",scrollbarWidth:"none"}}>
                    {(messages||[]).map((m,i)=>(
                      <ChatMessage key={i} m={m} onItemClick={setSelected}/>
                    ))}
                    {chatLoading&&(
                      <div style={{alignSelf:"flex-start",background:C.surface,borderRadius:"18px 18px 18px 4px",padding:"12px 18px",boxShadow:"0 1px 6px rgba(0,0,0,.3)"}}>
                        <div style={{display:"flex",gap:5,alignItems:"center"}}>
                          {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:C.accent,animation:"pulse 1s infinite",animationDelay:`${i*0.2}s`}}/>)}
                        </div>
                      </div>
                    )}
                    <div ref={endRef}/>
                  </div>
                  <div style={{padding:"12px 0 20px",display:"flex",gap:8,alignItems:"flex-end",borderTop:`1px solid ${C.border}`,flexShrink:0}}>
                    <textarea ref={inputRef} rows={3} value={input}
                      onChange={e=>setInput(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
                      placeholder={t.chat_ph}
                      style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:"10px 14px",color:C.text,fontSize:14,fontFamily:SANS,resize:"none",letterSpacing:.2,lineHeight:1.6}}/>
                    <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0,alignSelf:"stretch"}}>
                      <button onClick={send} disabled={chatLoading} style={{flex:1,background:chatLoading?"transparent":C.accent,border:`1px solid ${chatLoading?C.border:C.accent}`,borderRadius:10,color:chatLoading?C.dim:C.bg,fontFamily:MONO,fontSize:10,letterSpacing:2,padding:"0 20px",cursor:chatLoading?"not-allowed":"pointer",transition:"all .15s",display:"flex",alignItems:"center",justifyContent:"center"}}>GO</button>
                      <button onClick={clearChat} style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:8,color:C.dim,fontFamily:MONO,fontSize:9,padding:"7px 10px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",letterSpacing:1}}>CLR</button>
                    </div>
                  </div>
                </div>
              )}
              {desktopRight==="libreria" && (
                <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0,overflow:"hidden"}}>
                  <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap",flexShrink:0}}>
                    {["all","film","serie","gioco"].map(f=><Tag key={f} active={libFilter.type===f} color={f!=="all"?TYPE_COL[f]:undefined} onClick={()=>setLibFilter(p=>({...p,type:f}))}>{f==="all"?t.all:f.toUpperCase()}</Tag>)}
                    <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                      {["all","tu","lei","entrambi"].map(p=><Tag key={p} active={libFilter.profile===p} onClick={()=>setLibFilter(prev=>({...prev,profile:p}))}>{p==="all"?"T+L":p==="tu"?"T":p==="lei"?"L":"T+L"}</Tag>)}
                    </div>
                  </div>
                  {filtLib.length===0
                    ?<div style={{padding:"40px 0",fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.dim,lineHeight:2,whiteSpace:"pre-line"}}>{lib.length===0?t.lib_empty:t.lib_no_filter}</div>
                    :<div style={{overflowY:"auto",flex:1,scrollbarWidth:"none",borderTop:`1px solid ${C.border}`}}>{filtLib.map((item,i)=><LibRow key={i} item={item} onClick={setSelected}/>)}</div>}
                </div>
              )}
              {desktopRight==="wishlist" && (
                <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0,overflow:"hidden"}}>
                  <div style={{display:"flex",gap:6,marginBottom:12,flexShrink:0}}>
                    {["all","film","serie","gioco"].map(f=><Tag key={f} active={wishFilter===f} color={f!=="all"?TYPE_COL[f]:undefined} onClick={()=>setWishFilter(f)}>{f==="all"?t.all:f.toUpperCase()}</Tag>)}
                  </div>
                  {filtWish.length===0
                    ?<div style={{padding:"40px 0",fontFamily:MONO,fontSize:10,letterSpacing:2,color:C.dim,lineHeight:2,whiteSpace:"pre-line"}}>{t.wish_empty}</div>
                    :<div style={{overflowY:"auto",flex:1,scrollbarWidth:"none",borderTop:`1px solid ${C.border}`}}>
                      {filtWish.map((item,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                          <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:TYPE_COL[item.type]||C.muted,width:14}}>{TYPE_CHAR[item.type]}</span>
                          <span style={{fontFamily:SANS,fontSize:14,fontWeight:500,flex:1,letterSpacing:.1}}>{item.title}</span>
                          {item.genre&&<span style={{fontFamily:MONO,fontSize:9,color:C.dim,letterSpacing:1}}>{item.genre.toUpperCase()}</span>}
                          <span style={{fontFamily:MONO,fontSize:9,color:C.dim}}>{item.profileLabel==="entrambi"?"T+L":item.profileLabel==="tu"?"T":"L"}</span>
                          <button onClick={()=>{setProfiles(prev=>{const next=JSON.parse(JSON.stringify(prev));const targets=item.profileLabel==="entrambi"?["tu","lei"]:[item.profileLabel||"tu"];targets.forEach(tgt=>{next[tgt].wishlist=next[tgt].wishlist.filter(x=>x.title!==item.title);if(!next[tgt].library.find(x=>x.title===item.title))next[tgt].library.push({...item,profile:tgt,status:"finito",addedAt:new Date().toISOString()});});stSet(SK.profiles,next);return next;});notify(t.wish_moved(item.title));}} style={{fontFamily:MONO,fontSize:9,letterSpacing:1.5,padding:"5px 8px",border:`1px solid ${C.green}`,background:"transparent",color:C.green,cursor:"pointer"}}>{t.wish_mark}</button>
                          <button onClick={()=>{setProfiles(prev=>{const next=JSON.parse(JSON.stringify(prev));["tu","lei"].forEach(tgt=>{next[tgt].wishlist=next[tgt].wishlist.filter(x=>x.title!==item.title);});stSet(SK.profiles,next);return next;});notify(t.wish_del_msg(item.title));}} style={{fontFamily:MONO,fontSize:9,padding:"5px 8px",border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer"}}>×</button>
                        </div>
                      ))}
                    </div>}
                </div>
              )}
              {desktopRight==="vision" && (
                <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none"}}>
                  {visionMode==="mission"&&<MissionMode lang={lang} onStatus={setApiStatus} savedMissions={missions} onSaveMission={saveMission} onDeleteMission={deleteMission}/>}
                  {visionMode==="scan"&&<FilmScan lang={lang} onStatus={setApiStatus}/>}
                </div>
              )}
              {desktopRight==="stats"   && <div style={{overflowY:"auto",flex:1,scrollbarWidth:"none"}}><StatsView library={lib} lang={lang}/></div>}
              {desktopRight==="profile" && <div style={{overflowY:"auto",flex:1,scrollbarWidth:"none"}}><ProfileEditor profiles={profiles} active={active} onSave={savePrefs} t={t}/></div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════
  // MOBILE LAYOUT  (< 900px)
  // ════════════════════════════════════════
  return (
    <div style={{fontFamily:SANS,background:C.bg,minHeight:"100vh",color:C.text,display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}}>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes slideDown{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        *::-webkit-scrollbar{display:none}
        input,textarea{transition:border-color .15s;}
        input:focus,textarea:focus{border-color:${C.accent}!important;outline:none;}
      `}</style>

      <Notif msg={notif}/>
      {selected&&<DetailModal item={selected} onClose={()=>setSelected(null)} lang={lang} onStatus={setApiStatus} onAddToLibrary={(it)=>{ applyAction({op:"add",dest:"library",profile:active,title:it.title,type:it.type||"film",genre:it.genre||"",status:"finito",hours:2}); setSelected(null); }}/>}
      <Header/>

      {/* MOBILE TABS */}
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,overflowX:"auto",scrollbarWidth:"none"}}>
        {TABS.map(tb=>tabBtn(tb.id,tb.label))}
      </div>

      <div style={{flex:1,display:"flex",flexDirection:"column",padding:"14px 16px 0"}}>
        {tab==="chat"&&(
          <div style={{display:"flex",flexDirection:"column",flex:1}}>
            <ChatPanel maxH="52vh"/>
          </div>
        )}
        {tab==="libreria"&&<LibPanel/>}
        {tab==="wishlist"&&<WishPanel/>}
        {tab==="vision"&&<VisionPanel/>}
        {tab==="stats"&&<StatsView library={lib} lang={lang}/>}
        {tab==="profile"&&<ProfileEditor profiles={profiles} active={active} onSave={savePrefs} t={t}/>}
      </div>
    </div>
  );
}
