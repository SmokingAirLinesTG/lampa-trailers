(function () {
    'use strict';

    // Лента YouTube-трейлеров фильмов и сериалов по жанру:
    // ▲▼ листать, OK — карточка, → — Фильмы/Сериалы и жанр, ← — меню Lampa, Назад — выход.
    // Плееры — официальный YouTube IFrame API прямо в странице Lampa. Если YouTube отказывает
    // такой странице (ошибка 153: у неё нет адреса-источника), лента переходит на yt.html.
    if (window.trailers_feed_plugin) return;
    window.trailers_feed_plugin = true;

    var tmdb = Lampa.Api.sources.tmdb;
    var TYPES = { movie: 'Фильмы', tv: 'Сериалы' };
    var AHEAD = 3;          // следующих постеров в колонке справа
    var META_AHEAD = 10;    // для скольких следующих заранее узнать трейлер, логотип и загрузить картинки
    // Живых плееров впереди: каждый — YouTube-iframe на десятки МБ, а у ТВ 1,8 ГБ и один-два видеодекодера.
    var LIVE_AHEAD = 2;
    var LOAD_TIMEOUT = 15000;
    var DEBUG = true;       // временно: показывать в плашке, сколько следующего ролика уже в буфере
    var BASE = ((document.currentScript && document.currentScript.src) ||
        'https://smokingairlinestg.github.io/lampa-trailers/feed.js').split('?')[0].replace(/[^/]*$/, '');
    var bridgeMode = false; // true — YouTube отказал странице Lampa, играем через yt.html без предзагрузки

    var css = '' +
        '.tfeed{position:fixed;left:0;top:0;width:100%;height:100%;background:#000;overflow:hidden}' +
        'body.tfeed--on .head{display:none}' +
        '.tfeed__bg,.tfeed__video,.tfeed__yt{position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden}' +
        '.tfeed__bg{background-size:cover;background-position:center;opacity:.35}' +
        // Плеер вдвое больше и сдвинут на 300px: YouTube берёт качество под большой плеер,
        // а его панели сверху и снизу остаются за краем экрана.
        '.tfeed__yt iframe{position:absolute;left:0;top:-300px;border:0;transform-origin:left top;transform:scale(.5);pointer-events:none}' +
        '.tfeed__yt.tfeed__pre{opacity:0}' +
        '.tfeed__frame{position:absolute;left:0;top:0;width:100%;height:100%;border:0;pointer-events:none}' +
        '.tfeed__chip{position:absolute;left:3em;top:2em;padding:.4em .9em;border-radius:1em;' +
            'background:rgba(0,0,0,.55);font-size:1.1em}' +
        '.tfeed__side{position:absolute;right:2.5em;top:50%;transform:translateY(-50%)}' +
        '.tfeed__poster{width:6em;height:9em;margin:.7em 0;border-radius:.5em;background-color:#222;' +
            'background-size:cover;background-position:center;opacity:.55}' +
        '.tfeed__poster--now{opacity:1;box-shadow:0 0 0 .2em #fff}' +
        '.tfeed__info{position:absolute;left:0;right:0;bottom:0;padding:6em 12em 2em 3em;' +
            'background:linear-gradient(to top,rgba(0,0,0,.9),rgba(0,0,0,0))}' +
        '.tfeed__logo{display:block;max-width:28em;max-height:7em;margin-bottom:.4em}' +
        '.tfeed__title{font-size:2.6em;font-weight:600}' +
        '.tfeed__title--small{font-size:1.5em;opacity:.85}' +
        '.tfeed__meta{font-size:1.3em;opacity:.8;margin-top:.3em}' +
        '.tfeed__descr{font-size:1.2em;opacity:.7;margin-top:.6em;max-width:70%;' +
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

    // Логотип на языке интерфейса, иначе английский, иначе без текста.
    function pickLogo(logos) {
        var order = [Lampa.Storage.field('tmdb_lang'), 'en', null];
        for (var i = 0; i < order.length; i++) {
            var lang = order[i];
            var found = logos.filter(function (l) { return l.iso_639_1 === lang; })[0];
            if (found) return found;
        }
        return logos[0];
    }

    function genreTitle(type, id) {
        if (!id) return 'Популярное';
        var g = tmdb.genres[type].filter(function (x) { return x.id === id; })[0];
        return g ? Lampa.Utils.capitalizeFirstLetter(Lampa.Lang.translate(g.title)) : '';
    }

    // YouTube API мог уже подгрузить сам Lampa: не трогаем его onYouTubeIframeAPIReady, а ждём YT.Player.
    function loadYT(cb) {
        if (window.YT && window.YT.Player) return cb(true);
        if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
            var s = document.createElement('script');
            s.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(s);
        }
        var waited = 0;
        var timer = setInterval(function () {
            waited += 100;
            if (window.YT && window.YT.Player) {
                clearInterval(timer);
                cb(true);
            } else if (waited >= LOAD_TIMEOUT) {
                clearInterval(timer);
                cb(false);
            }
        }, 100);
    }

    function Feed(object) {
        var html = $('<div class="tfeed"><div class="tfeed__bg"></div><div class="tfeed__video"></div>' +
            '<div class="tfeed__status"></div><div class="tfeed__chip"></div><div class="tfeed__side"></div>' +
            '<div class="tfeed__info"><img class="tfeed__logo"><div class="tfeed__title"></div>' +
            '<div class="tfeed__meta"></div><div class="tfeed__descr"></div>' +
            '<div class="tfeed__hint">▲▼ листать · OK — открыть · → жанры · Назад — выход</div></div></div>');
        var type, genre, items, index, dir, page, totalPages, loading, waiters;
        var feedGen = 0;      // отбрасывает страницы прежнего жанра, если его сменили во время загрузки
        var seq = 0;          // отбрасывает ответы для фильма, с которого уже пролистали
        var players = [];     // текущий и предзагруженные: {item, el, yt, ready, buffered, wantPlay}
        var cur = null;       // плеер, который сейчас на экране
        var frameId = '';     // yt.html в режиме bridgeMode
        var nextTimer, watchdog, debugTimer;
        var tPress = 0;       // отладка: когда нажали ▲▼, чтобы мерить время до старта
        var lastStart = '';   // отладка: итог последнего переключения
        var self = this;

        function status(text) {
            html.find('.tfeed__status').text(text || '');
        }

        function chip() {
            return TYPES[type] + ' · ' + genreTitle(type, genre);
        }

        function reset(newType, newGenre) {
            type = newType;
            genre = newGenre;
            Lampa.Storage.set('tfeed_type', type);
            Lampa.Storage.set('tfeed_genre', genre);
            items = [];
            index = -1;
            dir = 1;
            page = 0;
            totalPages = 1;
            loading = false;
            waiters = [];
            feedGen++;
            seq++;
            stopAll();
            html.find('.tfeed__side').empty();
            html.find('.tfeed__chip').text(chip());
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
            var gen = feedGen;
            var params = { page: page + 1, sort_by: 'popularity.desc', filter: { 'vote_count.gte': 50 } };
            if (genre) params.genres = genre;
            // Новости и ток-шоу — не то, что листают ради трейлеров.
            if (type === 'tv' && !genre) params.filter.without_genres = '10763,10767';
            tmdb.get('discover/' + type, params, function (json) {
                if (gen !== feedGen) return;
                loading = false;
                page = json.page || page + 1;
                totalPages = json.total_pages || page;
                items = items.concat((json.results || []).filter(function (m) { return !m.adult; }));
                flush(true);
            }, function () {
                if (gen !== feedGen) return;
                loading = false;
                flush(false);
            });
        }

        // Ждущие одного запроса копятся в item[key + '_wait'], результат кладётся в item[key].
        function cached(item, key, request, cb) {
            if (item[key] !== undefined) return cb(item[key]);
            if (item[key + '_wait']) return item[key + '_wait'].push(cb);
            item[key + '_wait'] = [cb];
            request(function (value) {
                item[key] = value || null;
                var w = item[key + '_wait'];
                item[key + '_wait'] = null;
                w.forEach(function (f) { f(item[key]); });
            });
        }

        function ensureVideo(item, cb) {
            var t = type;
            cached(item, 'tfeed_video', function (done) {
                tmdb.videos({ method: t, id: item.id }, function (json) {
                    done(pickTrailer(json.results || []));
                }, function () { done(null); });
            }, cb);
        }

        function ensureLogo(item, cb) {
            var t = type;
            cached(item, 'tfeed_logo', function (done) {
                var langs = Lampa.Storage.field('tmdb_lang') + ',en,null';
                tmdb.get(t + '/' + item.id + '/images', { filter: { include_image_language: langs } }, function (json) {
                    var logo = json.logos && json.logos.length ? pickLogo(json.logos) : null;
                    done(logo ? Lampa.Api.img(logo.file_path, 'w500') : null);
                }, function () { done(null); });
            }, cb);
        }

        function fullscreen(on) {
            $('body').toggleClass('tfeed--on', on);
        }

        function findPlayer(item) {
            return players.filter(function (p) { return p.item === item; })[0];
        }

        function sizeFrame(p) {
            var frame = p.yt && p.yt.getIframe && p.yt.getIframe();
            if (!frame) return;
            frame.setAttribute('tabindex', '-1');
            frame.style.width = window.innerWidth * 2 + 'px';
            frame.style.height = (window.innerHeight + 600) * 2 + 'px';
        }

        function startSound(p) {
            p.yt.unMute();
            p.yt.setVolume(100);
            p.yt.playVideo(); // без перемотки в начало: seekTo заставил бы YouTube заново наполнять буфер
        }

        // preload: играем без звука до первого кадра, ставим паузу и ждём — ролик уже в буфере.
        function makePlayer(item, preload) {
            var p = { item: item, ready: false, buffered: false, wantPlay: !preload };
            p.el = $('<div class="tfeed__yt"><div></div></div>').toggleClass('tfeed__pre', preload);
            html.find('.tfeed__video').append(p.el);
            var vars = { autoplay: 1, mute: preload ? 1 : 0, controls: 0, rel: 0, modestbranding: 1, playsinline: 1,
                iv_load_policy: 3, disablekb: 1, fs: 0, enablejsapi: 1 };
            if (/^https?:/.test(location.origin)) vars.origin = location.origin;
            p.yt = new window.YT.Player(p.el.children()[0], {
                videoId: item.tfeed_video.key,
                width: '100%',
                height: '100%',
                playerVars: vars,
                events: {
                    onReady: function () {
                        p.ready = true;
                        sizeFrame(p);
                        if (preload && p.wantPlay) startSound(p);
                        onPlayer(p, 'ready');
                    },
                    onStateChange: function (e) {
                        if (preload && !p.buffered && !p.wantPlay && e.data === window.YT.PlayerState.PLAYING) {
                            p.buffered = true;
                            p.tBuffered = Date.now();
                            p.yt.pauseVideo();
                            return;
                        }
                        if (DEBUG && p.tPromote && !p.started) {
                            p.path.push(e.data);
                            if (e.data === window.YT.PlayerState.PLAYING) {
                                p.started = true;
                                lastStart = 'старт ' + (Date.now() - p.tPromote) + ' мс' +
                                    (p.tBuffered ? ', ждал ' + Math.round((p.tPromote - p.tBuffered) / 1000) + ' с' : ', без буфера') +
                                    ', путь ' + p.path.join('→');
                            }
                        }
                        onPlayer(p, 'state', e.data);
                    },
                    onError: function (e) { onPlayer(p, 'error', e.data); }
                }
            });
            sizeFrame(p);
            players.push(p);
            return p;
        }

        function killPlayer(p) {
            if (p === cur) {
                cur = null;
                clearTimeout(nextTimer);
                clearTimeout(watchdog);
            }
            try { p.yt.destroy(); } catch (e) {}
            p.el.remove();
            players.splice(players.indexOf(p), 1);
        }

        function stopAll() {
            players.slice().forEach(killPlayer);
            clearTimeout(nextTimer);
            clearTimeout(watchdog);
            frameId = '';
            html.find('.tfeed__frame').remove();
        }

        // Держим живыми текущий и LIVE_AHEAD следующих с трейлером, остальные выгружаем.
        function plan() {
            if (bridgeMode || index < 0 || !items[index] || !window.YT || !window.YT.Player) return;
            var keep = [items[index]];
            for (var i = index + 1; i < items.length && keep.length <= LIVE_AHEAD; i++) {
                var v = items[i].tfeed_video;
                if (v === undefined) {
                    ensureVideo(items[i], plan); // узнаем — и спланируем заново
                    break;
                }
                if (v) keep.push(items[i]);
            }
            players.slice().forEach(function (p) {
                if (keep.indexOf(p.item) < 0) killPlayer(p);
            });
            keep.slice(1).forEach(function (item) {
                if (!findPlayer(item)) makePlayer(item, true);
            });
        }

        function watch(my) {
            clearTimeout(watchdog);
            watchdog = setTimeout(function () {
                if (my === seq) status('YouTube не отвечает · проверьте интернет или пролистайте дальше');
            }, LOAD_TIMEOUT);
        }

        function playItem(item) {
            var my = seq;
            if (bridgeMode) return playFrame(item);
            loadYT(function (ok) {
                if (my !== seq) return;
                if (!ok) {
                    bridgeMode = true;
                    return playFrame(item);
                }
                var p = findPlayer(item);
                if (p) {
                    p.tPromote = tPress;
                    p.path = [];
                    p.el.removeClass('tfeed__pre');
                    p.wantPlay = true;
                    if (p.ready) startSound(p);
                } else {
                    p = makePlayer(item, false);
                    p.tPromote = tPress;
                    p.path = [];
                }
                cur = p;
                status(p.ready ? '' : 'Загрузка трейлера…');
                if (!p.ready) watch(my);
                plan();
            });
        }

        function onPlayer(p, type, value) {
            if (type === 'error') {
                // 153 — YouTube не принимает страницу Lampa как источник: дальше играем через yt.html.
                if (value === 153) {
                    bridgeMode = true;
                    var item = cur === p ? p.item : null;
                    players.slice().forEach(killPlayer);
                    if (item && items[index] === item) playFrame(item);
                    return;
                }
                // Встраивание этого ролика запрещено: фильм больше не предлагаем.
                p.item.tfeed_video = null;
                renderSide();
            }
            if (p !== cur) {
                if (type === 'error') {
                    killPlayer(p);
                    plan();
                }
                return;
            }
            if (type === 'ready') {
                clearTimeout(watchdog);
                status('');
            }
            // 0 — ролик закончился.
            if ((type === 'state' && value === 0) || type === 'error') {
                if (type === 'error') status('Трейлер недоступен, листаю дальше…');
                nextTimer = setTimeout(function () { show(index + 1, 1); }, type === 'error' ? 1500 : 300);
            }
        }

        function playFrame(item) {
            frameId = 'tfeed_' + Math.random().toString(36).slice(2);
            html.find('.tfeed__video').append($('<iframe class="tfeed__frame" tabindex="-1" allow="autoplay; encrypted-media"></iframe>')
                .attr('src', BASE + 'yt.html?id=' + frameId + '&v=' + encodeURIComponent(item.tfeed_video.key) + '&preload=0'));
            status('Загрузка трейлера…');
            watch(seq);
        }

        function onMessage(event) {
            var data = event.data;
            if (!data || !frameId || data.bridgeId !== frameId) return;
            if (data.type === 'ready') {
                clearTimeout(watchdog);
                status('');
            }
            if ((data.type === 'stateChange' && data.data && data.data.state === 0) || data.type === 'error') {
                if (data.type === 'error') status('Трейлер недоступен, листаю дальше…');
                nextTimer = setTimeout(function () { show(index + 1, 1); }, data.type === 'error' ? 1500 : 300);
            }
        }

        // Временно, для проверки предзагрузки на ТВ: сколько следующего ролика уже скачано.
        function debugTick() {
            var next = players.filter(function (p) { return p !== cur; })[0];
            var text = chip();
            if (next) {
                var loaded = next.ready && next.yt.getVideoLoadedFraction ? Math.round(next.yt.getVideoLoadedFraction() * 100) : 0;
                text += ' · след.: ' + (next.buffered ? 'в буфере ' + loaded + '%' : next.ready ? 'готовится' : 'загрузка');
            }
            if (lastStart) text += ' · ' + lastStart;
            html.find('.tfeed__chip').text(text);
        }

        // Текущий постер и следующие, у которых трейлер есть или ещё не проверен.
        function renderSide() {
            var side = html.find('.tfeed__side').empty();
            for (var i = index, shown = 0; i < items.length && shown <= AHEAD; i++) {
                if (i > index && items[i].tfeed_video === null) continue;
                var poster = items[i].poster_path ? 'url(' + Lampa.Api.img(items[i].poster_path, 'w200') + ')' : 'none';
                side.append($('<div class="tfeed__poster"></div>')
                    .toggleClass('tfeed__poster--now', i === index).css('background-image', poster));
                shown++;
            }
        }

        // Заранее: трейлер (чтобы пустые не попадали в колонку), логотип и картинки — при листании всё уже есть.
        function prefetch() {
            for (var i = index + 1; i < Math.min(items.length, index + 1 + META_AHEAD); i++) {
                var item = items[i];
                ensureVideo(item, renderSide);
                ensureLogo(item, function (url) { if (url) new Image().src = url; });
                if (!item.tfeed_warm) {
                    item.tfeed_warm = true;
                    if (item.poster_path) new Image().src = Lampa.Api.img(item.poster_path, 'w200');
                    if (item.backdrop_path) new Image().src = Lampa.Api.img(item.backdrop_path, 'w1280');
                }
            }
        }

        function info(item) {
            var date = item.release_date || item.first_air_date || '';
            var genres = tmdb.getGenresNameFromIds(type, item.genre_ids || []).slice(0, 3).join(', ');
            var meta = [date.slice(0, 4), item.vote_average ? '★ ' + item.vote_average.toFixed(1) : '', genres]
                .filter(Boolean).join(' · ');
            var title = html.find('.tfeed__title').text(item.title || item.name || item.original_title || item.original_name || '')
                .removeClass('tfeed__title--small');
            var logo = html.find('.tfeed__logo').hide().removeAttr('src');
            html.find('.tfeed__meta').text(meta);
            html.find('.tfeed__descr').text(item.overview || '');
            html.find('.tfeed__bg').css('background-image',
                item.backdrop_path ? 'url(' + Lampa.Api.img(item.backdrop_path, 'w1280') + ')' : 'none');
            ensureLogo(item, function (url) {
                if (items[index] !== item || !url) return;
                logo.attr('src', url).show();
                title.addClass('tfeed__title--small');
            });
        }

        function show(i, direction) {
            dir = direction || dir;
            if (i < 0) return show(0, 1); // выше первого без трейлера — разворачиваемся вниз
            if (i >= items.length) {
                return loadPage(function (ok) {
                    if (ok && i < items.length) show(i, dir);
                    else status(TYPES[type] + ' в этом жанре закончились');
                });
            }
            if (i >= items.length - META_AHEAD) loadPage();

            index = i;
            var item = items[i];
            var my = ++seq;
            tPress = Date.now();
            // Прошлый ролик выгружаем сразу, чтобы не звучал поверх следующего.
            if (cur && cur.item !== item) killPlayer(cur);
            frameId = '';
            html.find('.tfeed__frame').remove();
            info(item);
            renderSide();
            status(findPlayer(item) ? '' : 'Загрузка трейлера…');
            ensureVideo(item, function (trailer) {
                if (my !== seq) return;
                if (trailer) playItem(item);
                else show(index + dir, dir); // нет трейлера на YouTube — пропускаем в ту же сторону
            });
            prefetch();
        }

        function begin(done) {
            self.activity.loader(true);
            loadPage(function (ok) {
                self.activity.loader(false);
                if (ok && items.length) show(0, 1);
                else status('Не удалось загрузить список');
                if (done) done();
            });
        }

        function openPanel() {
            var list = ['movie', 'tv'].map(function (t) {
                return { title: TYPES[t] + (t === type ? '  ✓' : ''), tfeed_type: t };
            });
            list.push({ title: 'Жанр', separator: true });
            [{ id: 0 }].concat(tmdb.genres[type]).forEach(function (g) {
                // Галочку у выбранного жанра Lampa ставит сама (selected).
                list.push({ title: genreTitle(type, g.id), tfeed_genre: g.id, selected: g.id === genre });
            });
            Lampa.Select.show({
                title: 'Лента трейлеров',
                items: list,
                onSelect: function (a) {
                    Lampa.Controller.toggle('content');
                    if (a.tfeed_type) {
                        if (a.tfeed_type === type) return;
                        // Общие жанры (комедия, драма…) сохраняем, остальные — «Популярное».
                        var keep = tmdb.genres[a.tfeed_type].some(function (g) { return g.id === genre; });
                        reset(a.tfeed_type, keep ? genre : 0);
                    } else {
                        if (a.tfeed_genre === genre) return;
                        reset(type, a.tfeed_genre);
                    }
                    begin();
                },
                onBack: function () { Lampa.Controller.toggle('content'); }
            });
        }

        this.create = function () {
            window.addEventListener('message', onMessage);
            html.find('.tfeed__logo').on('error', function () {
                $(this).hide();
                html.find('.tfeed__title').removeClass('tfeed__title--small');
            });
            reset(TYPES[object.type] ? object.type : 'movie', object.genre || 0);
            begin(function () { self.activity.toggle(); });
            return this.render();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () { Lampa.Controller.clear(); },
                up: function () { if (index > 0) show(index - 1, -1); },
                down: function () { show(index + 1, 1); },
                left: function () { Lampa.Controller.toggle('menu'); },
                right: openPanel,
                enter: function () {
                    var item = items[index];
                    if (!item) return;
                    Lampa.Activity.push({ url: '', component: 'full', id: item.id, method: type, card: item, source: 'tmdb' });
                },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
            fullscreen(true);
            if (DEBUG) {
                clearInterval(debugTimer);
                debugTimer = setInterval(debugTick, 1000);
            }
            // Вернулись из карточки — продолжаем с того же трейлера.
            if (index >= 0 && !cur && !frameId && items[index] && items[index].tfeed_video) playItem(items[index]);
        };

        // В карточке плееры не нужны: выгружаем все (и отдаём видеодекодер), по возвращении start() поднимет заново.
        this.pause = function () { seq++; stopAll(); clearInterval(debugTimer); fullscreen(false); };
        this.stop = function () { seq++; stopAll(); clearInterval(debugTimer); fullscreen(false); };
        this.render = function () { return html; };
        this.destroy = function () {
            seq++;
            feedGen++;
            stopAll();
            clearInterval(debugTimer);
            fullscreen(false);
            window.removeEventListener('message', onMessage);
            html.remove();
        };
    }

    function openFeed() {
        Lampa.Activity.push({
            url: '', title: 'Лента трейлеров', component: 'trailers_feed', page: 1,
            type: Lampa.Storage.get('tfeed_type', 'movie'), genre: parseInt(Lampa.Storage.get('tfeed_genre', 0), 10) || 0
        });
    }

    function start() {
        $('head').append('<style>' + css + '</style>');
        Lampa.Component.add('trailers_feed', Feed);
        var icon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        if (Lampa.Menu.addButton) {
            Lampa.Menu.addButton(icon, 'Лента трейлеров', openFeed);
        } else {
            var item = $('<li class="menu__item selector"><div class="menu__ico">' + icon + '</div><div class="menu__text">Лента трейлеров</div></li>');
            item.on('hover:enter', openFeed);
            $('.menu .menu__list').eq(0).append(item);
        }
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
