const MAIN_CONTENT_ID = "main-content";

let tab = null;
let lastHref = location.href;

chrome.runtime.sendMessage({ type: "whoAmI" })
  .then(tabId => {
    tab = tabId.tab;
  });

const extractPatreonData = () => {
  console.log("Patreon Downloader | Attempting to extract Patreon data from page.");
  const campaignIdRegex = /"https:\/\/www.patreon.com\/api\/campaigns\/(\d+)"/gm;
  const postIdRegex = /"https:\/\/www.patreon.com\/meta-image\/post\/(\d+)"/gm;
  const campaignIdMatch = campaignIdRegex.exec(document.documentElement.innerHTML);
  const postIdMatch = postIdRegex.exec(document.documentElement.innerHTML);

  function fetchDataFromPage() {
    try {
      const data = window.__NEXT_DATA__ ?? JSON.parse(document.getElementById("__NEXT_DATA__")?.innerText);
      console.log("Patreon Downloader | Could not extract data from API, falling back to embedded data.");
      const detail = data?.props?.pageProps?.bootstrapEnvelope?.pageBootstrap?.post;
      document.dispatchEvent(new CustomEvent("pd-bootstrap-data", {
        detail: {
          pageURL: window.location.href,
          ...detail,
        }
      }));
    } catch (e) {
      console.error("Patreon Downloader | Failed to extract Patreon data from page.", e);
      document.dispatchEvent(new CustomEvent("pd-bootstrap-data", { detail: undefined }));
    }
  }

  if (campaignIdMatch?.length > 1 && postIdMatch?.length > 1) {
    const campaignId = campaignIdMatch[1];
    const postId = postIdMatch[1];
    const fetchOptions = {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      headers: {
        "Content-Type": "application/json"
      }
    };
    const params = new URLSearchParams({
      "fields[post]": "content,embed,image,post_metadata,title,video",
      "fields[post_tag]": "tag_type,value",
      "fields[media]": "id,image_urls,display,download_url,metadata,file_name",
      "filter[campaign_id]": campaignId,
      "include": "images,attachment,media,attachments_media,campaign",
      "json-api-version": "1.0",
      "json-api-use-default-includes": "true"
    });

    const apiUrl = `https://www.patreon.com/api/posts/${postId}?${params}`;

    fetch(apiUrl, fetchOptions)
      .then(response => response.json())
      .then(data => {
        console.log("Patreon Downloader | Fetched Patreon bootstrap data from API.", data);
        document.dispatchEvent(new CustomEvent("pd-bootstrap-data", {
          detail: {
            pageURL: window.location.href,
            ...data,
          }
        }));
      })
      .catch(error => {
        console.error("Error fetching Patreon data from API:", error);
        fetchDataFromPage();
      });
  } else {
    fetchDataFromPage();
  }
};

const handleMaybeRouteChange = () => {
  const href = location.href;
  if (href === lastHref) return;
  lastHref = href;
  extractPatreonData();
};


const installListener = () => {
  if (globalThis["__pdMainContentWatcherInstalled"]) return;
  globalThis["__pdMainContentWatcherInstalled"] = true;

  let previousNode = document.getElementById(MAIN_CONTENT_ID);
  let scheduled = false;

  const scheduleInit = () => {
    if (scheduled) return;
    scheduled = true;

    queueMicrotask(() => {
      scheduled = false;

      const current = document.getElementById(MAIN_CONTENT_ID);
      if (!current || current === previousNode) return;

      previousNode = current;
      handleMaybeRouteChange();
    });
  };

  /**
   * Checks if the mutation contains the main element (which gets replaced
   * when Patreon updates the page).
   * @param {MutationRecord} mutation
   * @returns {boolean}
   */
  const hasMainElementNode = (mutation) => {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = /** @type {Element} */ (node);

      if (el.id === MAIN_CONTENT_ID) return true;
      if (typeof el.querySelector === "function" && el.querySelector(`#${MAIN_CONTENT_ID}`)) return true;
    }
    return false;
  };

  const handleMutations = (mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList" || mutation.addedNodes.length === 0) continue;
      if (!hasMainElementNode(mutation)) continue;

      scheduleInit();
      return;
    }
  };

  const observer = new MutationObserver(handleMutations);

  const start = () => {
    if (!document.body) return;
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  // Trigger data population on the initial load.
  if (previousNode) {
    extractPatreonData();
  }
};

if (!globalThis.__pdContentScriptInitialized) {
  globalThis.__pdContentScriptInitialized = true;

  document.addEventListener("pd-bootstrap-data", function handleBootstrapData(e) {
    console.log("Patreon Downloader | Received bootstrap data.", e.detail);
    setState(e.detail, 0);
  });

  installListener();
}

function setState(state, iteration) {
  if (!tab) {
    if (iteration > 5) {
      console.error("Patreon Downloader | Failed to get tab ID.");
      return;
    }

    setTimeout(() => {
      setState(state, (iteration || 0) + 1);
    }, 500);
    return;
  }

  try {
    const data = {};
    data[tab.toString()] = state;
    chrome.storage.local.set(data, function() {
      if (chrome.runtime.lastError) {
        console.error("Patreon Downloader | Failed to set data for tab.", tab, data, chrome.runtime.lastError.message);
      } else {
        console.log("Patreon Downloader | Set page data.", tab, data);
      }
    });
  } catch (e) {
    console.error("Patreon Downloader |", e);
  }
}

chrome.runtime.onMessage.addListener(
  function(msg, sender, sendResponse) {
    if (msg.type === "download") {
      doDownload(msg.requests, msg.zipName);
    } else {
      console.log(...msg);
    }
    sendResponse();
    return true;
  }
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
          chrome.runtime.sendMessage({
            type: "downloadUpdate",
            count: processed,
            total
          });
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
      chrome.runtime.sendMessage({
        type: "downloadUpdate",
        speed
      });
    }
  });

  if (requests?.length) {
    total += requests.length;
    for (const request of requests) {
      fileDetails[request.url] = request.filename;
    }
    downloader.AddURLs(requests.map(r => r.url));
    downloader.Process()
      .then(() => {
        dataZip.Complete();
        chrome.runtime.sendMessage({
          type: "downloadComplete",
          filename
        });
        console.log("Patreon Downloader | Triggering download", requests);
        dataZip.Download();
      });
  }
}
