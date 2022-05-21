class Downloader {
  /**
   * @param {number} concurrency - The number of concurrent downloads to process
   * @param {function(ProgressDownloaded): void} onDownloaded - A function to call each time a download completes.
   * @param {function(ProgressUpdate): void} onProgress - A function to call with progress updates.
   */
  constructor({
    concurrency = 5,
    onDownloaded = () => {},
    onProgress = () => {},
  } = {}) {
    this.urls = [];
    this.running = 0;
    this.concurrency = concurrency;
    this.resolve = null;
    this.reject = null;
    this.results = {};
    /**
     * The function to call each time a download completes.
     * @type {function(ProgressDownloaded): void}
     */
    this.onDownloaded = onDownloaded;
    /**
     * The function to call with progress updates.
     * @type {function(ProgressUpdate): void}
     */
    this.onProgress = onProgress;
  }

  /**
   * @typedef ProgressDownloaded
   * @property {string} url - The URL this update belongs to.
   * @property {Blob} blob - The binary data blob.
   */

  /**
   * @typedef ProgressUpdate
   * @property {string} url - The URL this update belongs to.
   * @property {number} percentComplete - The percentage of the download that is complete.
   * @property {number} speed - The bytes per second.
   * @property {boolean} complete - Whether the download has completed.
   */

  /**
   * Add an array of URLs
   * @param {IterableIterator<string>|string[]} urls - The URLs to add
   */
  AddURLs(urls) {
    this.urls.push(...urls);
  }

  /**
   * Process the pending urls. Be sure to add all the URLs prior to calling Process.
   * @return {Promise<void>}
   */
  async Process() {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;

      // No urls to process
      if (!this.urls.length) {
        return this.resolve(this.results);
      }

      const resolveAsset = async (iterator) => {
        for (let [, url] of iterator) {
          const blob = await this._download(url);
          if (blob) {
            this.onDownloaded({
              url,
              blob,
            });
          }
        }
      };

      // Operate with concurrency
      const iterator = this.urls.entries();
      const workers = new Array(Math.min(this.concurrency, this.urls.length))
        .fill(iterator)
        .map(resolveAsset);

      Promise.allSettled(workers).then(() => {
        return this.resolve();
      });
    });
  }

  /**
   * Download the requested absolute URL, providing progress updates to {@link onProgress}
   * @param {string} url - The absolute URL to download.
   * @return {Promise<{Blob}>} The binary data of the requested URL.
   * @private
   */
  async _download(url) {
    return new Promise((resolve, reject) => {
      const oReq = new XMLHttpRequest();
      // TODO set a timeout based on config setting
      oReq.responseType = 'blob';

      let speed = null;
      let previousLoaded = 0;
      const TIME_CONSTANT = 5;
      oReq.addEventListener('progress', (e) => {
        let percentComplete = 0;
        // Only able to compute progress information if the total size is known
        if (e.lengthComputable && e.total) {
          percentComplete = Math.floor((e.loaded / e.total) * 100);
        }

        if (speed === null) {
          speed = e.loaded - previousLoaded;
        } else {
          speed += (e.loaded - previousLoaded - speed) / TIME_CONSTANT;
        }

        this.onProgress({
          url,
          percentComplete,
          speed,
          complete: false,
        });
      });
      oReq.addEventListener('load', () => {
        this.onProgress({
          url,
          percentComplete: 100,
          speed: 0,
          complete: true,
        });
        resolve(oReq.response);
      });
      oReq.addEventListener('error', (e) => {
        reject(e);
      });
      oReq.addEventListener('abort', (e) => {
        reject(e);
      });
      oReq.open('GET', url);
      oReq.send();
    });
  }
}
