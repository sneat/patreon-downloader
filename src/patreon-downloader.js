const data = JSON.parse(document.getElementById("__NEXT_DATA__")?.innerText);
if (data?.props?.pageProps?.bootstrapEnvelope?.pageBootstrap) {
  document.dispatchEvent(new CustomEvent('pd-bootstrap-data', { detail: data.props.pageProps.bootstrapEnvelope.pageBootstrap }));
} else {
  console.error('Patreon Downloader | Failed to find Patreon bootstrap data.')
}