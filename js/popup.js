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

function isPatreonPostSite() {
  return chrome.tabs.query(
    {active: true, lastFocusedWindow: true},
    (tabs) => {
      const tabId = tabs[0]?.id.toString();
      if (!tabId) {
        return;
      }
      const url = tabs[0].url;
      if (url.indexOf('https://www.patreon.com/posts/') > -1) {
        $('#not-patreon-site').hide();
        $('#patreon-site').show();
        parsePatreonData(tabId);
      } else {
        $('#not-patreon-site').show();
        $('#patreon-site').hide();
      }
    },
  );
}

function parsePatreonData(tabId) {
  chrome.storage.local.get(tabId, function (contentData) {
    if (!contentData || !contentData[tabId]) {
      console.error('Patreon Downloader | No post data found.');
      return;
    }
    contentData = contentData[tabId];
    console.debug('Patreon Downloader | Raw post data', contentData);

    if (!contentData || !contentData.post || !contentData.post.data || !contentData.post.data.attributes) {
      console.error('Patreon Downloader | Invalid post data found.');
      return;
    }

    const downloadLink = $('#download-link');
    let text = contentData.post.data.attributes.title;

    const campaignData = contentData.post.included.filter(o => o.type === 'campaign').map(o => {
      return o.attributes;
    });
    let postUser = {};
    if (campaignData.length) {
      postUser.name = campaignData[0].name;
      postUser.url = campaignData[0].url;
      if (postUser.name) {
        text = `${postUser.name}-${text}`;
      }
    }
    $('#folder-name').prop('value', slugify(text));

    const files = contentData.post.included.filter(o => o.type === 'media' || o.type === 'attachment').map(o => {
        let out = {
          filename: null,
          url: null,
        };
        switch (o.type) {
          case 'media':
            out.filename = o.attributes.file_name;
            out.url = o.attributes.download_url;
            break;
          case 'attachment':
            out.filename = o.attributes.name;
            out.url = o.attributes.url;
            break;
        }
        return out;
      },
    );
    if (files.length) {
      files.sort((a, b) => {
        return a.filename.localeCompare(b.filename);
      });

      downloadLink.prop('disabled', false);
      downloadLink.text(`Download ${files.length + 1} items`);
    }
    console.debug('Patreon Downloader | Files', files);

    $('#download').submit(e => {
      e.preventDefault();

      const prefix = $('#folder-name').val();

      if (!files.length) {
        console.info('Patreon Downloader | No files to download.');
        return;
      }

      downloadLink.prop('disabled', true);
      downloadLink.text(`Downloading 0/${files.length + 1} items`);

      const throttler = new ChromeDownloader(3);
      throttler.OnComplete(function () {
        downloadLink.text('Completed.');
      });
      let count = 0;
      throttler.OnBeginDownload(function () {
        count++;
        downloadLink.text(`Downloading ${count}/${files.length + 1} items`);
      });

      let content = [
        `<h1>${contentData.post.data.attributes.title}</h1>`,
      ];
      if (postUser.name && postUser.url) {
        content.push(
          `<p>by <a href="${postUser.url}">${postUser.name}</a></p>`,
        );
      }
      content.push(
        contentData.post.data.attributes.content,
        `<p><a href="${contentData.post.data.attributes.url}">${contentData.post.data.attributes.url}</a>`,
      );
      let blob = new Blob(content, {type: 'text/html'});
      let url = URL.createObjectURL(blob);
      let filename = 'description.html';
      if (prefix) {
        filename = `${prefix}/${filename}`;
      }

      throttler.Download({url: url, filename: filename});

      for (let i = 0; i < files.length; i++) {
        const req = {
          filename: files[i].filename,
          url: files[i].url,
        };
        if (prefix) {
          req.filename = `${prefix}/${req.filename}`;
        }

        throttler.Download(req);
      }
    });
  });
}

function slugify(text) {
  return text.toString().toLowerCase().trim()
    .normalize('NFD')         // separate accent from letter
    .replace(/[\u0300-\u036f]/g, '') // remove all separated accents
    .replace(/\s+/g, '-')            // replace spaces with -
    .replace(/&/g, '-and-')          // replace & with 'and'
    .replace(/[^\w\-]+/g, '')        // remove all non-word chars
    .replace(/\-\-+/g, '-')          // replace multiple '-' with single '-'
    .replace(/^-+/, '')              // Trim - from start of text
    .replace(/-+$/, '');             // Trim - from end of text
}

(function () {
  try {
    isPatreonPostSite();
  } catch (e) {
    console.error('Patreon Downloader |', e);
  }
})();
