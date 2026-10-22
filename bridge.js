// bridge.js - Isolated World Bridge for RNGidle Mod
// Handles Chrome Extension APIs (storage, popup messages) and forwards to MAIN world.

// Forward initial settings
chrome.storage?.local?.get(['rngidle_overlay_enabled', 'rngidle_show_all_items', 'rngidle_net_mode', 'rngidle_gamble_mode'], (settings) => {
  window.postMessage({
    type: 'RNGIDLE_SETTINGS_INIT',
    settings: {
      enabled: settings.rngidle_overlay_enabled ?? true,
      showAll: settings.rngidle_show_all_items ?? true,
      netMode: settings.rngidle_net_mode ?? true,
      gambleMode: settings.rngidle_gamble_mode ?? false
    }
  }, '*');
});

// Listen for popup messages
chrome.runtime?.onMessage?.addListener((msg) => {
  if (msg?.type === 'RNGIDLE_SETTING_CHANGED') {
    window.postMessage({
      type: 'RNGIDLE_SETTING_UPDATE',
      key: msg.key,
      value: msg.value
    }, '*');
  }
});

// Listen for settings save from in-game overlay
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;
  if (event.data.type === 'RNGIDLE_SAVE_SETTING') {
    chrome.storage?.local?.set({ [event.data.key]: event.data.value });
  }
});
