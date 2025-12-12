"use strict";

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const ppcInput = document.getElementById('ppc');
  const minPauseInput = document.getElementById('min_pause');
  const autoEnableInput = document.getElementById('auto_enable');
  const hideSubsInput = document.getElementById('hide_subs');
  const hotkeyDisplay = document.getElementById('hotkey_display');
  const saveBtn = document.getElementById('save');

  // Default hotkey state fallback
  let currentHotkey = { 
    code: 'KeyP', 
    ctrlKey: false, 
    altKey: true, 
    shiftKey: false, 
    metaKey: false, 
    display: 'Alt + P' 
  };

  /**
   * 1. Load Settings from Chrome Storage
   */
  chrome.storage.sync.get({ 
    pause_per_char: 0.06, 
    min_pause: 0.5,
    auto_enable: true,
    hide_subs: false,
    hotkey: currentHotkey
  }, (items) => {
    ppcInput.value = items.pause_per_char;
    minPauseInput.value = items.min_pause;
    autoEnableInput.checked = items.auto_enable;
    hideSubsInput.checked = items.hide_subs;
    
    if (items.hotkey) {
      currentHotkey = items.hotkey;
      hotkeyDisplay.value = items.hotkey.display || 'Alt + P';
    }
  });

  /**
   * 2. Hotkey Recorder Logic
   * Captures key combinations when the input field is focused.
   */
  hotkeyDisplay.addEventListener('keydown', (e) => {
    e.preventDefault(); 
    e.stopPropagation();

    // Ignore standalone modifier key presses
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    // Build the display string (e.g., "Ctrl + Shift + K")
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Cmd');
    
    // Clean up the key code (e.g., "KeyP" -> "P")
    const cleanKey = e.code.replace('Key', '').replace('Digit', '');
    parts.push(cleanKey);
    
    const displayString = parts.join(' + ');

    // Update state
    currentHotkey = { 
      code: e.code, 
      ctrlKey: e.ctrlKey, 
      altKey: e.altKey, 
      shiftKey: e.shiftKey, 
      metaKey: e.metaKey, 
      display: displayString 
    };
    
    hotkeyDisplay.value = displayString;
  });

  /**
   * 3. Save Settings
   * Saves to storage and notifies the active tab to update immediately.
   */
  saveBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ 
      pause_per_char: parseFloat(ppcInput.value), 
      min_pause: parseFloat(minPauseInput.value),
      auto_enable: autoEnableInput.checked,
      hide_subs: hideSubsInput.checked,
      hotkey: currentHotkey
    }, () => {
      // Notify the active tab to reload settings without refreshing
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_SETTINGS' });
        }
      });
      window.close();
    });
  });
});