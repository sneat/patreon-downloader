/**
 * Helpers for extracting Patreon post data from the page without depending on
 * Patreon's generated CSS classes or one specific Next.js bootstrap format.
 */
(function initPatreonPageHelpers(root) {
  "use strict";

  /**
   * Extract the numeric Patreon post id from stable URL shapes first and only
   * then fall back to markers found in the page source.
   *
   * @param {string} pageUrl Current browser URL.
   * @param {string} canonicalUrl Canonical URL from <link rel="canonical">.
   * @param {string} html Page HTML/source.
   * @returns {string|null}
   */
  function extractPostId(pageUrl = "", canonicalUrl = "", html = "") {
    // Old and current social/meta image URL shapes. Patreon emits these only for
    // the post actually being viewed, so they are the only patterns safe to run
    // against the whole page source.
    const metaPatterns = [
      /\/meta-image\/post\/(\d{6,})/i,
      /\/ig\/card-teaser-image\/post\/(\d{6,})/i,
    ];
    const urlPatterns = [
      // Current canonical/page URL: /Creator/posts/some-title-167916041
      /\/posts\/(?:[^/?#]*-)?(\d{6,})(?=$|[/?#"'\\])/i,
      ...metaPatterns,
      // Useful final fallback when an API link is embedded in serialized data.
      /\/api\/posts\/(\d{6,})/i,
    ];

    // A creator/feed page's HTML is full of links to other posts, so the
    // URL-shaped patterns must never be run against it.
    const candidates = [
      [pageUrl, urlPatterns],
      [canonicalUrl, urlPatterns],
      [html, metaPatterns],
    ];

    for (const [candidate, patterns] of candidates) {
      if (!candidate) continue;
      for (const pattern of patterns) {
        const match = pattern.exec(candidate);
        if (match?.[1]) return match[1];
      }
    }

    return null;
  }

  /**
   * Return a balanced JSON object substring beginning at `start`.
   * Handles braces inside JSON strings and escaped quotes.
   *
   * @param {string} text
   * @param {number} start Index of the opening "{".
   * @returns {string|null}
   */
  function readBalancedJsonObject(text, start) {
    if (start < 0 || text[start] !== "{") return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }

    return null;
  }

  /**
   * Decode the text payloads Patreon/Next.js writes through self.__next_f.
   * We intentionally parse only the JSON string argument rather than executing
   * any page script.
   *
   * @param {string} html
   * @returns {string[]}
   */
  function decodeNextFlightPayloads(html) {
    const payloads = [];
    const pattern = /self\.__next_f\.push\(\[\s*1\s*,\s*("(?:\\.|[^"\\])*")\s*\]\)/g;
    let match;

    while ((match = pattern.exec(html))) {
      try {
        payloads.push(JSON.parse(match[1]));
      } catch {
        // Ignore malformed/unrelated chunks and continue looking for valid ones.
      }
    }

    return payloads;
  }

  /**
   * Resolve a React Server Components text record reference such as "$64" when
   * it points at a JSON object record (`64:T...,{...}`). This is primarily used
   * by Patreon for content_json_string in the new page bootstrap.
   *
   * @param {string} flightText Decoded RSC payload text.
   * @param {string} reference e.g. "$64".
   * @returns {string|null} JSON string suitable for content_json_string.
   */
  function resolveRscJsonObjectReference(flightText, reference) {
    const id = /^\$([0-9a-f]+)$/i.exec(reference || "")?.[1];
    if (!id) return null;

    const marker = new RegExp(`(?:^|\\n)${id}:T[0-9a-f]+,`, "i");
    const match = marker.exec(flightText);
    if (!match) return null;

    const searchFrom = match.index + match[0].length;
    const objectStart = flightText.indexOf("{", searchFrom);
    if (objectStart < 0) return null;

    const objectText = readBalancedJsonObject(flightText, objectStart);
    if (!objectText) return null;

    try {
      JSON.parse(objectText);
      return objectText;
    } catch {
      return null;
    }
  }

  /**
   * Extract the same `post` JSON:API object normally returned by Patreon's post
   * API from the newer Next.js/RSC bootstrap embedded in the HTML.
   *
   * @param {string} html
   * @param {string} pageUrl
   * @returns {object|null}
   */
  function extractPostDataFromNextFlight(html, pageUrl = "") {
    const payloads = decodeNextFlightPayloads(html);
    if (!payloads.length) return null;

    const flightText = payloads.join("\n");
    const key = '"bootstrapEnvelope"';
    let from = 0;

    while (from < flightText.length) {
      const keyIndex = flightText.indexOf(key, from);
      if (keyIndex < 0) break;

      const colonIndex = flightText.indexOf(":", keyIndex + key.length);
      const objectStart = flightText.indexOf("{", colonIndex + 1);
      if (colonIndex < 0 || objectStart < 0) break;

      const objectText = readBalancedJsonObject(flightText, objectStart);
      if (!objectText) {
        from = keyIndex + key.length;
        continue;
      }

      try {
        const envelope = JSON.parse(objectText);
        const post = envelope?.pageBootstrap?.post;
        if (post?.data?.attributes) {
          const contentRef = post.data.attributes.content_json_string;
          if (typeof contentRef === "string" && /^\$[0-9a-f]+$/i.test(contentRef)) {
            const resolved = resolveRscJsonObjectReference(flightText, contentRef);
            if (resolved) post.data.attributes.content_json_string = resolved;
          }

          return {
            pageURL: pageUrl,
            ...post,
          };
        }
      } catch {
        // Keep looking; not every bootstrapEnvelope on the page is the post envelope.
      }

      from = objectStart + objectText.length;
    }

    return null;
  }

  const api = {
    extractPostId,
    extractPostDataFromNextFlight,
    decodeNextFlightPayloads,
    resolveRscJsonObjectReference,
  };

  root.PatreonPage = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
