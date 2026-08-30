/**
 * Ensure a filename is unique within the set of already-seen names, appending a
 * suffix (the source id, or a random number as a last resort) on collision.
 * Mutates seenFiles to record the returned name.
 * @param {string} filename
 * @param {Set<string>} seenFiles
 * @param {string|number} [id] - Stable suffix to prefer over a random one.
 * @return {string}
 */
function makeUniqueFilename(filename, seenFiles, id) {
  if (!seenFiles.has(filename)) {
    seenFiles.add(filename);
    return filename;
  }

  const uniqueSuffix = id || Math.floor(Math.random() * 1e9);
  const dotIndex = filename.lastIndexOf(".");
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : "";
  const unique = `${baseName}-${uniqueSuffix}${extension}`;

  seenFiles.add(unique);
  return unique;
}

/**
 * Escape a value for safe interpolation into HTML text or attribute contexts.
 * @param {unknown} value
 * @return {string}
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert Patreon's `content_json_string` (a ProseMirror/TipTap document) into HTML.
 * Used when the rendered `content` HTML field is null but the structured body is present.
 * Text is escaped; unknown nodes still render their children so no text is dropped.
 * @param {string|object} json - The content_json_string value (or parsed document).
 * @return {string} HTML markup, or "" if the input is empty/unparseable.
 */
function contentJsonToHtml(json) {
  if (!json) return "";
  let doc;
  try {
    doc = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return "";
  }

  // Drop anything that isn't an allowed scheme so a javascript:/data: URI from
  // post content can't execute when description.html is opened.
  const safeUrl = (value, schemes) => {
    try {
      const parsed = new URL(value || "", "https://www.patreon.com");
      return schemes.includes(parsed.protocol) ? parsed.href : "";
    } catch {
      return "";
    }
  };

  const renderMarks = (text, marks = []) => {
    let html = escapeHtml(text);
    // Wrap inner-to-outer so the first mark ends up outermost.
    for (let i = marks.length - 1; i >= 0; i--) {
      switch (marks[i].type) {
        case "bold":
          html = `<strong>${html}</strong>`;
          break;
        case "italic":
          html = `<em>${html}</em>`;
          break;
        case "underline":
          html = `<u>${html}</u>`;
          break;
        case "strike":
          html = `<s>${html}</s>`;
          break;
        case "code":
          html = `<code>${html}</code>`;
          break;
        case "link": {
          const href = safeUrl(marks[i].attrs?.href, ["http:", "https:"]);
          html = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${html}</a>`;
          break;
        }
      }
    }
    return html;
  };

  const renderNodes = (nodes) => (Array.isArray(nodes) ? nodes.map(renderNode).join("") : "");

  const renderNode = (node) => {
    if (!node) return "";
    switch (node.type) {
      case "text":
        return renderMarks(node.text || "", node.marks);
      case "hardBreak":
        return "<br>";
      case "horizontalRule":
        return "<hr>";
      case "paragraph":
        return `<p>${renderNodes(node.content)}</p>`;
      case "heading": {
        const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6);
        return `<h${level}>${renderNodes(node.content)}</h${level}>`;
      }
      case "bulletList":
        return `<ul>${renderNodes(node.content)}</ul>`;
      case "orderedList":
        return `<ol>${renderNodes(node.content)}</ol>`;
      case "listItem":
        return `<li>${renderNodes(node.content)}</li>`;
      case "blockquote":
        return `<blockquote>${renderNodes(node.content)}</blockquote>`;
      case "image": {
        const src = safeUrl(node.attrs?.src, ["http:", "https:"]);
        return src
          ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.attrs?.alt || "")}">`
          : "";
      }
      default:
        return renderNodes(node.content);
    }
  };

  return renderNodes(doc?.content);
}

/**
 * Build an ordered, duplicate-free list of usable URLs for a Patreon media item.
 * Patreon's `download_url` is preferred because it is intended to represent the
 * original downloadable asset. Newer post pages occasionally expose a first/hero
 * image whose download URL is absent or fails while the display/image variants
 * remain valid, so these are retained as transparent fallbacks.
 * @param {object} attributes Patreon media attributes.
 * @return {string[]}
 */
function getPatreonMediaDownloadCandidates(attributes = {}) {
  const candidates = [
    attributes.download_url,
    attributes.display?.url,
    attributes.image_urls?.original,
    attributes.image_urls?.default_large,
    attributes.image_urls?.url,
    attributes.image_urls?.default,
  ];

  const seen = new Set();
  return candidates.filter((value) => {
    if (typeof value !== "string" || !value) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/**
 * Return a stable key for Patreon image variants that point at the same original
 * media asset. Patreon changes the transformation/token part of the URL between
 * preview and download variants, but the post id + asset hash stay identical.
 * @param {string} value
 * @return {string}
 */
function patreonMediaAssetKey(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/patreon-media\/p\/post\/(\d+)\/([^/]+)\//i);
    return match ? `${match[1]}:${match[2]}` : "";
  } catch {
    return "";
  }
}

/**
 * Detect whether Patreon's post-level image URL is only a preview/transform of
 * a media item that is already present in `included`. This prevents duplicate
 * files such as `1.jpg` next to the correctly named original image.
 * @param {string} imageUrl
 * @param {Array<object>} included
 * @return {boolean}
 */
function isDuplicatePatreonPostImage(imageUrl, included = []) {
  if (!imageUrl) return false;

  const imageKey = patreonMediaAssetKey(imageUrl);

  for (const item of included || []) {
    if (item?.type !== "media") continue;

    const attributes = item.attributes || {};
    const candidates = [
      attributes.download_url,
      attributes.display?.url,
      ...Object.values(attributes.image_urls || {}),
    ].filter((value) => typeof value === "string" && value);

    for (const candidate of candidates) {
      if (candidate === imageUrl) return true;
      const candidateKey = patreonMediaAssetKey(candidate);
      if (imageKey && candidateKey && imageKey === candidateKey) return true;
    }
  }

  return false;
}

/**
 * Format bytes as human-readable text.
 * @see https://stackoverflow.com/a/14919494/191306
 * @param {number} bytes Number of bytes.
 * @param {boolean} si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param {number} dp Number of decimal places to display.
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
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

  return `${bytes.toFixed(dp)} ${units[u]}`;
}

/**
 * Format an ISO datetime string in the viewer's local timezone and locale.
 * Returns the original value if it isn't a parseable date, or "" when empty.
 * @param {string} value - An ISO 8601 datetime (e.g. Patreon's published_at).
 * @return {string}
 */
function formatLocalDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

/**
 * Convert arbitrary text into a filesystem-safe slug.
 * @param {string} text
 * @return {string}
 */
function slugify(text) {
  const illegalRe = /[/?<>\\:*|"]/g;
  // eslint-disable-next-line no-control-regex -- intentionally strips control characters from filenames
  const controlRe = /[\x00-\x1f\x80-\x9f]/g;
  const reservedRe = /^\.+$/;
  const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  const windowsTrailingRe = /[. ]+$/;
  const dashLikeRe = /[‐‑‒–—―−﹘﹣－]/g; // normalize common unicode dashes to "-"

  return text
    .toString()
    .trim()
    .replace(dashLikeRe, "-")
    .replace(/\s+/g, "-") // replace spaces with -
    .replace(/&/g, "-and-") // replace & with 'and'
    .replace(/--+/g, "-") // replace multiple '-' with single '-'
    .replace(/^-+/, "") // Trim - from start of text
    .replace(/-+$/, "") // Trim - from end of text
    .replace(/\.+$/, "") // Trim . from end of text
    .replace(illegalRe, "")
    .replace(controlRe, "")
    .replace(reservedRe, "")
    .replace(windowsReservedRe, "")
    .replace(windowsTrailingRe, "");
}

/**
 * Identify stored post-data entries whose owning tab no longer exists. Only
 * numeric keys are considered so any future non-tab settings keys are left untouched.
 * @param {string[]} storedKeys - Keys currently present in chrome.storage.local.
 * @param {Array<number|string>} openTabIds - Ids of currently open tabs.
 * @return {string[]} Keys safe to remove.
 */
function findOrphanedTabKeys(storedKeys, openTabIds) {
  const open = new Set(openTabIds.map((id) => String(id)));
  return storedKeys.filter((key) => /^\d+$/.test(key) && !open.has(key));
}

// Exposed for the Node test runner; ignored in the browser where `module` is undefined.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    makeUniqueFilename,
    escapeHtml,
    contentJsonToHtml,
    formatLocalDateTime,
    HumanFileSize,
    slugify,
    findOrphanedTabKeys,
    getPatreonMediaDownloadCandidates,
    patreonMediaAssetKey,
    isDuplicatePatreonPostImage,
  };
}
