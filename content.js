// AlphaRoller content script - Binance Alpha Symbol Transaction Handler

(function() {
  'use strict';

  console.log('AlphaRoller: Content script loaded on Binance');

  let autoTradingEnabled = false;
  let detectedSymbols = new Set();
  let dryRunEnabled = true;
  let currentAlphaContract = null;
  let observer = null;

  // Initialize extension
  init();

  async function init() {
    // Load saved state
    const result = await chrome.storage.local.get(['autoTradingEnabled', 'detectedSymbols', 'dryRunEnabled']);
    autoTradingEnabled = result.autoTradingEnabled || false;
    if (result.detectedSymbols) {
      detectedSymbols = new Set(result.detectedSymbols);
    }
    dryRunEnabled = result.dryRunEnabled !== undefined ? result.dryRunEnabled : true;

    // Check if we're on an Alpha symbol page
    checkAlphaPage();

    // Start scanning for alpha symbols
    startSymbolDetection();
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'toggleAutoTrading') {
        autoTradingEnabled = request.enabled;
        chrome.storage.local.set({ autoTradingEnabled: autoTradingEnabled });
        if (autoTradingEnabled && currentAlphaContract) {
          attemptCommitTransaction();
        }
        sendResponse({ success: true });
      } else if (request.action === 'scanSymbols') {
        scanForAlphaSymbols();
        sendResponse({ success: true });
      } else if (request.action === 'setDryRun') {
        dryRunEnabled = !!request.enabled;
        chrome.storage.local.set({ dryRunEnabled });
        sendResponse({ success: true });
      } else if (request.action === 'commitNow') {
        attemptCommitTransaction();
        sendResponse({ success: true });
      } else if (request.action === 'getCurrentAlpha') {
        sendResponse({ contract: currentAlphaContract, url: window.location.href });
        return true;
      }
      return true;
    });

    // Listen for URL changes (for SPAs)
    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        checkAlphaPage();
      }
    }).observe(document, { subtree: true, childList: true });
  }

  function checkAlphaPage() {
    const url = window.location.href;
    const alphaMatch = url.match(/\/alpha\/([^/]+)\/(0x[a-fA-F0-9]{40})/);
    
    if (alphaMatch) {
      const chain = alphaMatch[1]; // e.g., 'bsc'
      const contractAddress = alphaMatch[2]; // e.g., '0xae1e85c3665b70b682defd778e3dafdf09ed3b0f'
      
      currentAlphaContract = {
        chain: chain.toUpperCase(),
        address: contractAddress,
        url: url
      };

      console.log('AlphaRoller: Detected Alpha symbol page:', currentAlphaContract);
      
      // Save current Alpha info
      chrome.storage.local.set({ 
        currentAlpha: currentAlphaContract 
      });

      // Notify popup
      chrome.runtime.sendMessage({
        action: 'alphaPageDetected',
        contract: currentAlphaContract
      });

      // Ensure side panel is visible and synced
      ensureSidePanel();
      syncSidePanelWithPage();

      // If auto-trading is enabled, attempt to commit transaction
      if (autoTradingEnabled) {
        // Wait a bit for page to load, then attempt transaction
        setTimeout(() => {
          attemptCommitTransaction();
        }, 2000);
      }
    } else {
      currentAlphaContract = null;
      removeSidePanel();
      chrome.storage.local.remove('currentAlpha');
    }
  }

  function startSymbolDetection() {
    // Scan immediately
    scanForAlphaSymbols();

    // Set up observer for dynamic content
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver(() => {
      scanForAlphaSymbols();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Periodic scan as backup
    setInterval(scanForAlphaSymbols, 5000);
  }

  function scanForAlphaSymbols() {
    // Binance typically displays trading pairs in various formats
    // Look for common patterns: text nodes, buttons, links containing symbol pairs
    
    const alphaSymbolPattern = /([A-Z]{2,10}(?:USDT|BUSD|BTC|ETH|BNB))|([A-Z]{2,10}\/[A-Z]{2,10})/g;
    const textNodes = getTextNodes(document.body);
    
    const foundSymbols = new Set();
    
    textNodes.forEach(node => {
      const text = node.textContent.trim();
      const matches = text.match(alphaSymbolPattern);
      
      if (matches) {
        matches.forEach(match => {
          // Clean up the symbol (remove separators if any)
          const symbol = match.replace(/[\/\s]/g, '').toUpperCase();
          // Validate: should start with letters and be alpha symbols
          if (/^[A-Z]{2,10}/.test(symbol)) {
            foundSymbols.add(symbol);
          }
        });
      }
    });

    // Also check for Binance-specific elements
    scanBinanceSpecificElements(foundSymbols);

    // Update detected symbols
    const newSymbols = Array.from(foundSymbols);
    if (newSymbols.length > 0) {
      detectedSymbols = foundSymbols;
      chrome.storage.local.set({ detectedSymbols: newSymbols });
      
      // Notify popup
      chrome.runtime.sendMessage({
        action: 'symbolsUpdated',
        symbols: newSymbols
      });

      // If auto-trading is enabled, commit transactions
      if (autoTradingEnabled) {
        commitTransactionsForSymbols(newSymbols);
      }
    }
  }

  function scanBinanceSpecificElements(symbolSet) {
    // Look for Binance-specific DOM elements that contain trading pairs
    const selectors = [
      '[class*="symbol"]',
      '[class*="ticker"]',
      '[class*="pair"]',
      '[data-testid*="symbol"]',
      'button[class*="symbol"]',
      'a[href*="/trade/"]'
    ];

    selectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = el.textContent || el.getAttribute('href') || '';
          const symbolMatch = text.match(/([A-Z]{2,10}(?:USDT|BUSD|BTC|ETH|BNB))/);
          if (symbolMatch) {
            symbolSet.add(symbolMatch[1].toUpperCase());
          }
        });
      } catch (e) {
        // Ignore selector errors
      }
    });
  }

  function getTextNodes(node) {
    const textNodes = [];
    
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text.length > 0 && text.length < 100) { // Limit to reasonable length
        textNodes.push(node);
      }
    } else {
      node.childNodes.forEach(child => {
        textNodes.push(...getTextNodes(child));
      });
    }
    
    return textNodes;
  }

  function attemptCommitTransaction() {
    if (!currentAlphaContract) {
      console.log('AlphaRoller: No Alpha contract detected on this page');
      return;
    }

    console.log('AlphaRoller: Attempting to commit transaction for Alpha symbol:', currentAlphaContract);

    // Look for commit/buy/transaction buttons on Alpha page
    // Binance Alpha pages may have buttons like "Commit", "Buy", "Confirm", etc.
    const commitButton = findCommitButton();
    
    if (commitButton) {
      console.log('AlphaRoller: Found commit button, clicking...');
      
      // Scroll button into view
      commitButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Small delay before clicking to ensure button is ready
      setTimeout(() => {
        try {
          if (!dryRunEnabled) {
            // Try multiple click methods (actual commit)
            if (commitButton.click) {
              commitButton.click();
            } else if (commitButton.onclick) {
              commitButton.onclick();
            } else {
              // Trigger click event
              const event = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
              });
              commitButton.dispatchEvent(event);
            }
            console.log('AlphaRoller: Transaction commit button clicked');
          } else {
            console.log('AlphaRoller: Dry run enabled - not clicking commit button');
          }
          
          // Send notification to background
          chrome.runtime.sendMessage({
            action: 'transactionAttempted',
            contract: currentAlphaContract,
            timestamp: Date.now(),
            dryRun: dryRunEnabled,
            usdtAmount: typeof usdtAmount === 'number' ? usdtAmount : null,
            volumePoints: calculateAlphaVolumePoints(usdtAmount)
          });
        } catch (error) {
          console.error('AlphaRoller: Error clicking commit button:', error);
        }
      }, 500);
    } else {
      console.log('AlphaRoller: Commit button not found. Scanning page...');
      // Try scanning again after a delay (page might still be loading)
      setTimeout(() => {
        const retryButton = findCommitButton();
        if (retryButton) {
          attemptCommitTransaction();
        }
      }, 3000);
    }
  }

  function findCommitButton() {
    // Common selectors for commit/buy buttons on Binance Alpha pages
    // These may need to be adjusted based on actual Binance UI structure
    
    const selectors = [
      // Common button text patterns
      'button:contains("Commit")',
      'button:contains("Buy")',
      'button:contains("Confirm")',
      'button:contains("Submit")',
      'button:contains("Trade")',
      // Class-based selectors
      'button[class*="commit"]',
      'button[class*="buy"]',
      'button[class*="confirm"]',
      'button[class*="submit"]',
      'button[class*="trade"]',
      'button[class*="primary"]',
      // Data attribute selectors
      'button[data-testid*="commit"]',
      'button[data-testid*="buy"]',
      'button[data-testid*="confirm"]',
      'button[data-testid*="submit"]',
      // Role-based
      'button[role="button"]',
      // Look for buttons containing transaction-related text
      'a[class*="commit"], a[class*="buy"], a[class*="trade"]'
    ];

    // Try querySelector for standard selectors
    for (const selector of selectors) {
      try {
        // Handle :contains() pseudo-selector manually
        if (selector.includes(':contains(')) {
          const textMatch = selector.match(/:contains\("([^"]+)"\)/);
          if (textMatch) {
            const searchText = textMatch[1];
            const baseSelector = selector.split(':contains')[0];
            const elements = document.querySelectorAll(baseSelector);
            
            for (const el of elements) {
              if (el.textContent && el.textContent.trim().toLowerCase().includes(searchText.toLowerCase())) {
                // Check if button is visible and enabled
                if (isElementVisible(el) && !el.disabled) {
                  return el;
                }
              }
            }
          }
        } else {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent || '';
            // Check for commit/buy/confirm related text
            if (text.match(/commit|buy|confirm|submit|trade/i) && 
                isElementVisible(el) && 
                !el.disabled &&
                el.tagName.toLowerCase() === 'button') {
              return el;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
        continue;
      }
    }

    // Fallback: Look for any primary action button
    const allButtons = document.querySelectorAll('button[type="button"], button[type="submit"], button:not([type])');
    for (const button of allButtons) {
      const text = (button.textContent || '').trim().toLowerCase();
      const classes = (button.className || '').toLowerCase();
      
      // Check for transaction-related keywords
      if ((text.includes('commit') || text.includes('buy') || text.includes('confirm') || 
           text.includes('submit') || text.includes('trade') ||
           classes.includes('commit') || classes.includes('buy') || classes.includes('primary') ||
           classes.includes('confirm') || classes.includes('submit')) &&
          isElementVisible(button) && 
          !button.disabled) {
        return button;
      }
    }

    return null;
  }

  function isElementVisible(element) {
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           element.offsetWidth > 0 &&
           element.offsetHeight > 0;
  }

  // =========================
  // Side Panel (Alpha Info)
  // =========================
  let sidePanel = null;
  let sidePanelPriceEl = null;
  let priceObserver = null;
  let sidePanelPollTimer = null;
  let sidePanelEnabled = true;
  let usdtAmount = 100; // default user-entered amount for transaction
  let operationLogs = []; // recent buy/sell logs, latest first
  
  function calculateAlphaVolumePoints(amountUsd) {
    if (typeof amountUsd !== 'number' || !isFinite(amountUsd) || amountUsd < 2) return 0;
    return Math.floor(Math.log2(amountUsd / 2)) + 1;
  }

  function calculateTransactionsNeeded(targetPoints, amountUsd) {
    const perTx = calculateAlphaVolumePoints(amountUsd);
    if (perTx <= 0) return null; // not achievable with current amount
    return Math.ceil(targetPoints / perTx);
  }

  function ensureSidePanel() {
    if (!sidePanelEnabled) return;
    if (sidePanel && document.body.contains(sidePanel)) return;

    // Create container
    sidePanel = document.createElement('div');
    sidePanel.id = 'alpharoller-side-panel';
    sidePanel.setAttribute('style', [
      'position: fixed',
      'top: 0',
      'right: 0',
      'height: 100vh',
      'width: 300px',
      'z-index: 2147483647',
      'background: #0b0e11',
      'color: #eaecef',
      'box-shadow: -2px 0 12px rgba(0,0,0,0.4)',
      'border-left: 1px solid rgba(255,255,255,0.08)',
      'display: flex',
      'flex-direction: column',
      'font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
    ].join(';'));

    const header = document.createElement('div');
    header.setAttribute('style', [
      'padding: 12px 14px',
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'border-bottom: 1px solid rgba(255,255,255,0.08)'
    ].join(';'));
    const title = document.createElement('div');
    title.textContent = 'AlphaRoller';
    title.setAttribute('style', 'font-weight: 700; letter-spacing: .3px;');
    
    // Actions container (Start + Close)
    const actions = document.createElement('div');
    actions.setAttribute('style', 'display:flex; gap:8px; align-items:center;');

    const startBtn = document.createElement('button');
    startBtn.textContent = 'Start Transactions';
    startBtn.setAttribute('style', [
      'background: linear-gradient(135deg, #f0b90b 0%, #d4a008 100%)',
      'border: none',
      'color: #000',
      'font-weight: 700',
      'padding: 6px 10px',
      'border-radius: 6px',
      'cursor: pointer',
      'font-size: 12px',
      'box-shadow: 0 2px 6px rgba(240, 185, 11, 0.35)'
    ].join(';'));
    startBtn.addEventListener('click', async () => {
      if (startBtn.disabled) return;
      const prevText = startBtn.textContent;
      startBtn.textContent = 'Processing...';
      startBtn.disabled = true;
      try {
        await startRoundTripTransaction();
      } catch (e) {
        console.error('AlphaRoller: Round-trip transaction error', e);
      } finally {
        setTimeout(() => {
          startBtn.textContent = prevText;
          startBtn.disabled = false;
        }, 1500);
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.setAttribute('style', [
      'background: transparent',
      'border: none',
      'color: #eaecef',
      'font-size: 20px',
      'cursor: pointer'
    ].join(';'));
    closeBtn.addEventListener('click', removeSidePanel);
    header.appendChild(title);
    actions.appendChild(startBtn);
    actions.appendChild(closeBtn);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.setAttribute('style', 'padding: 14px; display: flex; flex-direction: column; gap: 12px;');

    const symbolRow = document.createElement('div');
    symbolRow.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');
    const symbolLabel = document.createElement('div');
    symbolLabel.textContent = 'Symbol';
    symbolLabel.setAttribute('style', 'opacity: 0.7; font-size: 12px;');
    const symbolValue = document.createElement('div');
    symbolValue.id = 'alpharoller-symbol';
    symbolValue.textContent = '-';
    symbolValue.setAttribute('style', 'font-size: 18px; font-weight: 700;');
    symbolRow.appendChild(symbolLabel);
    symbolRow.appendChild(symbolValue);

    const priceRow = document.createElement('div');
    priceRow.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');
    const priceLabel = document.createElement('div');
    priceLabel.textContent = 'Price';
    priceLabel.setAttribute('style', 'opacity: 0.7; font-size: 12px;');
    const priceValue = document.createElement('div');
    priceValue.id = 'alpharoller-price';
    priceValue.textContent = '-';
    priceValue.setAttribute('style', 'font-size: 22px; font-weight: 800; color: #f0b90b;');
    priceRow.appendChild(priceLabel);
    priceRow.appendChild(priceValue);

    // Amount input (USDT)
    const amountRow = document.createElement('div');
    amountRow.setAttribute('style', 'display:flex; flex-direction: column; gap: 6px;');
    const amountLabel = document.createElement('label');
    amountLabel.setAttribute('for', 'alpharoller-amount');
    amountLabel.textContent = 'Amount (USDT)';
    amountLabel.setAttribute('style', 'opacity: 0.7; font-size: 12px;');
    const amountInput = document.createElement('input');
    amountInput.id = 'alpharoller-amount';
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.step = '0.01';
    amountInput.placeholder = 'e.g. 100.00';
    amountInput.setAttribute('style', [
      'padding: 8px 10px',
      'border-radius: 6px',
      'border: 1px solid rgba(255,255,255,0.12)',
      'background: #1e2329',
      'color: #eaecef',
      'font-size: 14px',
      'outline: none'
    ].join(';'));
    // Set default visible value
    amountInput.value = String(usdtAmount);
    amountInput.addEventListener('input', () => {
      const val = parseFloat(amountInput.value);
      if (!isNaN(val) && val >= 0) {
        usdtAmount = val;
        chrome.storage.local.set({ usdtAmount: val });
      }
    });
    // Load saved value
    chrome.storage.local.get(['usdtAmount'], (res) => {
      if (typeof res.usdtAmount === 'number' && res.usdtAmount >= 0) {
        usdtAmount = res.usdtAmount;
        amountInput.value = String(res.usdtAmount);
      } else {
        // Persist default if not present
        chrome.storage.local.set({ usdtAmount });
      }
    });
    amountRow.appendChild(amountLabel);
    amountRow.appendChild(amountInput);


    body.appendChild(symbolRow);
    body.appendChild(priceRow);
    body.appendChild(amountRow);
    

    // Operation logs (latest at top)
    const logWrap = document.createElement('div');
    logWrap.setAttribute('style', 'margin-top: 12px; display:flex; flex-direction:column; gap: 8px;');
    const logTitle = document.createElement('div');
    logTitle.textContent = 'Operation Log';
    logTitle.setAttribute('style', 'opacity:0.7; font-size:12px;');
    const logList = document.createElement('div');
    logList.id = 'alpharoller-log';
    logList.setAttribute('style', [
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'max-height:200px',
      'overflow:auto',
      'border-top:1px solid rgba(255,255,255,0.08)',
      'padding-top:8px'
    ].join(';'));
    logWrap.appendChild(logTitle);
    logWrap.appendChild(logList);
    body.appendChild(logWrap);
    // Load logs from storage and render
    chrome.storage.local.get(['operationLogs'], (res) => {
      if (Array.isArray(res.operationLogs)) {
        operationLogs = res.operationLogs;
        renderOperationLogs();
      }
    });

    sidePanel.appendChild(header);
    sidePanel.appendChild(body);

    document.body.appendChild(sidePanel);
  }

  function removeSidePanel() {
    if (priceObserver) {
      try { priceObserver.disconnect(); } catch (e) {}
      priceObserver = null;
    }
    if (sidePanelPollTimer) {
      clearInterval(sidePanelPollTimer);
      sidePanelPollTimer = null;
    }
    if (sidePanel && sidePanel.parentNode) {
      sidePanel.parentNode.removeChild(sidePanel);
    }
    sidePanel = null;
    sidePanelPriceEl = null;
  }

  function syncSidePanelWithPage() {
    if (!sidePanel || !sidePanelEnabled) return;
    const symbolName = detectSymbolName() || (currentAlphaContract ? currentAlphaContract.address : '-');
    const symbolEl = document.getElementById('alpharoller-symbol');
    if (symbolEl) symbolEl.textContent = symbolName;

    const priceEl = detectPriceElement();
    const priceValueEl = document.getElementById('alpharoller-price');

    if (priceEl && priceValueEl) {
      sidePanelPriceEl = priceEl;
      // Initial set
      priceValueEl.textContent = (priceEl.textContent || '').trim();

      // Observe mutations on the price element
      if (priceObserver) {
        try { priceObserver.disconnect(); } catch (e) {}
      }
      priceObserver = new MutationObserver(() => {
        priceValueEl.textContent = (priceEl.textContent || '').trim();
      });
      priceObserver.observe(priceEl, { characterData: true, subtree: true, childList: true });

      // Fallback polling in case Binance re-renders the node entirely
      if (sidePanelPollTimer) clearInterval(sidePanelPollTimer);
      sidePanelPollTimer = setInterval(() => {
        if (!document.body.contains(priceEl)) {
          // Re-detect
          const newEl = detectPriceElement();
          if (newEl) {
            sidePanelPriceEl = newEl;
            priceValueEl.textContent = (newEl.textContent || '').trim();
            if (priceObserver) {
              try { priceObserver.disconnect(); } catch (e) {}
            }
            priceObserver = new MutationObserver(() => {
              priceValueEl.textContent = (newEl.textContent || '').trim();
            });
            priceObserver.observe(newEl, { characterData: true, subtree: true, childList: true });
          }
        } else {
          // Keep in sync
          priceValueEl.textContent = (priceEl.textContent || '').trim();
        }
      }, 1500);
    }
  }

  function detectSymbolName() {
    if (document.title) {
      const m = document.title.split(/\|/gi);
      if (m) return m[1].trim().split(' ')[0];
    }
    return null;
  }

  function detectPriceElement() {
    // Try likely price selectors on Binance
    const selectors = [
      '[data-testid*="price"]',
      '[class*="price"]',
      '[class*="Price"]',
      '[data-bn-type="text"]:not([class])' // Sometimes Binance uses data-bn-type spans
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const txt = (el.textContent || '').trim();
        if (looksLikePrice(txt)) {
          return el;
        }
      }
    }
    // Generic fallback: scan for prominent number with decimals and optional currency
    const all = document.querySelectorAll('span, div');
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (parseFloat(style.fontSize) >= 18 && isElementVisible(el)) {
        const txt = (el.textContent || '').trim();
        if (looksLikePrice(txt)) return el;
      }
    }
    return null;
  }

  function looksLikePrice(text) {
    if (!text) return false;
    // Common price formats: 123.45, $123.45, 0.000123, 1,234.56
    const cleaned = text.replace(/[,\s]/g, '');
    return /^(\$)?\d*(?:\.|\,)??\d{1,8}$/.test(cleaned) || /^(\$)?\d+$/i.test(cleaned);
  }

  // Removed side panel points and estimation UI

  function addOperationLog(entry) {
    // Prepend and cap length
    operationLogs.unshift(entry);
    if (operationLogs.length > 100) operationLogs.pop();
    chrome.storage.local.set({ operationLogs });
    renderOperationLogs();
  }

  function renderOperationLogs() {
    const list = document.getElementById('alpharoller-log');
    if (!list) return;
    list.innerHTML = operationLogs.map(item => {
      const ts = new Date(item.timestamp).toLocaleTimeString();
      const priceStr = typeof item.price === 'number' ? item.price.toPrecision(6) : '-';
      const qtyStr = typeof item.quantity === 'number' ? item.quantity.toFixed(8) : '-';
      return `<div style="display:flex; justify-content:space-between; gap:8px;">
        <div style="opacity:.7; font-size:12px; min-width:62px;">${ts}</div>
        <div style="font-size:12px; font-weight:700; min-width:36px;">${item.type.toUpperCase()}</div>
        <div style="font-size:12px;">Price: ${priceStr}</div>
        <div style="font-size:12px;">Qty: ${qtyStr}</div>
      </div>`;
    }).join('');
  }

  // =========================
  // Round-trip transaction: Buy then Sell
  // =========================
  function getRealTimePrice() {
    const priceEl = detectPriceElement();
    if (!priceEl) return null;
    const raw = (priceEl.textContent || '').trim().replace(/[,\s$]/g, '');
    const price = parseFloat(raw);
    return isFinite(price) && price > 0 ? price : null;
  }

  function findTradeInputs() {
    // Heuristics to locate amount/quantity inputs on Binance Alpha page
    const inputSelectors = [
      'input[placeholder*="Amount" i]',
      'input[placeholder*="USDT" i]',
      'input[inputmode="decimal"]',
      'input[type="number"]'
    ];
    const buttonSelectors = [
      'button:contains("Buy")',
      'button:contains("Sell")',
      'button[class*="buy" i]',
      'button[class*="sell" i]',
      'button[data-testid*="buy" i]',
      'button[data-testid*="sell" i]'
    ];

    const inputs = [];
    inputSelectors.forEach(sel => {
      if (sel.includes(':contains(')) return; // skip contains here for inputs
      document.querySelectorAll(sel).forEach(el => inputs.push(el));
    });

    const buttons = [];
    buttonSelectors.forEach(sel => {
      if (sel.includes(':contains(')) {
        const textMatch = sel.match(/:contains\("([^"]+)"\)/);
        if (textMatch) {
          const searchText = textMatch[1].toLowerCase();
          const baseSelector = sel.split(':contains')[0];
          document.querySelectorAll(baseSelector).forEach(el => {
            const txt = (el.textContent || '').toLowerCase();
            if (txt.includes(searchText)) buttons.push(el);
          });
        }
      } else {
        document.querySelectorAll(sel).forEach(el => buttons.push(el));
      }
    });

    const buyButton = buttons.find(b => /buy/i.test(b.textContent || '') && isElementVisible(b));
    const sellButton = buttons.find(b => /sell/i.test(b.textContent || '') && isElementVisible(b));

    return { inputs, buyButton, sellButton };
  }

  async function fillInput(element, value) {
    if (!element) return;
    const valStr = String(value);
    element.focus();
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.value = valStr;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clickElement(el) {
    if (!el) return;
    if (el.click) el.click();
    else if (el.dispatchEvent) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      el.dispatchEvent(event);
    }
  }

  async function startRoundTripTransaction() {
    if (!currentAlphaContract) {
      console.warn('AlphaRoller: Not on an Alpha contract page.');
      return;
    }
    const price = getRealTimePrice();
    if (!price) {
      console.warn('AlphaRoller: Unable to read real-time price.');
      return;
    }
    const amountUsd = typeof usdtAmount === 'number' ? usdtAmount : 0;
    if (amountUsd <= 0) {
      console.warn('AlphaRoller: Invalid USDT amount.');
      return;
    }

    const quantity = amountUsd / price;

    chrome.runtime.sendMessage({
      action: 'transactionStarted',
      contract: currentAlphaContract,
      price,
      usdtAmount: amountUsd,
      quantity,
      dryRun: dryRunEnabled,
      timestamp: Date.now()
    });

    const { inputs, buyButton, sellButton } = findTradeInputs();

    // Try to find a USDT amount input; fallback to first numeric input
    const amountInput = inputs.find(i => /usdt/i.test(i.placeholder || '')) || inputs[0];

    // BUY
    if (!dryRunEnabled) {
      await fillInput(amountInput, amountUsd);
      await new Promise(r => setTimeout(r, 200));
      clickElement(buyButton);
    } else {
      console.log(`AlphaRoller [DRY RUN]: Buy ${quantity} with ${amountUsd} USDT at ${price}`);
    }

    chrome.runtime.sendMessage({
      action: 'buyPlaced',
      contract: currentAlphaContract,
      price,
      usdtAmount: amountUsd,
      quantity,
      dryRun: dryRunEnabled,
      timestamp: Date.now()
    });
    addOperationLog({ type: 'buy', price, quantity, timestamp: Date.now() });

    // Wait briefly to simulate/allow order execution
    await new Promise(r => setTimeout(r, 1200));

    // SELL the bought quantity
    const qtyInput = inputs.find(i => /qty|quantity|amount/i.test(i.placeholder || '')) || inputs[0];
    if (!dryRunEnabled) {
      await fillInput(qtyInput, quantity);
      await new Promise(r => setTimeout(r, 200));
      clickElement(sellButton);
    } else {
      console.log(`AlphaRoller [DRY RUN]: Sell ${quantity} at ~${getRealTimePrice() || price}`);
    }

    const sellPrice = getRealTimePrice() || price;
    chrome.runtime.sendMessage({
      action: 'sellPlaced',
      contract: currentAlphaContract,
      price: sellPrice,
      usdtAmount: amountUsd,
      quantity,
      dryRun: dryRunEnabled,
      timestamp: Date.now()
    });
    addOperationLog({ type: 'sell', price: sellPrice, quantity, timestamp: Date.now() });
  }

  // Load sidePanelEnabled from storage at startup
  chrome.storage.local.get(['sidePanelEnabled'], (res) => {
    if (res.sidePanelEnabled !== undefined) sidePanelEnabled = !!res.sidePanelEnabled;
  });

  // Extend message handler for panel toggling
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'toggleSidePanel') {
      sidePanelEnabled = !sidePanelEnabled;
      chrome.storage.local.set({ sidePanelEnabled });
      if (sidePanelEnabled) {
        ensureSidePanel();
        syncSidePanelWithPage();
      } else {
        removeSidePanel();
      }
      sendResponse && sendResponse({ enabled: sidePanelEnabled });
      return true;
    } else if (request && request.action === 'setSidePanel') {
      sidePanelEnabled = !!request.enabled;
      chrome.storage.local.set({ sidePanelEnabled });
      if (sidePanelEnabled) {
        ensureSidePanel();
        syncSidePanelWithPage();
      } else {
        removeSidePanel();
      }
      sendResponse && sendResponse({ enabled: sidePanelEnabled });
      return true;
    }
  });

  async function commitTransactionsForSymbols(symbols) {
    console.log('AlphaRoller: Committing transactions for symbols:', symbols);

    // If we're on an Alpha page, use the Alpha-specific commit logic
    if (currentAlphaContract) {
      attemptCommitTransaction();
      return;
    }

    // Otherwise, use general symbol trading logic
    for (const symbol of symbols) {
      try {
        // Find buy/sell buttons or trading interface
        const tradingElements = findTradingInterface(symbol);
        
        if (tradingElements && autoTradingEnabled) {
          // Execute transaction logic
          await executeTransaction(tradingElements, symbol);
        }
      } catch (error) {
        console.error(`AlphaRoller: Error processing symbol ${symbol}:`, error);
      }
    }
  }

  function findTradingInterface(symbol) {
    // Look for Binance trading interface elements
    // This will need to be customized based on Binance's actual DOM structure
    
    const buyButton = Array.from(document.querySelectorAll('button')).find(
      btn => btn.textContent && btn.textContent.toLowerCase().includes('buy')
    );
    const sellButton = Array.from(document.querySelectorAll('button')).find(
      btn => btn.textContent && btn.textContent.toLowerCase().includes('sell')
    );
    const orderButton = Array.from(document.querySelectorAll('button')).find(
      btn => btn.textContent && (btn.textContent.toLowerCase().includes('order') || 
                                  btn.textContent.toLowerCase().includes('submit'))
    );
    
    return {
      buyButton,
      sellButton,
      orderButton,
      symbol: symbol
    };
  }

  async function executeTransaction(tradingElements, symbol) {
    console.log(`AlphaRoller: Attempting to commit transaction for ${symbol}`);
    
    // Send notification to background
    chrome.runtime.sendMessage({
      action: 'transactionAttempted',
      symbol: symbol,
      timestamp: Date.now()
    });
  }

  // Utility function to check if text contains alpha symbols
  function isAlphaSymbol(text) {
    return /^[A-Z]{2,10}/.test(text) && !/^[0-9]/.test(text);
  }

})();

