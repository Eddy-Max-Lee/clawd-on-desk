"use strict";

// shared.js injected first: SESSION_ID and sendState() available

console.log("[clawd-bridge] gemini.js injected", window.location.href);

const AGENT_ID = "gemini-web";
const CHECK_INTERVAL_MS = 400;
const GENERATION_IDLE_MS = 1800; // declare done after this long with no new content

// Response selectors — broadest first
const RESPONSE_SELECTORS = [
  "model-response",
  "message-content",
  "response-container",
  ".model-response-text",
  "[data-test-id*='response']",
];

function getLastResponseNode() {
  for (const sel of RESPONSE_SELECTORS) {
    const nodes = document.querySelectorAll(sel);
    if (nodes.length) return nodes[nodes.length - 1];
  }
  return null;
}

function getResponseSnapshot() {
  const node = getLastResponseNode();
  return {
    count: (() => {
      for (const sel of RESPONSE_SELECTORS) {
        const n = document.querySelectorAll(sel).length;
        if (n) return n;
      }
      return 0;
    })(),
    len: node ? node.textContent.length : 0,
  };
}

function extra() {
  const raw = document.title || "Gemini";
  const title = raw.replace(/\s*[-|]\s*Gemini\s*$/i, "").trim() || "Gemini";
  return {
    session_title: title,
    cwd: window.location.href,
  };
}

let sessionStarted = false;
let state = "idle";          // idle | thinking | working | attention
let isGenerating = false;
let lastActivityMs = 0;      // last time content changed
let prevCount = 0;
let prevLen = 0;

function tick() {
  try {
    if (!sessionStarted) {
      sessionStarted = true;
      sendState("idle", "SessionStart", AGENT_ID, extra());
    }

    const { count, len } = getResponseSnapshot();
    const now = Date.now();
    const contentGrew = len > prevLen || count > prevCount;

    if (contentGrew) {
      lastActivityMs = now;

      if (!isGenerating) {
        // Generation just started
        isGenerating = true;
        sendState("thinking", "UserPromptSubmit", AGENT_ID, extra());
        state = "thinking";
      } else if (state !== "working") {
        sendState("working", "PreToolUse", AGENT_ID, extra());
        state = "working";
      }
    }

    // Declare done when no new content for GENERATION_IDLE_MS
    if (isGenerating && !contentGrew && lastActivityMs > 0 && (now - lastActivityMs) >= GENERATION_IDLE_MS) {
      isGenerating = false;
      lastActivityMs = 0;
      sendState("attention", "Stop", AGENT_ID, extra());
      state = "attention";
    }

    prevCount = count;
    prevLen = len;
  } catch (err) {
    console.error("[clawd-bridge] gemini tick error:", err);
  }
}

const observer = new MutationObserver(tick);
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
setInterval(tick, CHECK_INTERVAL_MS);

window.addEventListener("pagehide", () => {
  sendState("sleeping", "SessionEnd", AGENT_ID, extra());
});
