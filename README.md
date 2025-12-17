# Kiku: Primed Listening

Kiku is a browser extension for Chrome and Brave that automates "Primed Listening" for language learners. It works by detecting subtitle events on YouTube and Netflix and automatically pausing playback at the end of every sentence.

This creates a momentary silence gap, allowing the learner to process the audio input before the next line of dialogue begins.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

## Features

* **Auto-Pause:** Automatically pauses video playback immediately after a subtitle line disappears.
* **Subtitle Hiding:** Option to hide subtitles during playback and reveal them only when the video is paused (active recall).
* **Platform Support:** Compatible with YouTube and Netflix.
* **Netflix UI Suppression:** Automatically hides the Netflix control bar, overlays, and rating warnings during auto-pauses to prevent visual distractions.
* **Configurable Timing:**
    * **Pause per Character:** Dynamically adjusts pause duration based on sentence length.
    * **Min/Max Pause:** Enforce minimum and maximum silence durations.
* **Privacy:** Operations are performed entirely client-side. No user data is collected or transmitted.

## Installation

### From Chrome Web Store
[Add to Chrome](https://chromewebstore.google.com/detail/kiku-primed-listening/kaogbooahpdhbhmpiijlcbajkmpepflh)

### Manual Installation (Load Unpacked)
1.  Download or clone this repository.
2.  Open Chrome/Brave and navigate to `chrome://extensions`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked**.
5.  Select the directory containing the extension files (`manifest.json`, `content.js`, etc.).

## Usage and Configuration

Click the extension icon in the browser toolbar to access settings.

### Timing Settings
* **Pause per Char (s):** Calculates pause duration based on text length. Default is 0.06s per character.
* **Min Pause (s):** The minimum duration for the pause, regardless of text length. Default is 0.5s.
* **Max Pause (s):** The maximum duration for the pause. Default is 10.0s.

### Behavior
* **Hide Subs while Playing:** Toggles visibility of subtitles. When enabled, subtitles are hidden while audio is playing and visible when paused.
* **Enable on Startup:** Automatically activates the extension when a compatible page loads.

### Shortcuts
* **Toggle Extension:** `Alt + P` (Default, customizable in settings).
* **Playback Control:** When auto-paused, pressing `Space`, `K`, or `P` will resume playback immediately.

## Background

This tool implements the "Primed Listening" workflow discussed by [Matt vs Japan](https://www.youtube.com/@mattvsjapan) and the [Immersion Dojo](https://www.skool.com/mattvsjapan/about) community. The goal is to automate the manual pausing required to decode native-speed audio during immersion study.

## Privacy Policy

This extension does not collect, store, or transmit any personal data. All settings are stored locally on the user's device using the Chrome Storage API. The extension only accesses the DOM of YouTube and Netflix to read subtitle text and control the video player.

## License

Distributed under the MIT License. See `LICENSE` for more information.