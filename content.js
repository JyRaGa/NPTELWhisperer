// content.js - NPTEL Whisperer Injection Logic

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

// Detect week number from URL and page context
function detectWeekNumber() {
    const url = window.location.href.toLowerCase();
    const context = getPageContextText();

    // Check URL (e.g. week4, week-4, unit=4, unit=28)
    const urlWeekMatch = url.match(/week[-_]?0?(\d+)/i) || url.match(/[?&]unit=0?(\d+)/i);
    if (urlWeekMatch) {
        const num = parseInt(urlWeekMatch[1], 10);
        if (num >= 1 && num <= 12) return num;
    }

    // Check context (e.g. "Week 4", "Assignment 4", "Unit 4")
    const contextMatch = context.match(/week\s*0?(\d+)/i) || 
                         context.match(/assignment\s*0?(\d+)/i) || 
                         context.match(/unit\s*0?(\d+)/i);
    if (contextMatch) {
        const num = parseInt(contextMatch[1], 10);
        if (num >= 1 && num <= 12) return num;
    }

    return null;
}

// Function to find the correct Python code based on the current page URL & DOM heuristics
function getProgrammingSolutionForCurrentPage(nptelData) {
    const currentURL = window.location.href;
    const programming = nptelData?.programming;

    if (!programming) {
        return null;
    }

    // 1. Direct URL fragment match
    for (const week in programming) {
        if (Object.prototype.hasOwnProperty.call(programming, week)) {
            const weekSolutions = programming[week];
            for (const urlFragment in weekSolutions) {
                if (Object.prototype.hasOwnProperty.call(weekSolutions, urlFragment)) {
                    if (urlFragment && currentURL.includes(urlFragment)) {
                        console.log(`[NPTEL Whisperer] Matched programming assignment URL fragment: "${urlFragment}" (in ${week})`);
                        return weekSolutions[urlFragment];
                    }
                }
            }
        }
    }

    // 2. Smart Fallback: Match based on Week + Problem Number / Keywords in DOM
    const isExplicitAssessmentPage = currentURL.includes('assessmentId') || currentURL.includes('assessment=');
    const hasCodeEditor = Boolean(document.querySelector('textarea.inputarea, .ace_editor, .monaco-editor, #editor, textarea'));
    const hasQuestions = document.querySelectorAll('input[type="radio"], input[type="checkbox"], .gcb-question').length >= 3;

    if (isExplicitAssessmentPage || (hasQuestions && !hasCodeEditor)) {
        return null;
    }

    const weekNum = detectWeekNumber();
    if (weekNum) {
        const weekKey = `week${weekNum}`;
        const weekSolutions = programming[weekKey];
        if (weekSolutions) {
            const solutionKeys = Object.keys(weekSolutions);
            if (solutionKeys.length > 0) {
                const combinedContext = (window.location.href + ' ' + getPageContextText()).toLowerCase();

                // Problem 1 heuristics
                if (combinedContext.includes('assignment 1') || combinedContext.includes('problem 1') || 
                    combinedContext.includes('question 1') || combinedContext.includes('prog 1') || 
                    combinedContext.includes('temperature') || combinedContext.includes('frequency') ||
                    combinedContext.includes('progassignmentid=1') || combinedContext.includes('name=1')) {
                    console.log(`[NPTEL Whisperer] Smart Fallback matched ${weekKey} Problem 1`);
                    return weekSolutions[solutionKeys[0]];
                }

                // Problem 2 heuristics
                if (combinedContext.includes('assignment 2') || combinedContext.includes('problem 2') || 
                    combinedContext.includes('question 2') || combinedContext.includes('prog 2') || 
                    combinedContext.includes('prime') || combinedContext.includes('first duplicate') ||
                    combinedContext.includes('progassignmentid=2') || combinedContext.includes('name=2')) {
                    console.log(`[NPTEL Whisperer] Smart Fallback matched ${weekKey} Problem 2`);
                    return weekSolutions[solutionKeys[1] || solutionKeys[0]];
                }

                // Problem 3 heuristics
                if (combinedContext.includes('assignment 3') || combinedContext.includes('problem 3') || 
                    combinedContext.includes('question 3') || combinedContext.includes('prog 3') || 
                    combinedContext.includes('product id') || combinedContext.includes('exactly twice') ||
                    combinedContext.includes('progassignmentid=3') || combinedContext.includes('name=3')) {
                    console.log(`[NPTEL Whisperer] Smart Fallback matched ${weekKey} Problem 3`);
                    return weekSolutions[solutionKeys[2] || solutionKeys[0]];
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
    const mcqSolutions = nptelData?.mcq;

    if (!mcqSolutions) {
        return null;
    }

    // 1. Direct URL fragment match
    for (const urlFragment in mcqSolutions) {
        if (Object.prototype.hasOwnProperty.call(mcqSolutions, urlFragment)) {
            if (urlFragment && currentURL.includes(urlFragment)) {
                console.log(`[NPTEL Whisperer] Matched MCQ assessment URL fragment: "${urlFragment}"`);
                return mcqSolutions[urlFragment];
            }
        }
    }

    // 2. Smart Fallback via Week Detection
    const weekNum = detectWeekNumber();
    if (weekNum) {
        for (const key in mcqSolutions) {
            if (key.toLowerCase().includes(`week${weekNum}`) || 
                key.toLowerCase().includes(`week_${weekNum}`) || 
                key.toLowerCase().includes(`assessment_${weekNum}`)) {
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
    }

    // 3. Question Content Fingerprint Matching
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

    console.log(`[NPTEL Whisperer] Executing ${actionsToPerform.length} corrective option update(s)...`);

    // Perform needed updates
    actionsToPerform.forEach(item => {
        if (item.textInput) {
            item.textInput.focus();
            item.textInput.value = item.valueToSet;
            item.textInput.dispatchEvent(new Event('input', { bubbles: true }));
            item.textInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`[NPTEL Whisperer] [✓] Set value for ${item.qKey}: "${item.valueToSet}"`);
        } else if (item.input) {
            item.input.focus();
            item.input.click();
            item.input.dispatchEvent(new Event('change', { bubbles: true }));
            item.input.dispatchEvent(new Event('input', { bubbles: true }));
            console.log(`[NPTEL Whisperer] [✓] ${item.action === 'check' ? 'Selected' : 'Unselected'} for ${item.qKey}: "${item.labelText.trim().slice(0, 40)}..."`);
        }
    });

    console.log("[NPTEL Whisperer] MCQ Injection complete.");

    if (autoSubmitEnabled) {
        console.log("[NPTEL Whisperer] Auto-submit enabled. Searching for 'Submit Answers' button in 1500ms...");
        setTimeout(() => {
            const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], .gcb-submit-button, .qt-submit-btn'));
            const submitBtn = allButtons.find(b => {
                const text = (b.innerText || b.value || b.textContent || '').trim().toLowerCase();
                return text.includes('submit answers') || text.includes('submit answer') || text === 'submit';
            });

            if (submitBtn) {
                console.log("[NPTEL Whisperer] Clicking 'Submit Answers' button...");
                submitBtn.click();
                console.log("[NPTEL Whisperer] MCQ Assessment submitted successfully.");
            } else {
                console.warn("[NPTEL Whisperer] 'Submit Answers' button not found on MCQ page.");
            }
        }, 1500);
    }
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

        const attemptResolveAndInject = () => {
            const currentUrlLower = window.location.href.toLowerCase();
            const isAssessmentUrl = currentUrlLower.includes('assessmentid') || currentUrlLower.includes('assessment=');
            const isProgrammingUrl = currentUrlLower.includes('progassignmentid') || currentUrlLower.includes('progassignment');

            // 1. Direct MCQ resolution
            const mcqData = getMCQSolutionForCurrentPage(nptelData);
            // 2. Direct Programming resolution
            const pythonCode = getProgrammingSolutionForCurrentPage(nptelData);

            if (isAssessmentUrl && mcqData) {
                console.log("[NPTEL Whisperer] Mode: MCQ/MSQ Assessment detected.");
                injectMCQSolutions(mcqData, autoSubmitEnabled);
            } else if (isProgrammingUrl && pythonCode) {
                console.log("[NPTEL Whisperer] Mode: Programming Assignment detected.");
                injectProgrammingSolution(pythonCode, autoSubmitEnabled);
            } else if (mcqData) {
                console.log("[NPTEL Whisperer] Mode: MCQ/MSQ Assessment detected.");
                injectMCQSolutions(mcqData, autoSubmitEnabled);
            } else if (pythonCode) {
                console.log("[NPTEL Whisperer] Mode: Programming Assignment detected.");
                injectProgrammingSolution(pythonCode, autoSubmitEnabled);
            } else {
                console.log("[NPTEL Whisperer] No programming or MCQ solution mapped for this URL/page:", currentURL);
            }
        };

        // Allow SPA DOM 2000ms to mount and render before detecting and injecting
        activeInjectionTimeout = setTimeout(attemptResolveAndInject, 2000);
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