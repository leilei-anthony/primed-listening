"use strict";

/**
 * Primed Listening - Content Script
 * * Purpose:
 * 1. Monitors video playback on YouTube and Netflix.
 * 2. Detects subtitle changes via MutationObserver.
 * 3. Pauses video automatically after a subtitle line is completed.
 * 4. Hides specific UI elements (Netflix overlays, ratings, controls) to provide
 * a seamless "cinematic" study experience.
 */

// ==========================================
// 1. CONFIGURATION & STATE MANAGEMENT
// ==========================================

let settings = {
    pause_per_char: 0.06,  // Default seconds per character
    min_pause: 0.5,        // Minimum pause duration in seconds
    max_pause: 2.0,       // Maximum pause duration in seconds (<-- NEW)
    min_chars: 2,          // Minimum characters to trigger a pause
    hide_subs: false,      // User preference: Hide subs while listening?
    hotkey: {              // Default Toggle Key: Alt + X
        code: 'KeyP', 
        altKey: true, 
        ctrlKey: false, 
        shiftKey: false, 
        metaKey: false 
    }
};

let state = {
    enabled: false,       // Master extension toggle
    isAutoPaused: false,  // Is the script currently holding a pause?
    isPauseLocked: false, // Did user manually extend the pause (Lock Mode)?
    timerId: null,        // Reference to the active resume timer
    lastSubText: "",      // Buffer to prevent duplicate pauses on the same line
    uiHidden: false       // Track if we are currently forcing the Netflix UI to hide
};


// ==========================================
// 2. CSS INJECTION
// ==========================================
// We inject dynamic CSS to handle subtitle visibility and to suppress 
// Netflix's aggressive UI overlays during auto-pauses.

const style = document.createElement('style');
style.innerHTML = `
  /* --- Feature: Hide Subtitles (during playback) --- */
  .pl-hidden-sub { opacity: 0 !important; }
  .pl-show-sub { opacity: 1 !important; }

  /* --- Feature: Netflix UI Suppression (The "Nuclear" List) --- */
  /* Targets every layer of the Netflix interface to prevent flashing 
     controls or rating warnings when the script pauses/resumes. */
  
  /* 1. Content Warnings & Ratings (e.g., "Rated 16+") */
  .pl-netflix-ui-hidden .evidence-overlay,
  .pl-netflix-ui-hidden .advisory,
  .pl-netflix-ui-hidden div[data-uia="advisory-info"],
  .pl-netflix-ui-hidden div[data-uia="content-warning"],

  /* 2. Top Controls (Back Arrow, Flag Report) */
  .pl-netflix-ui-hidden .watch-video--back-container,
  .pl-netflix-ui-hidden .watch-video--flag-container,

  /* 3. Bottom Controls (Timeline, Volume, Episode Select) */
  .pl-netflix-ui-hidden .watch-video--bottom-controls-container,
  .pl-netflix-ui-hidden div[data-uia="controls-standard"],
  
  /* 4. General Overlays, Touch Layers & Center Animations */
  .pl-netflix-ui-hidden .nfp-chrome-controls,
  .pl-netflix-ui-hidden .PlayerControlsNeo__layout, 
  .pl-netflix-ui-hidden .touch-overlay,
  .pl-netflix-ui-hidden .watch-video--player-view-overlay,
  .pl-netflix-ui-hidden div[data-uia="player-gui"],
  .pl-netflix-ui-hidden div[data-uia="player-status-animation"], /* Center Play/Pause Icon */
  .pl-netflix-ui-hidden .player-status-main,
  .pl-netflix-ui-hidden .button-layer
  {
      opacity: 0 !important;
      display: none !important;
      visibility: hidden !important;
  }
`;
document.head.appendChild(style);


// ==========================================
// 3. PLATFORM SELECTORS
// ==========================================
// Definitions for locating video elements, subtitle text, and UI containers
// specific to YouTube and Netflix.

const PLATFORMS = {
    youtube: {
        root: '#movie_player', 
        video: 'video',
        subContainer: '.ytp-caption-window-bottom, .ytp-caption-window-container',
        getText: () => {
            // YouTube splits captions into segments; join them for full context.
            const segments = document.querySelectorAll('.ytp-caption-segment');
            if (segments && segments.length > 0) {
                return Array.from(segments).map(s => s.innerText).join(" ");
            }
            return "";
        },
        toggleUI: (hide) => { 
            // YouTube's UI is generally less obtrusive; no custom hiding needed.
        }
    },
    netflix: {
        root: '.nfp-app-player-wrapper',
        video: 'video',
        subContainer: '.player-timedtext',
        getText: () => {
            // Netflix uses various containers depending on player version.
            const container = document.querySelector('.player-timedtext-text-container');
            if (container) return container.innerText;
            const span = document.querySelector('.player-timedtext');
            if (span) return span.innerText;
            return "";
        },
        toggleUI: (hide) => {
            // Toggles the "pl-netflix-ui-hidden" class on the main wrapper
            const wrapper = document.querySelector('.nfp-app-player-wrapper') || document.body;
            if (hide) {
                wrapper.classList.add('pl-netflix-ui-hidden');
                state.uiHidden = true;
            } else {
                wrapper.classList.remove('pl-netflix-ui-hidden');
                state.uiHidden = false;
            }
        }
    }
};

// Determine current site once on load
const currentPlatform = window.location.hostname.includes('netflix') 
    ? PLATFORMS.netflix 
    : PLATFORMS.youtube;


// ==========================================
// 4. UTILITY FUNCTIONS
// ==========================================

/**
 * Calculates the "visible" length of a subtitle string, removing 
 * control characters, newlines, and brackets (e.g., [Music], (Laughs)).
 */
function getVisibleCharCount(text) {
    if (!text) return 0;
    let clean = text.replace(/[\n\r]/g, "")
                    .replace(/\s+/g, "")
                    .replace(/\{.*?\}/g, "")         // ASS/SSA style
                    .replace(/\(.*?\)|\（.*?\）/g, ""); // Parentheses
    return clean.length;
}

/**
 * Displays a temporary On-Screen Display (OSD) message to the user.
 */
function showOSD(message) {
    let osd = document.getElementById('pl-osd');
    if (!osd) {
        osd = document.createElement('div');
        osd.id = 'pl-osd';
        Object.assign(osd.style, {
            position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0,0,0,0.8)', color: '#FFF', padding: '12px 24px',
            borderRadius: '8px', zIndex: 2147483647, fontSize: '20px', pointerEvents: 'none',
            fontFamily: 'sans-serif', fontWeight: 'bold', boxShadow: '0 2px 10px rgba(0,0,0,0.5)'
        });
        document.body.appendChild(osd);
    }
    osd.innerText = message;
    osd.style.display = 'block';
    
    // Reset fade-out timer
    if (osd.hideTimer) clearTimeout(osd.hideTimer);
    osd.hideTimer = setTimeout(() => { osd.style.display = 'none'; }, 2000);
}

/**
 * Controls subtitle visibility based on the user's "Hide Subs" preference.
 */
function toggleSubtitles(forceVisible) {
    if (!settings.hide_subs && forceVisible !== true) return;

    const nodes = document.querySelectorAll(currentPlatform.subContainer);
    nodes.forEach(node => {
        if (forceVisible) {
            node.classList.remove('pl-hidden-sub');
            node.classList.add('pl-show-sub');
        } else {
            node.classList.remove('pl-show-sub');
            node.classList.add('pl-hidden-sub');
        }
    });
}

/**
 * Restores UI visibility if it was hidden, triggered by user interaction.
 */
function restoreUI() {
    if (state.uiHidden && currentPlatform.toggleUI) {
        currentPlatform.toggleUI(false);
    }
}


// ==========================================
// 5. CORE LOGIC
// ==========================================

/**
 * Loads settings from Chrome Storage and updates local state.
 */
function loadSettings(callback) {
    chrome.storage.sync.get({ 
        pause_per_char: 0.06, 
        min_pause: 0.5,
        max_pause: 10.0, // <--- NEW DEFAULT
        auto_enable: true,
        hide_subs: false,
        hotkey: settings.hotkey
    }, (items) => {
        settings.pause_per_char = items.pause_per_char;
        settings.min_pause = items.min_pause;
        settings.max_pause = items.max_pause; // <--- LOAD
        settings.hotkey = items.hotkey;
        settings.hide_subs = items.hide_subs;

        if (callback) {
            state.enabled = items.auto_enable;
            callback();
        }
        
        // Apply initial subtitle visibility state
        if (state.enabled && settings.hide_subs && !state.isAutoPaused) {
            toggleSubtitles(false); 
        } else {
            toggleSubtitles(true);
        }
    });
}

/**
 * Resumes video playback after the calculated pause duration.
 */
function resumePlayback(video) {
    if (state.timerId) clearTimeout(state.timerId);
    state.timerId = null;
    state.isAutoPaused = false;
    state.isPauseLocked = false;
    
    // Note: We intentionally leave the Netflix UI hidden here to prevent
    // the "Play" animation flash. It will be restored by mouse movement.

    // Hide subs again if the setting is enabled
    if (settings.hide_subs) toggleSubtitles(false);

    video.play().catch(() => { /* Ignore play interruptions */ });
}

/**
 * Locks the pause state, preventing auto-resume until the user intervenes.
 */
function lockPause() {
    if (state.timerId) {
        clearTimeout(state.timerId);
        state.timerId = null;
    }
    state.isPauseLocked = true;
    showOSD("|| Pause Locked");
}

/**
 * Main handler: Triggered when a new subtitle line is detected.
 */
function handleSubtitle(text, video) {
    if (!state.enabled || !text) return;
    
    const cleanText = text.trim();
    if (cleanText === state.lastSubText) return; 
    
    state.lastSubText = cleanText;
    const chars = getVisibleCharCount(cleanText);
    if (chars < settings.min_chars) return;

    // Calculate pause duration: Max(min_pause, chars * PPC)
    let duration = Math.max(settings.min_pause, chars * settings.pause_per_char);
    
    // Apply Cap: Min(max_pause, duration)
    duration = Math.min(settings.max_pause, duration);
    
    // --- EXECUTE PAUSE ---
    state.isAutoPaused = true;

    // Force Hide Netflix UI (Control bars, ratings, etc.)
    if (currentPlatform.toggleUI) currentPlatform.toggleUI(true);

    video.pause();
    
    // Reveal subtitles for reading
    if (settings.hide_subs) toggleSubtitles(true);

    // Schedule resume
    state.timerId = setTimeout(() => {
        resumePlayback(video);
    }, duration * 1000);
}


// ==========================================
// 6. INITIALIZATION & EVENTS
// ==========================================

function startObserver() {
    const video = document.querySelector(currentPlatform.video);
    const rootNode = document.querySelector(currentPlatform.root) || document.body;

    if (!video) {
        // Video element not ready yet? Retry in 1 second.
        setTimeout(startObserver, 1000);
        return;
    }

    // Load initial settings
    loadSettings(() => {
        if (state.enabled) showOSD("Primed Listening Ready");
    });

    // --- A. KEYBOARD LISTENERS ---
    document.addEventListener('keydown', (e) => {
        // Any key press indicates user presence; restore UI.
        restoreUI();

        // Check for Custom Hotkey (Toggle ON/OFF)
        const h = settings.hotkey;
        if (e.code === h.code && 
            e.ctrlKey === h.ctrlKey && 
            e.altKey === h.altKey && 
            e.shiftKey === h.shiftKey && 
            e.metaKey === h.metaKey) {   
             
             state.enabled = !state.enabled;
             showOSD(`Primed Listening: ${state.enabled ? "ON" : "OFF"}`);
             
             if (!state.enabled) {
                 // Clean up if disabled while active
                 if (state.isAutoPaused) resumePlayback(video);
                 toggleSubtitles(true); // Force subs visible
                 restoreUI();           // Force UI visible
             } else {
                 // Apply hiding logic if enabling
                 if (settings.hide_subs) toggleSubtitles(false);
             }
             return;
        }

        if (!state.enabled) return;

        // Check for Interaction Keys (Space, K, P) during auto-pause
        const isInteractionKey = (e.code === 'Space' || e.key === 'k' || e.key === 'p');
        if (isInteractionKey && state.isAutoPaused) {
            e.preventDefault(); 
            e.stopPropagation();
            
            if (!state.isPauseLocked) {
                lockPause();
            } else {
                resumePlayback(video);
            }
        }
    }, true);

    // --- B. MOUSE LISTENER ---
    // Restore UI on mouse movement (throttled for performance)
    let mouseTimer = null;
    document.addEventListener('mousemove', () => {
        // Only restore UI if we are NOT in an auto-pause.
        // If we are auto-paused, we want the screen clean.
        if (!state.isAutoPaused) {
             if (!mouseTimer) {
                 restoreUI();
                 mouseTimer = setTimeout(() => mouseTimer = null, 200);
             }
        }
    }, { passive: true });

    // --- C. MUTATION OBSERVER ---
    // Watches for changes in the DOM to detect subtitles
    const observer = new MutationObserver((mutations) => {
        if (!state.enabled || (video.paused && !state.isAutoPaused)) return;
        
        try {
            const text = currentPlatform.getText();
            if (text && text.length > 0) {
                handleSubtitle(text, video);
            }
        } catch (error) {
            // Silently ignore minor DOM errors during page transitions
        }
    });

    observer.observe(rootNode, { 
        childList: true, 
        subtree: true, 
        characterData: true 
    });
}

// Listen for settings updates from the Popup
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'UPDATE_SETTINGS') {
        loadSettings(null);
    }
});

// Start the engine
startObserver();