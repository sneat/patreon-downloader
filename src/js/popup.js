const downloadLink = document.getElementById("download-link");
const includeAvatar = document.getElementById("include_avatar");
const includeDescription = document.getElementById("include_description");
const downloadSpeed = document.getElementById("download-speed");
const notPatreonSite = document.getElementById("not-patreon-site");
const patreonSite = document.getElementById("patreon-site");
const zipNameInput = document.getElementById("zip-name");
const downloadForm = document.getElementById("download");

let files = [];

includeAvatar?.addEventListener("change", updateDownloadCount);
includeDescription?.addEventListener("change", updateDownloadCount);

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  switch (message.type) {
    case "downloadUpdate":
      if (message.speed) {
        if (downloadSpeed) downloadSpeed.textContent = `Downloading: ${HumanFileSize(message.speed)}/s`;
      }
      break;
    case "downloadComplete":
      if (downloadSpeed) downloadSpeed.textContent = "Complete!";
      break;
  }
  sendResponse();
  return true;
});

function isPatreonPostSite() {
  return chrome.tabs.query(
    {
      active: true,
      lastFocusedWindow: true
    },
    (tabs) => {
      const tabId = tabs[0]?.id?.toString();
      if (!tabId) return;

      notPatreonSite.hidden = true;
      patreonSite.hidden = false;
      parsePatreonData(tabId);
    }
  );
}

function updateDownloadCount() {
  let count = files.length;

  if (includeAvatar?.checked) count += 1;
  if (includeDescription?.checked) count += 1;

  if (count) {
    if (downloadLink) {
      downloadLink.disabled = false;
      downloadLink.textContent = `Download ${count} ${count === 1 ? "file" : "files"}`;
    }

    chrome.tabs.query(
      {
        active: true,
        currentWindow: true
      },
      function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, ["Patreon Downloader | Files", files]);
      }
    );
  }
}

function parsePatreonData(tabId) {
  chrome.storage.local.get(tabId, function(contentData) {
    if (!contentData || !contentData[tabId]) {
      notPatreonSite.hidden = false;
      patreonSite.hidden = true;
      console.error("Patreon Downloader | No post data found.");
      return;
    }

    contentData = contentData[tabId];
    console.log("Patreon Downloader | Raw post data", contentData);

    if (!contentData?.data?.attributes) {
      console.error("Patreon Downloader | Invalid post data found.");
      return;
    }

    let text = contentData.data.attributes.title;

    const campaignData = contentData.included
      .filter((o) => o.type === "campaign")
      .map((o) => o.attributes);

    let postUser = {};
    if (campaignData.length) {
      postUser.name = campaignData[0].name;
      postUser.url = campaignData[0].url;
      postUser.avatarUrl = campaignData[0].avatar_photo_url;
      if (postUser.name) {
        text = `${postUser.name}-${text}`;
      }
    }

    if (zipNameInput) zipNameInput.value = `${slugify(text)}.zip`;

    files = contentData.included
      .filter((o) => o.type === "media" || o.type === "attachment")
      .map((o) => {
        let out = {
          filename: null,
          url: null,
        };

        switch (o.type) {
          case "media":
            out.filename = o.id ? `${o.id}-${o.attributes.file_name}` : o.attributes.file_name;
            out.url = o.attributes.download_url;
            break;
          case "attachment":
            out.filename = o.id ? `${o.id}-${o.attributes.name}` : o.attributes.name;
            out.url = o.attributes.url;
            break;
        }

        if (!out.filename && o.id) {
          // Try parsing the url as the filename
          try {
            const url = new URL(out.url);
            out.filename = `${o.id}-${url.pathname.split(/[\\/]/).pop()}`;
          } catch (e) {
            console.error(`Patreon Downloader | Error parsing URL ${out.url}`, e);
            console.warn(
              `Patreon Downloader | Using ID ${o.id}.jpg as filename. This may not be correct and you may have to manually rename the file extension.`
            );
            out.filename = `${o.id}.jpg`;
          }
        }

        return out;
      });

    if (contentData.data.attributes?.image?.url) {
      let filename = new URL(contentData.data.attributes.image.url).pathname.split("/").pop();
      files.push({
        filename,
        url: contentData.data.attributes.image.url
      });
    }

    if (contentData.data.attributes?.embed_url) {
      let filename = "embed.txt";
      files.push({
        filename,
        url: contentData.data.attributes.embed_url
      });
    }

    updateDownloadCount();

    files.sort((a, b) => a.filename.localeCompare(b.filename));
    console.log("Patreon Downloader | Files", files);

    downloadForm?.addEventListener("submit", (e) => {
      e.preventDefault();

      if (!files.length) {
        console.info("Patreon Downloader | No files to download.");
        return;
      }

      if (downloadLink) downloadLink.disabled = true;

      const requests = [];

      if (includeDescription?.checked) {
        let content = [`<h1 id="title">${contentData.data.attributes?.title}</h1>`];

        if (postUser.name && postUser.url) {
          content.push(`<p>by <a href="${postUser.url}">${postUser.name}</a></p>`);
        }

        const tags = contentData.included
          .filter((included) => included?.type === "post_tag" && included.attributes?.value)
          .map((included) => included.attributes.value);

        if (contentData.data?.attributes?.published_at) {
          content.push(`<p id="published-at">${contentData.data.attributes.published_at}</p>`);
        }
        if (contentData.data?.attributes?.content) {
          content.push(`<p id="content">${contentData.data.attributes.content}</p>`);
        }
        if (tags?.length) {
          content.push(
            `<p id="tags">${tags.map((tag) => `<span class="tag">${tag}</span>`)
              .join(" | ")}</p>`
          );
        }
        if (contentData.data?.attributes?.url) {
          content.push(
            `<p id="url"><a href="${contentData.data.attributes.url}">${contentData.data.attributes.url}</a></p>`
          );
        } else if (contentData.pageURL) {
          content.push(
            `<p id="url"><a href="${contentData.pageURL}">${contentData.pageURL}</a></p>`
          );
        }

        const blob = new Blob(content, { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const filename = "description.html";
        requests.push({
          url,
          filename
        });
      }

      if (postUser.avatarUrl && includeAvatar?.checked) {
        let filename = new URL(postUser.avatarUrl).pathname.split("/").pop();
        let extension = filename.split(".").pop();
        if (!extension) extension = "png";

        requests.push({
          filename: `avatar.${extension}`,
          url: postUser.avatarUrl
        });
      }

      for (let i = 0; i < files.length; i++) {
        let filename = files[i].filename;

        if (filename.startsWith("http")) {
          try {
            // Handle full urls as the filename, pull the final segment out
            const url = new URL(filename);
            filename = url.pathname.split(/[\\/]/).pop();
          } catch (e) {
            // Try parsing the url as the filename
            try {
              const url = new URL(files[i].url);
              filename = url.pathname.split(/[\\/]/).pop();
            } catch (e) {
              // Carry on with the standard filename
            }
          }
        }

        requests.push({
          filename,
          url: files[i].url
        });
      }

      const seen = new Set();
      const filteredRequests = requests.filter((request) => {
        if (seen.has(request.url)) {
          return false;
        }
        seen.add(request.url);
        return true;
      });

      chrome.tabs.query({
        active: true,
        currentWindow: true
      }, function(tabs) {
        let zipName = zipNameInput?.value || "archive.zip";
        if (!zipName.endsWith(".zip")) zipName += ".zip";

        chrome.tabs.sendMessage(tabs[0].id, {
          type: "download",
          requests: filteredRequests,
          zipName
        });
      });
    });
  });
}

/**
 * Format bytes as human-readable text.
 * @see https://stackoverflow.com/a/14919494/191306
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 * @return {string} Formatted string.
 */
function HumanFileSize(bytes, si = true, dp = 1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return `${bytes} B`;
  }

  const units = si
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
    );

  return `${bytes.toFixed(dp)} ${units[u]}`;
}

function slugify(text) {
  const illegalRe = /[\/?<>\\:*|"]/g;
  const controlRe = /[\x00-\x1f\x80-\x9f]/g;
  const reservedRe = /^\.+$/;
  const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  const windowsTrailingRe = /[. ]+$/;
  const dashLikeRe = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g; // normalize common unicode dashes to "-"

  return text.toString()
    .trim()
    .replace(dashLikeRe, "-")
    .replace(/\s+/g, "-")   // replace spaces with -
    .replace(/&/g, "-and-") // replace & with 'and'
    .replace(/--+/g, "-")   // replace multiple '-' with single '-'
    .replace(/^-+/, "")     // Trim - from start of text
    .replace(/-+$/, "")     // Trim - from end of text
    .replace(/\.+$/, "")     // Trim . from end of text
    .replace(illegalRe, "")
    .replace(controlRe, "")
    .replace(reservedRe, "")
    .replace(windowsReservedRe, "")
    .replace(windowsTrailingRe, "");
}

(function() {
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", isPatreonPostSite);
    } else {
      isPatreonPostSite();
    }
  } catch (e) {
    console.error("Patreon Downloader |", e);
  }
})();
