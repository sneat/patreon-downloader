if (window.patreon.bootstrap) {
  document.dispatchEvent(new CustomEvent('pd-bootstrap-data', { detail: window.patreon.bootstrap }));
} else {
  console.error('Patreon Downloader | Failed to find Patreon bootstrap data.')
}
