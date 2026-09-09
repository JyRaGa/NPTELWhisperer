// popup.js - NPTEL Whisperer Popup Controller

document.addEventListener('DOMContentLoaded', () => {
  // 1. Auto-Submit toggle handling
  const autoSubmitCheckbox = document.getElementById('autoSubmit');
  if (autoSubmitCheckbox) {
    chrome.storage.local.get(['autoSubmit'], (result) => {
      autoSubmitCheckbox.checked = Boolean(result.autoSubmit);
    });

    autoSubmitCheckbox.addEventListener('change', () => {
      chrome.storage.local.set({ autoSubmit: autoSubmitCheckbox.checked });
    });
  }

  // 2. Diagnostics Elements
  const toggleDiagBtn = document.getElementById('toggleDiagBtn');
  const diagPanel = document.getElementById('diagPanel');
  const diagArrow = document.getElementById('diagArrow');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const consoleBox = document.getElementById('consoleBox');
  const copyLogsBtn = document.getElementById('copyLogsBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const refreshBtn = document.getElementById('refreshBtn');

  let isDiagOpen = false;
  let currentRawLogs = [];

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderLogs(logs) {
    currentRawLogs = logs || [];
    if (!logs || logs.length === 0) {
      consoleBox.innerHTML = '<span style="color: #64748b;">No diagnostic logs recorded yet.</span>';
      return;
    }

    const lines = logs.map(item => {
      const time = `<span class="log-time">[${escapeHtml(item.time || '')}]</span>`;
      let levelClass = 'log-info';
      if (item.level === 'warn') levelClass = 'log-warn';
      if (item.level === 'error') levelClass = 'log-error';

      const tag = `<span class="${levelClass}">[${item.level.toUpperCase()}]</span>`;
      const msg = `<span class="log-text">${escapeHtml(item.message)}</span>`;
      return `<div class="log-line">${time} ${tag} ${msg}</div>`;
    });

    consoleBox.innerHTML = lines.join('');
    consoleBox.scrollTop = consoleBox.scrollHeight;
  }

  async function loadDiagnostics() {
    statusText.textContent = 'Scanning active tab...';
    statusDot.className = 'status-dot';

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (activeTab && activeTab.url && activeTab.url.includes('onlinecourses.nptel.ac.in')) {
        chrome.tabs.sendMessage(activeTab.id, { type: 'GET_DIAGNOSTICS' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            // Content script may not have injected or tab not fully loaded yet
            statusText.textContent = 'NPTEL Tab (Refresh page)';
            fallbackToStoredLogs();
            return;
          }

          statusDot.className = 'status-dot online';
          const targetInfo = response.assessmentId !== 'N/A' 
            ? `Assmt #${response.assessmentId}` 
            : (response.progassignmentId !== 'N/A' ? `Prog #${response.progassignmentId}` : 'NPTEL Page');
          statusText.textContent = `Online (${targetInfo})`;
          renderLogs(response.logs);
        });
      } else {
        statusText.textContent = 'Standby (Not on NPTEL tab)';
        fallbackToStoredLogs();
      }
    } catch (err) {
      statusText.textContent = 'Standby';
      fallbackToStoredLogs();
    }
  }

  function fallbackToStoredLogs() {
    chrome.storage.local.get(['nptelDiagnosticLogs'], (result) => {
      if (result && result.nptelDiagnosticLogs && result.nptelDiagnosticLogs.length > 0) {
        renderLogs(result.nptelDiagnosticLogs);
      } else {
        consoleBox.innerHTML = '<span style="color: #64748b;">No logs recorded yet.\nNavigate to an NPTEL assignment page to view live diagnostics.</span>';
      }
    });
  }

  // Toggle button
  if (toggleDiagBtn) {
    toggleDiagBtn.addEventListener('click', () => {
      isDiagOpen = !isDiagOpen;
      diagPanel.style.display = isDiagOpen ? 'block' : 'none';
      diagArrow.textContent = isDiagOpen ? '▲' : '▼';
      if (isDiagOpen) {
        loadDiagnostics();
      }
    });
  }

  // Refresh
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadDiagnostics();
    });
  }

  // Clear logs
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id) {
          chrome.tabs.sendMessage(activeTab.id, { type: 'CLEAR_DIAGNOSTICS' }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
      } catch (e) {}

      chrome.storage.local.remove(['nptelDiagnosticLogs'], () => {
        renderLogs([]);
      });
    });
  }

  // Copy logs
  if (copyLogsBtn) {
    copyLogsBtn.addEventListener('click', () => {
      if (!currentRawLogs || currentRawLogs.length === 0) return;
      const plainText = currentRawLogs.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
      navigator.clipboard.writeText(plainText).then(() => {
        const originalText = copyLogsBtn.textContent;
        copyLogsBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyLogsBtn.textContent = originalText;
        }, 1200);
      });
    });
  }
});