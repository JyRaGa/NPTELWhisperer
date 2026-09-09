// content.js - NPTEL Whisperer Injection Logic

// --- Built-in Diagnostic Logger ---
const MAX_DIAGNOSTIC_LOGS = 150;
const diagnosticLogs = [];

function recordDiagnostic(level, args) {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const message = Array.from(args).map(arg => {
        if (arg instanceof Error) return arg.stack || arg.message;
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch { return String(arg); }
        }
        return String(arg);
    }).join(' ');

    diagnosticLogs.push({ time: timestamp, level, message });
    if (diagnosticLogs.length > MAX_DIAGNOSTIC_LOGS) {
        diagnosticLogs.shift();
    }

    try {
        chrome.storage.local.set({ nptelDiagnosticLogs: diagnosticLogs });
    } catch (e) {}
}

const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

['log', 'info', 'warn', 'error'].forEach(level => {
    console[level] = function(...args) {
        originalConsole[level](...args);
        const text = args.map(a => typeof a === 'string' ? a : '').join(' ');
        if (text.includes('[NPTEL Whisperer]')) {
            recordDiagnostic(level, args);
        }
    };
});

// Message listener for Extension Popup to retrieve live diagnostics
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GET_DIAGNOSTICS') {
        const urlParams = new URLSearchParams(window.location.search);
        sendResponse({
            url: window.location.href,
            courseId: urlParams.get('courseId') || window.location.pathname.split('/').pop() || 'N/A',
            unitId: urlParams.get('unitId') || 'N/A',
            assessmentId: urlParams.get('assessmentId') || 'N/A',
            progassignmentId: urlParams.get('progassignmentId') || 'N/A',
            logs: diagnosticLogs
        });
    } else if (request.type === 'CLEAR_DIAGNOSTICS') {
        diagnosticLogs.length = 0;
        try {
            chrome.storage.local.remove(['nptelDiagnosticLogs']);
        } catch (e) {}
        sendResponse({ success: true });
    }
    return true;
});

console.info("[NPTEL Whisperer] Note: Any 404 or MIME type errors you see below are native NPTEL website errors failing to load Ace editor themes. The extension will force-inject regardless.");
console.log("[NPTEL Whisperer] Script initialized. Current URL:", window.location.href);

const REMOTE_SOLUTIONS_URL = "https://raw.githubusercontent.com/JyRaGa/NPTELWhisperer/refs/heads/main/solutions.json";

// Fetch the latest solutions JSON with priority: Remote GitHub -> Bundled local extension solutions.json -> Local cache
async function fetchLatestSolutions() {
    let localBundledData = null;
    try {
        const localRes = await fetch(chrome.runtime.getURL('solutions.json'));
        if (localRes.ok) {
            localBundledData = await localRes.json();
            console.log("[NPTEL Whisperer] Successfully loaded local extension solutions.json.");
        }
    } catch (e) {
        console.warn("[NPTEL Whisperer] Could not read bundled solutions.json:", e);
    }

    try {
        const response = await fetch(REMOTE_SOLUTIONS_URL, { cache: 'no-cache' });
        if (response.ok) {
            const remoteData = await response.json();
            if (remoteData && (remoteData.programming || remoteData.mcq)) {
                // Merge: remote takes priority over local bundled solutions
                const merged = {
                    programming: { ...(localBundledData?.programming || {}), ...(remoteData.programming || {}) },
                    mcq: { ...(localBundledData?.mcq || {}), ...(remoteData.mcq || {}) }
                };
                await chrome.storage.local.set({ latestNptelData: merged });
                console.log("[NPTEL Whisperer] Successfully fetched and merged solutions with remote.");
                return merged;
            }
        }
    } catch (err) {
        console.warn("[NPTEL Whisperer] Remote fetch failed or offline:", err.message);
    }

    // Fallback to locally bundled file or chrome.storage.local cache
    if (localBundledData) {
        await chrome.storage.local.set({ latestNptelData: localBundledData });
        return localBundledData;
    }

    try {
        const cached = await new Promise((resolve) => {
            chrome.storage.local.get(['latestNptelData'], resolve);
        });
        if (cached && cached.latestNptelData) {
            console.log("[NPTEL Whisperer] Loaded cached solutions from chrome.storage.local.");
            return cached.latestNptelData;
        }
    } catch (err) {
        console.warn("[NPTEL Whisperer] Error retrieving cached solutions:", err);
    }

    console.warn("[NPTEL Whisperer] No solutions data available.");
    return null;
}

// Normalize and clean strings for reliable matching (strips quotes, dashes, commas, choice prefixes)
function cleanText(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .replace(/[\u2018\u2019\u201C\u201D'"`]/g, '') // strip all single/double/curly quotes & backticks
        .replace(/[\u2013\u2014–—]/g, '-')            // normalize dashes
        .replace(/\u00a0/g, ' ')                       // non-breaking spaces
        .replace(/^(\([a-z0-9]\)|[a-z0-9][\.\)\:\-])\s*/i, '') // strip prefixes like (a), A., 1), etc.
        .replace(/[,\s]+/g, ' ')                      // normalize spaces & commas
        .trim();
}

// Extract page context text (title, breadcrumbs, headers, active navigation)
function getPageContextText() {
    const selectors = [
        'h1', 'h2', 'h3', 'h4',
        '.breadcrumb', '.unit-title', '.lesson-title', '.assessment-title',
        '.active', '.selected', '.gcb-nav-active', '.nav-item.active', '[aria-current="page"]',
        '.assignment-title', '.programming-title', '.qt-title', '.gcb-lesson-title',
        '#course-nav', '.navigation-item', '.sidebar'
    ];
    const elements = Array.from(document.querySelectorAll(selectors.join(', ')));
    const texts = [document.title || ''];
    elements.forEach(el => {
        const t = (el.innerText || el.textContent || '').trim();
        if (t && t.length < 300) {
            texts.push(t);
        }
    });
    return texts.join(' ').toLowerCase();
}

// Fast lookup map for known assessment and programming assignment IDs across weeks
const KNOWN_ASSESSMENT_MAP = {
    // Week 4
    '675': { type: 'mcq', week: 4 },
    '676': { type: 'programming', week: 4, index: 0 },
    '677': { type: 'programming', week: 4, index: 1 },
    '678': { type: 'programming', week: 4, index: 2 },
    '679': { type: 'programming', week: 4, index: 3 },
    // Week 5
    '682': { type: 'mcq', week: 5 },
    '683': { type: 'programming', week: 5, index: 0 },
    '684': { type: 'programming', week: 5, index: 1 },
    '685': { type: 'programming', week: 5, index: 2 },
    // Week 6
    '686': { type: 'mcq', week: 6 },
    '687': { type: 'programming', week: 6, index: 0 },
    '688': { type: 'programming', week: 6, index: 1 },
    '689': { type: 'programming', week: 6, index: 2 },
    // Week 7
    '692': { type: 'programming', week: 7, index: 0 },
    '693': { type: 'programming', week: 7, index: 1 },
    '694': { type: 'programming', week: 7, index: 2 },
    '695': { type: 'mcq', week: 7 }
};

// Extract all query parameters and hash parameters from current URL into a lowercase dictionary
function getNormalizedUrlParams(urlStr = window.location.href) {
    const params = {};
    try {
        const parsed = new URL(urlStr);
        parsed.searchParams.forEach((val, key) => {
            params[key.toLowerCase()] = val.toLowerCase().trim();
        });
        if (parsed.hash && parsed.hash.includes('?')) {
            const hashSearch = parsed.hash.split('?')[1];
            const hashParams = new URLSearchParams(hashSearch);
            hashParams.forEach((val, key) => {
                params[key.toLowerCase()] = val.toLowerCase().trim();
            });
        }
    } catch (e) {
        const matches = urlStr.matchAll(/[?&#]([a-zA-Z0-9_-]+)=([^&#\s]*)/g);
        for (const m of matches) {
            params[m[1].toLowerCase()] = decodeURIComponent(m[2]).toLowerCase().trim();
        }
    }
    return params;
}

// Detect week number from URL, known IDs, and page context with hierarchical priority
function detectWeekNumber() {
    const url = window.location.href;
    const urlLower = url.toLowerCase();
    const params = getNormalizedUrlParams(url);

    // 1. Direct check from known ID in URL params
    const activeId = params.assessmentid || params.progassignmentid || params.assessment || params.progassignment || params.id;
    if (activeId && KNOWN_ASSESSMENT_MAP[activeId]) {
        return KNOWN_ASSESSMENT_MAP[activeId].week;
    }

    // 2. Check URL query parameters or path for explicit week
    if (params.week) {
        const w = parseInt(params.week, 10);
        if (w >= 1 && w <= 12) return w;
    }
    const urlWeekMatch = urlLower.match(/(?:week|w)[-_]?0?(\d+)/i);
    if (urlWeekMatch) {
        const num = parseInt(urlWeekMatch[1], 10);
        if (num >= 1 && num <= 12) return num;
    }

    // 3. Check active sidebar unit, breadcrumbs, and selected navigation elements
    const highPrioritySelectors = [
        '.breadcrumb',
        '.unit-title',
        '.active',
        '.selected',
        '.gcb-nav-active',
        '.nav-item.active',
        '[aria-current="page"]',
        '.sidebar .selected',
        '.sidebar .active',
        '.gcb-lesson-title',
        'h1', 'h2', 'h3'
    ];
    for (const sel of highPrioritySelectors) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            const m = txt.match(/\bweek\s*0?(\d+)\b/i) || txt.match(/\bunit\s*0?(\d+)\b/i);
            if (m) {
                const num = parseInt(m[1], 10);
                if (num >= 1 && num <= 12) return num;
            }
        }
    }

    // 4. Broader page context matching
    const context = getPageContextText();
    const weekMatch = context.match(/\bweek\s*0?(\d+)\b/i);
    if (weekMatch) {
        const num = parseInt(weekMatch[1], 10);
        if (num >= 1 && num <= 12) return num;
    }

    // 5. Look for non-programming "Assignment X" in context
    const assignmentMatch = context.match(/\bassignment\s*[-_:]?\s*0?(\d+)\b/i);
    if (assignmentMatch && !context.includes(`programming assignment ${assignmentMatch[1]}`)) {
        const num = parseInt(assignmentMatch[1], 10);
        if (num >= 1 && num <= 12) return num;
    }

    return null;
}

// Function to find the correct Python code based on current page URL, parameters & DOM heuristics
function getProgrammingSolutionForCurrentPage(nptelData) {
    const currentURL = window.location.href;
    const currentUrlLower = currentURL.toLowerCase();
    const params = getNormalizedUrlParams(currentURL);
    const programming = nptelData?.programming;

    if (!programming) {
        return null;
    }

    // Exclude explicit MCQ page when no code editor is present
    const isExplicitAssessmentPage = (params.assessmentid || currentUrlLower.includes('assessmentid') || currentUrlLower.includes('assessment=')) &&
        !document.querySelector('textarea.inputarea, .ace_editor, .monaco-editor, #editor, textarea');
    const hasQuestions = document.querySelectorAll('input[type="radio"], input[type="checkbox"], .gcb-question').length >= 3;
    const hasCodeEditor = Boolean(document.querySelector('textarea.inputarea, .ace_editor, .monaco-editor, #editor, textarea'));

    if (isExplicitAssessmentPage || (hasQuestions && !hasCodeEditor)) {
        return null;
    }

    const progId = params.progassignmentid || params.progassignment || params.assignmentid || params.id;

    // 1. Direct URL fragment & parameter matching
    for (const week in programming) {
        if (Object.prototype.hasOwnProperty.call(programming, week)) {
            const weekSolutions = programming[week];
            for (const urlFragment in weekSolutions) {
                if (Object.prototype.hasOwnProperty.call(weekSolutions, urlFragment)) {
                    const fragLower = urlFragment.toLowerCase();
                    // Case-insensitive direct URL match
                    if (currentUrlLower.includes(fragLower)) {
                        console.log(`[NPTEL Whisperer] Matched programming assignment URL fragment: "${urlFragment}" (in ${week})`);
                        return weekSolutions[urlFragment];
                    }
                    // Parameter ID match (e.g. progassignmentId=692 matches param 692)
                    if (progId && fragLower.includes(progId)) {
                        console.log(`[NPTEL Whisperer] Matched programming assignment param ID "${progId}" -> "${urlFragment}" (in ${week})`);
                        return weekSolutions[urlFragment];
                    }
                }
            }
        }
    }

    // 2. Known Assessment ID Map fast-path
    if (progId && KNOWN_ASSESSMENT_MAP[progId] && KNOWN_ASSESSMENT_MAP[progId].type === 'programming') {
        const info = KNOWN_ASSESSMENT_MAP[progId];
        const weekKey = `week${info.week}`;
        const weekSolutions = programming[weekKey];
        if (weekSolutions) {
            const keys = Object.keys(weekSolutions);
            if (keys[info.index]) {
                console.log(`[NPTEL Whisperer] Matched programming assignment from known ID map: ${progId} -> ${weekKey}[${info.index}]`);
                return weekSolutions[keys[info.index]];
            }
        }
    }

    // 3. Smart Fallback: Match based on Week + Problem Number / Keywords in DOM
    const weekNum = detectWeekNumber();
    if (weekNum) {
        const weekKey = `week${weekNum}`;
        const weekSolutions = programming[weekKey];
        if (weekSolutions) {
            const solutionKeys = Object.keys(weekSolutions);
            if (solutionKeys.length > 0) {
                const combinedContext = (currentUrlLower + ' ' + getPageContextText() + ' ' + (document.body ? document.body.innerText.slice(0, 3000) : '')).toLowerCase();

                // Detect problem index from context (e.g. "Programming Assignment 1", "Problem 2")
                const problemIndexMatch = combinedContext.match(/(?:programming\s*assignment|prog\s*assignment|problem|question|prog|pa)\s*0?([1-4])/i) ||
                    combinedContext.match(/[?&](?:name|p|index|problem)=0?([1-4])/i);

                if (problemIndexMatch) {
                    const pIdx = parseInt(problemIndexMatch[1], 10) - 1;
                    if (solutionKeys[pIdx]) {
                        console.log(`[NPTEL Whisperer] Smart Fallback matched ${weekKey} Problem ${pIdx + 1} from context index`);
                        return weekSolutions[solutionKeys[pIdx]];
                    }
                }

                // Problem 1 heuristics (Week 4, 5, 6, 7 keywords)
                if (combinedContext.includes('assignment 1') || combinedContext.includes('problem 1') ||
                    combinedContext.includes('question 1') || combinedContext.includes('prog 1') ||
                    combinedContext.includes('temperature') || combinedContext.includes('frequency') ||
                    combinedContext.includes('attraction') || combinedContext.includes('rating') ||
                    combinedContext.includes('count_alpha') || combinedContext.includes('progassignmentid=1') ||
                    combinedContext.includes('name=1')) {
                    console.log(`[NPTEL Whisperer] Smart Fallback matched ${weekKey} Problem 1`);
                    return weekSolutions[solutionKeys[0]];
                }

                // Problem 2 heuristics
                if (combinedContext.includes('assignment 2') || combinedContext.includes('problem 2') ||
                    combinedContext.includes('question 2') || combinedContext.includes('prog 2') ||
                    combinedContext.includes('prime') || combinedContext.includes('first duplicate') ||
                    combinedContext.includes('count_boxes') || combinedContext.includes('landmark') ||
                    combinedContext.includes('progassignmentid=2') || combinedContext.includes('name=2')) {
                    console.log(`[NPTEL Whisperer] Smart Fallback matched ${weekKey} Problem 2`);
                    return weekSolutions[solutionKeys[1] || solutionKeys[0]];
                }

                // Problem 3 heuristics
                if (combinedContext.includes('assignment 3') || combinedContext.includes('problem 3') ||
                    combinedContext.includes('question 3') || combinedContext.includes('prog 3') ||
                    combinedContext.includes('product id') || combinedContext.includes('exactly twice') ||
                    combinedContext.includes('find_max') || combinedContext.includes('second largest') ||
                    combinedContext.includes('progassignmentid=3') || combinedContext.includes('name=3')) {
                    console.log(`[NPTEL Whisperer] Smart Fallback matched ${weekKey} Problem 3`);
                    return weekSolutions[solutionKeys[2] || solutionKeys[0]];
                }

                // Problem 4 heuristics
                if (solutionKeys.length > 3 && (combinedContext.includes('assignment 4') || combinedContext.includes('problem 4'))) {
                    console.log(`[NPTEL Whisperer] Smart Fallback matched ${weekKey} Problem 4`);
                    return weekSolutions[solutionKeys[3]];
                }

                // Single solution fallback for that week
                if (solutionKeys.length === 1) {
                    console.log(`[NPTEL Whisperer] Smart Fallback matched ${weekKey} single solution`);
                    return weekSolutions[solutionKeys[0]];
                }
            }
        }
    }

    return null;
}

// Function to find the correct MCQ/MSQ answers based on current page URL & DOM heuristics
function getMCQSolutionForCurrentPage(nptelData) {
    const currentURL = window.location.href;
    const currentUrlLower = currentURL.toLowerCase();
    const params = getNormalizedUrlParams(currentURL);
    const mcqSolutions = nptelData?.mcq;

    if (!mcqSolutions) {
        return null;
    }

    const assessmentId = params.assessmentid || params.assessment || params.testid || params.quizid || params.id;

    // 1. Direct URL fragment & parameter matching
    for (const urlFragment in mcqSolutions) {
        if (Object.prototype.hasOwnProperty.call(mcqSolutions, urlFragment)) {
            const fragLower = urlFragment.toLowerCase();
            // Direct case-insensitive URL match
            if (currentUrlLower.includes(fragLower)) {
                console.log(`[NPTEL Whisperer] Matched MCQ assessment URL fragment: "${urlFragment}"`);
                return mcqSolutions[urlFragment];
            }
            // Parameter ID match (e.g. assessmentId=695 matches param 695)
            if (assessmentId && fragLower.includes(assessmentId)) {
                console.log(`[NPTEL Whisperer] Matched MCQ assessment param ID "${assessmentId}" -> "${urlFragment}"`);
                return mcqSolutions[urlFragment];
            }
        }
    }

    // 2. Known Assessment ID Map fast-path
    if (assessmentId && KNOWN_ASSESSMENT_MAP[assessmentId] && KNOWN_ASSESSMENT_MAP[assessmentId].type === 'mcq') {
        const info = KNOWN_ASSESSMENT_MAP[assessmentId];
        const weekNum = info.week;
        for (const key in mcqSolutions) {
            if (key.includes(assessmentId) || key.toLowerCase().includes(`week${weekNum}`) || key.toLowerCase().includes(`assessment_${weekNum}`)) {
                console.log(`[NPTEL Whisperer] Matched MCQ assessment from known ID map: ${assessmentId} -> ${key}`);
                return mcqSolutions[key];
            }
        }
    }

    // 3. Smart Fallback via Week Detection
    const weekNum = detectWeekNumber();
    if (weekNum) {
        for (const key in mcqSolutions) {
            const kLower = key.toLowerCase();
            if (kLower.includes(`week${weekNum}`) ||
                kLower.includes(`week_${weekNum}`) ||
                kLower.includes(`assessment_${weekNum}`)) {
                console.log(`[NPTEL Whisperer] Smart Fallback matched MCQ week key: "${key}"`);
                return mcqSolutions[key];
            }
        }
        if (weekNum === 4 && (mcqSolutions['assessmentId=675'] || mcqSolutions['assessmentId=678'])) {
            console.log(`[NPTEL Whisperer] Smart Fallback matched Week 4 MCQ`);
            return mcqSolutions['assessmentId=675'] || mcqSolutions['assessmentId=678'];
        }
        if (weekNum === 5 && mcqSolutions['assessmentId=682']) {
            console.log(`[NPTEL Whisperer] Smart Fallback matched Week 5 MCQ assessmentId=682`);
            return mcqSolutions['assessmentId=682'];
        }
        if (weekNum === 6 && mcqSolutions['assessmentId=686']) {
            console.log(`[NPTEL Whisperer] Smart Fallback matched Week 6 MCQ assessmentId=686`);
            return mcqSolutions['assessmentId=686'];
        }
        if (weekNum === 7 && mcqSolutions['assessmentId=695']) {
            console.log(`[NPTEL Whisperer] Smart Fallback matched Week 7 MCQ assessmentId=695`);
            return mcqSolutions['assessmentId=695'];
        }
    }

    // 4. Question Content Fingerprint Matching
    const choiceWrappers = Array.from(document.querySelectorAll('label, .gcb-mcq-choice, .qt-choice, .form-check, li, [class*="choice"], [class*="option"]'));
    if (choiceWrappers.length >= 3) {
        const visibleChoiceTexts = choiceWrappers.map(w => cleanText(w.innerText || w.textContent || '')).filter(Boolean);

        let bestKey = null;
        let highestScore = 0;

        for (const key in mcqSolutions) {
            const dataset = mcqSolutions[key];
            let matchScore = 0;

            for (const q in dataset) {
                const ans = dataset[q];
                const answers = Array.isArray(ans) ? ans : [ans];
                for (const target of answers) {
                    const cleanedTarget = cleanText(target);
                    if (cleanedTarget && visibleChoiceTexts.some(c => c === cleanedTarget || (cleanedTarget.length > 8 && c.includes(cleanedTarget)))) {
                        matchScore++;
                    }
                }
            }

            if (matchScore > highestScore) {
                highestScore = matchScore;
                bestKey = key;
            }
        }

        if (highestScore >= 2 && bestKey) {
            console.log(`[NPTEL Whisperer] Smart Fallback content fingerprint matched MCQ set: "${bestKey}" (confidence score: ${highestScore})`);
            return mcqSolutions[bestKey];
        }
    }

    return null;
}

// Match choice text with target answer text
function matchAnswerText(choiceText, targetAnswer) {
    const cleanChoice = cleanText(choiceText);
    const cleanTarget = cleanText(targetAnswer);
    if (!cleanChoice || !cleanTarget) return false;

    // 1. Exact clean match
    if (cleanChoice === cleanTarget) return true;

    // 2. Choice with prefix stripped
    const stripped = cleanChoice.replace(/^(\([a-z0-9]\)|[a-z0-9][\.\)\:\-])\s*/i, '').trim();
    if (stripped === cleanTarget) return true;

    // 3. Multi-word phrase matching
    if (cleanTarget.includes(' ')) {
        return cleanChoice.includes(cleanTarget);
    } else {
        // 4. Single word / number word-boundary match
        const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(^|\\s|\\(|\\)|\\[|\\]|\\.|\\b)${escaped}(\\b|\\s|\\(|\\)|\\[|\\]|\\.|$)`, 'i');
        return pattern.test(cleanChoice);
    }
}

// Detect distinct question blocks in DOM
function getQuestionContainers() {
    // 1. Known classes
    const selectors = [
        '.gcb-question',
        '.qt-question',
        '.question-container',
        '.assessment-question',
        'fieldset',
        '[data-question-index]',
        'div[id^="question"]'
    ];

    for (const selector of selectors) {
        const list = Array.from(document.querySelectorAll(selector));
        if (list.length >= 5) {
            return list;
        }
    }

    // 2. Identify question blocks by input parent groups
    const inputElements = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    if (inputElements.length > 0) {
        const groups = new Map();
        inputElements.forEach(input => {
            const parent = input.closest('fieldset, .border, .p-4, .p-6, .mb-6, .mb-8, .shadow-sm, [class*="question"]') || input.parentElement?.parentElement?.parentElement;
            if (parent && !groups.has(parent)) {
                groups.set(parent, true);
            }
        });
        const containers = Array.from(groups.keys());
        if (containers.length >= 5) {
            return containers;
        }
    }

    return [];
}

// Get clean readable text for a specific input option
function getChoiceText(input) {
    let text = '';
    const wrapper = input.closest('label, .gcb-mcq-choice, .qt-choice, .form-check, li, [class*="choice"], [class*="option"]');
    if (wrapper) {
        text = wrapper.innerText || wrapper.textContent || '';
    }
    if (!text && input.getAttribute('for')) {
        const lbl = document.querySelector(`label[for="${input.getAttribute('for')}"]`);
        if (lbl) text = lbl.innerText || lbl.textContent || '';
    }
    if (!text && input.id) {
        const lbl = document.querySelector(`label[for="${input.id}"]`);
        if (lbl) text = lbl.innerText || lbl.textContent || '';
    }
    if (!text && input.parentElement) {
        text = input.parentElement.innerText || input.parentElement.textContent || '';
    }
    return text;
}

// Helper to check if an input is in a checked/selected state
function isInputChecked(input) {
    if (!input) return false;
    if (input.type === 'text' || input.type === 'number') {
        return Boolean(input.value && input.value.trim().length > 0);
    }
    return Boolean(
        input.checked ||
        input.hasAttribute('checked') ||
        input.defaultChecked ||
        input.getAttribute('aria-checked') === 'true' ||
        input.getAttribute('data-state') === 'checked' ||
        input.closest('[aria-checked="true"], .selected, .active, .mat-radio-checked, .mat-checkbox-checked, [data-state="checked"]')
    );
}

// Ensure Inter font is loaded on page for Windows & Linux
function ensureInterFontLoaded() {
    if (!document.getElementById('nptel-inter-font')) {
        const link = document.createElement('link');
        link.id = 'nptel-inter-font';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
        document.head.appendChild(link);
    }
}

// UI Notification for corrected answers
function showNptelWhispererToast(actionsToPerform, autoSubmitEnabled) {
    ensureInterFontLoaded();
    const toastId = 'nptel-whisperer-toast';
    let existing = document.getElementById(toastId);
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.style.cssText = `
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #1f2937;
        padding: 16px 24px;
        border-radius: 12px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        z-index: 999999;
        font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 16px;
        border: 1px solid rgba(229, 231, 235, 0.5);
        transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        opacity: 0;
        margin-top: -20px;
    `;
    
    const icon = document.createElement('div');
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    icon.style.display = 'flex';
    
    // Format message
    const missingKeys = actionsToPerform.filter(a => a.action === 'check' || a.textInput).map(a => a.qKey.replace('Q', ''));
    const wrongKeys = actionsToPerform.filter(a => a.action === 'uncheck').map(a => a.qKey.replace('Q', ''));
    
    let missingText = '';
    if (missingKeys.length > 0) {
        missingText = `${missingKeys.length} missing answer${missingKeys.length > 1 ? 's' : ''} (${missingKeys.join(',')})`;
    }
    
    let wrongText = '';
    if (wrongKeys.length > 0) {
        wrongText = `${wrongKeys.length} wrong selection${wrongKeys.length > 1 ? 's' : ''} (${wrongKeys.join(',')})`;
    }
    
    const detailsText = [missingText, wrongText].filter(Boolean).join(' and ');
    
    const textWrapper = document.createElement('div');
    textWrapper.style.display = 'flex';
    textWrapper.style.flexDirection = 'column';
    textWrapper.style.gap = '4px';
    
    const title = document.createElement('div');
    title.innerHTML = `<strong style="color: #111827;">NPTEL Whisperer:</strong> Found incorrect answers!`;
    
    const text = document.createElement('div');
    text.style.fontSize = '12px';
    text.style.color = '#4b5563';
    text.innerHTML = `Found ${detailsText}.`;
    
    textWrapper.appendChild(title);
    textWrapper.appendChild(text);
    
    const fixBtn = document.createElement('button');
    fixBtn.innerHTML = 'Fix Answers';
    fixBtn.style.cssText = `
        background-color: #3b82f6;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
        transition: background-color 0.2s;
        white-space: nowrap;
    `;
    fixBtn.onmouseover = () => fixBtn.style.backgroundColor = '#2563eb';
    fixBtn.onmouseout = () => fixBtn.style.backgroundColor = '#3b82f6';
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = `
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        margin-left: 4px;
        line-height: 1;
    `;
    
    let autoDismissTimer = null;

    const dismissToast = (reason) => {
        if (autoDismissTimer) {
            clearTimeout(autoDismissTimer);
            autoDismissTimer = null;
        }
        toast.style.opacity = '0';
        toast.style.marginTop = '-20px';
        setTimeout(() => toast.remove(), 300);
    };
    
    closeBtn.onclick = () => {
        console.log("[NPTEL Whisperer] User dismissed correction prompt. No answers were modified.");
        dismissToast('user_dismissed');
    };
    
    fixBtn.onclick = () => {
        if (autoDismissTimer) {
            clearTimeout(autoDismissTimer);
            autoDismissTimer = null;
        }
        console.log(`[NPTEL Whisperer] User accepted prompt: Fixing ${actionsToPerform.length} incorrect/missing option(s)...`);
        fixBtn.innerHTML = 'Fixing...';
        fixBtn.style.backgroundColor = '#10b981';
        
        setTimeout(() => {
            actionsToPerform.forEach(item => {
                if (item.textInput) {
                    item.textInput.focus();
                    item.textInput.value = item.valueToSet;
                    item.textInput.dispatchEvent(new Event('input', { bubbles: true }));
                    item.textInput.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (item.input) {
                    item.input.focus();
                    item.input.click();
                    item.input.dispatchEvent(new Event('change', { bubbles: true }));
                    item.input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
            
            console.log(`[NPTEL Whisperer] Successfully applied corrections to ${actionsToPerform.length} option(s).`);

            if (autoSubmitEnabled) {
                console.log("[NPTEL Whisperer] Auto-submit enabled: Locating submit button...");
                setTimeout(() => {
                    const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], .gcb-submit-button, .qt-submit-btn'));
                    const submitBtn = allButtons.find(b => {
                        const t = (b.innerText || b.value || b.textContent || '').trim().toLowerCase();
                        return t.includes('submit answers') || t.includes('submit answer') || t === 'submit';
                    });
                    if (submitBtn) {
                        console.log("[NPTEL Whisperer] Auto-submit: Triggering answer submission.");
                        submitBtn.click();
                    } else {
                        console.warn("[NPTEL Whisperer] Auto-submit: Submit button not found on page.");
                    }
                }, 1500);
            } else {
                console.log("[NPTEL Whisperer] Auto-submit disabled: Answers updated without submitting.");
            }
            
            icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
            title.innerHTML = `<strong style="color: #111827;">Fixed Successfully!</strong>`;
            text.innerHTML = 'Answers have been updated.';
            fixBtn.style.display = 'none';
            
            setTimeout(() => dismissToast('fixed'), 4000);
        }, 300);
    };
    
    toast.appendChild(icon);
    toast.appendChild(textWrapper);
    toast.appendChild(fixBtn);
    toast.appendChild(closeBtn);
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.marginTop = '0';
    });
    
    // Auto dismiss after 10 seconds if no action is taken
    autoDismissTimer = setTimeout(() => {
        if (document.getElementById(toastId) && fixBtn.style.display !== 'none') {
            console.log("[NPTEL Whisperer] Correction prompt timed out (auto-dismissed after 10s). No answers were modified.");
            dismissToast('timeout');
        }
    }, 10000);
}

// Function to handle MCQ/MSQ injection and verification
function injectMCQSolutions(mcqData, autoSubmitEnabled) {
    console.log("[NPTEL Whisperer] Starting MCQ/MSQ assessment verification...");

    // Check if page indicates previous submission
    const pageText = (document.body ? document.body.innerText : '') || '';
    if (pageText.includes("Assignment submitted") ||
        pageText.includes("Assessment submitted") ||
        pageText.includes("You have submitted this assignment") ||
        pageText.includes("Submission Date:")) {
        console.log("[NPTEL Whisperer] Silently verified: Assessment is already marked submitted. Skipping injection & auto-submit.");
        return;
    }

    const questionContainers = getQuestionContainers();
    const qKeys = (typeof mcqData === 'object' && mcqData !== null && !Array.isArray(mcqData))
        ? Object.keys(mcqData)
        : (Array.isArray(mcqData) ? mcqData.map((_, i) => `Q${i + 1}`) : []);

    console.log(`[NPTEL Whisperer] Verifying ${qKeys.length} question(s) across ${questionContainers.length} detected question container(s)...`);

    let isEverythingCorrect = true;
    const actionsToPerform = [];

    qKeys.forEach((qKey, qIndex) => {
        const rawExpected = Array.isArray(mcqData) ? mcqData[qIndex] : mcqData[qKey];
        const expectedAnswers = Array.isArray(rawExpected) ? rawExpected : [rawExpected];
        const container = (questionContainers.length > qIndex) ? questionContainers[qIndex] : document;

        const inputs = Array.from(container.querySelectorAll('input[type="radio"], input[type="checkbox"]'));

        if (inputs.length === 0) {
            const textInput = container.querySelector('input[type="text"], input[type="number"]');
            if (textInput && expectedAnswers[0]) {
                const isMatch = cleanText(textInput.value) === cleanText(expectedAnswers[0]);
                if (!isMatch) {
                    isEverythingCorrect = false;
                    actionsToPerform.push({
                        textInput,
                        valueToSet: expectedAnswers[0],
                        qKey
                    });
                }
            }
            return;
        }

        let questionHasUnselectedExpected = false;
        let questionHasSelectedUnexpected = false;

        inputs.forEach(input => {
            const labelText = getChoiceText(input);
            const isExpected = expectedAnswers.some(ans => matchAnswerText(labelText, ans));
            const isChecked = isInputChecked(input);

            if (isExpected && !isChecked) {
                // Correct option is not checked
                isEverythingCorrect = false;
                questionHasUnselectedExpected = true;
                actionsToPerform.push({
                    input,
                    action: 'check',
                    qKey,
                    labelText
                });
            } else if (!isExpected && isChecked && input.type === 'checkbox') {
                // Wrong option in MSQ is checked
                isEverythingCorrect = false;
                questionHasSelectedUnexpected = true;
                actionsToPerform.push({
                    input,
                    action: 'uncheck',
                    qKey,
                    labelText
                });
            }
        });

        if (questionHasUnselectedExpected || questionHasSelectedUnexpected) {
            console.log(`[NPTEL Whisperer] ${qKey}: Needs update (Missing expected: ${questionHasUnselectedExpected}, Wrong selected: ${questionHasSelectedUnexpected})`);
        }
    });

    if (isEverythingCorrect) {
        console.log("[NPTEL Whisperer] Silently verified: All questions are already correctly answered (no missing or wrong options). Skipping injection & auto-submit.");
        return;
    }

    console.log(`[NPTEL Whisperer] Found ${actionsToPerform.length} incorrect/missing option(s). Prompting user for permission...`);
    
    // Show UI notification and wait for user to click "Fix Answers"
    showNptelWhispererToast(actionsToPerform, autoSubmitEnabled);
}

// Helper to retrieve currently rendered code from the editor DOM
function getVisibleEditorCode() {
    // 1. Ace Editor lines
    const aceLines = Array.from(document.querySelectorAll('.ace_line, .ace_line_group'));
    if (aceLines.length > 0) {
        const text = aceLines.map(l => l.innerText || l.textContent || '').join('\n');
        if (text.trim().length > 0) return text;
    }

    // 2. Monaco Editor lines
    const monacoLines = Array.from(document.querySelectorAll('.view-line'));
    if (monacoLines.length > 0) {
        const text = monacoLines.map(l => l.innerText || l.textContent || '').join('\n');
        if (text.trim().length > 0) return text;
    }

    // 3. Textarea fallback
    const el = document.querySelector('textarea.inputarea, .monaco-editor textarea, textarea, .ace_text-input');
    if (el && el.value && el.value.trim().length > 5) {
        return el.value;
    }

    return '';
}

// Helper to normalize code lines for comparison
function normalizeCode(code) {
    if (!code) return '';
    return code
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');
}

// Function to handle Programming Solution injection
function injectProgrammingSolution(pythonCodeToInject, autoSubmitEnabled) {
    console.log("[NPTEL Whisperer] Verifying programming assignment state...");

    const pageText = (document.body ? document.body.innerText : '') || '';

    // 1. Check for submission status, scores, and evaluation banners
    const isAlreadySubmittedOrEvaluated =
        /status\s*:\s*(evaluated|submitted)/i.test(pageText) ||
        /score\s*:\s*100/i.test(pageText) ||
        /100\s*\/\s*100/.test(pageText) ||
        /all\s*(public\s*and\s*private\s*)?test\s*cases?\s*passed/i.test(pageText) ||
        /passed\s*all\s*test\s*cases/i.test(pageText) ||
        /passed\s*:\s*100%/i.test(pageText) ||
        /submission\s*date\s*:/i.test(pageText) ||
        /submitted\s*on\s*:/i.test(pageText) ||
        /submission\s*details/i.test(pageText) ||
        /your\s*submission/i.test(pageText) ||
        /you\s*have\s*(already\s*)?submitted/i.test(pageText);

    if (isAlreadySubmittedOrEvaluated) {
        console.log("[NPTEL Whisperer] Silently verified: Assignment is already submitted/evaluated. Skipping injection & auto-submit.");
        return;
    }

    // 2. Check if the current editor code already matches the solution
    const currentEditorCode = getVisibleEditorCode();
    if (currentEditorCode && normalizeCode(currentEditorCode) === normalizeCode(pythonCodeToInject)) {
        console.log("[NPTEL Whisperer] Silently verified: Target solution already exists in the editor. Skipping injection & re-submission.");
        return;
    }

    console.log("[NPTEL Whisperer] Searching DOM for code editor textarea...");

    // Target both standard textareas and embedded editor textareas (CSP-compliant DOM injection)
    const el = document.querySelector('textarea.inputarea, .monaco-editor textarea, textarea, .ace_text-input');

    if (el) {
        el.focus();

        // 1. STEP 1: CTRL + A (Select All)
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const selectAllParams = {
            key: 'a',
            code: 'KeyA',
            keyCode: 65,
            which: 65,
            ctrlKey: !isMac,
            metaKey: isMac,
            bubbles: true,
            cancelable: true,
            composed: true
        };
        el.dispatchEvent(new KeyboardEvent('keydown', selectAllParams));
        el.dispatchEvent(new KeyboardEvent('keypress', selectAllParams));
        document.execCommand('selectAll', false, null);
        el.dispatchEvent(new KeyboardEvent('keyup', selectAllParams));

        // 2. STEP 2: DELETE / BACKSPACE (Clear Selection)
        const backspaceParams = {
            key: 'Backspace',
            code: 'Backspace',
            keyCode: 8,
            which: 8,
            bubbles: true,
            cancelable: true,
            composed: true
        };
        const deleteParams = {
            key: 'Delete',
            code: 'Delete',
            keyCode: 46,
            which: 46,
            bubbles: true,
            cancelable: true,
            composed: true
        };
        el.dispatchEvent(new KeyboardEvent('keydown', backspaceParams));
        el.dispatchEvent(new KeyboardEvent('keydown', deleteParams));
        document.execCommand('delete', false, null);
        document.execCommand('forwardDelete', false, null);
        el.dispatchEvent(new KeyboardEvent('keyup', backspaceParams));
        el.dispatchEvent(new KeyboardEvent('keyup', deleteParams));

        // 3. STEP 3: INJECT SOLUTION
        document.execCommand('insertText', false, pythonCodeToInject);

        // Check if this is a standard HTML textarea (not an internal code editor proxy)
        const isProxyInput = el.classList.contains('inputarea') ||
            el.classList.contains('ace_text-input') ||
            Boolean(el.closest('.monaco-editor, .ace_editor, .CodeMirror'));

        if (!isProxyInput) {
            try {
                const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                if (nativeValueSetter) {
                    nativeValueSetter.call(el, pythonCodeToInject);
                } else {
                    el.value = pythonCodeToInject;
                }
            } catch (e) {
                el.value = pythonCodeToInject;
            }
            el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
        }

        console.log("[NPTEL Whisperer] Programming solution injected successfully!");

        // Auto-submit logic if enabled in settings
        if (autoSubmitEnabled) {
            console.log("[NPTEL Whisperer] Auto-submit enabled. Searching for 'Compile & Run' button in 1500ms...");
            setTimeout(() => {
                const actionButtons = Array.from(document.querySelectorAll('.programming-action-buttons button, button.programming-button, button'));
                const compileBtn = actionButtons.find(b => {
                    const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                    return text.includes('compile') && text.includes('run');
                }) || actionButtons.find(b => (b.innerText || b.textContent || '').trim().toLowerCase().includes('compile'));

                if (compileBtn) {
                    console.log("[NPTEL Whisperer] Clicking 'Compile & Run' button...");
                    compileBtn.click();

                    // Wait 3500ms for compile & run to initiate/finish, then find and click Submit button
                    console.log("[NPTEL Whisperer] Waiting 3500ms for compilation before clicking Submit...");
                    setTimeout(() => {
                        const refreshedButtons = Array.from(document.querySelectorAll('.programming-action-buttons button, button.programming-button, button'));
                        const submitBtn = refreshedButtons.find(b => {
                            const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                            return text === 'submit' || (text.includes('submit') && !text.includes('draft'));
                        });

                        if (submitBtn) {
                            console.log("[NPTEL Whisperer] Clicking 'Submit' button...");
                            submitBtn.click();
                            console.log("[NPTEL Whisperer] Programming solution submitted successfully.");
                        } else {
                            console.warn("[NPTEL Whisperer] 'Submit' button not found after compilation.");
                        }
                    }, 3500);
                } else {
                    // Fallback if compile button not found: try clicking Submit button directly
                    const submitBtn = actionButtons.find(b => {
                        const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                        return text === 'submit' || (text.includes('submit') && !text.includes('draft'));
                    });
                    if (submitBtn) {
                        console.log("[NPTEL Whisperer] 'Compile & Run' not found; clicking 'Submit' button directly...");
                        submitBtn.click();
                        console.log("[NPTEL Whisperer] Programming solution submitted.");
                    } else {
                        console.warn("[NPTEL Whisperer] Neither 'Compile & Run' nor 'Submit' button found.");
                    }
                }
            }, 1500);
        }
    } else {
        console.warn("[NPTEL Whisperer] Target code editor textarea not found.");
    }
}

// SPA URL Change Observer & Main Execution Block
let lastHandledUrl = '';
let activeInjectionTimeout = null;

async function runInjector() {
    const currentURL = window.location.href;
    if (currentURL === lastHandledUrl) {
        return;
    }
    lastHandledUrl = currentURL;

    console.log("[NPTEL Whisperer] URL change detected / Page loaded:", currentURL);

    // Clear any pending timeouts from previous route
    if (activeInjectionTimeout) {
        clearTimeout(activeInjectionTimeout);
        activeInjectionTimeout = null;
    }

    // 1. Fetch latest solutions or fallback to local cache
    const nptelData = await fetchLatestSolutions();

    chrome.storage.local.get(['autoSubmit'], (result) => {
        const autoSubmitEnabled = Boolean(result.autoSubmit);
        console.log("[NPTEL Whisperer] Auto-submit preference:", autoSubmitEnabled);
        console.log("[NPTEL Whisperer] Checking current URL against database mappings...");

        if (!nptelData) {
            console.warn("[NPTEL Whisperer] No solutions data available to check against.");
            return;
        }

        let attempts = 0;
        const maxAttempts = 6;

        const attemptResolveAndInject = () => {
            attempts++;
            const currentUrlLower = window.location.href.toLowerCase();
            const params = getNormalizedUrlParams();
            const isAssessmentUrl = Boolean(params.assessmentid || currentUrlLower.includes('assessmentid') || currentUrlLower.includes('assessment='));
            const isProgrammingUrl = Boolean(params.progassignmentid || currentUrlLower.includes('progassignmentid') || currentUrlLower.includes('progassignment'));

            // 1. Direct MCQ resolution
            const mcqData = getMCQSolutionForCurrentPage(nptelData);
            // 2. Direct Programming resolution
            const pythonCode = getProgrammingSolutionForCurrentPage(nptelData);

            const hasEditor = Boolean(document.querySelector('textarea.inputarea, .ace_editor, .monaco-editor, #editor, textarea'));
            const hasQuestions = getQuestionContainers().length > 0 || document.querySelectorAll('input[type="radio"], input[type="checkbox"]').length >= 3;

            if (isAssessmentUrl && mcqData) {
                if (!hasQuestions && attempts < maxAttempts) {
                    console.log(`[NPTEL Whisperer] MCQ page detected, waiting for questions to render in DOM (attempt ${attempts}/${maxAttempts})...`);
                    activeInjectionTimeout = setTimeout(attemptResolveAndInject, 800);
                    return;
                }
                console.log("[NPTEL Whisperer] Mode: MCQ/MSQ Assessment detected.");
                injectMCQSolutions(mcqData, autoSubmitEnabled);
            } else if (isProgrammingUrl && pythonCode) {
                if (!hasEditor && attempts < maxAttempts) {
                    console.log(`[NPTEL Whisperer] Programming page detected, waiting for code editor to render in DOM (attempt ${attempts}/${maxAttempts})...`);
                    activeInjectionTimeout = setTimeout(attemptResolveAndInject, 800);
                    return;
                }
                console.log("[NPTEL Whisperer] Mode: Programming Assignment detected.");
                injectProgrammingSolution(pythonCode, autoSubmitEnabled);
            } else if (mcqData && hasQuestions) {
                console.log("[NPTEL Whisperer] Mode: MCQ/MSQ Assessment detected via heuristic.");
                injectMCQSolutions(mcqData, autoSubmitEnabled);
            } else if (pythonCode && hasEditor) {
                console.log("[NPTEL Whisperer] Mode: Programming Assignment detected via heuristic.");
                injectProgrammingSolution(pythonCode, autoSubmitEnabled);
            } else if ((isAssessmentUrl || isProgrammingUrl) && attempts < maxAttempts) {
                console.log(`[NPTEL Whisperer] Assignment URL recognized, waiting for page components (attempt ${attempts}/${maxAttempts})...`);
                activeInjectionTimeout = setTimeout(attemptResolveAndInject, 800);
                return;
            } else {
                console.log("[NPTEL Whisperer] No programming or MCQ solution mapped for this URL/page:", window.location.href);
            }
        };

        // Allow SPA DOM a brief initial moment to mount
        activeInjectionTimeout = setTimeout(attemptResolveAndInject, 1000);
    });
}

// 1. Initial run on page load
runInjector();

// 2. Wrap history pushState and replaceState for SPA client-side routing
const originalPushState = history.pushState;
history.pushState = function (...args) {
    originalPushState.apply(this, args);
    runInjector();
};

const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    runInjector();
};

// 3. Listen to popstate and hashchange events
window.addEventListener('popstate', runInjector);
window.addEventListener('hashchange', runInjector);

// 4. Polling observer fallback for Next.js / React Router navigation
setInterval(() => {
    if (window.location.href !== lastHandledUrl) {
        runInjector();
    }
}, 800);