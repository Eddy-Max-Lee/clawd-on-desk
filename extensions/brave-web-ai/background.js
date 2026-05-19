"use strict";

const CLAWD_HEADER = "x-clawd-server";
const CLAWD_ID = "clawd-on-desk";
const PORTS = [23333, 23334, 23335, 23336, 23337];
const PROBE_TIMEOUT_MS = 500;
const POST_TIMEOUT_MS = 2000;

let cachedPort = null;

// sessionId → tabId (for tab focus)
const sessionTabMap = new Map();

// tabIds created very recently (to distinguish clawd-opened tabs from normal navigation)
const recentlyCreatedTabs = new Set();

async function probePort(port) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`http://127.0.0.1:${port}/state`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.headers.get(CLAWD_HEADER) === CLAWD_ID ? port : null;
  } catch {
    return null;
  }
}

async function discoverPort() {
  for (const port of PORTS) {
    const found = await probePort(port);
    if (found) return found;
  }
  return null;
}

async function getPort() {
  if (cachedPort) {
    const ok = await probePort(cachedPort);
    if (ok) return cachedPort;
    cachedPort = null;
  }
  cachedPort = await discoverPort();
  return cachedPort;
}

async function postState(payload) {
  const port = await getPort();
  if (!port) {
    console.warn("[clawd-bridge] clawd server not found on ports", PORTS);
    return;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
    // text/plain avoids CORS preflight; server parses JSON regardless of Content-Type
    const res = await fetch(`http://127.0.0.1:${port}/state`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    console.log(`[clawd-bridge] POST /state → ${res.status} (${payload.state}/${payload.event})`);
  } catch (err) {
    console.error("[clawd-bridge] fetch failed:", err.message);
    cachedPort = null;
  }
}

// ── Message handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "clawd_state") return;

  const tabId = sender.tab && sender.tab.id;
  const windowId = sender.tab && sender.tab.windowId;
  const payload = { ...msg.payload };

  // Track which tab owns this session
  if (tabId && payload.session_id) {
    sessionTabMap.set(payload.session_id, { tabId, windowId });
  }

  // Embed tabId in CWD URL fragment so clawd's openExternal carries it back
  if (tabId && payload.cwd && payload.cwd.startsWith("http")) {
    const baseUrl = payload.cwd.split("#")[0];
    payload.cwd = `${baseUrl}#clawd-tab=${tabId}`;
  }

  postState(payload);
});

// ── Tab focus intercept ────────────────────────────────────────────────────
// Track newly created tabs so we only intercept clawd-opened ones
chrome.tabs.onCreated.addListener((tab) => {
  recentlyCreatedTabs.add(tab.id);
  setTimeout(() => recentlyCreatedTabs.delete(tab.id), 5000);
});

// When clawd does shell.openExternal(url#clawd-tab=ID), a new tab opens.
// We close it and focus the original tab instead.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!recentlyCreatedTabs.has(tabId)) return;

  const url = changeInfo.url || tab.url || "";
  if (!url.includes("#clawd-tab=")) return;

  const match = url.match(/#clawd-tab=(\d+)/);
  if (!match) return;

  const originalTabId = parseInt(match[1], 10);
  if (originalTabId === tabId) return;

  recentlyCreatedTabs.delete(tabId);

  chrome.tabs.remove(tabId, () => {
    chrome.tabs.get(originalTabId, (originalTab) => {
      if (chrome.runtime.lastError || !originalTab) return;
      chrome.tabs.update(originalTabId, { active: true }, () => {
        chrome.windows.update(originalTab.windowId, { focused: true });
      });
    });
  });
});
