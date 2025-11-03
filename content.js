// AlphaRoller content script - Binance Alpha Symbol Transaction Handler

(function() {
  'use strict';

  console.log('AlphaRoller: Content script loaded on Binance');

  let autoTradingEnabled = false;
  let detectedSymbols = new Set();
  let currentAlphaContract = null;
  let observer = null;

  // Initialize extension
  init();

  async function init() {
    // Load saved state
    const result = await chrome.storage.local.get(['autoTradingEnabled', 'detectedSymbols']);
    autoTradingEnabled = result.autoTradingEnabled || false;
    if (result.detectedSymbols) {
      detectedSymbols = new Set(result.detectedSymbols);
    }

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

      // If auto-trading is enabled, attempt to commit transaction
      if (autoTradingEnabled) {
        // Wait a bit for page to load, then attempt transaction
        setTimeout(() => {
          attemptCommitTransaction();
        }, 2000);
      }
    } else {
      currentAlphaContract = null;
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
          // Try multiple click methods
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
          
          // Send notification to background
          chrome.runtime.sendMessage({
            action: 'transactionAttempted',
            contract: currentAlphaContract,
            timestamp: Date.now()
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

