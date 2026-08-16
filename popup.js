document.addEventListener('DOMContentLoaded', () => {
  const autoSubmitCheckbox = document.getElementById('autoSubmit');

  if (autoSubmitCheckbox) {
    // Load the current setting from storage
    chrome.storage.local.get(['autoSubmit'], (result) => {
      autoSubmitCheckbox.checked = Boolean(result.autoSubmit);
    });

    // Save the setting when toggled
    autoSubmitCheckbox.addEventListener('change', () => {
      chrome.storage.local.set({ autoSubmit: autoSubmitCheckbox.checked });
    });
  }
});