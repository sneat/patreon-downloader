const downloadLink = $('#download-link');
const includeAvatar = $('#include_avatar');
const includeDescription = $('#include_description');
const downloadSpeed = $('#download-speed');
let files = [];

includeAvatar.change(updateDownloadCount);
includeDescription.change(updateDownloadCount);

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  switch (message.type) {
    case 'downloadUpdate':
      if (message.speed) {
        downloadSpeed.text(`Downloading: ${HumanFileSize(message.speed)}/s`);
      }
      break;
    case 'downloadComplete':
      downloadSpeed.text('Complete!');
      break;
  }
  sendResponse();
  return true;
});

function isPatreonPostSite() {
  return chrome.tabs.query(
    {active: true, lastFocusedWindow: true},
    (tabs) => {
      const tabId = tabs[0]?.id.toString();
      if (!tabId) {
        return;
      }
      const url = tabs[0].url;
      console.log(tabs, url);
      if (url && url.indexOf('https://www.patreon.com/posts/') > -1) {
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

function updateDownloadCount() {
  let count = files.length;
  if (includeAvatar.is(':checked')) {
    count += 1;
  }
  if (includeDescription.is(':checked')) {
    count += 1;
  }
  if (count) {
    downloadLink.prop('disabled', false);
    downloadLink.text(`Download ${count} ${count === 1 ? 'file' : 'files'}`);
    chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, ['Patreon Downloader | Files', files]);
    });
  }
}

function parsePatreonData(tabId) {
  chrome.storage.local.get(tabId, function (contentData) {
    if (!contentData || !contentData[tabId]) {
      console.error('Patreon Downloader | No post data found.');
      return;
    }

    contentData = contentData[tabId];
    console.log('Patreon Downloader | Raw post data', contentData);

    if (!contentData?.post?.data?.attributes) {
      console.error('Patreon Downloader | Invalid post data found.');
      return;
    }

    let text = contentData.post.data.attributes.title;

    const campaignData = contentData.post.included.filter(o => o.type === 'campaign').map(o => {
      return o.attributes;
    });
    let postUser = {};
    if (campaignData.length) {
      postUser.name = campaignData[0].name;
      postUser.url = campaignData[0].url;
      postUser.avatarUrl = campaignData[0].avatar_photo_url;
      if (postUser.name) {
        text = `${postUser.name}-${text}`;
      }
    }
    $('#zip-name').prop('value', `${slugify(text)}.zip`);

    files = contentData.post.included.filter(o => o.type === 'media' || o.type === 'attachment').map(o => {
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
    if (contentData.post.data.attributes?.post_type === 'video_external_file' && contentData.post.data.attributes?.post_file?.url) {
      let filename = new URL(contentData.post.data.attributes.post_file.url).pathname.split('/').pop() || 'video';
      files.push({
        filename,
        url: contentData.post.data.attributes.post_file.url,
      });
    }

    updateDownloadCount();

    files.sort((a, b) => {
      return a.filename.localeCompare(b.filename);
    });
    console.log('Patreon Downloader | Files', files);

    $('#download').submit(e => {
      e.preventDefault();

      if (!files.length) {
        console.info('Patreon Downloader | No files to download.');
        return;
      }

      downloadLink.prop('disabled', true);

      const requests = [];

      if (includeDescription.prop('checked')) {
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
        requests.push({url: url, filename: filename});
      }

      if (postUser.avatarUrl && includeAvatar.prop('checked')) {
        let filename = new URL(postUser.avatarUrl).pathname.split('/').pop();
        let extension = filename.split('.').pop();
        if (!extension) {
          extension = 'png';
        }
        let file = `avatar.${extension}`;
        requests.push({
          filename: file,
          url: postUser.avatarUrl,
        });
      }

      for (let i = 0; i < files.length; i++) {
        let filename = files[i].filename;
        if (filename.startsWith('http')) {
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
        const req = {
          filename: filename,
          url: files[i].url,
        };
        requests.push(req);
      }

      chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
        let zipName = $('#zip-name').val() || 'archive.zip';
        if (!zipName.endsWith('.zip')) {
          zipName += '.zip';
        }
        chrome.tabs.sendMessage(tabs[0].id, {type: 'download', requests, zipName});
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
    return bytes + ' B';
  }

  const units = si
                ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
                : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
    );

  return bytes.toFixed(dp) + ' ' + units[u];
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
