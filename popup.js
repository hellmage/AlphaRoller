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

  // Load saved state
  loadState();

  // Check for current Alpha page
  checkCurrentAlphaPage();

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

  async function loadState() {
    const result = await chrome.storage.local.get(['autoTradingEnabled', 'detectedSymbols']);
    const enabled = result.autoTradingEnabled || false;
    const symbols = result.detectedSymbols || [];

    if (enableToggle) enableToggle.checked = enabled;
    updateStatus(enabled);
    updateSymbolList(symbols);
  }

  function updateStatus(enabled) {
    if (statusElement) {
      statusElement.textContent = enabled ? 'Active' : 'Inactive';
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

