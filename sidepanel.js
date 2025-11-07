// AlphaRoller Side Panel Module
(function() {
  'use strict';

  // =========================
  // Side Panel State
  // =========================
  let sidePanel = null;
  let sidePanelPriceEl = null;
  let priceObserver = null;
  let sidePanelPollTimer = null;
  let sidePanelEnabled = true;
  let usdtAmount = 100; // default user-entered amount for transaction
  let operationLogs = []; // recent buy/sell logs, latest first
  let sidePanelWidth = 300; // px, resizable
  let targetUsdtAmount = 1000; // target cumulative amount for multiple transactions

  // External dependencies (will be set by content.js)
  let externalAPI = {
    startRoundTripTransaction: null,
    detectSymbolName: null,
    detectPriceElement: null,
    getCurrentAlphaContract: null,
    isElementVisible: null
  };

  // =========================
  // Side Panel Functions
  // =========================
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
      `width: ${sidePanelWidth}px`,
      'z-index: 2147483647',
      'background: #0b0e11',
      'color: #eaecef',
      'box-shadow: -2px 0 12px rgba(0,0,0,0.4)',
      'border-left: 1px solid rgba(255,255,255,0.08)',
      'display: flex',
      'flex-direction: column',
      'font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      'box-sizing: border-box',
      'position: fixed'
    ].join(';'));

    // Resizer (left edge)
    const resizer = document.createElement('div');
    resizer.setAttribute('style', [
      'position: absolute',
      'left: -4px',
      'top: 0',
      'width: 8px',
      'height: 100%',
      'cursor: col-resize',
      'z-index: 2147483648'
    ].join(';'));
    sidePanel.appendChild(resizer);

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
      await runRoundTripsToTarget(startBtn);
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

    // Clear logs button
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Logs';
    clearBtn.setAttribute('style', [
      'background: transparent',
      'border: 1px solid rgba(255,255,255,0.2)',
      'color: #eaecef',
      'padding: 6px 10px',
      'border-radius: 6px',
      'cursor: pointer',
      'font-size: 12px'
    ].join(';'));
    clearBtn.addEventListener('click', () => {
      clearTransactionLogs();
    });

    actions.appendChild(startBtn);
    actions.appendChild(clearBtn);
    actions.appendChild(closeBtn);
    header.appendChild(title);
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
    amountRow.setAttribute('style', 'display:flex; flex-direction: column; gap: 8px;');
    const amountLabel = document.createElement('div');
    amountLabel.textContent = 'Amounts (USDT)';
    amountLabel.setAttribute('style', 'opacity: 0.7; font-size: 12px;');

    const amountInputsWrapper = document.createElement('div');
    amountInputsWrapper.setAttribute('style', 'display:flex; gap: 10px;');

    const perTxnWrapper = document.createElement('div');
    perTxnWrapper.setAttribute('style', 'flex:1; display:flex; flex-direction:column; gap:4px;');
    const perTxnLabel = document.createElement('label');
    perTxnLabel.setAttribute('for', 'alpharoller-amount');
    perTxnLabel.textContent = 'Per Transaction';
    perTxnLabel.setAttribute('style', 'opacity: 0.65; font-size: 11px;');
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
    amountInput.value = String(usdtAmount);
    amountInput.addEventListener('input', () => {
      const val = parseFloat(amountInput.value);
      if (!isNaN(val) && val >= 0) {
        usdtAmount = val;
        chrome.storage.local.set({ usdtAmount: val });
      }
    });
    perTxnWrapper.appendChild(perTxnLabel);
    perTxnWrapper.appendChild(amountInput);

    const targetWrapper = document.createElement('div');
    targetWrapper.setAttribute('style', 'flex:1; display:flex; flex-direction:column; gap:4px;');
    const targetLabel = document.createElement('label');
    targetLabel.setAttribute('for', 'alpharoller-target-amount');
    targetLabel.textContent = 'Target Total';
    targetLabel.setAttribute('style', 'opacity: 0.65; font-size: 11px;');
    const targetInput = document.createElement('input');
    targetInput.id = 'alpharoller-target-amount';
    targetInput.type = 'number';
    targetInput.min = '0';
    targetInput.step = '0.01';
    targetInput.placeholder = 'e.g. 1000.00';
    targetInput.setAttribute('style', [
      'padding: 8px 10px',
      'border-radius: 6px',
      'border: 1px solid rgba(255,255,255,0.12)',
      'background: #1e2329',
      'color: #eaecef',
      'font-size: 14px',
      'outline: none'
    ].join(';'));
    targetInput.value = String(targetUsdtAmount);
    targetInput.addEventListener('input', () => {
      const val = parseFloat(targetInput.value);
      if (!isNaN(val) && val >= 0) {
        targetUsdtAmount = val;
        chrome.storage.local.set({ targetUsdtAmount: val });
      }
    });
    targetWrapper.appendChild(targetLabel);
    targetWrapper.appendChild(targetInput);

    amountInputsWrapper.appendChild(perTxnWrapper);
    amountInputsWrapper.appendChild(targetWrapper);

    amountRow.appendChild(amountLabel);
    amountRow.appendChild(amountInputsWrapper);

    // Load saved values
    chrome.storage.local.get(['usdtAmount', 'targetUsdtAmount'], (res) => {
      if (typeof res.usdtAmount === 'number' && res.usdtAmount >= 0) {
        usdtAmount = res.usdtAmount;
        amountInput.value = String(res.usdtAmount);
      } else {
        chrome.storage.local.set({ usdtAmount });
      }

      if (typeof res.targetUsdtAmount === 'number' && res.targetUsdtAmount >= 0) {
        targetUsdtAmount = res.targetUsdtAmount;
        targetInput.value = String(res.targetUsdtAmount);
      } else {
        chrome.storage.local.set({ targetUsdtAmount });
      }
    });

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

    // Attach resize handlers
    attachSidePanelResizer(sidePanel);
  }

  async function runRoundTripsToTarget(startBtn) {
    const prevText = startBtn.textContent;
    startBtn.textContent = 'Processing...';
    startBtn.disabled = true;

    try {
      if (!externalAPI.startRoundTripTransaction) {
        console.warn('AlphaRoller: startRoundTripTransaction API not available.');
        return;
      }

      const perAmount = usdtAmount;
      const targetAmount = targetUsdtAmount;

      if (perAmount <= 0 || targetAmount <= 0) {
        console.warn('AlphaRoller: Invalid per-transaction or target amount.');
        return;
      }

      let accumulated = 0;
      let round = 0;
      const maxRounds = 200;

      while (accumulated < targetAmount && round < maxRounds) {
        const remaining = targetAmount - accumulated;
        const amountThisRound = Math.min(perAmount, remaining);
        if (amountThisRound <= 0) break;

        round += 1;
        const cumulativeAfter = accumulated + amountThisRound;

        const success = await externalAPI.startRoundTripTransaction({
          amountOverride: amountThisRound,
          cumulativeAmount: cumulativeAfter,
          round,
          targetAmount,
          remainingAmount: Math.max(targetAmount - cumulativeAfter, 0)
        });

        if (!success) {
          console.warn(`AlphaRoller: Round trip aborted at round ${round}.`);
          break;
        }

        accumulated = cumulativeAfter;

        if (accumulated >= targetAmount) {
          break;
        }

        await new Promise(r => setTimeout(r, 800));
      }

      console.log(`AlphaRoller: Completed round trip sequence. Total executed: ${accumulated} USDT over ${round} rounds.`);
    } catch (e) {
      console.error('AlphaRoller: Round-trip transaction error', e);
    } finally {
      setTimeout(() => {
        startBtn.textContent = prevText;
        startBtn.disabled = false;
      }, 600);
    }
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

  function attachSidePanelResizer(panel) {
    const resizer = panel.firstChild; // the resizer div
    if (!resizer) return;

    let startX = 0;
    let startWidth = sidePanelWidth;
    const minWidth = 220;
    const maxWidth = 640;

    function onMouseMove(e) {
      const delta = startX - e.clientX; // dragging left increases width
      let newWidth = startWidth + delta;
      if (newWidth < minWidth) newWidth = minWidth;
      if (newWidth > maxWidth) newWidth = maxWidth;
      sidePanelWidth = newWidth;
      panel.style.width = `${newWidth}px`;
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      chrome.storage.local.set({ sidePanelWidth });
    }

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = panel.getBoundingClientRect().width;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  function syncSidePanelWithPage() {
    if (!sidePanel || !sidePanelEnabled) return;
    const symbolName = externalAPI.detectSymbolName ? externalAPI.detectSymbolName() : null;
    const contract = externalAPI.getCurrentAlphaContract ? externalAPI.getCurrentAlphaContract() : null;
    const symbolEl = document.getElementById('alpharoller-symbol');
    if (symbolEl) {
      symbolEl.textContent = symbolName || (contract ? contract.address : '-');
    }

    const priceEl = externalAPI.detectPriceElement ? externalAPI.detectPriceElement() : null;
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
          const newEl = externalAPI.detectPriceElement ? externalAPI.detectPriceElement() : null;
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
      const fromSym = item.fromSymbol || '-';
      const toSym = item.toSymbol || '-';
      const cumulativeStr = typeof item.cumulativeAmount === 'number' ? item.cumulativeAmount.toFixed(2) : '-';
      return `<div style="display:flex; justify-content:space-between; gap:8px;">
        <div style="opacity:.7; font-size:12px; min-width:62px;">${ts}</div>
        <div style="font-size:12px; font-weight:700; min-width:36px;">${item.type.toUpperCase()}</div>
        <div style="font-size:12px;">${fromSym} → ${toSym}</div>
        <div style="font-size:12px;">Price: ${priceStr}</div>
        <div style="font-size:12px;">Qty: ${qtyStr}</div>
        <div style="font-size:12px;">Accum: ${cumulativeStr}</div>
      </div>`;
    }).join('');
  }

  function clearTransactionLogs() {
    operationLogs = [];
    chrome.storage.local.remove(['operationLogs', 'transactionLog'], () => {
      renderOperationLogs();
    });
  }

  // =========================
  // Public API
  // =========================
  window.AlphaRollerSidePanel = {
    // Setup
    setAPI: function(api) {
      Object.assign(externalAPI, api);
    },
    
    // Panel control
    ensure: ensureSidePanel,
    remove: removeSidePanel,
    sync: syncSidePanelWithPage,
    setEnabled: function(enabled) {
      sidePanelEnabled = enabled;
      chrome.storage.local.set({ sidePanelEnabled });
      if (enabled) {
        ensureSidePanel();
        syncSidePanelWithPage();
      } else {
        removeSidePanel();
      }
    },
    
    // Logging
    addLog: addOperationLog,
    
    // Getter
    getUsdtAmount: function() {
      return usdtAmount;
    },
    getTargetUsdtAmount: function() {
      return targetUsdtAmount;
    },
    
    // Load initial state
    init: function() {
      chrome.storage.local.get(['sidePanelEnabled', 'sidePanelWidth', 'usdtAmount', 'targetUsdtAmount'], (res) => {
        if (res.sidePanelEnabled !== undefined) sidePanelEnabled = !!res.sidePanelEnabled;
        if (typeof res.sidePanelWidth === 'number' && res.sidePanelWidth >= 200 && res.sidePanelWidth <= 1000) {
          sidePanelWidth = res.sidePanelWidth;
        }
        if (typeof res.usdtAmount === 'number' && res.usdtAmount >= 0) {
          usdtAmount = res.usdtAmount;
        }
        if (typeof res.targetUsdtAmount === 'number' && res.targetUsdtAmount >= 0) {
          targetUsdtAmount = res.targetUsdtAmount;
        }
      });
    }
  };

  // Initialize on load
  window.AlphaRollerSidePanel.init();

})();

