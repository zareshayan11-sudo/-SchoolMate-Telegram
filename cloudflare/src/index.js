const HELP = `📚 SchoolMate — Classroom Planner\n\n/tasks — upcoming homework\n/exams — upcoming exams\n/week — this week's tasks and exams\n/addtask — add homework (authorized editors)\n/addexam — add an exam (authorized editors)\n/cancel — cancel an active form\n\nDates: Gregorian YYYY-MM-DD or Persian/Jalali YYYY/MM/DD.`;
const TZ = "Asia/Tehran";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response("SchoolMate is running.");
    if (request.method !== "POST" || url.pathname !== "/telegram/webhook") return new Response("Not found", { status: 404 });
    if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
    let update;
    try { update = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
    ctx.waitUntil(handleUpdate(update, env).catch(err => console.error("Update failed", err)));
    return new Response("OK");
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(sendDailyReminders(env).catch(err => console.error("Reminder job failed", err)));
  }
};

async function handleUpdate(update, env) {
  const msg = update.message;
  if (!msg || !msg.chat || !msg.from) return;
  const chatId = String(msg.chat.id);
  if (!env.SCHOOLMATE_GROUP_ID || chatId !== String(env.SCHOOLMATE_GROUP_ID)) return;
  const userId = Number(msg.from.id);
  const text = String(msg.text || "").trim();
  if (!text) return;
  const command = text.startsWith("/") ? text.split(/\s+/)[0].split("@")[0].toLowerCase() : "";
  if (command === "/cancel") {
    await env.DB.prepare("DELETE FROM form_sessions WHERE user_id=?").bind(userId).run();
    return send(env, chatId, "Form cancelled.");
  }
  const session = await env.DB.prepare("SELECT * FROM form_sessions WHERE user_id=?").bind(userId).first();
  if (session && !command) return continueForm(env, chatId, userId, text, session);
  if (command === "/start" || command === "/help") return send(env, chatId, HELP);
  if (command === "/tasks") return listEntries(env, chatId, "task");
  if (command === "/exams") return listEntries(env, chatId, "exam");
  if (command === "/week") {
    const today = todayInTZ();
    const end = addDays(today, 6);
    const { results } = await env.DB.prepare("SELECT * FROM entries WHERE done=0 AND due_date>=? AND due_date<=? ORDER BY due_date,id LIMIT 30").bind(today, end).all();
    return render(env, chatId, results || [], "📅 This week's plan");
  }
  if (command === "/addtask" || command === "/addexam") {
    const editors = String(env.SCHOOLMATE_EDITOR_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
    if (!editors.includes(String(userId))) return send(env, chatId, "Only designated class editors can add shared entries.");
    const kind = command === "/addtask" ? "task" : "exam";
    await env.DB.prepare("INSERT INTO form_sessions(user_id,kind,step) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET kind=excluded.kind,step=excluded.step,subject=NULL,details=NULL,updated_at=CURRENT_TIMESTAMP").bind(userId, kind, "subject").run();
    return send(env, chatId, `Let's add a ${kind}.\n1/3 — Send the subject (e.g. Physics). Use /cancel to stop.`);
  }
  if (command) return send(env, chatId, "I don't recognize that command. Use /help.");
}

async function continueForm(env, chatId, userId, text, form) {
  if (form.step === "subject") {
    if (text.length > 80) return send(env, chatId, "Please keep the subject under 80 characters.");
    await env.DB.prepare("UPDATE form_sessions SET subject=?,step='details',updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(text, userId).run();
    return send(env, chatId, "2/3 — Send the task/exam details.");
  }
  if (form.step === "details") {
    if (text.length > 500) return send(env, chatId, "Please keep the details under 500 characters.");
    await env.DB.prepare("UPDATE form_sessions SET details=?,step='date',updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(text, userId).run();
    return send(env, chatId, "3/3 — Send the date as YYYY-MM-DD or Persian/Jalali YYYY/MM/DD (e.g. 2026-10-20 or 1405/07/29).");
  }
  if (form.step === "date") {
    let due;
    try { due = parseDate(text); } catch { return send(env, chatId, "Date not recognized. Use YYYY-MM-DD (Gregorian) or YYYY/MM/DD (Persian/Jalali)."); }
    if (due < todayInTZ()) return send(env, chatId, "That date is in the past. Please send a future date.");
    const result = await env.DB.prepare("INSERT INTO entries(kind,subject,details,due_date,created_by) VALUES(?,?,?,?,?)").bind(form.kind, form.subject, form.details || "", due, userId).run();
    await env.DB.prepare("DELETE FROM form_sessions WHERE user_id=?").bind(userId).run();
    const label = form.kind === "task" ? "Homework" : "Exam";
    return send(env, chatId, `✅ ${label} #${result.meta.last_row_id} saved for ${due}.`);
  }
}

async function listEntries(env, chatId, kind) {
  const { results } = await env.DB.prepare("SELECT * FROM entries WHERE done=0 AND kind=? AND due_date>=? ORDER BY due_date,id LIMIT 30").bind(kind, todayInTZ()).all();
  return render(env, chatId, results || [], kind === "task" ? "📚 Upcoming homework" : "📝 Upcoming exams");
}
async function render(env, chatId, rows, title) {
  if (!rows.length) return send(env, chatId, `${title}\n\nNothing scheduled yet.`);
  const lines = [title, ""];
  for (const row of rows) {
    lines.push(`${row.kind === "task" ? "📚" : "📝"} #${row.id} · ${row.due_date} · ${row.subject}`);
    if (row.details) lines.push(`   ${row.details}`);
  }
  return send(env, chatId, lines.join("\n"));
}

async function sendDailyReminders(env) {
  if (!env.SCHOOLMATE_GROUP_ID || !env.TELEGRAM_BOT_TOKEN) return;
  const today = todayInTZ();
  const { results } = await env.DB.prepare("SELECT * FROM entries WHERE done=0 AND reminder_sent=0 AND due_date=? ORDER BY id").bind(today).all();
  for (const row of results || []) {
    const label = row.kind === "task" ? "Homework" : "Exam";
    await send(env, env.SCHOOLMATE_GROUP_ID, `⏰ Reminder for today\n${label}: ${row.subject}\n${row.details}\nDate: ${row.due_date}`);
    await env.DB.prepare("UPDATE entries SET reminder_sent=1 WHERE id=?").bind(row.id).run();
  }
}

async function send(env, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
}

function todayInTZ() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function parseDate(input) {
  const normalized = input.trim().replace(/[۰-۹٠-٩]/g, d => "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(d) < 10 ? String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)) : String("٠١٢٣٤٥٦٧٨٩".indexOf(d)) ).replaceAll("/", "-");
  const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) throw new Error("bad date");
  let y = +m[1], mo = +m[2], day = +m[3];
  if (y >= 1300 && y <= 1600) [y, mo, day] = jalaliToGregorian(y, mo, day);
  const d = new Date(Date.UTC(y, mo - 1, day));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) throw new Error("bad date");
  return d.toISOString().slice(0, 10);
}
function jalaliToGregorian(jy, jm, jd) {
  if (jm < 1 || jm > 12 || jd < 1 || jd > (jm <= 6 ? 31 : 30)) throw new Error("bad Jalali date");
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd;
  const mdays = [31,31,31,31,31,31,30,30,30,30,30];
  for (let i = 1; i < jm; i++) days += mdays[i - 1];
  let gy = 400 * Math.floor(days / 146097); days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor((days - 1) / 36524); days = (days - 1) % 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const leap = gy % 4 === 0 && (gy % 100 !== 0 || gy % 400 === 0);
  const lens = [31, leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  let gm = 1;
  for (const len of lens) { if (gd <= len) break; gd -= len; gm++; }
  return [gy, gm, gd];
}
