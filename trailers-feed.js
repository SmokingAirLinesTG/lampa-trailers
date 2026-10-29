(function () {
    'use strict';

    // Лента YouTube-трейлеров по жанру: ▲▼ листать, OK — карточка фильма, Назад — выход.
    if (window.trailers_feed_plugin) return;
    window.trailers_feed_plugin = true;

    var tmdb = Lampa.Api.sources.tmdb;

    var css = '' +
        // На весь экран: bridge-плеер YouTube из Lampa кадрирует видео под размер окна.
        '.tfeed{position:fixed;left:0;top:0;width:100%;height:100%;background:#000;overflow:hidden}' +
        'body.tfeed--on .head{display:none}' +
        '.tfeed__bg,.tfeed__video,.tfeed__video iframe{position:absolute;left:0;top:0;width:100%;height:100%;border:0}' +
        '.tfeed__bg{background-size:cover;background-position:center;opacity:.35}' +
        '.tfeed__video iframe{pointer-events:none}' +
        '.tfeed__info{position:absolute;left:0;right:0;bottom:0;padding:6em 3em 2em;' +
            'background:linear-gradient(to top,rgba(0,0,0,.9),rgba(0,0,0,0))}' +
        '.tfeed__title{font-size:2.6em;font-weight:600}' +
        '.tfeed__meta{font-size:1.3em;opacity:.8;margin-top:.3em}' +
        '.tfeed__descr{font-size:1.2em;opacity:.7;margin-top:.6em;max-width:60%;' +
            'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}' +
        '.tfeed__hint{font-size:1em;opacity:.5;margin-top:1em}' +
        '.tfeed__status{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);font-size:1.4em;opacity:.7}';

    // Трейлер на языке интерфейса TMDB, иначе английский; тизер — если трейлера нет.
    function pickTrailer(results) {
        var lang = Lampa.Storage.field('tmdb_lang');
        var rank = function (v) {
            return (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 2 : 4) + (v.iso_639_1 === lang ? 0 : 1);
        };
        var yt = results.filter(function (v) { return v.site === 'YouTube' && v.key; });
        yt.sort(function (a, b) { return rank(a) - rank(b); });
        return yt[0];
    }

    function Feed(object) {
        var html = $('<div class="tfeed"><div class="tfeed__bg"></div><div class="tfeed__video"></div>' +
            '<div class="tfeed__status"></div><div class="tfeed__info"><div class="tfeed__title"></div>' +
            '<div class="tfeed__meta"></div><div class="tfeed__descr"></div>' +
            '<div class="tfeed__hint">▲▼ листать · OK — открыть фильм · Назад — выход</div></div></div>');
        var items = [];
        var index = -1;
        var dir = 1;
        var page = 0;
        var totalPages = 1;
        var loading = false;
        var waiters = [];     // кто ждёт страницу, пока она ещё грузится
        var seq = 0;          // отбрасывает ответы для фильма, с которого уже пролистали
        var bridgeId = '';
        var nextTimer;
        var self = this;

        function status(text) {
            html.find('.tfeed__status').text(text || '');
        }

        function flush(ok) {
            var w = waiters;
            waiters = [];
            w.forEach(function (f) { f(ok); });
        }

        function loadPage(done) {
            if (done) waiters.push(done);
            if (loading) return;
            if (page >= totalPages) return flush(false);
            loading = true;
            var params = { page: page + 1, sort_by: 'popularity.desc', filter: { 'vote_count.gte': 50 } };
            if (object.genre) params.genres = object.genre;
            tmdb.get('discover/movie', params, function (json) {
                loading = false;
                page = json.page || page + 1;
                totalPages = json.total_pages || page;
                items = items.concat((json.results || []).filter(function (m) { return !m.adult; }));
                flush(true);
            }, function () {
                loading = false;
                flush(false);
            });
        }

        function stopVideo() {
            clearTimeout(nextTimer);
            bridgeId = '';
            html.find('.tfeed__video').empty();
        }

        function fullscreen(on) {
            $('body').toggleClass('tfeed--on', on);
        }

        function playVideo(key) {
            stopVideo();
            bridgeId = 'tfeed_' + Math.random().toString(36).slice(2);
            var frame = document.createElement('iframe');
            frame.setAttribute('tabindex', '-1');
            frame.setAttribute('allow', 'autoplay; encrypted-media');
            frame.src = Lampa.Manifest.github_lampa + 'youtube.html?bridgeId=' + bridgeId +
                '&videoId=' + key + '&autoplay=1&controls=0&mute=0&start=0';
            html.find('.tfeed__video').append(frame);
        }

        function onMessage(event) {
            var data = event.data;
            if (!data || !bridgeId || data.bridgeId !== bridgeId) return;
            if (data.type === 'ready') status('');
            // 0 — ролик закончился; error — YouTube запретил встраивание этого ролика.
            if ((data.type === 'stateChange' && data.data && data.data.state === 0) || data.type === 'error') {
                if (data.type === 'error') status('Трейлер недоступен, листаю дальше…');
                nextTimer = setTimeout(function () { show(index + 1, 1); }, data.type === 'error' ? 1500 : 300);
            }
        }

        function info(movie) {
            var year = (movie.release_date || '').slice(0, 4);
            var genres = tmdb.getGenresNameFromIds('movie', movie.genre_ids || []).slice(0, 3).join(', ');
            var meta = [year, movie.vote_average ? '★ ' + movie.vote_average.toFixed(1) : '', genres]
                .filter(Boolean).join(' · ');
            html.find('.tfeed__title').text(movie.title || movie.original_title || '');
            html.find('.tfeed__meta').text(meta);
            html.find('.tfeed__descr').text(movie.overview || '');
            html.find('.tfeed__bg').css('background-image',
                movie.backdrop_path ? 'url(' + Lampa.Api.img(movie.backdrop_path, 'w1280') + ')' : 'none');
        }

        function show(i, direction) {
            dir = direction || dir;
            if (i < 0) return show(0, 1); // выше первого фильма без трейлера — разворачиваемся вниз
            if (i >= items.length) {
                return loadPage(function (ok) {
                    if (ok && i < items.length) show(i, dir);
                    else status('Трейлеры в этом жанре закончились');
                });
            }
            if (i >= items.length - 3) loadPage();

            index = i;
            var movie = items[i];
            var my = ++seq;
            stopVideo();
            info(movie);
            status('Загрузка трейлера…');

            var go = function (video) {
                if (my !== seq) return;
                if (video) playVideo(video.key);
                else show(index + dir, dir); // у фильма нет трейлера на YouTube — пропускаем в ту же сторону
            };
            if (movie.tfeed_video !== undefined) return go(movie.tfeed_video);
            tmdb.videos({ method: 'movie', id: movie.id }, function (json) {
                movie.tfeed_video = pickTrailer(json.results || []) || null;
                go(movie.tfeed_video);
            }, function () {
                movie.tfeed_video = null;
                go(null);
            });
        }

        this.create = function () {
            this.activity.loader(true);
            window.addEventListener('message', onMessage);
            loadPage(function (ok) {
                self.activity.loader(false);
                if (ok && items.length) show(0, 1);
                else status('Не удалось загрузить фильмы');
                self.activity.toggle();
            });
            return this.render();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () { Lampa.Controller.clear(); },
                up: function () { if (index > 0) show(index - 1, -1); },
                down: function () { show(index + 1, 1); },
                left: function () { Lampa.Controller.toggle('menu'); },
                enter: function () {
                    var movie = items[index];
                    if (!movie) return;
                    Lampa.Activity.push({ url: '', component: 'full', id: movie.id, method: 'movie', card: movie, source: 'tmdb' });
                },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
            fullscreen(true);
            // Вернулись из карточки фильма — продолжаем с того же трейлера.
            if (index >= 0 && !bridgeId && items[index] && items[index].tfeed_video) playVideo(items[index].tfeed_video.key);
        };

        this.pause = function () { stopVideo(); fullscreen(false); };
        this.stop = function () { stopVideo(); fullscreen(false); };
        this.render = function () { return html; };
        this.destroy = function () {
            seq++;
            stopVideo();
            fullscreen(false);
            window.removeEventListener('message', onMessage);
            html.remove();
        };
    }

    function openGenres() {
        var items = [{ title: 'Популярное', genre: 0 }].concat(tmdb.genres.movie.map(function (g) {
            return { title: Lampa.Utils.capitalizeFirstLetter(Lampa.Lang.translate(g.title)), genre: g.id };
        }));
        Lampa.Select.show({
            title: 'Лента трейлеров',
            items: items,
            onSelect: function (a) {
                Lampa.Activity.push({ url: '', title: 'Трейлеры: ' + a.title, component: 'trailers_feed', genre: a.genre, page: 1 });
            },
            onBack: function () { Lampa.Controller.toggle('menu'); }
        });
    }

    function start() {
        $('head').append('<style>' + css + '</style>');
        Lampa.Component.add('trailers_feed', Feed);
        var icon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        if (Lampa.Menu.addButton) {
            Lampa.Menu.addButton(icon, 'Лента трейлеров', openGenres);
        } else {
            var item = $('<li class="menu__item selector"><div class="menu__ico">' + icon + '</div><div class="menu__text">Лента трейлеров</div></li>');
            item.on('hover:enter', openGenres);
            $('.menu .menu__list').eq(0).append(item);
        }
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
