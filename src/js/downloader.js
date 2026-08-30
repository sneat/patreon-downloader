/* exported Downloader, decodeFilenameSafely */

/**
 * Decode a filename that may have come from a URL without letting a literal
 * percent sign in a real Patreon filename (for example `100%ComfyUI.png`)
 * throw URIError. Patreon API `file_name` values are already human-readable,
 * so malformed/ordinary percent signs must be preserved verbatim.
 * @param {unknown} value
 * @return {string}
 */
function decodeFilenameSafely(value) {
  const filename = String(value ?? "");
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}
class Downloader {
  /**
   * @param {number} concurrency - The number of concurrent downloads to process
   * @param {function(ProgressDownloaded): void} onDownloaded - A function to call each time a download completes.
   * @param {function(ProgressUpdate): void} onProgress - A function to call with progress updates.
   * @param {function(DownloadError): void} onError - A function to call when a download fails.
   */
  constructor({
    concurrency = 5,
    onDownloaded = () => {},
    onProgress = () => {},
    onError = () => {},
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
    /**
     * The function to call when a download fails.
     * @type {function(DownloadError): void}
     */
    this.onError = onError;
  }

  /**
   * @typedef DownloadError
   * @property {string} url - The URL that failed to download.
   * @property {*} error - The error that caused the failure.
   */

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
        for (let [, item] of iterator) {
          const primaryUrl = typeof item === "string" ? item : item?.url;
          const fallbackUrls =
            typeof item === "string" || !Array.isArray(item?.fallbackUrls) ? [] : item.fallbackUrls;
          const candidates = [primaryUrl, ...fallbackUrls].filter(Boolean);

          if (!candidates.length) {
            this.onError({
              url: primaryUrl,
              error: new Error("No usable download URL."),
            });
            continue;
          }

          let lastError = null;
          let completed = false;

          for (const candidateUrl of candidates) {
            try {
              const blob = await this._download(candidateUrl);
              if (blob) {
                this.onDownloaded({
                  // Keep the primary URL as the logical asset key so callers
                  // retain the original filename even when a fallback wins.
                  url: primaryUrl,
                  resolvedUrl: candidateUrl,
                  blob,
                });
                completed = true;
                break;
              }
            } catch (error) {
              lastError = error;
              console.warn(
                "Patreon Downloader | Download URL failed; trying fallback if available.",
                candidateUrl,
                error,
              );
            }
          }

          if (!completed) {
            this.onError({
              url: primaryUrl,
              error: lastError || new Error("All download URL variants failed."),
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
      oReq.responseType = "blob";

      let speed = null;
      let previousLoaded = 0;
      const TIME_CONSTANT = 5;
      oReq.addEventListener("progress", (e) => {
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
      oReq.addEventListener("load", () => {
        // XHR fires `load` for HTTP errors too. Treat non-success responses as
        // failures so the caller can retry a Patreon display/image fallback.
        // Blob/object URLs may report status 0 even when the request succeeded.
        if (oReq.status !== 0 && (oReq.status < 200 || oReq.status >= 300)) {
          reject(new Error(`HTTP ${oReq.status} while downloading ${url}`));
          return;
        }

        this.onProgress({
          url,
          percentComplete: 100,
          speed: 0,
          complete: true,
        });
        resolve(oReq.response);
      });
      oReq.addEventListener("error", (e) => {
        reject(e);
      });
      oReq.addEventListener("abort", (e) => {
        reject(e);
      });
      oReq.open("GET", url);
      oReq.send();
    });
  }
}
