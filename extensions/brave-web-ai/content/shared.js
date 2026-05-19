"use strict";

// Unique session id per tab (survives SPA navigation within same tab)
const SESSION_ID = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function sendState(state, event, agentId, extra) {
  console.log(`[clawd-bridge] sendState: ${state} / ${event}`);
  chrome.runtime.sendMessage({
    type: "clawd_state",
    payload: {
      state,
      event,
      session_id: SESSION_ID,
      agent_id: agentId,
      ...extra,
    },
  });
}
