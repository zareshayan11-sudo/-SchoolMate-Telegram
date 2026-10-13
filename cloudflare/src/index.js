const HELP = `📚 SchoolMate — Classroom Planner

/start — start the bot
/help — show help
/tasks — upcoming homework
/exams — upcoming exams
/week — this week's tasks and exams
/addtask — add homework (authorized editors)
/addexam — add an exam (authorized editors)
/cancel — cancel an active form

Dates: Gregorian YYYY-MM-DD or Persian/Jalali YYYY/MM/DD.`;

const TZ = "Asia/Tehran";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("SchoolMate is running.");
    }

    if (
      request.method !== "POST" ||
      url.pathname !== "/telegram/webhook"
    ) {
      return new Response("Not found", { status: 404 });
    }

    if (
      env.WEBHOOK_SECRET &&
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
        env.WEBHOOK_SECRET
    ) {
      console.warn("SchoolMate: webhook secret mismatch");
      return new Response("Forbidden", { status: 403 });
    }

    let update;

    try {
      update = await request.json();
    } catch {
      console.error("SchoolMate: invalid webhook JSON");
      return new Response("Bad JSON", { status: 400 });
    }

    try {
      await handleUpdate(update, env);
    } catch (err) {
      console.error("SchoolMate: update processing failed", {
        error: String(err?.message || err),
        updateId: update?.update_id ?? null
      });
    }

    return new Response("OK");
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      sendDailyReminders(env).catch((err) => {
        console.error("SchoolMate: reminder job failed", {
          error: String(err?.message || err)
        });
      })
    );
  }
};

async function handleUpdate(update, env) {
  const msg = update?.message;

  if (!msg?.chat || !msg?.from) {
    console.log("SchoolMate: update has no regular message");
    return;
  }

  const chatId = String(msg.chat.id);
  const configuredGroupId = String(env.SCHOOLMATE_GROUP_ID || "");
  const text = String(msg.text || "").trim();

  // Safe diagnostics: never log group IDs, message text, or tokens.
  console.log("SchoolMate: incoming message", {
    groupIdConfigured: Boolean(configuredGroupId),
    groupIdLength: configuredGroupId.length,
    hasText: Boolean(text),
    updateId: update?.update_id ?? null
  });

  if (!configuredGroupId || chatId !== configuredGroupId) {
    console.log("SchoolMate: group ID mismatch");
    return;
  }

  if (!text) return;

  const command = text.startsWith("/")
    ? text.split(/\s+/)[0].split("@")[0].toLowerCase()
    : "";

  const userId = Number(msg.from.id);

  if (command === "/cancel") {
    await env.DB
      .prepare("DELETE FROM form_sessions WHERE user_id = ?")
      .bind(userId)
      .run();

    return send(env, chatId, "Form cancelled.");
  }

  const session = await env.DB
    .prepare("SELECT * FROM form_sessions WHERE user_id = ?")
    .bind(userId)
    .first();

  if (session && !command) {
    return continueForm(env, chatId, userId, text, session);
  }

  if (command === "/start" || command === "/help") {
    return send(env, chatId, HELP);
  }

  if (command === "/tasks") {
    return listEntries(env, chatId, "task");
  }

  if (command === "/exams") {
    return listEntries(env, chatId, "exam");
  }

  if (command === "/week") {
    const today = todayInTZ();
    const end = addDays(today, 6);

    const { results } = await env.DB
      .prepare(
        "SELECT * FROM entries WHERE done = 0 AND due_date >= ? AND due_date <= ? ORDER BY due_date, id LIMIT 30"
      )
      .bind(today, end)
      .all();

    return render(env, chatId, results || [], "📅 This week's plan");
  }

  if (command === "/addtask" || command === "/addexam") {
    const editors = String(env.SCHOOLMATE_EDITOR_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!editors.includes(String(userId))) {
      return send(
        env,
        chatId,
        "Only designated class editors can add shared entries."
      );
    }

    const kind = command === "/addtask" ? "task" : "exam";

    await env.DB
      .prepare(
        `INSERT INTO form_sessions (user_id, kind, step)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           kind = excluded.kind,
           step = excluded.step,
           subject = NULL,
           details = NULL,
           updated_at = CURRENT_TIMESTAMP`
      )
      .bind(userId, kind, "subject")
      .run();

    return send(
      env,
      chatId,
      `Let's add a ${kind}.\n1/3 — Send the subject (e.g. Physics). Use /cancel to stop.`
    );
  }

  if (command) {
    return send(env, chatId, "I don't recognize that command. Use /help.");
  }
}

async function continueForm(env, chatId, userId, text, form) {
  if (form.step === "subject") {
    if (text.length > 80) {
      return send(env, chatId, "Please keep the subject under 80 characters.");
    }

    await env.DB
      .prepare(
        "UPDATE form_sessions SET subject = ?, step = 'details', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
      )
      .bind(text, userId)
      .run();

    return send(env, chatId, "2/3 — Send the task/exam details.");
  }

  if (form.step === "details") {
    if (text.length > 500) {
      return send(env, chatId, "Please keep the details under 500 characters.");
    }

    await env.DB
      .prepare(
        "UPDATE form_sessions SET details = ?, step = 'date', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
      )
      .bind(text, userId)
      .run();

    return send(
      env,
      chatId,
      "3/3 — Send the date as YYYY-MM-DD or Persian/Jalali YYYY/MM/DD (e.g. 2026-10-20 or 1405/07/29)."
    );
  }

  if (form.step === "date") {
    let due;

    try {
      due = parseDate(text);
    } catch {
      return send(
        env,
        chatId,
        "Date not recognized. Use YYYY-MM-DD (Gregorian) or YYYY/MM/DD (Persian/Jalali)."
      );
    }

    if (due < todayInTZ()) {
      return send(env, chatId, "That date is in the past. Please send a future date.");
    }

    const result = await env.DB
      .prepare(
        "INSERT INTO entries (kind, subject, details, due_date, created_by) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(form.kind, form.subject, form.details || "", due, userId)
      .run();

    await env.DB
      .prepare("DELETE FROM form_sessions WHERE user_id = ?")
      .bind(userId)
      .run();

    const label = form.kind === "task" ? "Homework" : "Exam";

    return send(
      env,
      chatId,
      `✅ ${label} #${result.meta.last_row_id} saved for ${due}.`
    );
  }

  console.warn("SchoolMate: unknown form step");
}

async function listEntries(env, chatId, kind) {
  const { results } = await env.DB
    .prepare(
      "SELECT * FROM entries WHERE done = 0 AND kind = ? AND due_date >= ? ORDER BY due_date, id LIMIT 30"
    )
    .bind(kind, todayInTZ())
    .all();

  return render(
    env,
    chatId,
    results || [],
    kind === "task" ? "📚 Upcoming homework" : "📝 Upcoming exams"
  );
}

async function render(env, chatId, rows, title) {
  if (!rows.length) {
    return send(env, chatId, `${title}\n\nNothing scheduled yet.`);
  }

  const lines = [title, ""];

  for (const row of rows) {
    lines.push(
      `${row.kind === "task" ? "📚" : "📝"} #${row.id} · ${row.due_date} · ${row.subject}`
    );

    if (row.details) {
      lines.push(`   ${row.details}`);
    }
  }

  return send(env, chatId, lines.join("\n"));
}

async function sendDailyReminders(env) {
  if (!env.SCHOOLMATE_GROUP_ID || !env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing reminder configuration");
  }

  const today = todayInTZ();

  const { results } = await env.DB
    .prepare(
      "SELECT * FROM entries WHERE done = 0 AND reminder_sent = 0 AND due_date = ? ORDER BY id"
    )
    .bind(today)
    .all();

  for (const row of results || []) {
    const label = row.kind === "task" ? "Homework" : "Exam";

    await send(
      env,
      env.SCHOOLMATE_GROUP_ID,
      `⏰ Reminder for today\n${label}: ${row.subject}\n${row.details}\nDate: ${row.due_date}`
    );

    await env.DB
      .prepare("UPDATE entries SET reminder_sent = 1 WHERE id = ?")
      .bind(row.id)
      .run();
  }
}

async function send(env, chatId, text) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN secret");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram returned HTTP ${response.status}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram sendMessage failed: HTTP ${response.status}; ${data.description || "Unknown Telegram API error"}`
    );
  }
}

function todayInTZ() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const get = (type) => parts.find((part) => part.type === type).value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(iso, n) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

function parseDate(input) {
  const normalized = input
    .trim()
    .replace(/[۰-۹٠-٩]/g, (digit) => {
      const persian = "۰۱۲۳۴۵۶۷۸۹";
      const arabic = "٠١٢٣٤٥٦٧٨٩";
      const index = persian.indexOf(digit);

      return index !== -1 ? String(index) : String(arabic.indexOf(digit));
    })
    .replaceAll("/", "-");

  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (!match) throw new Error("Invalid date format");

  let year = Number(match[1]);
  let month = Number(match[2]);
  let day = Number(match[3]);

  if (year >= 1300 && year <= 1600) {
    [year, month, day] = jalaliToGregorian(year, month, day);
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date");
  }

  return date.toISOString().slice(0, 10);
}

function jalaliToGregorian(jy, jm, jd) {
  if (
    jm < 1 ||
    jm > 12 ||
    jd < 1 ||
    jd > (jm <= 6 ? 31 : 30)
  ) {
    throw new Error("Invalid Jalali date");
  }

  jy += 1595;

  let days =
    -355668 +
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    jd;

  const monthDays = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30];

  for (let i = 1; i < jm; i++) {
    days += monthDays[i - 1];
  }

  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;

  if (days > 36524) {
    gy += 100 * Math.floor((days - 1) / 36524);
    days = (days - 1) % 36524;

    if (days >= 365) days++;
  }

  gy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  let gd = days + 1;

  const leap =
    gy % 4 === 0 && (gy % 100 !== 0 || gy % 400 === 0);

  const monthLengths = [
    31, leap ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31
  ];

  let gm = 1;

  for (const length of monthLengths) {
    if (gd <= length) break;
    gd -= length;
    gm++;
  }

  return [gy, gm, gd];
}
