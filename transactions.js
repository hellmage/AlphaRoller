// AlphaRoller Transactions Module
(function() {
  'use strict';

  // Temporary toggles
  const BUY_ENABLED = false;
  const SELL_ENABLED = true;

  // External dependencies (will be set by content.js)
  let externalAPI = {
    getCurrentAlphaContract: null,
    getDryRunEnabled: null,
    isElementVisible: null,
    detectPriceElement: null,
    detectSymbolName: null,
    getSidePanel: null
  };

  // =========================
  // Transaction Helper Functions
  // =========================
  function getRealTimePrice() {
    if (!externalAPI.detectPriceElement) return null;
    const priceEl = externalAPI.detectPriceElement();
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
      '.bn-button__buy',
      '.bn-button__sell',
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

    const isVisible = externalAPI.isElementVisible || (() => true);
    // Prefer the explicit Binance buy class if present
    const buyButton = document.querySelector('.bn-button__buy') || buttons.find(b => /buy/i.test(b.textContent || '') && isVisible(b));
    const sellButton = document.querySelector('.bn-button__sell') || buttons.find(b => /sell/i.test(b.textContent || '') && isVisible(b));

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

  function findCommitButton() {
    // Common selectors for commit/buy buttons on Binance Alpha pages
    const selectors = [
      'button:contains("Commit")',
      'button:contains("Buy")',
      'button:contains("Confirm")',
      'button:contains("Submit")',
      'button:contains("Trade")',
      'button[class*="commit"]',
      'button[class*="buy"]',
      'button[class*="confirm"]',
      'button[class*="submit"]',
      'button[class*="trade"]',
      'button[class*="primary"]',
      'button[data-testid*="commit"]',
      'button[data-testid*="buy"]',
      'button[data-testid*="confirm"]',
      'button[data-testid*="submit"]',
      'button[role="button"]',
      'a[class*="commit"], a[class*="buy"], a[class*="trade"]'
    ];

    const isVisible = externalAPI.isElementVisible || (() => true);

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
                if (isVisible(el) && !el.disabled) {
                  return el;
                }
              }
            }
          }
        } else {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent || '';
            if (text.match(/commit|buy|confirm|submit|trade/i) && 
                isVisible(el) && 
                !el.disabled &&
                el.tagName.toLowerCase() === 'button') {
              return el;
            }
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Fallback: Look for any primary action button
    const allButtons = document.querySelectorAll('button[type="button"], button[type="submit"], button:not([type])');
    for (const button of allButtons) {
      const text = (button.textContent || '').trim().toLowerCase();
      const classes = (button.className || '').toLowerCase();
      
      if ((text.includes('commit') || text.includes('buy') || text.includes('confirm') || 
           text.includes('submit') || text.includes('trade') ||
           classes.includes('commit') || classes.includes('buy') || classes.includes('primary') ||
           classes.includes('confirm') || classes.includes('submit')) &&
          isVisible(button) && 
          !button.disabled) {
        return button;
      }
    }

    return null;
  }

  // =========================
  // Transaction Execution Functions
  // =========================
  async function startRoundTripTransaction() {
    const contract = externalAPI.getCurrentAlphaContract ? externalAPI.getCurrentAlphaContract() : null;
    if (!contract) {
      console.warn('AlphaRoller: Not on an Alpha contract page.');
      return;
    }
    const price = getRealTimePrice();
    if (!price) {
      console.warn('AlphaRoller: Unable to read real-time price.');
      return;
    }
    const sidePanel = externalAPI.getSidePanel ? externalAPI.getSidePanel() : null;
    const amountUsd = sidePanel ? sidePanel.getUsdtAmount() : 0;
    if (amountUsd <= 0) {
      console.warn('AlphaRoller: Invalid USDT amount.');
      return;
    }

    const quantity = amountUsd / price;
    const dryRun = externalAPI.getDryRunEnabled ? externalAPI.getDryRunEnabled() : true;

    chrome.runtime.sendMessage({
      action: 'transactionStarted',
      contract: contract,
      price,
      usdtAmount: amountUsd,
      quantity,
      dryRun: dryRun,
      timestamp: Date.now()
    });

    const { buyButton, sellButton } = findTradeInputs();

    // Find limit order inputs by ID
    const limitPriceInput = document.getElementById('limitPrice');
    const limitTotalInput = document.getElementById('limitTotal');

    // Determine symbols
    const baseSymbol = (function() {
      const el = document.getElementById('alpharoller-symbol');
      const txt = el && el.textContent ? el.textContent.trim() : null;
      if (txt && txt.length > 0) return txt;
      return externalAPI.detectSymbolName ? (externalAPI.detectSymbolName() || 'TOKEN') : 'TOKEN';
    })();
    const quoteSymbol = 'USDT';

    // BUY - Limit Order (temporarily disabled if BUY_ENABLED is false)
    if (BUY_ENABLED) {
      if (!dryRun) {
        if (limitPriceInput && limitTotalInput) {
          await fillInput(limitPriceInput, price);
          await new Promise(r => setTimeout(r, 100));
          await fillInput(limitTotalInput, amountUsd);
          await new Promise(r => setTimeout(r, 200));
          clickElement(buyButton);
        } else {
          console.warn('AlphaRoller: Limit order inputs not found (limitPrice, limitTotal)');
        }
      } else {
        console.log(`AlphaRoller [DRY RUN]: Limit Buy - Price: ${price}, Total: ${amountUsd} USDT`);
      }

      chrome.runtime.sendMessage({
        action: 'buyPlaced',
        contract: contract,
        price,
        usdtAmount: amountUsd,
        quantity,
        dryRun: dryRun,
        timestamp: Date.now()
      });
      if (sidePanel) {
        sidePanel.addLog({ type: 'buy', price, quantity, timestamp: Date.now(), fromSymbol: quoteSymbol, toSymbol: baseSymbol });
      }
    } else {
      console.log('AlphaRoller: BUY operation temporarily disabled. Skipping buy step.');
    }

    // Wait briefly to simulate/allow order execution
    await new Promise(r => setTimeout(r, 1200));

    // SELL temporarily disabled
    if (!SELL_ENABLED) {
      console.log('AlphaRoller: SELL operation temporarily disabled. Skipping sell step.');
      return;
    }

    // SELL - Limit Order (use same price input, find quantity input)
    const sellPrice = getRealTimePrice() || price;
    const limitSellPriceInput = document.getElementById('limitPrice'); // May reuse same input
    // Prefer Binance-specific amount input for SELL
    const limitAmountInput = document.getElementById('limitAmount');
    const limitQuantityInput = document.getElementById('limitQuantity') || 
                               document.getElementById('limitTotal'); // Fallbacks

    // Read the actual available quantity from holdings summary element if present
    let sellQty = quantity;
    try {
      const qtyTextEl = document.querySelector('.text-TertiaryText > .items-center > .text-PrimaryText');
      if (qtyTextEl && qtyTextEl.textContent) {
        const rawQty = qtyTextEl.textContent.trim().replace(/[,\s]/g, '');
        const parsedQty = parseFloat(rawQty);
        if (isFinite(parsedQty) && parsedQty > 0) {
          sellQty = parsedQty;
        }
      }
    } catch (_) {}
    
    if (!dryRun) {
      if (limitSellPriceInput) {
        await fillInput(limitSellPriceInput, sellPrice);
        await new Promise(r => setTimeout(r, 100));
        // Prefer #limitAmount if available, otherwise fallback to other inputs
        if (limitAmountInput) {
          await fillInput(limitAmountInput, sellQty);
        } else if (limitQuantityInput) {
          await fillInput(limitQuantityInput, sellQty);
        } else {
          const qtyInput = document.querySelector('input[placeholder*="quantity" i], input[placeholder*="amount" i]');
          if (qtyInput) await fillInput(qtyInput, sellQty);
        }
        await new Promise(r => setTimeout(r, 200));
        clickElement(sellButton);
      } else {
        console.warn('AlphaRoller: Limit sell price input not found');
      }
    } else {
      console.log(`AlphaRoller [DRY RUN]: Limit Sell - Price: ${sellPrice}, Quantity: ${sellQty}`);
    }
    chrome.runtime.sendMessage({
      action: 'sellPlaced',
      contract: contract,
      price: sellPrice,
      usdtAmount: amountUsd,
      quantity: sellQty,
      dryRun: dryRun,
      timestamp: Date.now()
    });
    if (sidePanel) {
      sidePanel.addLog({ type: 'sell', price: sellPrice, quantity: sellQty, timestamp: Date.now(), fromSymbol: baseSymbol, toSymbol: quoteSymbol });
    }
  }

  function attemptCommitTransaction() {
    const contract = externalAPI.getCurrentAlphaContract ? externalAPI.getCurrentAlphaContract() : null;
    if (!contract) {
      console.log('AlphaRoller: No Alpha contract detected on this page');
      return;
    }

    console.log('AlphaRoller: Attempting to commit transaction for Alpha symbol:', contract);

    const commitButton = findCommitButton();
    const dryRun = externalAPI.getDryRunEnabled ? externalAPI.getDryRunEnabled() : true;
    
    if (commitButton) {
      console.log('AlphaRoller: Found commit button, clicking...');
      
      commitButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      setTimeout(() => {
        try {
          if (!dryRun) {
            if (commitButton.click) {
              commitButton.click();
            } else if (commitButton.onclick) {
              commitButton.onclick();
            } else {
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
          
          chrome.runtime.sendMessage({
            action: 'transactionAttempted',
            contract: contract,
            timestamp: Date.now(),
            dryRun: dryRun
          });
        } catch (error) {
          console.error('AlphaRoller: Error clicking commit button:', error);
        }
      }, 500);
    } else {
      console.log('AlphaRoller: Commit button not found. Scanning page...');
      setTimeout(() => {
        const retryButton = findCommitButton();
        if (retryButton) {
          attemptCommitTransaction();
        }
      }, 3000);
    }
  }

  function findTradingInterface(symbol) {
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
    
    chrome.runtime.sendMessage({
      action: 'transactionAttempted',
      symbol: symbol,
      timestamp: Date.now()
    });
  }

  async function commitTransactionsForSymbols(symbols, getCurrentAlphaContract, getAutoTradingEnabled) {
    console.log('AlphaRoller: Committing transactions for symbols:', symbols);

    const contract = getCurrentAlphaContract ? getCurrentAlphaContract() : null;
    if (contract) {
      attemptCommitTransaction();
      return;
    }

    const autoTradingEnabled = getAutoTradingEnabled ? getAutoTradingEnabled() : false;
    for (const symbol of symbols) {
      try {
        const tradingElements = findTradingInterface(symbol);
        if (tradingElements && autoTradingEnabled) {
          await executeTransaction(tradingElements, symbol);
        }
      } catch (error) {
        console.error(`AlphaRoller: Error processing symbol ${symbol}:`, error);
      }
    }
  }

  // =========================
  // Public API
  // =========================
  window.AlphaRollerTransactions = {
    // Setup
    setAPI: function(api) {
      Object.assign(externalAPI, api);
    },
    
    // Transaction functions
    startRoundTripTransaction: startRoundTripTransaction,
    attemptCommitTransaction: attemptCommitTransaction,
    commitTransactionsForSymbols: commitTransactionsForSymbols,
    getRealTimePrice: getRealTimePrice
  };

})();

