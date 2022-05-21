chrome.runtime.sendMessage({type: 'whoAmI'}, tabId => {
  try {
    const payload = '{'.concat(document.documentElement.innerHTML.split('Object.assign(window.patreon.bootstrap, {')[1].split('\n});\n      Object.assign(window.patreon')[0], '}');
    const data = {};
    data[tabId.tab.toString()] = JSON.parse(payload);
    chrome.storage.local.set(data, function () {
      if (chrome.runtime.lastError) {
        console.error('Patreon Downloader | Failed to set data for tab.', tabId.tab, data, chrome.runtime.lastError.message);
      } else {
        console.log('Patreon Downloader | Set page data.', tabId.tab, data);
      }
    });
  } catch (e) {
    console.error('Patreon Downloader |', e);
  }
});

chrome.runtime.onMessage.addListener(
  function (msg, sender, sendResponse) {
    if (msg.type === 'download') {
      doDownload(msg.requests, msg.zipName);
    } else {
      console.log(...msg);
    }
    sendResponse();
    return true;
  },
);

function doDownload(requests, filename) {
  const dataZip = new Compressor(filename);

  /**
   * Total number of items being counted in the progress bar.
   * @type {number}
   */
  let total = 0;
  /**
   * The number of items processed so far.
   * @type {number}
   */
  let processed = 0;
  /**
   * Total file size downloaded so far. For calculating overall average download speed.
   * @type {number}
   */
  let totalLoaded = 0;
  /**
   * The current speed of downloads. For calculating a smoother download speed.
   * @type {null|number}
   * @see {@link https://stackoverflow.com/a/18637230/191306}
   */
  let speed = null;
  /**
   * A time constant for use with the speed.
   * @type {number}
   */
  const TIME_CONSTANT = 5;
  const fileDetails = {};

  const downloader = new Downloader({
    onDownloaded: (data) => {
      totalLoaded += data.blob.size || 0;
      dataZip
        .AddBlobToZip(data.blob, decodeURIComponent(fileDetails[data.url]))
        .then(() => {
          processed++;
          chrome.runtime.sendMessage({type: 'downloadUpdate', count: processed, total});
        });
    },
    onProgress: (data) => {
      if (data.complete) {
        return;
      }
      if (speed === null) {
        speed = data.speed;
      } else {
        speed += (data.speed - speed) / TIME_CONSTANT;
      }
      chrome.runtime.sendMessage({type: 'downloadUpdate', speed});
    },
  });

  if (requests?.length) {
    total += requests.length;
    for (const request of requests) {
      fileDetails[request.url] = request.filename;
    }
    downloader.AddURLs(requests.map(r => r.url));
    downloader.Process().then(() => {
      dataZip.Complete();
      chrome.runtime.sendMessage({type: 'downloadComplete', filename});
      console.log('Patreon Downloader | Triggering download', requests);
      dataZip.Download();
    });
  }
}