"use strict";

// shared.js is injected first: SESSION_ID and sendState() are available

const AGENT_ID = "chatgpt-web";
const CHECK_INTERVAL_MS = 600;

// Selectors — ordered by reliability (most specific first)
const STOP_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label="Stop streaming"]',
  'button.stop-streaming',
];

const SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send message"]',
  'button[aria-label="Send prompt"]',
];

const MSG_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '.markdown.prose',
  '[class*="agent-turn"]',
];

function isStopVisible() {
  return STOP_SELECTORS.some((sel) => {
    const el = document.querySelector(sel);
    return el && !el.disabled && el.offsetParent !== null;
  });
}

function lastAssistantMsgLength() {
  const nodes = document.querySelectorAll(MSG_SELECTORS[0] || MSG_SELECTORS[1]);
  if (!nodes.length) return 0;
  return nodes[nodes.length - 1].textContent.length;
}

let state = "idle"; // idle | thinking | working | attention
let prevStopVisible = false;
let prevMsgLen = 0;
let sessionStarted = false;

function extra() {
  const raw = document.title || "ChatGPT";
  const title = raw.replace(/\s*[-|]\s*ChatGPT\s*$/i, "").trim() || "ChatGPT";
  return {
    session_title: title,
    cwd: window.location.href,
  };
}

function tick() {
  const stopNow = isStopVisible();
  const msgLen = lastAssistantMsgLength();

  if (!sessionStarted) {
    sessionStarted = true;
    sendState("idle", "SessionStart", AGENT_ID, extra());
    state = "idle";
  }

  if (stopNow && !prevStopVisible) {
    sendState("thinking", "UserPromptSubmit", AGENT_ID, extra());
    state = "thinking";
  } else if (!stopNow && prevStopVisible) {
    sendState("attention", "Stop", AGENT_ID, extra());
    state = "attention";
  } else if (stopNow && msgLen > prevMsgLen) {
    if (state !== "working") {
      sendState("working", "PreToolUse", AGENT_ID, extra());
      state = "working";
    }
  }

  prevStopVisible = stopNow;
  prevMsgLen = msgLen;
}

// Use MutationObserver for responsiveness + interval as fallback
const observer = new MutationObserver(tick);
observer.observe(document.body, { childList: true, subtree: true });
setInterval(tick, CHECK_INTERVAL_MS);

// SessionEnd on unload
window.addEventListener("pagehide", () => {
  sendState("sleeping", "SessionEnd", AGENT_ID);
});
