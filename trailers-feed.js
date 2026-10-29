(function () {
    'use strict';

    // Загрузчик: GitHub Pages и WebView держат этот файл в кеше до 10 минут,
    // а основной код берётся свежим, поэтому обновления доходят сразу.
    var src = (document.currentScript && document.currentScript.src) ||
        'https://smokingairlinestg.github.io/lampa-trailers/trailers-feed.js';
    var script = document.createElement('script');
    script.src = src.split('?')[0].replace(/[^/]*$/, '') + 'feed.js?v=' + Date.now();
    document.head.appendChild(script);
})();
