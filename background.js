class ChromeDownloader {
  /**
   * ChromeDownloader manages a maximum concurrent number of download requests (Semaphore)
   * @param {Number} maxConcurrentRequests
   */
  constructor(maxConcurrentRequests = 1) {
    this.requests = [];
    this.running = 0;
    this.max = maxConcurrentRequests;
    this.callbackComplete = null;
    this.callbackBeginDownload = null;
  }

  /**
   * A callback to trigger when there are no more pending downloads.
   * @param {Function} func
   */
  OnComplete(func) {
    if (typeof func === 'function') {
      this.callbackComplete = func;
    }
  }

  /**
   * A callback to trigger when a download starts.
   * @param func
   */
  OnBeginDownload(func) {
    if (typeof func === 'function') {
      this.callbackBeginDownload = func;
    }
  }

  /**
   * Request a download.
   * @see {@link https://developer.chrome.com/docs/extensions/reference/downloads/#method-download} for request details
   * @param {Object} request
   * @returns {Promise<Boolean>} Whether the download completed successfully.
   */
  Download(request) {
    return new Promise((resolve, reject) => {
      this.requests.push({
        resolve,
        reject,
        request,
      });
      this.nextDownload();
    });
  }

  /**
   * Triggers the next download to start if it can.
   */
  nextDownload() {
    try {
      if (!this.requests.length) {
        if (typeof this.callbackComplete === 'function') {
          this.callbackComplete();
        }
        return;
      }
      if (this.running < this.max) {
        let {resolve, reject, request} = this.requests.shift();
        this.running++;
        new Promise(resolve => {
          if (typeof this.callbackBeginDownload === 'function') {
            this.callbackBeginDownload();
          }
          chrome.downloads.download(request, resolve);
        }).then(downloadId => {
          if (chrome.runtime.lastError) {
            console.error('Patreon Downloader |', request.filename, downloadId, chrome.runtime.lastError.message);
          } else {
            console.debug('Patreon Downloader |', `Download started: ${request.filename}`, downloadId);
          }
          this.onDownloadComplete(downloadId)
            .then(success => {
              if (success) {
                console.debug('Patreon Downloader |', `Download finished: ${request.filename}`, downloadId);
              } else {
                console.debug('Patreon Downloader |', `Download failed: ${request.filename}`, downloadId);
              }
              resolve(success);
            })
            .catch(err => {
              console.debug('Patreon Downloader |', `Download failed: ${request.filename}`, downloadId);
              reject(err);
            })
            .finally(() => {
              this.running--;
              this.nextDownload();
            });
        });
      }
    } catch (e) {
      console.error('huh', e);
    }
  }

  /**
   * Trigger a response when a download finishes successfully or when it is interrupted.
   * @param {Number} downloadId The downloadId response from chrome.downloads.download
   * @returns {Promise<Boolean>} Whether the download completed successfully.
   */
  onDownloadComplete(downloadId) {
    return new Promise(resolve => {
      chrome.downloads.onChanged.addListener(function onChanged({id, state}) {
        if (id === downloadId && state && state.current !== 'in_progress') {
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve(state.current === 'complete');
        }
      });
    });
  }
}

chrome.runtime.onInstalled.addListener(function () {
  chrome.declarativeContent.onPageChanged.removeRules(undefined, function () {
    chrome.declarativeContent.onPageChanged.addRules([
      {
        conditions: [
          new chrome.declarativeContent.PageStateMatcher({
            pageUrl: {hostEquals: 'www.patreon.com', schemes: ['https'], pathPrefix: '/posts/'},
          }),
        ],
        actions: [new chrome.declarativeContent.ShowPageAction()],
      },
    ]);
  });
});

chrome.runtime.onMessage.addListener(
  function (message, sender, sendResponse) {
    switch (message.type) {
      case 'whoAmI':
        sendResponse({tab: sender.tab.id});
        break;
    }
  },
);

let count = 0;
let total = 0;
chrome.extension.onConnect.addListener(function (port) {
  const throttler = new ChromeDownloader(3);
  throttler.OnComplete(function () {
    count = 0;
    total = 0;
    try {
      port.postMessage({type: 'complete'});
    } catch (e) {
      console.error('Patreon Downloader | Error OnComplete:', e);
    }
  });
  throttler.OnBeginDownload(function () {
    count++;
    try {
      port.postMessage({type: 'downloadUpdate', count, total});
    } catch (e) {
      console.error('Patreon Downloader | Error OnBeginDownload:', e);
    }
  });
  port.onMessage.addListener(function (msg) {
    if (typeof msg !== 'object') {
      return;
    }
    if (msg.type) {
      switch (msg.type) {
        case 'download':
          if (msg?.requests?.length) {
            total += msg.requests.length;
            for (let i = 0; i < msg.requests.length; i++) {
              throttler.Download(msg.requests[i]);
            }
          }
          break;
        case 'status':
          try {
            port.postMessage({type: 'downloadUpdate', count, total});
          } catch (e) {
            console.error('Patreon Downloader | Error OnBeginDownload:', e);
          }
          break;
      }
    }
  });
});