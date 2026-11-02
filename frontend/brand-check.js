'use strict';
/* Shared brand matching. Single implementation used by both the classic and React apps.
   A configured brand (one or more words) must appear as consecutive tokens in the word. */
function brandHit(word, configuredText) {
  const tokens = String(word || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const configured = String(configuredText || '').toLowerCase().split(/[,，\n]+/);
  return configured.some((brand) => {
    const parts = brand.match(/[a-z0-9]+/g) || [];
    return parts.length > 0 && tokens.some((_, start) => parts.every((part, i) => tokens[start + i] === part));
  });
}
window.brandHit = brandHit;
if (typeof module !== 'undefined') module.exports = { brandHit };
