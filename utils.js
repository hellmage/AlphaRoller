(function() {
  'use strict';

  const existingUtils = window.AlphaRollerUtils || {};

  function sleep(ms = 0) {
    ms = typeof ms === 'number' && ms >= 0 ? ms : 0;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForCondition(fn, options = {}) {
    const interval = typeof options.interval === 'number' ? options.interval : 100;
    const timeout = typeof options.timeout === 'number' ? options.timeout : 5000;
    const start = Date.now();

    while (true) {
      try {
        const result = await fn();
        if (result) return result;
      } catch (err) {
        // ignore errors from predicate and keep waiting
      }

      if (Date.now() - start >= timeout) {
        return null;
      }
      await sleep(interval);
    }
  }

  function dispatchInputEvents(element) {
    if (!element) return;
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    const changeEvent = new Event('change', { bubbles: true, cancelable: true });
    element.dispatchEvent(inputEvent);
    element.dispatchEvent(changeEvent);
  }

  function safeClick(element) {
    if (!element) return false;
    try {
      if (typeof element.click === 'function') {
        element.click();
      } else if (typeof element.onclick === 'function') {
        element.onclick();
      } else {
        element.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      }
      return true;
    } catch (err) {
      console.error('AlphaRoller Utils: safeClick error', err);
      return false;
    }
  }

  function formatNumber(value, decimals = 2) {
    if (typeof value !== 'number' || !isFinite(value)) return '-';
    const factor = Math.pow(10, decimals);
    return (Math.round(value * factor) / factor).toFixed(decimals);
  }

  function parseNumberFromText(text) {
    if (typeof text !== 'string') return null;
    const cleaned = text.trim().replace(/[\s,]/g, '');
    if (cleaned.length === 0) return null;
    const value = parseFloat(cleaned);
    return isFinite(value) ? value : null;
  }

  window.AlphaRollerUtils = Object.assign({}, existingUtils, {
    sleep,
    waitForCondition,
    dispatchInputEvents,
    safeClick,
    formatNumber,
    parseNumberFromText
  });
})();


