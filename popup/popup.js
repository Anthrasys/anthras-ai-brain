// Popup script for Anthra's AI Brain

const toggleOverlay = document.getElementById('toggleOverlay');
const toggleShowAll = document.getElementById('toggleShowAll');
const toggleNetMode = document.getElementById('toggleNetMode');
const toggleGambleMode = document.getElementById('toggleGambleMode');

// Load stored settings
chrome.storage?.local?.get(['rngidle_overlay_enabled', 'rngidle_show_all_items', 'rngidle_net_mode', 'rngidle_gamble_mode'], (res) => {
  if (res.rngidle_overlay_enabled !== undefined) toggleOverlay.checked = res.rngidle_overlay_enabled;
  if (res.rngidle_show_all_items !== undefined) toggleShowAll.checked = res.rngidle_show_all_items;
  if (res.rngidle_net_mode !== undefined) toggleNetMode.checked = res.rngidle_net_mode;
  if (res.rngidle_gamble_mode !== undefined) toggleGambleMode.checked = res.rngidle_gamble_mode;
});

function saveAndNotify(key, value) {
  const patch = { [key]: value };
  chrome.storage?.local?.set(patch);

  // Notify active tab
  chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'RNGIDLE_SETTING_CHANGED', key, value });
    }
  });
}

toggleOverlay?.addEventListener('change', () => {
  saveAndNotify('rngidle_overlay_enabled', toggleOverlay.checked);
});

toggleShowAll?.addEventListener('change', () => {
  saveAndNotify('rngidle_show_all_items', toggleShowAll.checked);
});

toggleNetMode?.addEventListener('change', () => {
  saveAndNotify('rngidle_net_mode', toggleNetMode.checked);
});

toggleGambleMode?.addEventListener('change', () => {
  saveAndNotify('rngidle_gamble_mode', toggleGambleMode.checked);
});
