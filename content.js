"use strict";

/**
 * Primed Listening - Content Script
 * * Handles DOM observation, subtitle extraction, and playback control 
 * for YouTube and Netflix.
 */

// --- CONFIGURATION & STATE ---
let settings = {
    pause_per_char: 0.06,
    min_pause: 0.5,
    min_chars: 2,
    hide_subs: false,
    hotkey: { code: 'KeyP', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }
};

let state = {
    enabled: false,       // Master toggle
    isAutoPaused: false,  // Is the script currently holding a pause?
    isPauseLocked: false, // Did user manually extend the pause?
    timerId: null,        // Reference to the resume timer
    lastSubText: ""       // Deduplication buffer
};

// --- CSS INJECTION ---
// Injects styles to hide subtitles during playback if the feature is enabled.
const style = document.createElement('style');
style.innerHTML = `
  .pl-hidden-sub { opacity: 0 !important; }
  .pl-show-sub { opacity: 1 !important; }
`;
document.head.appendChild(style);


// --- PLATFORM SELECTORS ---
// Definitions for finding video elements and subtitle text on supported sites.
const PLATFORMS = {
    youtube: {
        root: '#movie_player', 
        video: 'video',
        // Target multiple caption containers to be safe
        subContainer: '.ytp-caption-window-bottom, .ytp-caption-window-container',
        getText: () => {
            // YouTube splits text into segments; we join them for full context.
            const segments = document.querySelectorAll('.ytp-caption-segment');
            if (segments && segments.length > 0) {
                return Array.from(segments).map(s => s.innerText).join(" ");
            }
            return "";
        }
    },
    netflix: {
        root: '.nfp-app-player-wrapper',
        video: 'video',
        subContainer: '.player-timedtext',
        getText: () => {
            // Netflix selectors vary; try the most common text containers.
            const container = document.querySelector('.player-timedtext-text-container');
            if (container) return container.innerText;
            const span = document.querySelector('.player-timedtext');
            if (span) return span.innerText;
            return "";
        }
    }
};

const currentPlatform = window.location.hostname.includes('netflix') 
    ? PLATFORMS.netflix 
    : PLATFORMS.youtube;


// --- UTILITIES ---

/**
 * Calculates the number of "visible" characters, ignoring whitespace/brackets.
 * Useful for ignoring control characters or empty subtitle lines.
 */
function getVisibleCharCount(text) {
    if (!text) return 0;
    let clean = text.replace(/[\n\r]/g, "")
                    .replace(/\s+/g, "")
                    .replace(/\{.*?\}/g, "")         // ASS/SSA style brackets
                    .replace(/\(.*?\)|\（.*?\）/g, ""); // Parentheses
    return clean.length;
}

/**
 * Displays a temporary On-Screen Display (OSD) message.
 */
function showOSD(message) {
    let osd = document.getElementById('pl-osd');
    if (!osd) {
        osd = document.createElement('div');
        osd.id = 'pl-osd';
        Object.assign(osd.style, {
            position: 'absolute', 
            top: '10%', 
            left: '50%', 
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0,0,0,0.8)', 
            color: '#FFF', 
            padding: '12px 24px',
            borderRadius: '8px', 
            zIndex: 2147483647, 
            fontSize: '20px', 
            pointerEvents: 'none',
            fontFamily: 'sans-serif', 
            fontWeight: 'bold', 
            boxShadow: '0 2px 10px rgba(0,0,0,0.5)'
        });
        document.body.appendChild(osd);
    }
    osd.innerText = message;
    osd.style.display = 'block';
    
    if (osd.hideTimer) clearTimeout(osd.hideTimer);
    osd.hideTimer = setTimeout(() => { osd.style.display = 'none'; }, 2000);
}

/**
 * Toggles the visibility of subtitles using CSS classes.
 * @param {boolean} forceVisible - If true, ensures subs are visible.
 */
function toggleSubtitles(forceVisible) {
    // Only modify DOM if the "Hide Subs" feature is active or we are resetting
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


// --- CORE LOGIC ---

function loadSettings(callback) {
    chrome.storage.sync.get({ 
        pause_per_char: 0.06, 
        min_pause: 0.5,
        auto_enable: true,
        hide_subs: false,
        hotkey: settings.hotkey
    }, (items) => {
        settings.pause_per_char = items.pause_per_char;
        settings.min_pause = items.min_pause;
        settings.hotkey = items.hotkey;
        settings.hide_subs = items.hide_subs;

        if (callback) {
            state.enabled = items.auto_enable;
            callback();
        }
        
        // Sync subtitle visibility state immediately
        if (state.enabled && settings.hide_subs && !state.isAutoPaused) {
            toggleSubtitles(false); // Hide
        } else {
            toggleSubtitles(true);  // Show
        }
    });
}

function resumePlayback(video) {
    if (state.timerId) clearTimeout(state.timerId);
    state.timerId = null;
    state.isAutoPaused = false;
    state.isPauseLocked = false;
    
    // Ensure subs are hidden again when playback resumes
    if (settings.hide_subs) toggleSubtitles(false);

    video.play().catch(() => { /* Ignore play interruptions */ });
}

function lockPause() {
    if (state.timerId) {
        clearTimeout(state.timerId);
        state.timerId = null;
    }
    state.isPauseLocked = true;
    showOSD("|| Pause Locked");
}

function handleSubtitle(text, video) {
    if (!state.enabled || !text) return;
    
    const cleanText = text.trim();
    if (cleanText === state.lastSubText) return; 
    
    state.lastSubText = cleanText;
    const chars = getVisibleCharCount(cleanText);
    if (chars < settings.min_chars) return;

    // Calculate pause duration
    const duration = Math.max(settings.min_pause, chars * settings.pause_per_char);
    
    // EXECUTE PAUSE
    state.isAutoPaused = true;
    video.pause();
    
    // Reveal subs during the pause (if hidden)
    if (settings.hide_subs) toggleSubtitles(true);

    // Schedule resume
    state.timerId = setTimeout(() => {
        resumePlayback(video);
    }, duration * 1000);
}


// --- INITIALIZATION ---

function startObserver() {
    const video = document.querySelector(currentPlatform.video);
    // Use platform-specific root or fallback to body
    const rootNode = document.querySelector(currentPlatform.root) || document.body;

    if (!video) {
        // Video not ready? Retry shortly.
        setTimeout(startObserver, 1000);
        return;
    }

    // Initialize Settings
    loadSettings(() => {
        if (state.enabled) showOSD("Primed Listening Ready");
    });

    // 1. Keyboard Listener
    document.addEventListener('keydown', (e) => {
        const h = settings.hotkey;
        
        // Check for Custom Hotkey (Toggle ON/OFF)
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
             } else {
                 // Apply hide setting if enabling
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
    }, true); // Capture phase to intercept keys before player

    // 2. Mutation Observer (Subtitle Detector)
    const observer = new MutationObserver((mutations) => {
        if (!state.enabled || (video.paused && !state.isAutoPaused)) return;
        
        try {
            const text = currentPlatform.getText();
            if (text && text.length > 0) {
                handleSubtitle(text, video);
            }
        } catch (error) {
            // Silently ignore DOM errors to prevent console spam on complex pages
        }
    });

    observer.observe(rootNode, { 
        childList: true, 
        subtree: true, 
        characterData: true 
    });
}

// Listen for updates from the Popup UI
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'UPDATE_SETTINGS') {
        loadSettings(null);
    }
});

// Boot up
startObserver();