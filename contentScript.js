try {
  chrome.runtime.sendMessage({type: 'whoAmI'}, tabId => {
    try {
      const payload = '{'.concat(document.documentElement.innerHTML.split('Object.assign(window.patreon.bootstrap, {')[1].split('\n});\n      Object.assign(window.patreon')[0], '}');
      const data = {};
      data[tabId.tab.toString()] = JSON.parse(payload);
      chrome.storage.local.set(data, function () {
        if (chrome.runtime.lastError) {
          console.error('Patreon Downloader | Failed to set data for tab.', tabId.tab, data, chrome.runtime.lastError.message);
        } else {
          console.debug('Patreon Downloader | Set page data.', tabId.tab, data);
        }
      });
    } catch (e) {
      console.error('Patreon Downloader |', e);
    }
  });
} catch (e) {
  console.error('Patreon Downloader |', e);
}