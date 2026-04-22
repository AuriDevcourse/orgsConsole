const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const fmt = (n) => new Intl.NumberFormat("en-US").format(n);
const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// --- lucide icons (only the ones we use) ---
const ICONS = {
  "key":           `<path d="M15 7a4 4 0 1 1 4 4m0 0-9 9H6v-4l9-9"/>`,
  "external-link": `<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>`,
  "shield-check":  `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>`,
  "refresh":       `<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>`,
  "megaphone":     `<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M15 8a5 5 0 0 1 0 8"/><path d="M18 5a9 9 0 0 1 0 14"/>`,
  "send":          `<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>`,
  "mail-plus":     `<path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9"/><path d="m22 7-10 5L2 7"/><path d="M19 16v6"/><path d="M16 19h6"/>`,
  "check":         `<path d="m5 12 5 5L20 7"/>`,
  "alert":         `<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>`,
};
function iconSvg(name) {
  const body = ICONS[name];
  if (!body) return "";
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
function renderIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (el.querySelector(".icon")) return;
    const name = el.getAttribute("data-icon");
    el.insertAdjacentHTML("afterbegin", iconSvg(name));
  });
}

// --- toast ---
function toast({ title, sub, kind = "ok", icon, ttl = 4200 }) {
  const stack = $("#toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  const iconName = icon || (kind === "err" ? "alert" : kind === "warn" ? "alert" : "check");
  el.innerHTML = `
    ${iconSvg(iconName)}
    <div class="toast-body">
      <div class="toast-title">${esc(title)}</div>
      ${sub ? `<div class="toast-sub">${esc(sub)}</div>` : ""}
    </div>
    <button class="toast-close" aria-label="Dismiss">×</button>
  `;
  const kill = () => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 180);
  };
  el.querySelector(".toast-close").onclick = kill;
  stack.appendChild(el);
  if (ttl > 0) setTimeout(kill, ttl);
}

function wrapCollapsible(el, limit = 5) {
  if (!el) return;
  const prev = el.parentNode && el.parentNode.querySelector(":scope > .show-more");
  if (prev) prev.remove();
  el.classList.remove("collapsed");
  const count = el.children.length;
  if (count <= limit) return;
  el.classList.add("collapsed");
  const btn = document.createElement("button");
  btn.className = "show-more";
  btn.textContent = `Show all ${count}`;
  btn.onclick = () => {
    const collapsed = el.classList.toggle("collapsed");
    btn.textContent = collapsed ? `Show all ${count}` : "Show less";
  };
  el.after(btn);
}

// --- tabs ---
const TAB_KEY = "orgs.activeTab";
function activateTab(id) {
  const valid = Array.from($$(".tab")).some((t) => t.dataset.tab === id);
  if (!valid) return false;
  $$(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === id));
  $$(".panel-grid").forEach((p) => p.classList.toggle("hidden", p.id !== `tab-${id}`));
  try { localStorage.setItem(TAB_KEY, id); } catch {}
  return true;
}
$$(".tab").forEach((t) => t.addEventListener("click", () => activateTab(t.dataset.tab)));
try {
  const saved = localStorage.getItem(TAB_KEY);
  if (saved) activateTab(saved);
} catch {}

// --- clock ---
const pad = (n) => String(n).padStart(2, "0");
function tick() {
  const d = new Date();
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())} CEST`;
  $("#now").textContent = `${date} · ${t}`;
}
tick(); setInterval(tick, 30000);

// --- countdown ---
function countdown(target) {
  const diff = new Date(target) - new Date();
  const days = Math.ceil(diff / 86400000);
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "today";
  return `${days} days remaining`;
}

// --- LYS ---
async function loadLYS() {
  const d = await fetch("/api/lys").then((r) => r.json());

  $("#lys-name").textContent = d.name;
  $("#lys-name-local").textContent = d.nameLocal;
  $("#lys-board-count").textContent = fmt(d.boardMembers.length);
  $("#lys-events").textContent = fmt(d.upcomingEvents.length);
  $("#lys-meetings").textContent = fmt(d.recentMeetings.length);

  const fundingCard = document.querySelector(".funding-card");
  if (d.fundingAmount) {
    $("#lys-funding-amount").textContent = d.fundingAmount;
    $("#lys-funding-label").textContent = d.fundingLabel || "";
    $("#lys-countdown").textContent = countdown("2026-05-01");
    if (fundingCard) fundingCard.classList.remove("hidden");
  } else if (fundingCard) {
    fundingCard.classList.add("hidden");
  }

  const evEl = $("#lys-events-list");
  let calItems = [];
  try {
    const cal = await fetch("/api/lys/calendar").then((r) => r.ok ? r.json() : []);
    calItems = Array.isArray(cal) ? cal : [];
  } catch {}
  const vaultItems = d.upcomingEvents.map((e) => ({ label: e.name, sub: e.date || "", source: "vault" }));
  const calMapped = calItems.map((e) => ({
    label: e.summary || "(no title)",
    sub: (e.start || "").slice(0, 16).replace("T", " ") + (e.location ? ` · ${e.location}` : ""),
    source: "calendar",
    url: e.htmlLink,
  }));
  const merged = [...calMapped, ...vaultItems];
  evEl.innerHTML = merged.length ? merged.map((e) => `
    <li>
      <span>${e.url ? `<a href="${esc(e.url)}" target="_blank">${esc(e.label)}</a>` : esc(e.label)}</span>
      <span class="item-sub">${esc(e.sub)} · ${e.source}</span>
    </li>
  `).join("") : `<li class="empty">No events found</li>`;

  const mEl = $("#lys-meetings-list");
  mEl.innerHTML = d.recentMeetings.length ? d.recentMeetings.map((m) => `
    <li><span>${esc(m.name)}</span><span class="item-sub">${esc(m.date)}</span></li>
  `).join("") : `<li class="empty">No meeting notes found</li>`;

  wrapCollapsible($("#lys-events-list"), 5);
  wrapCollapsible($("#lys-meetings-list"), 5);
}

// --- LTBB ---
let LTBB = null;
let LTBB_SYNC = {};
let ltbbFilter = "all";

function gmailCell(p) {
  const s = LTBB_SYNC[p.email];
  if (!p.email) return `<span class="item-sub">no email</span>`;
  if (!s) return `<span class="item-sub">not synced</span>`;
  if (s.hasReceived) return `<span class="status-active">reply ✓</span>`;
  if (s.hasSent) return `<span>sent</span>`;
  return `<span class="item-sub">no thread</span>`;
}

function actionCell(p) {
  if (!p.email) return "";
  return `<button class="btn ghost btn-sm" data-draft="${esc(p.email)}" data-icon="mail-plus">Draft</button>`;
}

function renderPartners() {
  const rows = (LTBB?.partners || []).filter((p) => {
    if (ltbbFilter === "pending") return p.status === "Nesusisiekta" || !p.status;
    if (ltbbFilter === "contacted") return p.status && p.status !== "Nesusisiekta";
    return true;
  });
  const tbody = $("#ltbb-partners");
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="4" class="empty">no rows</td></tr>`; return; }
  tbody.innerHTML = rows.map((p, i) => {
    const s = LTBB_SYNC[p.email];
    const stat = s?.hasReceived ? "status-active"
      : s?.hasSent ? "status-active"
      : (p.status === "Nesusisiekta" || !p.status) ? "status-pending"
      : "status-active";
    const statusText = s?.hasReceived ? "Reply"
      : s?.hasSent ? "Contacted"
      : (p.status === "Nesusisiekta" || !p.status) ? "Pending"
      : p.status;
    const risk = (p.scandals || "").match(/HIGH/i) ? "risk-high"
      : (p.scandals || "").match(/LOW/i) ? "risk-med"
      : "risk-low";
    const detailsHtml = `
      <tr class="partner-detail hidden" data-row="${i}">
        <td colspan="4">
          <div class="partner-detail-grid">
            <div><span class="dtl-lbl">Category</span><span class="category-chip">${esc(p.category)}</span></div>
            <div><span class="dtl-lbl">Contact</span>${esc(p.contact || "·")}${p.role ? ` · <span class="item-sub">${esc(p.role)}</span>` : ""}</div>
            <div><span class="dtl-lbl">Risk</span><span class="${risk}">${esc((p.scandals || "·"))}</span></div>
            <div><span class="dtl-lbl">Email</span>${esc(p.email || "·")}</div>
            ${p.note ? `<div class="partner-note"><span class="dtl-lbl">Note</span>${esc(p.note)}</div>` : ""}
          </div>
        </td>
      </tr>`;
    return `
      <tr class="partner-row" data-row="${i}">
        <td><strong>${esc(p.company)}</strong></td>
        <td class="${stat}">${esc(statusText)}</td>
        <td>${gmailCell(p)}</td>
        <td>${actionCell(p)}</td>
      </tr>
      ${detailsHtml}
    `;
  }).join("");
  renderIcons(tbody);
}

async function syncLtbbGmail() {
  const btn = $("#ltbb-sync-btn");
  const hint = $("#ltbb-sync-hint");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${iconSvg("refresh")}Syncing…`;
  try {
    const r = await fetch("/api/ltbb/gmail-sync");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    LTBB_SYNC = {};
    for (const row of d.results || []) LTBB_SYNC[row.email] = row;
    const total = Object.keys(LTBB_SYNC).length;
    const sentCount = Object.values(LTBB_SYNC).filter((x) => x.hasSent).length;
    const replyCount = Object.values(LTBB_SYNC).filter((x) => x.hasReceived).length;
    hint.textContent = `Synced ${total} partners · ${sentCount} contacted · ${replyCount} replies`;
    toast({ title: "Gmail sync complete", sub: `${total} partners · ${sentCount} contacted · ${replyCount} replies`, kind: "ok" });
    renderPartners();
  } catch (e) {
    hint.textContent = `Sync failed: ${e.message}`;
    toast({ title: "Gmail sync failed", sub: e.message, kind: "err" });
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function createDraftFor(email) {
  try {
    const r = await fetch("/api/ltbb/drafts/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    toast({
      title: `Draft created for ${email}`,
      sub: `Subject: ${d.subject || "(no subject)"} · open Gmail Drafts to review`,
      kind: "ok",
      icon: "mail-plus",
      ttl: 6000,
    });
  } catch (e) {
    toast({ title: "Draft failed", sub: `${email}: ${e.message}`, kind: "err" });
  }
}

document.addEventListener("click", (e) => {
  const target = e.target;
  if (target?.id === "ltbb-sync-btn") return syncLtbbGmail();
  if (target?.id === "aiw-compose-toggle") {
    $("#aiw-compose").classList.toggle("hidden");
    return;
  }
  if (target?.id === "aiw-compose-send") return sendWhatsApp();
  const draftEmail = target?.dataset?.draft;
  if (draftEmail) { e.stopPropagation(); return createDraftFor(draftEmail); }
  const row = target?.closest?.(".partner-row");
  if (row) {
    const idx = row.dataset.row;
    const detail = row.parentNode.querySelector(`.partner-detail[data-row="${idx}"]`);
    if (detail) detail.classList.toggle("hidden");
  }
});

async function sendWhatsApp() {
  const ta = $("#aiw-compose-text");
  const hint = $("#aiw-compose-hint");
  const btn = $("#aiw-compose-send");
  const text = (ta.value || "").trim();
  if (!text) { hint.textContent = "Type something first."; return; }
  if (!confirm(`Send this to the AI Workshops group?\n\n${text}`)) return;
  btn.disabled = true;
  hint.textContent = "Sending…";
  try {
    const r = await fetch("/api/aiworkshop/whatsapp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `status ${r.status}`);
    ta.value = "";
    hint.textContent = `Sent at ${new Date().toLocaleTimeString()}`;
    loadAIW().catch(() => {});
  } catch (err) {
    hint.textContent = `Failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function loadLTBB() {
  LTBB = await fetch("/api/ltbb").then((r) => r.json());

  $("#ltbb-name").textContent = LTBB.name;
  $("#ltbb-name-local").textContent = LTBB.nameLocal;
  $("#ltbb-total").textContent = fmt(LTBB.totalCount);
  $("#ltbb-pending").textContent = fmt(LTBB.pendingCount);
  $("#ltbb-contacted").textContent = fmt(LTBB.contactedCount);

  $("#ltbb-template").textContent = LTBB.emailTemplate || "template not found";

  const cats = Object.entries(LTBB.partnersByCategory).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...cats.map((c) => c[1]), 1);
  $("#ltbb-categories").innerHTML = cats.map(([cat, n]) => `
    <li>
      <div class="bar-row">
        <span>${esc(cat || "Uncategorized")}</span>
        <span class="count">${n}</span>
      </div>
      <div class="bar-fill" style="width:${(n / max) * 100}%"></div>
    </li>
  `).join("") || `<li class="empty">no data</li>`;

  renderPartners();
}

$$(".chip").forEach((c) => c.addEventListener("click", () => {
  $$(".chip").forEach((x) => x.classList.remove("active"));
  c.classList.add("active");
  ltbbFilter = c.dataset.filter;
  renderPartners();
}));

// --- Google status (multi-account) ---
function applyStatus(acc, pillId, hintId, btnId) {
  const pill = $(pillId);
  const hint = $(hintId);
  if (!acc) { pill.textContent = "unknown"; return; }
  if (acc.authorized) {
    pill.textContent = acc.email;
    pill.classList.add("ok");
    if (hint) hint.textContent = `Authorized · ${acc.scopes?.length || 0} scopes`;
    if (btnId) {
      const btn = $(btnId);
      if (btn) {
        btn.innerHTML = `${iconSvg("key")}Re-authorize`;
        btn.setAttribute("data-icon", "key");
        btn.classList.remove("primary");
        btn.classList.add("ghost");
      }
    }
  } else if (acc.hasCredentials) {
    pill.textContent = "not authorized";
    pill.classList.add("warn");
  } else {
    pill.textContent = "no credentials";
    pill.classList.add("off");
    if (hint) hint.textContent = "Upload client_secret.json to credentials/<account>/";
  }
}

async function loadGoogleStatus() {
  try {
    const s = await fetch("/api/google/status").then((r) => r.json());
    applyStatus(s.lys, "#lys-google-status", "#lys-google-hint");
    applyStatus(s.auri, "#auri-google-status", "#auri-google-hint", "#auri-authorize-btn");

    const gmailRow = $("#integ-gmail");
    if (gmailRow) {
      const dot = gmailRow.querySelector(".int-dot");
      const label = gmailRow.querySelector(".mono");
      if (s.auri?.authorized) {
        dot.className = "int-dot ok";
        label.textContent = s.auri.email;
      } else {
        dot.className = "int-dot warn";
        label.textContent = "not authorized";
      }
    }
  } catch (e) { console.error("google status:", e); }
}

// --- LYS latest meeting ---
async function loadLatestMeeting() {
  try {
    const r = await fetch("/api/lys/meetings/latest");
    if (!r.ok) {
      $("#lys-meeting-date").textContent = "unavailable";
      return;
    }
    const m = await r.json();
    $("#lys-meeting-date").textContent = m.ref.date || m.ref.name;
    const link = $("#lys-latest-doc-link");
    if (link) link.href = m.ref.url;

    const render = (items, el, empty) => {
      el.innerHTML = items.length
        ? items.map((t) => `<li>${esc(t)}</li>`).join("")
        : `<li class="empty">${empty}</li>`;
    };

    const happened = [
      ...m.pastTasks.map((t) => ({ kind: "task", text: t })),
      ...(m.discussion || []).map((d) => ({ kind: "disc", text: d.topic })),
    ];
    const pastEl = $("#lys-past-tasks");
    pastEl.innerHTML = happened.length
      ? happened.map((h) => `<li><span class="task-kind ${h.kind}"></span>${esc(h.text)}</li>`).join("")
      : `<li class="empty">no recap yet</li>`;
    render(m.newTasks, $("#lys-new-tasks"), "no next items yet");
    wrapCollapsible(pastEl, 4);
    wrapCollapsible($("#lys-new-tasks"), 4);

    $("#lys-past-count").textContent = happened.length;
    $("#lys-new-count").textContent = m.newTasks.length;
  } catch (e) { console.error("latest meeting:", e); }
}

// --- AI Workshop ---
async function loadAIW() {
  const d = await fetch("/api/aiworkshop").then((r) => r.json());

  $("#aiw-members").textContent = fmt(d.memberCount);
  $("#aiw-past").textContent = fmt(d.pastSessionCount);
  $("#aiw-next").textContent = d.upcomingSession || "–";

  const wa = d.whatsapp || {};
  const statusPill = $("#aiw-wa-status");
  const hint = $("#aiw-wa-hint");
  const qrWrap = $("#aiw-qr-wrap");
  const qrImg = $("#aiw-qr-img");
  const composeToggle = $("#aiw-compose-toggle");
  const composeSend = $("#aiw-compose-send");
  const composeGroup = $("#aiw-compose-group");
  statusPill.className = "pill";
  if (composeGroup) composeGroup.textContent = wa.group || "AI Workshops";
  if (composeToggle) composeToggle.disabled = !wa.connected;
  if (composeSend) composeSend.disabled = !wa.connected;
  if (wa.connected) {
    statusPill.textContent = wa.group || "connected";
    statusPill.classList.add("ok");
    if (wa.lastSync) hint.textContent = `Last sync: ${wa.lastSync}`;
    qrWrap.classList.add("hidden");
  } else if (wa.qrPending) {
    statusPill.textContent = "scan QR";
    statusPill.classList.add("warn");
    hint.textContent = "Open WhatsApp on your phone and scan the QR below.";
    qrImg.src = `/api/aiworkshop/qr?t=${Date.now()}`;
    qrWrap.classList.remove("hidden");
  } else if (wa.error) {
    statusPill.textContent = "offline";
    statusPill.classList.add("warn");
    hint.textContent = wa.error;
    qrWrap.classList.add("hidden");
  } else {
    statusPill.textContent = "unknown";
    statusPill.classList.add("off");
    qrWrap.classList.add("hidden");
  }

  const actions = d.actionItemsPending || [];
  $("#aiw-actions-count").textContent = `${actions.length} pending`;
  $("#aiw-actions").innerHTML = actions.length ? actions.map((t) => `
    <li><span class="chk"></span><span class="task-text">${esc(t.text)}</span></li>
  `).join("") : `<li class="empty">no pending action items</li>`;

  const msgs = wa.messages || [];
  $("#aiw-wa-count").textContent = `${msgs.length} msgs`;
  $("#aiw-wa-messages").innerHTML = msgs.length ? msgs.slice().reverse().map((m) => {
    const when = new Date(m.ts * 1000).toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `<li>
      <span class="topic">${esc(m.name || m.from)}</span>
      <span class="item-sub">${esc(m.text).slice(0, 200)} · ${when}</span>
    </li>`;
  }).join("") : `<li class="empty">no messages yet (daemon not running or empty group)</li>`;

  const sessions = d.sessions || [];
  $("#aiw-sessions").innerHTML = sessions.length ? sessions.map((s) => `
    <li><span>#${s.num} · ${esc(s.date)}</span><span class="item-sub">${esc(s.topic || "")}</span></li>
  `).join("") : `<li class="empty">no sessions parsed</li>`;

  const members = d.members || [];
  $("#aiw-members-list").innerHTML = members.length ? members.map((m) => `
    <li><span>${esc(m.name)}</span><span class="item-sub">${esc(m.status)}</span></li>
  `).join("") : `<li class="empty">no members parsed</li>`;

  wrapCollapsible($("#aiw-actions"), 5);
  wrapCollapsible($("#aiw-wa-messages"), 5);
  wrapCollapsible($("#aiw-sessions"), 5);
  wrapCollapsible($("#aiw-members-list"), 6);
}

// --- LPC ---
async function loadLPC() {
  const d = await fetch("/api/lpc").then((r) => r.json());

  $("#lpc-members").textContent = fmt(d.memberCount);
  $("#lpc-events-count").textContent = fmt(d.summary?.events?.length || 0);
  $("#lpc-topics-count").textContent = fmt(d.summary?.topics?.length || 0);

  const wa = d.whatsapp || {};
  const statusPill = $("#lpc-wa-status");
  const hint = $("#lpc-wa-hint");
  statusPill.className = "pill";
  if (wa.connected) {
    statusPill.textContent = wa.group || "connected";
    statusPill.classList.add("ok");
    if (wa.lastSync) hint.textContent = `Last sync: ${wa.lastSync}`;
  } else if (wa.error) {
    statusPill.textContent = "offline";
    statusPill.classList.add("warn");
    hint.textContent = wa.error;
  } else {
    statusPill.textContent = "unknown";
    statusPill.classList.add("off");
  }

  const events = d.summary?.events || [];
  $("#lpc-events-pill").textContent = events.length ? `${events.length}` : "none";
  $("#lpc-events").innerHTML = events.length ? events.map((e) => `
    <li>
      <span>${esc(e.title)}</span>
      <span class="item-sub">${esc(e.date || "")}${e.details ? ` · ${esc(e.details)}` : ""}</span>
    </li>
  `).join("") : `<li class="empty">no summary yet — click Refresh AI summary</li>`;

  const topics = d.summary?.topics || [];
  $("#lpc-topics-pill").textContent = topics.length ? `${topics.length}` : "none";
  $("#lpc-topics").innerHTML = topics.length ? topics.map((t) => `
    <li>
      <span class="topic">${esc(t.title)}</span>
      <span class="item-sub">${esc(t.summary)}</span>
    </li>
  `).join("") : `<li class="empty">no summary yet — click Refresh AI summary</li>`;

  const msgs = wa.messages || [];
  $("#lpc-wa-count").textContent = `${msgs.length} msgs`;
  $("#lpc-wa-messages").innerHTML = msgs.length ? msgs.slice().reverse().map((m) => {
    const when = new Date(m.ts * 1000).toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `<li>
      <span class="topic">${esc(m.name || m.from)}</span>
      <span class="item-sub">${esc(m.text).slice(0, 200)} · ${when}</span>
    </li>`;
  }).join("") : `<li class="empty">no messages yet (daemon not running or empty group)</li>`;

  const members = d.members || [];
  $("#lpc-members-list").innerHTML = members.length ? members.map((m) => `
    <li><span>${esc(m.name)}</span><span class="item-sub">${esc(m.role)}</span></li>
  `).join("") : `<li class="empty">no members yet (daemon not running)</li>`;

  const sHint = $("#lpc-summary-hint");
  if (d.summary?.refreshedAt) {
    const t = new Date(d.summary.refreshedAt).toLocaleString();
    sHint.textContent = `Summary refreshed ${t} · ${d.summary.model || ""}`;
  } else {
    sHint.textContent = "No AI summary yet.";
  }

  wrapCollapsible($("#lpc-events"), 5);
  wrapCollapsible($("#lpc-topics"), 5);
  wrapCollapsible($("#lpc-wa-messages"), 5);
  wrapCollapsible($("#lpc-members-list"), 8);
}

async function refreshLPCSummary() {
  const btn = $("#lpc-refresh-summary");
  const hint = $("#lpc-summary-hint");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${iconSvg("refresh")}Summarizing…`;
  try {
    const r = await fetch("/api/lpc/summarize", { method: "POST" });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `status ${r.status}`);
    hint.textContent = `Summary refreshed · ${d.events?.length || 0} events · ${d.topics?.length || 0} topics`;
    toast({ title: "LPC summary refreshed", sub: `${d.events?.length || 0} events · ${d.topics?.length || 0} topics`, kind: "ok" });
    await loadLPC();
  } catch (e) {
    hint.textContent = `Refresh failed: ${e.message}`;
    toast({ title: "LPC summary failed", sub: e.message, kind: "err" });
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

document.addEventListener("click", (e) => {
  if (e.target?.id === "lpc-refresh-summary") return refreshLPCSummary();
});

// --- boot ---
renderIcons();
loadGoogleStatus();
loadLatestMeeting();
loadLYS().catch((e) => { console.error("LYS load:", e); toast({ title: "LYS failed to load", sub: e.message, kind: "err" }); });
loadLTBB().catch((e) => { console.error("LTBB load:", e); toast({ title: "LTBB failed to load", sub: e.message, kind: "err" }); });
loadAIW().catch((e) => { console.error("AIW load:", e); toast({ title: "AI Workshop failed to load", sub: e.message, kind: "err" }); });
loadLPC().catch((e) => { console.error("LPC load:", e); toast({ title: "LPC failed to load", sub: e.message, kind: "err" }); });
setInterval(() => loadAIW().catch(() => {}), 5000);
setInterval(() => loadLPC().catch(() => {}), 10000);
