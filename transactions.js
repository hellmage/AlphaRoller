// AlphaRoller Transactions Module
(function() {
  'use strict';

  // Temporary toggles
  const BUY_ENABLED = true;
  const SELL_ENABLED = true;

  const utils = window.AlphaRollerUtils || {};
  const sleep = utils.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const safeClick = utils.safeClick || ((el) => {
    try {
      if (!el) return false;
      if (typeof el.click === 'function') {
        el.click();
        return true;
      }
      if (typeof el.onclick === 'function') {
        el.onclick();
        return true;
      }
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (err) {
      console.error('AlphaRoller: safeClick fallback error', err);
      return false;
    }
  });
  const dispatchInputEvents = utils.dispatchInputEvents || ((element) => {
    if (!element) return;
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  });
  const parseNumberFromText = utils.parseNumberFromText || ((text) => {
    if (typeof text !== 'string') return null;
    const cleaned = text.trim().replace(/[\s,]/g, '');
    if (!cleaned) return null;
    const value = parseFloat(cleaned);
    return isFinite(value) ? value : null;
  });
  const activateInstantBuyTab = utils.activateInstantBuyTab || (async () => false);

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
    dispatchInputEvents(element);
    element.value = valStr;
    dispatchInputEvents(element);
    await sleep(0);
  }

  function clickElement(el) {
    safeClick(el);
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
  async function executeBuyOrder(price, amountUsd, quantity, contract, baseSymbol, quoteSymbol, dryRun, sidePanel, cumulativeAmount) {
    // Activate the Buy tab before placing the order
    await activateInstantBuyTab();

    // BUY - Instant Order (temporarily disabled if BUY_ENABLED is false)
    if (!BUY_ENABLED) {
      console.log('AlphaRoller: BUY operation temporarily disabled. Skipping buy step.');
      return true;
    }

    const { buyButton } = findTradeInputs();
    // For instant orders, we only need the amount input (no price needed)
    const instantAmountInput = document.getElementById('fromCoinAmount');

    if (!dryRun) {
      if (instantAmountInput && buyButton) {
        await fillInput(instantAmountInput, amountUsd);
        // Make sure input loses focus
        instantAmountInput.blur();

        // Ensure buy button is clickable (not marked inactive)
        let attempts = 0;
        while (buyButton && buyButton.classList && buyButton.classList.contains('inactive') && attempts < 20) {
          console.log('AlphaRoller: waiting for buy button to become active');
          await sleep(500);
          attempts += 1;
        }
        if (buyButton && buyButton.classList && buyButton.classList.contains('inactive')) {
          console.warn('AlphaRoller: buy button remains inactive, aborting buy click');
          return false;
        }

        clickElement(buyButton);
        // Handle post-buy confirmation dialog (click "Continue") if it appears
        await sleep(1000);
        try {
          const continueBtn = document.querySelector('[role=dialog] .bn-button__primary.data-size-middle');
          if (continueBtn) {
            console.log('AlphaRoller: clicking Continue in confirmation dialog');
            clickElement(continueBtn);
          }
        } catch (_) {}
        await sleep(1000);
      } else {
        console.warn('AlphaRoller: Instant order amount input not found or buy button missing');
        return false;
      }
    } else {
      console.log(`AlphaRoller [DRY RUN]: Instant Buy - Total: ${amountUsd} USDT`);
    }

    chrome.runtime.sendMessage({
      action: 'buyPlaced',
      contract: contract,
      price,
      usdtAmount: amountUsd,
      quantity,
      dryRun: dryRun,
      timestamp: Date.now(),
      cumulativeAmount
    });
    if (sidePanel) {
      sidePanel.addLog({ type: 'buy', price, quantity, timestamp: Date.now(), fromSymbol: quoteSymbol, toSymbol: baseSymbol, cumulativeAmount });
    }

    return true;
  }

  async function executeSellOrder(price, amountUsd, quantity, contract, baseSymbol, quoteSymbol, dryRun, sidePanel, cumulativeAmount) {
    if (!SELL_ENABLED) {
      console.log('AlphaRoller: SELL operation temporarily disabled. Skipping sell step.');
      return true;
    }

    // Activate the Sell tab before placing the order
    const sellTab = document.querySelector(".bn-tabs__buySell #bn-tab-1");
    if (sellTab) {
      // console.log('AlphaRoller: activate sell tab');
      clickElement(sellTab);
      await sleep(120);
    }
    const instantTab = document.getElementById("bn-tab-INSTANT");
    if (instantTab) {
      // console.log('AlphaRoller: activate sell instant tab');
      clickElement(instantTab);
      await sleep(120);
    }

    // SELL - Instant Order (use quantity input, no price needed)
    const sellPrice = getRealTimePrice() || price; // For logging purposes
    // Read the actual available quantity from holdings summary element if present
    let sellQty = null;
    let attempts = 0;
    while (attempts < 20 && !sellQty) {
      await sleep(500);
      try {
        const qtyTextEl = document.querySelector('.text-TertiaryText > .items-center > .text-PrimaryText');
        if (qtyTextEl && qtyTextEl.textContent) {
          const parsedQty = parseNumberFromText(qtyTextEl.textContent);
          if (parsedQty && parsedQty > 0) {
            sellQty = parsedQty;
          }
        }
      } catch (_) {}
      finally {
        attempts += 1;
      }
    }
    if (!sellQty) {
      console.warn('AlphaRoller: Unable to read sell quantity.');
      return false;
    }

    if (!dryRun) {
      const { sellButton } = findTradeInputs();
      // For instant orders, we only need the amount/quantity input (no price needed)
      const instantAmountInput = document.getElementById('fromCoinAmount');
      
      if (instantAmountInput && sellButton) {
        await fillInput(instantAmountInput, sellQty);
        // Make sure input loses focus
        instantAmountInput.blur();
        
        // Ensure sell button is clickable (not marked inactive)
        let attempts = 0;
        while (sellButton && sellButton.classList && sellButton.classList.contains('inactive') && attempts < 20) {
          console.log('AlphaRoller: waiting for sell button to become active');
          await sleep(500);
          attempts += 1;
        }
        if (sellButton && sellButton.classList && sellButton.classList.contains('inactive')) {
          console.warn('AlphaRoller: sell button remains inactive, aborting sell click');
          return false;
        }

        clickElement(sellButton);
        // Handle post-sell confirmation dialog (click "Continue") if it appears
        await sleep(1000);
        try {
          const continueBtn = document.querySelector('[role=dialog] .bn-button__primary.data-size-middle');
          if (continueBtn) {
            console.log('AlphaRoller: clicking Continue in sell confirmation dialog');
            clickElement(continueBtn);
          }
        } catch (_) {}
        await sleep(1000);
      } else {
        console.warn('AlphaRoller: Instant order amount input or sell button not found');
        return false;
      }
    } else {
      console.log(`AlphaRoller [DRY RUN]: Instant Sell - Quantity: ${sellQty}`);
    }

    chrome.runtime.sendMessage({
      action: 'sellPlaced',
      contract: contract,
      price: sellPrice,
      usdtAmount: amountUsd,
      quantity: sellQty,
      dryRun: dryRun,
      timestamp: Date.now(),
      cumulativeAmount
    });
    if (sidePanel) {
      sidePanel.addLog({ type: 'sell', price: sellPrice, quantity: sellQty, timestamp: Date.now(), fromSymbol: baseSymbol, toSymbol: quoteSymbol, cumulativeAmount });
    }

    return true;
  }

  async function startRoundTripTransaction(options = {}) {
    const contract = externalAPI.getCurrentAlphaContract ? externalAPI.getCurrentAlphaContract() : null;
    if (!contract) {
      console.warn('AlphaRoller: Not on an Alpha contract page.');
      return false;
    }
    const price = getRealTimePrice();
    if (!price) {
      console.warn('AlphaRoller: Unable to read real-time price.');
      return false;
    }
    const sidePanel = externalAPI.getSidePanel ? externalAPI.getSidePanel() : null;
    const overrideAmount = (options && typeof options.amountOverride === 'number' && options.amountOverride >= 0)
      ? options.amountOverride
      : null;
    const amountUsd = overrideAmount !== null
      ? overrideAmount
      : sidePanel ? sidePanel.getUsdtAmount() : 0;
    if (amountUsd <= 0) {
      console.warn('AlphaRoller: Invalid USDT amount.');
      return false;
    }

    const quantity = amountUsd / price;
    const dryRun = externalAPI.getDryRunEnabled ? externalAPI.getDryRunEnabled() : true;
    const cumulativeAmount = (options && typeof options.cumulativeAmount === 'number') ? options.cumulativeAmount : null;

    chrome.runtime.sendMessage({
      action: 'transactionStarted',
      contract: contract,
      price,
      usdtAmount: amountUsd,
      quantity,
      dryRun: dryRun,
      timestamp: Date.now(),
      cumulativeAmount
    });

    // Determine symbols
    const baseSymbol = (function() {
      const el = document.getElementById('alpharoller-symbol');
      const txt = el && el.textContent ? el.textContent.trim() : null;
      if (txt && txt.length > 0) return txt;
      return externalAPI.detectSymbolName ? (externalAPI.detectSymbolName() || 'TOKEN') : 'TOKEN';
    })();
    const quoteSymbol = 'USDT';

    // Execute buy order
    const buySuccess = await executeBuyOrder(price, amountUsd, quantity, contract, baseSymbol, quoteSymbol, dryRun, sidePanel, cumulativeAmount);
    if (!buySuccess) {
      console.warn('AlphaRoller: Buy operation failed or aborted, skipping sell.');
      return false;
    }

    // Wait briefly to simulate/allow order execution
    await sleep(5000);

    // SELL
    if (!SELL_ENABLED) {
      console.log('AlphaRoller: SELL operation temporarily disabled. Skipping sell step.');
      return false;
    }
    const sellSuccess = await executeSellOrder(price, amountUsd, quantity, contract, baseSymbol, quoteSymbol, dryRun, sidePanel, cumulativeAmount);
    if (!sellSuccess) {
      console.warn('AlphaRoller: Sell operation failed.');
      return false;
    }

    return true;
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

