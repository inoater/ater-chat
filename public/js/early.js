/* Runs before first paint: switches on OBS overlay mode (?overlay or #/overlay). */
(function(){var q=new URLSearchParams(location.search);if(q.has('overlay')||/^#\/overlay/.test(location.hash))document.documentElement.classList.add('ov')})()
