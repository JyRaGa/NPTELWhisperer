# NPTEL Whisperer

[![Version](https://img.shields.io/badge/version-2.0.0-blue?style=flat-square)](manifest.json)
[![Chrome Extension](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow?style=flat-square&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)

**NPTEL Whisperer** is a lightweight, modular browser extension designed for NPTEL / Swayam course participants. It automatically detects programming assignments and multiple-choice / multiple-select assessments (MCQ & MSQ), injects verified solutions, and handles verification and compilation with zero user friction.

> [!NOTE]
> Currently configured for demonstration purposes specifically for the NPTEL course **"The Joy of Computing using Python"**.

---

## Features

- **Smart Pre-Verification & Interactive Corrections (v2.0)**:
  - Automatically inspects page state to verify whether an assignment has already been evaluated or submitted.
  - For MCQs and MSQs (Multiple Select Questions), validates each choice question-by-question:
    - If all answers are already correct, it skips silently without tampering.
    - If missing answers or wrong selections are detected, it presents a modern, on-page permission prompt styled in **Inter** detailing the exact discrepancies (e.g., *“Found 2 missing answers and 1 wrong selection”*).
    - Features an explicit **Fix Answers** action button and a **10-second auto-dismiss** timeout if ignored.

- **Built-in In-Extension Diagnostics Console (v2.0)**:
  - Eliminates the need to open Chrome DevTools (ideal for environments where keyboard shortcuts or right-click context menus are disabled).
  - Expandable dark-mode terminal inside the extension popup displaying live page detection status, parsed assessment IDs, and timestamped color-coded logs (`[INFO]`, `[WARN]`, `[ERROR]`).
  - Includes one-click **Copy to Clipboard**, **Clear Logs**, and **Refresh** buttons.

- **CSP-Compliant Code Editor Injection**:
  - Uses native DOM input events and `document.execCommand('insertText')` to bypass strict Content Security Policies (`script-src 'self'`).
  - Automatically clears existing buffer text (`Ctrl+A` / `Cmd+A` $\rightarrow$ `Backspace` / `Delete`) before injection to prevent accidental code appending.

- **Two-Step Programming Submission Flow**:
  - Follows strict submission protocols: triggers **Compile & Run** first, allows compilation diagnostics to complete, and then initiates the final **Submit**.

- **Seamless SPA Client Routing**:
  - Built-in observers hook into HTML5 `history.pushState`, `history.replaceState`, `popstate`, and Next.js / React Router navigation without requiring full page reloads.

- **Configurable Auto-Submit**:
  - Clean popup UI allowing you to toggle automated submission on or off with a single click.

- **Modular Solutions Database**:
  - Easily extensible solution architecture supporting weekly assignments, programming problems, and multi-option quizzes.

---

## Installation

1. **Clone or Download** this repository:
   ```bash
   git clone https://github.com/JyRaGa/NPTELWhisperer.git
   ```
   *(Or download and extract the ZIP file from the latest [Release](https://github.com/JyRaGa/NPTELWhisperer/releases/latest).*

2. **Open Extensions Manager** in your Chromium-based browser (Chrome, Brave, Edge):
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top-right corner).

3. **Load the Extension**:
   - Click **Load unpacked**.
   - Select the root folder containing `manifest.json`.

4. **Navigate to NPTEL**:
   - Open any enrolled NPTEL course assignment on `https://onlinecourses.nptel.ac.in/`.

---

## Project Structure

```
nptel-whisperer/
├── manifest.json       # Chrome Manifest V3 configuration
├── content.js          # Main content script (cloud fetch, verification & injection engine)
├── solutions.json      # Dynamic database for programming solutions and MCQ answer keys
├── popup.html          # Extension popup UI (Auto-Submit & Diagnostics terminal)
├── popup.js            # Popup controller (storage sync & real-time log viewer)
├── LICENSE             # GNU General Public License v3.0
└── README.md           # Project documentation
```

---

## Updating Solutions (`solutions.json`)

The extension dynamically synchronizes with `solutions.json` from the repository on each navigation, falling back to local `chrome.storage` if offline.

To publish new solutions, simply edit `solutions.json` in your repository:

### 1. Programming Assignments
Add the assignment URL parameter fragment and the target Python code under `"programming"`:
```json
{
  "programming": {
    "week6": {
      "progassignmentId=690": "def solve():\n    # Your solution here\n    pass"
    }
  }
}
```

### 2. MCQ / MSQ Assessments
Add the assessment URL fragment and question answers under `"mcq"`:
```json
{
  "mcq": {
    "assessmentId=695": {
      "Q1": "Option text for Q1",
      "Q2": ["MSQ Option 1", "MSQ Option 2", "MSQ Option 3"],
      "Q3": "42"
    }
  }
}
```

---

## Content Security & Privacy

- **Safe Read-Only Cloud Sync**: The extension only fetches open assignment solutions from the public GitHub repository. No user data, session cookies, passwords, or personal telemetry are ever collected or transmitted.
- **Local Storage Only**: Uses Chrome's `storage.local` exclusively to cache the latest solutions and persist your personal auto-submit preferences.

---

## Disclaimer

This extension is developed for **educational and research purposes only** to demonstrate browser extension capabilities, DOM automation, and single-page application integration. Users are responsible for complying with the honor code and terms of service of the respective learning platform.

---

## License

Distributed under the [GNU General Public License v3.0](LICENSE) (GPL-3.0).
