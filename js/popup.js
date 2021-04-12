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
      downloadLink.text(`Download ${files.length} items`);
    }
    console.debug('Patreon Downloader | Files', files);

    $('#download').submit(e => {
      e.preventDefault();

      const prefix = $('#folder-name').val();

      if (!files.length) {
        console.info('Patreon Downloader | No files to download.');
        return;
      }

      for (let i = 0; i < files.length; i++) {
        const req = {
          filename: files[i].filename,
          url: files[i].url,
        };
        if (prefix) {
          req.filename = `${prefix}/${req.filename}`;
        }

        chrome.downloads.download(req, (id) => {
          if (chrome.runtime.lastError) {
            console.error('Patreon Downloader |', req.filename, id, chrome.runtime.lastError.message);
          } else {
            console.debug('Patreon Downloader |', `Download started: ${req.filename}`, id);
          }
        });
      }

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
      chrome.downloads.download({url: url, filename: filename}, (id) => {
        if (chrome.runtime.lastError) {
          console.error('Patreon Downloader |', req.filename, id, chrome.runtime.lastError.message);
        } else {
          console.debug('Patreon Downloader |', `Download started: ${filename}`, id);
        }
      });
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
