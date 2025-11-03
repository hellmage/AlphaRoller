// AlphaRoller background service worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('AlphaRoller extension installed');
  
  // Initialize default settings
  chrome.storage.local.set({
    autoTradingEnabled: false,
    detectedSymbols: []
  });
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('AlphaRoller: Message received in background:', request);
  
  if (request.action === 'transactionAttempted') {
    // Log transaction attempts for monitoring
    const contract = request.contract || { address: request.symbol || 'unknown' };
    console.log(`AlphaRoller: Transaction attempted for ${contract.address || contract.symbol} at ${new Date(request.timestamp).toISOString()}`);
    
    // You could add transaction logging, analytics, etc. here
    chrome.storage.local.get(['transactionLog'], (result) => {
      const log = result.transactionLog || [];
      log.push({
        contract: contract.address,
        chain: contract.chain,
        symbol: request.symbol,
        timestamp: request.timestamp,
        url: sender.tab?.url
      });
      // Keep only last 100 entries
      if (log.length > 100) log.shift();
      chrome.storage.local.set({ transactionLog: log });
    });
  }
  
  sendResponse({ success: true });
  return true; // Keep the message channel open for async response
});

// Handle tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('binance.com')) {
    console.log('AlphaRoller: Binance page loaded');
  }
});

