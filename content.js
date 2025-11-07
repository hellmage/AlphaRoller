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
          if (window.AlphaRollerTransactions) {
            window.AlphaRollerTransactions.attemptCommitTransaction();
          }
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
        if (window.AlphaRollerTransactions && window.AlphaRollerTransactions.startRoundTripTransaction) {
          window.AlphaRollerTransactions.startRoundTripTransaction();
        }
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
      if (window.AlphaRollerSidePanel) {
        window.AlphaRollerSidePanel.ensure();
        window.AlphaRollerSidePanel.sync();
      }

      // If auto-trading is enabled, attempt to commit transaction
      if (autoTradingEnabled) {
        // Wait a bit for page to load, then attempt transaction
        setTimeout(() => {
          if (window.AlphaRollerTransactions) {
            window.AlphaRollerTransactions.attemptCommitTransaction();
          }
        }, 2000);
      }
    } else {
      currentAlphaContract = null;
      if (window.AlphaRollerSidePanel) {
        window.AlphaRollerSidePanel.remove();
      }
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
      if (autoTradingEnabled && window.AlphaRollerTransactions) {
        window.AlphaRollerTransactions.commitTransactionsForSymbols(
          newSymbols,
          () => currentAlphaContract,
          () => autoTradingEnabled
        );
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

  // attemptCommitTransaction and findCommitButton moved to transactions.js

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
  // Side Panel - moved to sidepanel.js
  // =========================
  // Side panel functionality is now in sidepanel.js
  // Access via window.AlphaRollerSidePanel API

  // Side panel functions moved to sidepanel.js

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

  // Log functions moved to sidepanel.js

  // =========================
  // Transactions - moved to transactions.js
  // =========================
  // Transaction functions are now in transactions.js
  // Access via window.AlphaRollerTransactions API

  // Extend message handler for panel toggling
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'toggleSidePanel') {
      if (window.AlphaRollerSidePanel) {
        chrome.storage.local.get(['sidePanelEnabled'], (res) => {
          const current = res.sidePanelEnabled !== undefined ? res.sidePanelEnabled : true;
          window.AlphaRollerSidePanel.setEnabled(!current);
          sendResponse && sendResponse({ enabled: !current });
        });
      }
      return true;
    } else if (request && request.action === 'setSidePanel') {
      if (window.AlphaRollerSidePanel) {
        window.AlphaRollerSidePanel.setEnabled(!!request.enabled);
        sendResponse && sendResponse({ enabled: !!request.enabled });
      }
      return true;
    }
  });

  // commitTransactionsForSymbols, findTradingInterface, executeTransaction moved to transactions.js

  // Utility function to check if text contains alpha symbols
  function isAlphaSymbol(text) {
    return /^[A-Z]{2,10}/.test(text) && !/^[0-9]/.test(text);
  }

  // Register APIs with modules (after all functions are defined)
  if (window.AlphaRollerSidePanel) {
    window.AlphaRollerSidePanel.setAPI({
      startRoundTripTransaction: window.AlphaRollerTransactions ? window.AlphaRollerTransactions.startRoundTripTransaction : null,
      detectSymbolName: detectSymbolName,
      detectPriceElement: detectPriceElement,
      getCurrentAlphaContract: () => currentAlphaContract,
      isElementVisible: isElementVisible
    });
  }

  if (window.AlphaRollerTransactions) {
    window.AlphaRollerTransactions.setAPI({
      getCurrentAlphaContract: () => currentAlphaContract,
      getDryRunEnabled: () => dryRunEnabled,
      isElementVisible: isElementVisible,
      detectPriceElement: detectPriceElement,
      detectSymbolName: detectSymbolName,
      getSidePanel: () => window.AlphaRollerSidePanel
    });
  }

})();

