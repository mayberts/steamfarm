'use strict';
// Loaded in <head> so the saved theme applies before the page is drawn.
(function () {
  var KEY = 'steamfarm-theme';
  function read() {
    try {
      return localStorage.getItem(KEY) || '';
    } catch (e) {
      return '';
    }
  }
  function apply(theme) {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }
  apply(read());

  document.addEventListener('DOMContentLoaded', function () {
    var select = document.getElementById('theme-select');
    if (!select) return;
    select.value = read();
    select.addEventListener('change', function () {
      apply(select.value);
      try {
        if (select.value) localStorage.setItem(KEY, select.value);
        else localStorage.removeItem(KEY);
      } catch (e) {
        // Storage blocked: the theme still applies until the page is reloaded.
      }
    });
  });
})();
