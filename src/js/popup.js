const downloadLink = document.getElementById("download-link");
const includeAvatar = document.getElementById("include_avatar");
const includeDescription = document.getElementById("include_description");
const downloadSpeed = document.getElementById("download-speed");
const notPatreonSite = document.getElementById("not-patreon-site");
const patreonSite = document.getElementById("patreon-site");
const zipNameInput = document.getElementById("zip-name");
const downloadForm = document.getElementById("download");
const statusEl = document.getElementById("status");

let files = [];

includeAvatar?.addEventListener("change", updateDownloadCount);
includeDescription?.addEventListener("change", updateDownloadCount);

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = !message;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  switch (message.type) {
    case "downloadUpdate":
      if (message.speed) {
        if (downloadSpeed)
          downloadSpeed.textContent = `Downloading: ${HumanFileSize(message.speed)}/s`;
      }
      break;
    case "downloadComplete":
      if (downloadSpeed) {
        downloadSpeed.textContent = message.failed
          ? `Complete — ${message.failed} file(s) could not be downloaded.`
          : "Complete!";
      }
      break;
  }
  sendResponse();
  return true;
});

function isPatreonPostSite() {
  return chrome.tabs.query(
    {
      active: true,
      lastFocusedWindow: true,
    },
    (tabs) => {
      const tabId = tabs[0]?.id?.toString();
      if (!tabId) return;

      notPatreonSite.hidden = true;
      patreonSite.hidden = false;
      parsePatreonData(tabId);
    },
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
        currentWindow: true,
      },
      function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, ["Patreon Downloader | Files", files]);
      },
    );
  }
}

function parsePatreonData(tabId) {
  chrome.storage.local.get(tabId, function (contentData) {
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
      setStatus("Couldn't read this Patreon post. Try reloading the page.", true);
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

    const seenFiles = new Set();
    files = contentData.included
      .filter((o) => o.type === "media" || o.type === "attachment")
      .map((o) => {
        let out = {
          filename: null,
          url: null,
          fallbackUrls: [],
        };

        switch (o.type) {
          case "media": {
            out.filename = o.attributes.file_name;
            const candidates = getPatreonMediaDownloadCandidates(o.attributes);
            out.url = candidates[0] || null;
            out.fallbackUrls = candidates.slice(1);
            break;
          }
          case "attachment":
            out.filename = o.attributes.name;
            out.url = o.attributes.url;
            break;
        }

        if (!out.filename && o.id) {
          // Try parsing the url as the filename
          try {
            const url = new URL(out.url);
            out.filename = `${url.pathname.split(/[\\/]/).pop()}`;
          } catch (e) {
            console.error(`Patreon Downloader | Error parsing URL ${out.url}`, e);
            console.warn(
              `Patreon Downloader | Using ID ${o.id}.jpg as filename. This may not be correct and you may have to manually rename the file extension.`,
            );
            out.filename = `${o.id}.jpg`;
          }
        }

        if (!out.url) {
          console.warn("Patreon Downloader | Skipping media/attachment without a usable URL.", o);
          return null;
        }

        out.filename = makeUniqueFilename(out.filename, seenFiles, o.id);

        return out;
      })
      .filter(Boolean);

    const postImageUrl = contentData.data.attributes?.image?.url;
    const postImageIsDuplicate = isDuplicatePatreonPostImage(postImageUrl, contentData.included);

    if (postImageUrl && !postImageIsDuplicate) {
      const imageUrl = postImageUrl;

      let filename = "image";
      try {
        filename = new URL(imageUrl).pathname.split("/").pop() || filename;
      } catch {
        // Fall back to default filename if the URL cannot be parsed
      }

      files.push({
        filename: makeUniqueFilename(filename, seenFiles, contentData.data.id),
        url: imageUrl,
      });
    }

    if (contentData.data.attributes?.embed_url) {
      let filename = "embed.txt";
      files.push({
        filename,
        url: contentData.data.attributes.embed_url,
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
        let content = [`<h1 id="title">${escapeHtml(contentData.data.attributes?.title)}</h1>`];

        if (postUser.name && postUser.url) {
          content.push(
            `<p>by <a href="${escapeHtml(postUser.url)}">${escapeHtml(postUser.name)}</a></p>`,
          );
        }

        const tags = contentData.included
          .filter((included) => included?.type === "post_tag" && included.attributes?.value)
          .map((included) => included.attributes.value);

        if (contentData.data?.attributes?.published_at) {
          content.push(
            `<p id="published-at">${escapeHtml(formatLocalDateTime(contentData.data.attributes.published_at))}</p>`,
          );
        }
        // Patreon delivers the post body as a `content_json_string` (TipTap/ProseMirror)
        // document; the legacy rendered `content` HTML field is always null now.
        if (contentData.data?.attributes?.content_json_string) {
          content.push(
            `<div id="content">${contentJsonToHtml(contentData.data.attributes.content_json_string)}</div>`,
          );
        }
        if (tags?.length) {
          content.push(
            `<p id="tags">${tags
              .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
              .join(" | ")}</p>`,
          );
        }
        const postUrl = contentData.data?.attributes?.url || contentData.pageURL;
        if (postUrl) {
          content.push(
            `<p id="url"><a href="${escapeHtml(postUrl)}">${escapeHtml(postUrl)}</a></p>`,
          );
        }

        const blob = new Blob(content, { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const filename = "description.html";
        requests.push({
          url,
          filename,
        });
      }

      if (postUser.avatarUrl && includeAvatar?.checked) {
        let filename = new URL(postUser.avatarUrl).pathname.split("/").pop();
        let extension = filename.split(".").pop();
        if (!extension) extension = "png";

        requests.push({
          filename: `avatar.${extension}`,
          url: postUser.avatarUrl,
        });
      }

      for (let i = 0; i < files.length; i++) {
        let filename = files[i].filename;

        if (filename.startsWith("http")) {
          try {
            // Handle full urls as the filename, pull the final segment out
            const url = new URL(filename);
            filename = url.pathname.split(/[\\/]/).pop();
          } catch {
            // Try parsing the url as the filename
            try {
              const url = new URL(files[i].url);
              filename = url.pathname.split(/[\\/]/).pop();
            } catch {
              // Carry on with the standard filename
            }
          }
        }

        requests.push({
          filename,
          url: files[i].url,
          fallbackUrls: files[i].fallbackUrls || [],
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

      chrome.tabs.query(
        {
          active: true,
          currentWindow: true,
        },
        function (tabs) {
          let zipName = zipNameInput?.value || "archive.zip";
          if (!zipName.endsWith(".zip")) zipName += ".zip";

          chrome.tabs.sendMessage(tabs[0].id, {
            type: "download",
            requests: filteredRequests,
            zipName,
          });
        },
      );
    });
  });
}

(function () {
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
