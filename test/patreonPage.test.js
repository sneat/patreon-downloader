const assert = require("node:assert/strict");
const { test } = require("node:test");

const { extractPostId, extractPostDataFromNextFlight } = require("../src/js/patreonPage.js");

test("extractPostId reads the id from the post page URL", () => {
  assert.equal(extractPostId("https://www.patreon.com/posts/some-title-167916041"), "167916041");
});

test("extractPostId falls back to the canonical URL", () => {
  assert.equal(
    extractPostId("https://www.patreon.com/", "https://www.patreon.com/posts/title-167916041"),
    "167916041",
  );
});

test("extractPostId accepts the meta-image marker in page HTML", () => {
  const html = '<meta content="https://www.patreon.com/meta-image/post/167916041">';
  assert.equal(extractPostId("https://www.patreon.com/c/creator", "", html), "167916041");
});

test("extractPostId ignores post links in a feed page's HTML", () => {
  // Regression: matching /posts/ anywhere in the source made a creator page
  // report an unrelated post from the sidebar.
  const html = '<a href="https://www.patreon.com/posts/other-post-999888777">Other</a>';
  assert.equal(extractPostId("https://www.patreon.com/c/creator", "", html), null);
});

test("extractPostDataFromNextFlight pulls the post out of the RSC bootstrap", () => {
  const envelope = {
    pageBootstrap: {
      post: { data: { id: "1", attributes: { title: "Hi", content_json_string: "$64" } } },
    },
  };
  const html = [
    `<script>self.__next_f.push([1,${JSON.stringify(`0:{"bootstrapEnvelope":${JSON.stringify(envelope)}}\n`)}])</script>`,
    `<script>self.__next_f.push([1,${JSON.stringify('64:T1f,{"type":"doc","content":[]}\n')}])</script>`,
  ].join("");

  const post = extractPostDataFromNextFlight(html, "https://www.patreon.com/posts/hi-1");

  assert.equal(post.pageURL, "https://www.patreon.com/posts/hi-1");
  assert.equal(post.data.attributes.title, "Hi");
  assert.equal(post.data.attributes.content_json_string, '{"type":"doc","content":[]}');
});

test("extractPostDataFromNextFlight returns null when there is no bootstrap", () => {
  assert.equal(extractPostDataFromNextFlight("<html></html>", "https://x/"), null);
});
