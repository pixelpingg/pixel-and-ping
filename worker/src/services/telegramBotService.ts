import type { Env } from "../lib/env";
import { encryptSecret, decryptSecret, newId } from "../lib/crypto";

const TG = "https://api.telegram.org";
const CF_API = "https://api.cloudflare.com/client/v4";
const CONNECT_URL = "https://dash.cloudflare.com/login";
const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_subdomain%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=PIXEL%20%26%20PING";

type TgButton = { text: string; callback_data?: string; url?: string };
type TgMarkup = { inline_keyboard: TgButton[][] };
type TgEntity = { type: string; offset: number; length: number; custom_emoji_id?: string };
type TgMessage = { message_id: number; chat: { id: number }; from?: { id: number; first_name?: string; username?: string }; text?: string; entities?: TgEntity[] };
type TgCallback = { id: string; data?: string; from: { id: number; first_name?: string; username?: string }; message?: TgMessage };
type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallback };

async function tg(env: Env, method: string, body: Record<string, unknown>) {
  const res = await fetch(`${TG}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !(data as any).ok) throw new Error(`Telegram API error: ${res.status}`);
  return data as any;
}

async function loadEmojiMap(env: Env): Promise<Array<{ emoji: string; custom_emoji_id: string }>> {
  try {
    const rows = await env.DB.prepare(`SELECT emoji,custom_emoji_id FROM bot_emoji_library WHERE custom_emoji_id IS NOT NULL AND custom_emoji_id != ''`).all<any>();
    return rows.results.map((r: any) => ({ emoji: String(r.emoji), custom_emoji_id: String(r.custom_emoji_id) }));
  } catch { return []; }
}

function buildCustomEmojiEntities(text: string, map: Array<{ emoji: string; custom_emoji_id: string }>) {
  const entities: Array<{ type: string; offset: number; length: number; custom_emoji_id: string }> = [];
  for (const item of map.sort((a,b) => b.emoji.length - a.emoji.length)) {
    let from = 0;
    while (from < text.length) {
      const i = text.indexOf(item.emoji, from);
      if (i < 0) break;
      entities.push({ type: "custom_emoji", offset: i, length: item.emoji.length, custom_emoji_id: item.custom_emoji_id });
      from = i + item.emoji.length;
    }
  }
  return entities.sort((a,b) => a.offset-b.offset);
}

async function send(env: Env, chatId: number, text: string, replyMarkup?: TgMarkup) {
  const entities = await buildCustomEmojiEntities(text, await loadEmojiMap(env));
  return tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", entities: entities.length ? entities : undefined, disable_web_page_preview: true, reply_markup: replyMarkup });
}

async function answer(env: Env, callbackId: string, text?: string) {
  return tg(env, "answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: false });
}

function menu(env: Env, admin = false): TgMarkup {
  const b = (key: string, text: string): TgButton => ({ text, callback_data: key });
  const rows: TgButton[][] = [
    [b("cf:connect", "☁️ اتصال Cloudflare")],
    [b("panels:list", "📦 پنل‌های من"), b("panel:new", "➕ ساخت پنل")],
    [b("cf:list", "☁️ اکانت‌های من"), b("help", "❓ راهنما")],
  ];
  if (admin) rows.push([b("admin:home", "👑 مدیریت ربات")]);
  return { inline_keyboard: rows };
}

function adminMenu(): TgMarkup {
  return { inline_keyboard: [
    [{ text: "👥 کاربران", callback_data: "admin:users" }, { text: "📦 پنل‌ها", callback_data: "admin:panels" }],
    [{ text: "☁️ Cloudflare", callback_data: "admin:cf" }, { text: "📊 آمار", callback_data: "admin:stats" }],
    [{ text: "😀 Emoji", callback_data: "admin:emoji" }, { text: "📝 متن‌ها", callback_data: "admin:texts" }],
    [{ text: "⬅️ منوی اصلی", callback_data: "home" }],
  ] };
}

async function ensureUser(env: Env, user: { id: number; first_name?: string; username?: string }) {
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO bot_users (telegram_id, first_name, username, is_admin, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET first_name=excluded.first_name, username=excluded.username, last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at`)
    .bind(String(user.id), user.first_name ?? null, user.username ?? null, String(user.id) === env.ADMIN_TELEGRAM_ID ? 1 : 0, now, now, now).run();
}

async function stateKey(id: number) { return `tg:state:${id}`; }
async function setState(env: Env, id: number, state: unknown, ttl = 900) { await env.PIXELPING_KV.put(await stateKey(id), JSON.stringify(state), { expirationTtl: ttl }); }
async function getState<T>(env: Env, id: number): Promise<T | null> { const v = await env.PIXELPING_KV.get(await stateKey(id)); return v ? JSON.parse(v) as T : null; }
async function clearState(env: Env, id: number) { await env.PIXELPING_KV.delete(await stateKey(id)); }

async function cfFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({})) as any;
  if (!res.ok || body.success === false) throw new Error(body?.errors?.[0]?.message ?? `Cloudflare API error ${res.status}`);
  return body.result as T;
}

async function beginCloudflare(env: Env, chatId: number) {
  await send(env, chatId,
    `<b>☁️ اتصال اکانت Cloudflare</b>\n\n` +
    `برای اتصال، فقط یک API Token لازم است. لازم نیست Account ID یا تنظیمات دیگری را دستی وارد کنی.\n\n` +
    `<b>مراحل:</b>\n` +
    `1️⃣ اگر اکانت نداری، اکانت Cloudflare بساز یا وارد شو.\n` +
    `2️⃣ روی «ساخت توکن Pixel & Ping» بزن.\n` +
    `3️⃣ توکن را در Cloudflare بساز و فقط خود Token را همینجا ارسال کن.\n` +
    `4️⃣ ربات توکن را بررسی می‌کند، اکانت را خودش پیدا می‌کند و اتصال را ثبت می‌کند.\n\n` +
    `🔐 توکن در پیام‌های ربات نمایش داده یا در لاگ ذخیره نمی‌شود.`,
    { inline_keyboard: [
      [{ text: "🌐 ساخت اکانت / ورود", url: CONNECT_URL }],
      [{ text: "🔑 ساخت توکن Pixel & Ping", url: TOKEN_URL }],
      [{ text: "📥 توکن را گرفتم", callback_data: "cf:token" }],
      [{ text: "⬅️ برگشت", callback_data: "home" }],
    ] });
}

async function acceptToken(env: Env, chatId: number) {
  await setState(env, chatId, { step: "cf_token" });
  await send(env, chatId, `📥 <b>توکن Cloudflare را ارسال کن</b>\n\nفقط Token را بفرست؛ Account ID لازم نیست.\n\nاگر منصرف شدی، /start را بزن.`);
}

async function processToken(env: Env, msg: TgMessage) {
  const token = (msg.text ?? "").trim();
  if (token.length < 20 || token.length > 500) { await send(env, msg.chat.id, "❌ فرمت توکن قابل قبول نیست. دوباره فقط خود Token را ارسال کن."); return; }
  await send(env, msg.chat.id, "⏳ در حال بررسی توکن و پیدا کردن اکانت Cloudflare...");
  try {
    await cfFetch<{ status: string }>(token, "/user/tokens/verify");
    const accounts = await cfFetch<Array<{ id: string; name: string; status: string }>>(token, "/accounts?per_page=50");
    const active = accounts.filter(a => a.status === "active");
    if (!active.length) throw new Error("این Token به هیچ اکانت فعال Cloudflare دسترسی ندارد.");
    const encrypted = await encryptSecret(token, env.ENCRYPTION_KEY);
    await setState(env, msg.from!.id, { step: "cf_choose_account", encrypted, accounts: active.map(a => ({ id: a.id, name: a.name })) }, 900);
    if (active.length === 1) {
      await saveCloudflareAccount(env, msg.from!.id, active[0], encrypted);
      await clearState(env, msg.from!.id);
      await send(env, msg.chat.id, `✅ <b>Cloudflare متصل شد</b>\n\n☁️ ${escapeHtml(active[0].name)}\n🆔 <code>${active[0].id}</code>\n\nحالا می‌توانی از منوی «پنل‌های من» استفاده کنی.`, menu(env, String(msg.from!.id) === env.ADMIN_TELEGRAM_ID));
      return;
    }
    await send(env, msg.chat.id, `<b>چند اکانت با این Token در دسترس است.</b>\n\nاکانت موردنظر را انتخاب کن:`, { inline_keyboard: active.slice(0, 10).map(a => [{ text: `☁️ ${a.name}`.slice(0, 60), callback_data: `cf:choose:${a.id}` }]).concat([[{ text: "❌ لغو", callback_data: "home" }]]) });
  } catch (e) {
    await clearState(env, msg.from!.id);
    await send(env, msg.chat.id, `❌ <b>اتصال انجام نشد</b>\n\n${escapeHtml(e instanceof Error ? e.message : "Token نامعتبر است.")}\n\nتوکن را دوباره از لینک رسمی بساز و فقط خود Token را ارسال کن.`);
  }
}

async function saveCloudflareAccount(env: Env, telegramId: number, account: { id: string; name: string; status?: string }, encrypted: { ciphertext: string; iv: string; authTag: string }) {
  const now = Date.now();
  const existing = await env.DB.prepare(`SELECT id FROM bot_cloudflare_accounts WHERE telegram_id = ? AND account_id = ?`).bind(String(telegramId), account.id).first<any>();
  if (existing) {
    await env.DB.prepare(`UPDATE bot_cloudflare_accounts SET name=?, encrypted_token=?, token_iv=?, token_auth_tag=?, status='HEALTHY', last_error=NULL, updated_at=? WHERE id=?`)
      .bind(account.name, encrypted.ciphertext, encrypted.iv, encrypted.authTag, now, existing.id).run();
    return;
  }
  await env.DB.prepare(`INSERT INTO bot_cloudflare_accounts (id, telegram_id, name, account_id, encrypted_token, token_iv, token_auth_tag, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'HEALTHY', ?, ?)`)
    .bind(newId(), String(telegramId), account.name, account.id, encrypted.ciphertext, encrypted.iv, encrypted.authTag, now, now).run();
}

async function chooseCloudflare(env: Env, chatId: number, telegramId: number, accountId: string) {
  const st = await getState<any>(env, telegramId);
  if (!st || st.step !== "cf_choose_account" || !st.encrypted) { await send(env, chatId, "⏱️ این مرحله منقضی شده. دوباره اتصال Cloudflare را شروع کن."); return; }
  const account = st.accounts.find((a: any) => a.id === accountId);
  if (!account) { await send(env, chatId, "❌ اکانت انتخاب‌شده پیدا نشد."); return; }
  await saveCloudflareAccount(env, telegramId, account, st.encrypted);
  await clearState(env, telegramId);
  await send(env, chatId, `✅ <b>اکانت Cloudflare متصل شد</b>\n\n☁️ ${escapeHtml(account.name)}\n🆔 <code>${account.id}</code>`, menu(env, String(telegramId) === env.ADMIN_TELEGRAM_ID));
}

async function listCf(env: Env, chatId: number, telegramId: number) {
  const rows = await env.DB.prepare(`SELECT id,name,account_id,status,created_at FROM bot_cloudflare_accounts WHERE telegram_id=? ORDER BY created_at DESC`).bind(String(telegramId)).all<any>();
  if (!rows.results.length) { await send(env, chatId, "☁️ هنوز اکانت Cloudflare متصل نکردی.", { inline_keyboard: [[{ text: "➕ اتصال Cloudflare", callback_data: "cf:connect" }], [{ text: "⬅️ برگشت", callback_data: "home" }]] }); return; }
  const text = rows.results.map((r: any, i: number) => `${i + 1}. ☁️ <b>${escapeHtml(r.name)}</b>\n   🆔 <code>${r.account_id}</code>\n   وضعیت: ${r.status === "HEALTHY" ? "🟢 سالم" : "🟠 نیازمند بررسی"}`).join("\n\n");
  await send(env, chatId, `<b>☁️ اکانت‌های متصل من</b>\n\n${text}`, { inline_keyboard: [[{ text: "➕ افزودن اکانت دیگر", callback_data: "cf:connect" }], [{ text: "⬅️ برگشت", callback_data: "home" }]] });
}

async function listPanels(env: Env, chatId: number, telegramId: number) {
  const rows = await env.DB.prepare(`SELECT id,name,status,panel_url,created_at FROM bot_panels WHERE telegram_id=? ORDER BY created_at DESC LIMIT 20`).bind(String(telegramId)).all<any>();
  if (!rows.results.length) { await send(env, chatId, "📦 <b>پنل‌های من</b>\n\nهنوز پنلی ثبت نشده است.", { inline_keyboard: [[{ text: "➕ ساخت پنل جدید", callback_data: "panel:new" }], [{ text: "⬅️ برگشت", callback_data: "home" }]] }); return; }
  const buttons = rows.results.map((r: any) => [{ text: `${r.status === "READY" ? "🟢" : "🟡"} ${r.name}`.slice(0, 60), callback_data: `panel:view:${r.id}` }]);
  await send(env, chatId, `<b>📦 پنل‌های من</b>\n\nتعداد: ${rows.results.length}`, { inline_keyboard: buttons.concat([[{ text: "➕ ساخت پنل جدید", callback_data: "panel:new" }], [{ text: "⬅️ برگشت", callback_data: "home" }]]) });
}

async function newPanel(env: Env, chatId: number, telegramId: number) {
  const cf = await env.DB.prepare(`SELECT id,name,account_id FROM bot_cloudflare_accounts WHERE telegram_id=? AND status='HEALTHY' ORDER BY created_at DESC`).bind(String(telegramId)).all<any>();
  if (!cf.results.length) { await send(env, chatId, "برای ساخت پنل، اول یک اکانت Cloudflare متصل کن.", { inline_keyboard: [[{ text: "☁️ اتصال Cloudflare", callback_data: "cf:connect" }], [{ text: "⬅️ برگشت", callback_data: "home" }]] }); return; }
  await send(env, chatId, `<b>➕ ساخت پنل جدید</b>\n\nاکانت Cloudflare را انتخاب کن:`, { inline_keyboard: cf.results.slice(0, 10).map((a: any) => [{ text: `☁️ ${a.name}`.slice(0, 60), callback_data: `panel:request:${a.id}` }]).concat([[{ text: "⬅️ برگشت", callback_data: "home" }]]) });
}

async function createPanelRequest(env: Env, chatId: number, telegramId: number, cfId: string) {
  const account = await env.DB.prepare(`SELECT id,name FROM bot_cloudflare_accounts WHERE id=? AND telegram_id=? AND status='HEALTHY'`).bind(cfId, String(telegramId)).first<any>();
  if (!account) { await send(env, chatId, "❌ اکانت Cloudflare معتبر نیست."); return; }
  const id = newId(); const now = Date.now();
  const name = `Pixel & Ping ${new Date(now).toISOString().slice(0,10)}`;
  await env.DB.prepare(`INSERT INTO bot_panels (id,telegram_id,cloudflare_account_id,name,status,panel_url,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, String(telegramId), account.id, name, "QUEUED", null, null, now, now).run();
  await send(env, chatId, `🟡 <b>درخواست ساخت ثبت شد</b>\n\n📦 ${escapeHtml(name)}\n☁️ ${escapeHtml(account.name)}\n\nدر این بسته، موتور Deploy خودکار به دلیل نبودن فایل build نهایی Worker/Frontend داخل ZIP فعال نشده است. برای جلوگیری از نمایش وضعیت جعلی، ربات آن را READY اعلام نمی‌کند.`, { inline_keyboard: [[{ text: "📦 پنل‌های من", callback_data: "panels:list" }], [{ text: "⬅️ منوی اصلی", callback_data: "home" }]] });
}

async function adminStats(env: Env, chatId: number) {
  const [u, c, p, ready, queued, failed] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) c FROM bot_users`).first<any>(),
    env.DB.prepare(`SELECT COUNT(*) c FROM bot_cloudflare_accounts`).first<any>(),
    env.DB.prepare(`SELECT COUNT(*) c FROM bot_panels`).first<any>(),
    env.DB.prepare(`SELECT COUNT(*) c FROM bot_panels WHERE status='READY'`).first<any>(),
    env.DB.prepare(`SELECT COUNT(*) c FROM bot_panels WHERE status='QUEUED'`).first<any>(),
    env.DB.prepare(`SELECT COUNT(*) c FROM bot_panels WHERE status='FAILED'`).first<any>(),
  ]);
  await send(env, chatId, `<b>📊 آمار ربات</b>\n\n👥 کاربران: <b>${u?.c ?? 0}</b>\n☁️ اکانت‌های Cloudflare: <b>${c?.c ?? 0}</b>\n📦 کل پنل‌ها: <b>${p?.c ?? 0}</b>\n🟢 آماده: <b>${ready?.c ?? 0}</b>\n🟡 در صف: <b>${queued?.c ?? 0}</b>\n🔴 خطادار: <b>${failed?.c ?? 0}</b>`, adminMenu());
}

async function adminUsers(env: Env, chatId: number) {
  const rows = await env.DB.prepare(`SELECT telegram_id,first_name,username,last_seen_at,is_blocked FROM bot_users ORDER BY last_seen_at DESC LIMIT 20`).all<any>();
  const text = rows.results.map((r: any) => `• <code>${r.telegram_id}</code> ${escapeHtml(r.first_name ?? "")}${r.username ? ` @${escapeHtml(r.username)}` : ""}${r.is_blocked ? " 🔴" : " 🟢"}`).join("\n") || "موردی نیست";
  await send(env, chatId, `<b>👥 آخرین کاربران</b>\n\n${text}`, adminMenu());
}

async function adminPanels(env: Env, chatId: number) {
  const rows = await env.DB.prepare(`SELECT p.name,p.status,p.panel_url,p.created_at,c.name cf_name,p.telegram_id FROM bot_panels p JOIN bot_cloudflare_accounts c ON c.id=p.cloudflare_account_id ORDER BY p.created_at DESC LIMIT 20`).all<any>();
  const text = rows.results.map((r: any) => `• <b>${escapeHtml(r.name)}</b>\n  ${r.status} · ${escapeHtml(r.cf_name)} · <code>${r.telegram_id}</code>${r.panel_url ? `\n  🔗 ${escapeHtml(r.panel_url)}` : ""}`).join("\n\n") || "موردی نیست";
  await send(env, chatId, `<b>📦 آخرین پنل‌ها</b>\n\n${text}`, adminMenu());
}

async function adminCf(env: Env, chatId: number) {
  const rows = await env.DB.prepare(`SELECT c.name,c.account_id,c.status,c.telegram_id FROM bot_cloudflare_accounts c ORDER BY c.created_at DESC LIMIT 20`).all<any>();
  const text = rows.results.map((r: any) => `• ☁️ <b>${escapeHtml(r.name)}</b>\n  <code>${r.account_id}</code> · ${r.status} · user <code>${r.telegram_id}</code>`).join("\n\n") || "موردی نیست";
  await send(env, chatId, `<b>☁️ Cloudflare Accounts</b>\n\n${text}`, adminMenu());
}

async function adminTexts(env: Env, chatId: number) {
  const rows = await env.DB.prepare(`SELECT key,value FROM bot_settings ORDER BY key`).all<any>();
  const text = rows.results.map((r: any) => `• <code>${escapeHtml(r.key)}</code>\n${escapeHtml(r.value)}`).join("\n\n") || "هیچ متنی ثبت نشده است.";
  await send(env, chatId, `<b>📝 متن‌های ربات</b>\n\n${text}\n\nبرای ویرایش یک کلید، ابتدا کلید را دقیقاً ارسال کن.`, { inline_keyboard: [[{ text: "➕/✏️ ویرایش متن", callback_data: "admin:text_edit" }], [{ text: "⬅️ مدیریت", callback_data: "admin:home" }]] });
}

async function adminEmoji(env: Env, chatId: number) {
  const rows = await env.DB.prepare(`SELECT key,emoji,label,custom_emoji_id FROM bot_emoji_library ORDER BY key`).all<any>();
  const text = rows.results.map((r: any) => `• <code>${escapeHtml(r.key)}</code> ${escapeHtml(r.emoji)}${r.custom_emoji_id ? " → 🌟 Premium" : ""}${r.label ? ` (${escapeHtml(r.label)})` : ""}`).join("\n") || "موردی نیست";
  await send(env, chatId, `<b>😀 Emoji Library</b>\n\n${text}\n\nبرای افزودن ایموجی پرمیوم، روی دکمه زیر بزن و ابتدا ایموجی معمولی را بفرست.`, { inline_keyboard: [[{ text: "🌟 افزودن ایموجی پرمیوم جدید", callback_data: "admin:emoji_add" }], [{ text: "⬅️ مدیریت", callback_data: "admin:home" }]] });
}

async function beginEmojiAdd(env: Env, chatId: number, telegramId: number) {
  await setState(env, telegramId, { step: "admin_emoji_base" });
  await send(env, chatId, `🌟 <b>افزودن ایموجی پرمیوم</b>\n\n1️⃣ حالا فقط ایموجی معمولی/پایه را بفرست.`);
}

async function savePremiumEmoji(env: Env, chatId: number, telegramId: number, msg: TgMessage, base: string) {
  const entity = (msg.entities ?? []).find(e => e.type === "custom_emoji" && e.custom_emoji_id);
  if (!entity) { await send(env, chatId, "❌ پیام دوم باید یک Custom Emoji پرمیوم واقعی تلگرام داشته باشد. دوباره همان ایموجی پرمیوم را ارسال کن."); return; }
  const id = newId(); const key = `custom_${id.slice(-8)}`;
  await env.DB.prepare(`INSERT INTO bot_emoji_library(key,emoji,label,custom_emoji_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET emoji=excluded.emoji,custom_emoji_id=excluded.custom_emoji_id,updated_at=excluded.updated_at`).bind(key, base, "Premium custom emoji", entity.custom_emoji_id, Date.now()).run();
  await clearState(env, telegramId);
  await send(env, chatId, `✅ <b>ایموجی پرمیوم ثبت شد</b>\n\n${escapeHtml(base)} → 🌟 Custom Emoji` , adminMenu());
}

function escapeHtml(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }


export async function ensureTelegramWebhook(env: Env, baseUrl: string) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  // Use the bot token as the webhook secret unless a dedicated secret is configured.
  // This avoids another setup step while Telegram still validates the incoming header.
  const secret = env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_BOT_TOKEN;
  const marker = await env.PIXELPING_KV.get("telegram:webhook:configured");
  if (marker === baseUrl) return;
  await tg(env, "setWebhook", {
    url: `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  await env.PIXELPING_KV.put("telegram:webhook:configured", baseUrl, { expirationTtl: 86400 });
}

export async function handleTelegramUpdate(env: Env, update: TgUpdate) {
  const msg = update.message;
  const cb = update.callback_query;
  const from = msg?.from ?? cb?.from;
  if (!from) return;
  await ensureUser(env, from);
  const admin = String(from.id) === env.ADMIN_TELEGRAM_ID;

  if (msg?.text?.startsWith("/start")) {
    await clearState(env, from.id);
    await send(env, msg.chat.id, `<b>🚀 Pixel & Ping</b>\n\nخوش آمدی ${escapeHtml(from.first_name ?? "")}.\nاز منوی زیر استفاده کن:`, menu(env, admin));
    return;
  }
  if (msg?.text === "/admin" && admin) { await send(env, msg.chat.id, "👑 <b>پنل مدیریت Pixel & Ping</b>", adminMenu()); return; }

  const st = await getState<any>(env, from.id);
  if (msg?.text && st?.step === "cf_token") { await processToken(env, msg); return; }
  if (msg?.text && st?.step === "admin_text_key" && admin) {
    const key = msg.text.trim();
    const row = await env.DB.prepare(`SELECT key,value FROM bot_settings WHERE key=?`).bind(key).first<any>();
    if (!row) { await send(env, msg.chat.id, "❌ این کلید پیدا نشد. از بخش متن‌ها کلید را دقیق کپی کن."); return; }
    await setState(env, from.id, { step: "admin_text_value", key });
    await send(env, msg.chat.id, `✏️ متن جدید برای <code>${escapeHtml(key)}</code> را ارسال کن.\n\nفعلی:\n${escapeHtml(row.value)}`);
    return;
  }
  if (msg?.text && st?.step === "admin_text_value" && admin) {
    await env.DB.prepare(`UPDATE bot_settings SET value=?,updated_at=? WHERE key=?`).bind(msg.text, Date.now(), st.key).run();
    await clearState(env, from.id);
    await send(env, msg.chat.id, `✅ متن <code>${escapeHtml(st.key)}</code> به‌روزرسانی شد.`, adminMenu());
    return;
  }
  if (msg?.text && st?.step === "admin_emoji_base" && admin) {
    await setState(env, from.id, { step: "admin_emoji_premium", base: msg.text.trim() });
    await send(env, msg.chat.id, `2️⃣ عالی. حالا همان ایموجی را به صورت <b>Premium Custom Emoji</b> ارسال کن.`);
    return;
  }
  if (msg && st?.step === "admin_emoji_premium" && admin) { await savePremiumEmoji(env, msg.chat.id, from.id, msg, st.base); return; }

  if (cb) {
    await answer(env, cb.id);
    const data = cb.data ?? ""; const chatId = cb.message?.chat.id ?? from.id;
    if (data === "home") { await send(env, chatId, "🏠 <b>منوی اصلی</b>", menu(env, admin)); return; }
    if (data === "help") { await send(env, chatId, "❓ <b>راهنما</b>\n\nبرای اتصال Cloudflare فقط توکن بساز و آن را برای ربات بفرست. Account ID و تنظیمات دستی لازم نیست.", menu(env, admin)); return; }
    if (data === "cf:connect") { await beginCloudflare(env, chatId); return; }
    if (data === "cf:token") { await acceptToken(env, chatId); return; }
    if (data.startsWith("cf:choose:")) { await chooseCloudflare(env, chatId, from.id, data.slice(10)); return; }
    if (data === "cf:list") { await listCf(env, chatId, from.id); return; }
    if (data === "panels:list") { await listPanels(env, chatId, from.id); return; }
    if (data === "panel:new") { await newPanel(env, chatId, from.id); return; }
    if (data.startsWith("panel:request:")) { await createPanelRequest(env, chatId, from.id, data.slice(14)); return; }
    if (data.startsWith("panel:view:")) {
      const panel = await env.DB.prepare(`SELECT p.*, c.name cf_name FROM bot_panels p JOIN bot_cloudflare_accounts c ON c.id=p.cloudflare_account_id WHERE p.id=? AND p.telegram_id=?`).bind(data.slice(11), String(from.id)).first<any>();
      if (!panel) { await send(env, chatId, "❌ پنل پیدا نشد."); return; }
      await send(env, chatId, `<b>📦 ${escapeHtml(panel.name)}</b>\n\n☁️ ${escapeHtml(panel.cf_name)}\nوضعیت: <b>${escapeHtml(panel.status)}</b>${panel.panel_url ? `\n🔗 ${escapeHtml(panel.panel_url)}` : ""}${panel.error_message ? `\n❌ ${escapeHtml(panel.error_message)}` : ""}`, { inline_keyboard: [[...(panel.panel_url ? [{ text: "🌐 باز کردن پنل", url: panel.panel_url }] : [] )], [{ text: "🔄 بروزرسانی وضعیت", callback_data: `panel:view:${panel.id}` }], [{ text: "⬅️ پنل‌های من", callback_data: "panels:list" }]] });
      return;
    }
    if (data === "admin:home" && admin) { await send(env, chatId, "👑 <b>مدیریت ربات</b>", adminMenu()); return; }
    if (data === "admin:stats" && admin) { await adminStats(env, chatId); return; }
    if (data === "admin:users" && admin) { await adminUsers(env, chatId); return; }
    if (data === "admin:panels" && admin) { await adminPanels(env, chatId); return; }
    if (data === "admin:cf" && admin) { await adminCf(env, chatId); return; }
    if (data === "admin:emoji" && admin) { await adminEmoji(env, chatId); return; }
    if (data === "admin:emoji_add" && admin) { await beginEmojiAdd(env, chatId, from.id); return; }
    if (data === "admin:texts" && admin) { await adminTexts(env, chatId); return; }
    if (data === "admin:text_edit" && admin) { await setState(env, from.id, { step: "admin_text_key" }); await send(env, chatId, `📝 کلید متنی که می‌خواهی ویرایش شود را دقیقاً ارسال کن.`); return; }
  }
}

export async function verifyTelegramSecret(request: Request, env: Env) {
  const configured = env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_BOT_TOKEN;
  if (!configured) return false;
  return request.headers.get("x-telegram-bot-api-secret-token") === configured;
}
