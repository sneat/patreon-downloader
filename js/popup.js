const downloadLink = $('#download-link');

const port = chrome.extension.connect({
  name: 'Patreon Downloader',
});
port.postMessage({type: 'whoAmI'});
port.onMessage.addListener(function (msg) {
  if (typeof msg !== 'object' || !msg?.type) {
    return;
  }

  switch (msg.type) {
    case 'complete':
      downloadLink.text('Completed.');
      break;
    case 'downloadUpdate':
      if (typeof msg.count === 'number' && typeof msg.total === 'number' && msg.total) {
        downloadLink.prop('disabled', true);
        downloadLink.text(`Downloading ${msg.count}/${msg.total} items...`);
      }
      break;
  }
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

function parsePatreonData(tabId) {
  chrome.storage.local.get(tabId, function (contentData) {
    if (!contentData || !contentData[tabId]) {
      console.error('Patreon Downloader | No post data found.');
      return;
    }
    window.setInterval(function () {
      port.postMessage({type: 'status'});
    }, 2500);

    contentData = contentData[tabId];
    console.debug('Patreon Downloader | Raw post data', contentData);

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
      // One extra file due to the post description file.
      downloadLink.text(`Download ${files.length + 1} items`);
    }
    console.debug('Patreon Downloader | Files', files);
    // Check for existing downloads.
    port.postMessage({type: 'status'});

    $('#download').submit(e => {
      e.preventDefault();

      const prefix = $('#folder-name').val();

      if (!files.length) {
        console.info('Patreon Downloader | No files to download.');
        return;
      }

      downloadLink.prop('disabled', true);

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

      const requests = [];
      requests.push({url: url, filename: filename});

      for (let i = 0; i < files.length; i++) {
        let filename = files[i].filename;
        try {
          // Handle full urls as the filename, pull the final segment out
          const url = new URL(filename);
          filename = url.pathname.split(/[\\/]/).pop();
        } catch (e) {
          // Carry on with the standard filename
        }
        const req = {
          filename: filename,
          url: files[i].url,
        };
        if (prefix) {
          req.filename = `${prefix}/${req.filename}`;
        }
        requests.push(req);
      }

      port.postMessage({type: 'download', requests: requests});
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
