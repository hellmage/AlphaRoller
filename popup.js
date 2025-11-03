// AlphaRoller popup script

document.addEventListener('DOMContentLoaded', () => {
  const enableToggle = document.getElementById('enableToggle');
  const scanButton = document.getElementById('scanButton');
  const refreshButton = document.getElementById('refreshButton');
  const statusElement = document.getElementById('status');
  const symbolCountElement = document.getElementById('symbolCount');
  const symbolListElement = document.getElementById('symbolList');
  const alphaPageInfo = document.getElementById('alphaPageInfo');
  const alphaChain = document.getElementById('alphaChain');
  const alphaContract = document.getElementById('alphaContract');
  const commitSection = document.getElementById('commitSection');
  const commitButton = document.getElementById('commitButton');
  const dryRunToggle = document.getElementById('dryRunToggle');
  const togglePanelButton = document.getElementById('togglePanelButton');

  // Load saved state
  loadState();

  // Check for current Alpha page
  checkCurrentAlphaPage();
  initSidePanelButton();

  // Toggle auto-trading
  if (enableToggle) {
    enableToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await chrome.storage.local.set({ autoTradingEnabled: enabled });
      updateStatus(enabled);
      
      // Send message to content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('binance.com')) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'toggleAutoTrading',
          enabled: enabled
        });
      }
    });
  }

  // Toggle dry run
  if (dryRunToggle) {
    dryRunToggle.addEventListener('change', async (e) => {
      const dryRun = e.target.checked;
      await chrome.storage.local.set({ dryRunEnabled: dryRun });
      // Inform content script (optional; it also reads from storage)
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('binance.com')) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'setDryRun',
          enabled: dryRun
        });
      }
      // Refresh status display to reflect dry run
      loadState();
    });
  }

  // Scan for symbols
  if (scanButton) {
    scanButton.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('binance.com')) {
        chrome.tabs.sendMessage(tab.id, { action: 'scanSymbols' });
        setTimeout(loadState, 500); // Reload state after scanning
      } else {
        alert('Please navigate to Binance website first');
      }
    });
  }

  // Refresh status
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      loadState();
      checkCurrentAlphaPage();
    });
  }

  // Commit button
  if (commitButton) {
    commitButton.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('binance.com')) {
        chrome.tabs.sendMessage(tab.id, { action: 'commitNow' });
        commitButton.textContent = 'Committing...';
        commitButton.disabled = true;
        
        setTimeout(() => {
          commitButton.textContent = 'Commit Transaction';
          commitButton.disabled = false;
        }, 3000);
      }
    });
  }

  function initSidePanelButton() {
    if (!togglePanelButton) return;
    // Initialize label from storage
    chrome.storage.local.get(['sidePanelEnabled'], (result) => {
      const enabled = result.sidePanelEnabled !== undefined ? result.sidePanelEnabled : true;
      togglePanelButton.textContent = enabled ? 'Hide Side Panel' : 'Show Side Panel';
    });

    togglePanelButton.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.includes('binance.com')) return;

      // Determine desired next state from storage, then explicitly set it
      chrome.storage.local.get(['sidePanelEnabled'], (res) => {
        const next = !(res.sidePanelEnabled !== undefined ? res.sidePanelEnabled : true);
        const updateLabel = (on) => {
          togglePanelButton.textContent = on ? 'Hide Side Panel' : 'Show Side Panel';
          chrome.storage.local.set({ sidePanelEnabled: on });
        };

        let responded = false;
        chrome.tabs.sendMessage(tab.id, { action: 'setSidePanel', enabled: next }, (response) => {
          responded = true;
          const enabled = response && typeof response.enabled === 'boolean' ? response.enabled : next;
          updateLabel(enabled);
        });

        // If no response (content script not ready), retry once after delay
        setTimeout(() => {
          if (responded) return;
          chrome.tabs.sendMessage(tab.id, { action: 'setSidePanel', enabled: next }, (response) => {
            const enabled = response && typeof response.enabled === 'boolean' ? response.enabled : next;
            updateLabel(enabled);
          });
        }, 500);
      });
    });
  }

  async function loadState() {
    const result = await chrome.storage.local.get(['autoTradingEnabled', 'detectedSymbols', 'dryRunEnabled']);
    const enabled = result.autoTradingEnabled || false;
    const symbols = result.detectedSymbols || [];
    const dryRun = result.dryRunEnabled !== undefined ? result.dryRunEnabled : true;

    if (enableToggle) enableToggle.checked = enabled;
    if (dryRunToggle) dryRunToggle.checked = dryRun;
    updateStatus(enabled, dryRun);
    updateSymbolList(symbols);
  }

  function updateStatus(enabled, dryRun) {
    if (statusElement) {
      let text = enabled ? 'Active' : 'Inactive';
      if (dryRun) text += ' (Dry Run)';
      statusElement.textContent = text;
      statusElement.style.color = enabled ? '#0f9d58' : '#999';
    }
  }

  function updateSymbolList(symbols) {
    if (symbolCountElement) {
      symbolCountElement.textContent = symbols.length;
    }

    if (symbolListElement) {
      if (symbols.length === 0) {
        symbolListElement.innerHTML = '<p class="no-symbols">No alpha symbols detected yet</p>';
      } else {
        symbolListElement.innerHTML = symbols.map(symbol => 
          `<div class="symbol-item">${symbol}</div>`
        ).join('');
      }
    }
  }

  async function checkCurrentAlphaPage() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.url && tab.url.includes('binance.com') && tab.url.includes('/alpha/')) {
      try {
        chrome.tabs.sendMessage(tab.id, { action: 'getCurrentAlpha' }, (response) => {
          if (response && response.contract) {
            displayAlphaInfo(response.contract);
          } else {
            // Try loading from storage
            chrome.storage.local.get(['currentAlpha'], (result) => {
              if (result.currentAlpha) {
                displayAlphaInfo(result.currentAlpha);
              } else {
                hideAlphaInfo();
              }
            });
          }
        });
      } catch (e) {
        // Content script might not be ready, try storage
        chrome.storage.local.get(['currentAlpha'], (result) => {
          if (result.currentAlpha) {
            displayAlphaInfo(result.currentAlpha);
          } else {
            hideAlphaInfo();
          }
        });
      }
    } else {
      hideAlphaInfo();
    }
  }

  function displayAlphaInfo(contract) {
    if (alphaPageInfo) alphaPageInfo.style.display = 'block';
    if (commitSection) commitSection.style.display = 'block';
    if (alphaChain) alphaChain.textContent = contract.chain || '-';
    if (alphaContract) {
      const address = contract.address || '';
      // Show shortened version for display
      alphaContract.textContent = address.length > 12 
        ? `${address.slice(0, 6)}...${address.slice(-6)}`
        : address;
      alphaContract.title = address; // Full address on hover
    }
  }

  function hideAlphaInfo() {
    if (alphaPageInfo) alphaPageInfo.style.display = 'none';
    if (commitSection) commitSection.style.display = 'none';
  }

  // Listen for updates from content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'symbolsUpdated') {
      loadState();
    } else if (message.action === 'alphaPageDetected') {
      displayAlphaInfo(message.contract);
    }
  });
});

