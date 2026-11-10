(() => {
  const selected = new URLSearchParams(window.location.search).get('theme');
  document.documentElement.dataset.theme = selected === 'light' ? 'light' : 'dark';
})();
