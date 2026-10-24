/*
 * NovMox — catálogo de películas, series y canales pensado para la tele.
 * Sin dependencias ni compilación: se sirve tal cual (GitHub Pages, Netlify, etc.).
 * Se evita sintaxis muy nueva (?. ??) para que corra en navegadores de Smart TV.
 */
(function () {
  'use strict';

  var LS_PROPIOS = 'novmox.propios';
  var LS_TMDB = 'novmox.tmdb';
  var TMDB_API = 'https://api.themoviedb.org/3/';
  var TMDB_IMG = 'https://image.tmdb.org/t/p/';
  var HLS_JS = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
  var QR_JS = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

  var TIPOS = {
    peliculas: 'Películas',
    series: 'Series',
    envivo: 'TV en vivo',
    deportes: 'Deportes',
    infantil: 'Infantil'
  };
  var EN_VIVO = { envivo: true, deportes: true };

  var state = {
    catalogo: [],
    propios: [],
    compartido: null,
    heroIdx: 0,
    heroTimer: null,
    focoPrevio: null,
    hls: null,
    editando: null,
    tmdbRes: []
  };

  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('ver');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('ver'); }, 2600);
  }

  /* ---------- Datos ---------- */

  function cargarPropios() {
    try {
      var raw = localStorage.getItem(LS_PROPIOS);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function guardarPropios() {
    try {
      localStorage.setItem(LS_PROPIOS, JSON.stringify(state.propios));
    } catch (e) {
      toast('No se pudo guardar en este navegador');
    }
  }

  function todos() {
    var ids = {};
    var lista = [];
    // Lo propio tiene prioridad: así puedes "editar" algo del catálogo general
    state.propios.concat(state.catalogo).forEach(function (it) {
      if (!it || !it.id || ids[it.id]) return;
      ids[it.id] = true;
      lista.push(it);
    });
    return lista;
  }

  function buscarItem(id) {
    if (state.compartido && state.compartido.id === id) return state.compartido;
    var l = todos();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  function esPropio(id) {
    return state.propios.some(function (p) { return p.id === id; });
  }

  function porTipo(tipo) {
    return todos().filter(function (it) { return it.tipo === tipo; });
  }

  function cargarCatalogo() {
    return fetch('data/catalogo.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (d) { return Array.isArray(d) ? d : []; })
      .catch(function () { return []; });
  }

  /* Codifica una ficha completa en el enlace, así tus amigos la ven aunque no esté en el catálogo publicado */
  function codificar(item) {
    var limpio = {};
    ['id', 'titulo', 'tipo', 'anio', 'descripcion', 'poster', 'fondo', 'video', 'episodios'].forEach(function (k) {
      if (item[k] != null && item[k] !== '') limpio[k] = item[k];
    });
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(limpio))));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodificar(txt) {
    try {
      var b64 = txt.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var obj = JSON.parse(decodeURIComponent(escape(atob(b64))));
      return obj && obj.titulo ? obj : null;
    } catch (e) { return null; }
  }

  function urlBase() {
    return location.href.split('#')[0];
  }

  /* ---------- Piezas visuales ---------- */

  function posterGenerado(item) {
    var h = hashStr(item.titulo || item.id || 'x') % 360;
    var bg = EN_VIVO[item.tipo]
      ? 'radial-gradient(circle at 50% 120%, hsl(' + h + ',70%,38%), hsl(' + ((h + 40) % 360) + ',60%,14%) 70%)'
      : 'linear-gradient(160deg, hsl(' + h + ',65%,42%), hsl(' + ((h + 50) % 360) + ',60%,16%))';
    return '<div class="poster-gen" style="background:' + bg + '">' + esc(item.titulo) + '</div>';
  }

  /* Imagen de fondo con degradado de respaldo por si el enlace falla */
  function fondoCss(item) {
    var h = hashStr(item.titulo || '') % 360;
    var degradado = 'linear-gradient(120deg, hsl(' + h + ',60%,30%), hsl(' + ((h + 60) % 360) + ',60%,12%))';
    var url = item.fondo || item.poster;
    return url ? 'url("' + url.replace(/"/g, '%22') + '"), ' + degradado : degradado;
  }

  function imagen(url, alt) {
    if (!url) return '';
    return '<img loading="lazy" src="' + esc(url) + '" alt="' + esc(alt || '') + '" onerror="this.parentNode.removeChild(this)">';
  }

  function tarjeta(item) {
    var vivo = !!EN_VIVO[item.tipo];
    var sub = vivo
      ? '<span class="punto-vivo"></span>' + esc(TIPOS[item.tipo])
      : esc([item.anio, item.episodios && item.episodios.length ? item.episodios.length + ' episodios' : ''].filter(Boolean).join(' · '));
    return '<button class="tarjeta focusable' + (vivo ? ' vivo' : '') + '" type="button" data-id="' + esc(item.id) + '">' +
      '<div class="poster">' +
        posterGenerado(item) +
        imagen(vivo ? (item.fondo || item.poster) : (item.poster || item.fondo), item.titulo) +
        (vivo ? '<span class="badge-vivo">EN VIVO</span>' : '') +
        (esPropio(item.id) ? '<span class="badge-mio">MÍO</span>' : '') +
      '</div>' +
      '<div class="tarjeta-titulo">' + esc(item.titulo) + '</div>' +
      '<div class="tarjeta-sub">' + sub + '</div>' +
    '</button>';
  }

  function fila(titulo, items, ruta) {
    if (!items.length) return '';
    return '<section class="fila">' +
      '<div class="fila-cab"><h2>' + esc(titulo) + '</h2>' +
        (ruta ? '<a class="ver-todo focusable" href="#/' + ruta + '">Ver todo ›</a>' : '') +
      '</div>' +
      '<div class="carril">' + items.map(tarjeta).join('') + '</div>' +
    '</section>';
  }

  function vacio(texto) {
    return '<div class="vacio">' + texto + ' <a class="focusable" href="#/mis">Agregar ahora</a></div>';
  }

  /* ---------- Vistas ---------- */

  function vistaInicio() {
    var lista = todos();
    var destacados = lista.filter(function (i) { return i.destacado; });
    if (!destacados.length) destacados = lista.filter(function (i) { return !EN_VIVO[i.tipo]; }).slice(0, 5);

    var html = '';
    if (destacados.length) {
      html += '<section class="hero" id="hero">' +
        '<div class="hero-fondo" id="hero-fondo"></div>' +
        '<div class="hero-info" id="hero-info"></div>' +
        '<div class="puntos">' + destacados.map(function (_, i) { return '<span class="punto"></span>'; }).join('') + '</div>' +
      '</section>';
    }

    var vivos = porTipo('envivo').concat(porTipo('deportes'));
    html += fila('En vivo', vivos, 'envivo');
    html += fila('Películas populares', porTipo('peliculas'), 'peliculas');
    html += fila('Series', porTipo('series'), 'series');
    html += fila('Infantil', porTipo('infantil'), 'infantil');
    if (state.propios.length) html += fila('Agregadas por mí', state.propios.slice().reverse(), 'mis');
    if (!lista.length) html += vacio('Tu catálogo está vacío.');

    $('#vista').innerHTML = html;
    if (destacados.length) iniciarHero(destacados);
  }

  function iniciarHero(items) {
    clearInterval(state.heroTimer);
    state.heroIdx = 0;
    pintarHero(items);
    if (items.length > 1) {
      state.heroTimer = setInterval(function () {
        // No cambiar mientras el usuario tiene el foco en el banner
        var hero = $('#hero');
        if (!hero) return clearInterval(state.heroTimer);
        if (hero.contains(document.activeElement)) return;
        state.heroIdx = (state.heroIdx + 1) % items.length;
        pintarHero(items);
      }, 8000);
    }
  }

  function pintarHero(items) {
    var it = items[state.heroIdx];
    $('#hero-fondo').style.backgroundImage = fondoCss(it);
    var meta = [it.anio, TIPOS[it.tipo]].filter(Boolean).map(esc).join(' · ');
    $('#hero-info').innerHTML =
      '<div class="hero-marca">★ Destacado</div>' +
      '<h1>' + esc(it.titulo) + '</h1>' +
      (meta ? '<div class="hero-meta">' + meta + '</div>' : '') +
      (it.descripcion ? '<p>' + esc(it.descripcion) + '</p>' : '') +
      '<div class="botones">' +
        '<button class="btn btn-primario focusable" type="button" data-play="' + esc(it.id) + '">' + icoPlay() + 'Ver ahora</button>' +
        '<button class="btn focusable" type="button" data-id="' + esc(it.id) + '">Más info</button>' +
      '</div>';
    $$('#hero .punto').forEach(function (p, i) { p.classList.toggle('on', i === state.heroIdx); });
  }

  function vistaSeccion(tipo) {
    var items = porTipo(tipo);
    var ancha = EN_VIVO[tipo] ? ' ancha' : '';
    $('#vista').innerHTML =
      '<h1 class="titulo-seccion">' + esc(TIPOS[tipo]) + '</h1>' +
      (items.length
        ? '<div class="rejilla' + ancha + '">' + items.map(tarjeta).join('') + '</div>'
        : vacio('Todavía no hay nada en ' + esc(TIPOS[tipo].toLowerCase()) + '.'));
  }

  function vistaBuscar() {
    $('#vista').innerHTML =
      '<h1 class="titulo-seccion">Buscar</h1>' +
      '<input class="campo buscador focusable" id="q" type="search" placeholder="Título, año o descripción…" autocomplete="off">' +
      '<div id="resultados"></div>';
    var q = $('#q');
    var pintar = function () {
      var t = q.value.trim().toLowerCase();
      var res = !t ? [] : todos().filter(function (it) {
        return [it.titulo, it.descripcion, it.anio, TIPOS[it.tipo]].join(' ').toLowerCase().indexOf(t) !== -1;
      });
      $('#resultados').innerHTML = !t ? '' : res.length
        ? '<div class="rejilla">' + res.map(tarjeta).join('') + '</div>'
        : '<p class="tenue">Sin resultados para “' + esc(q.value) + '”.</p>';
    };
    q.addEventListener('input', pintar);
    setTimeout(function () { q.focus(); }, 30);
  }

  function vistaMis() {
    var e = state.editando || {};
    var tipoSel = e.tipo || 'peliculas';
    var eps = (e.episodios || []).map(function (x) { return x.titulo + ' | ' + x.video; }).join('\n');

    // Sin clave, el recuadro de TMDB va arriba para que se vea primero
    var sinClave = !tmdbKey();
    var panelTmdb =
'<div class="panel">' +
            '<h2>Carátulas automáticas (TMDB)</h2>' +
            '<p class="tenue" style="line-height:1.55">Pega tu clave de <b>themoviedb.org</b> y al agregar una película se buscan solas la carátula, el fondo, el año y la descripción. ' +
            'La clave se guarda solo en este dispositivo; tus amigos no la necesitan.</p>' +
            '<label class="etiqueta" for="f-tmdb">Clave de API (v3) o token de lectura (v4)</label>' +
            '<input class="campo focusable" id="f-tmdb" type="password" autocomplete="off" placeholder="Pega aquí tu clave" value="' + esc(tmdbKey()) + '">' +
            '<div class="botones" style="margin-top:1rem">' +
              '<button class="btn btn-primario focusable" type="button" id="btn-tmdb-guardar">Guardar clave</button>' +
              '<button class="btn focusable" type="button" id="btn-tmdb-completar">Completar carátulas faltantes</button>' +
            '</div>' +
          '</div>';

    $('#vista').innerHTML =
      '<h1 class="titulo-seccion">Mi catálogo</h1>' +
      (sinClave ? '<div class="tmdb-arriba">' + panelTmdb + '</div>' : '') +
      '<div class="dos-col">' +
        '<div>' +
          '<form class="panel" id="form-item" autocomplete="off">' +
            '<h2>' + (state.editando ? 'Editar: ' + esc(e.titulo) : 'Agregar película, serie o canal') + '</h2>' +
            '<label class="etiqueta">Tipo</label>' +
            '<div class="chips" id="chips-tipo">' +
              Object.keys(TIPOS).map(function (k) {
                return '<button type="button" class="chip focusable' + (k === tipoSel ? ' on' : '') + '" data-tipo="' + k + '">' + TIPOS[k] + '</button>';
              }).join('') +
            '</div>' +
            '<label class="etiqueta" for="f-titulo">Título *</label>' +
            '<input class="campo focusable" id="f-titulo" required value="' + esc(e.titulo) + '">' +
            '<div class="botones" style="margin-top:.6rem"><button class="btn btn-chico focusable" type="button" id="btn-tmdb">Buscar carátula en TMDB</button></div>' +
            '<div class="tmdb-res" id="tmdb-res"></div>' +
            '<div id="bloque-video">' +
              '<label class="etiqueta" for="f-video">Enlace del video *</label>' +
              '<input class="campo focusable" id="f-video" type="url" placeholder="https://…/pelicula.mp4" value="' + esc(e.video) + '">' +
              '<div class="ayuda">Acepta enlaces directos .mp4 / .webm, transmisiones .m3u8 (HLS) y videos de YouTube.</div>' +
            '</div>' +
            '<div id="bloque-eps" hidden>' +
              '<label class="etiqueta" for="f-eps">Episodios (uno por línea: <b>Título | enlace</b>)</label>' +
              '<textarea class="campo focusable" id="f-eps" placeholder="Capítulo 1 | https://…/cap1.mp4">' + esc(eps) + '</textarea>' +
            '</div>' +
            '<label class="etiqueta" for="f-poster">Póster (imagen vertical, opcional)</label>' +
            '<input class="campo focusable" id="f-poster" type="url" placeholder="https://…/poster.jpg" value="' + esc(e.poster) + '">' +
            '<label class="etiqueta" for="f-fondo">Imagen de fondo (horizontal, opcional)</label>' +
            '<input class="campo focusable" id="f-fondo" type="url" placeholder="https://…/fondo.jpg" value="' + esc(e.fondo) + '">' +
            '<label class="etiqueta" for="f-anio">Año</label>' +
            '<input class="campo focusable" id="f-anio" inputmode="numeric" maxlength="4" value="' + esc(e.anio) + '">' +
            '<label class="etiqueta" for="f-desc">Descripción</label>' +
            '<textarea class="campo focusable" id="f-desc">' + esc(e.descripcion) + '</textarea>' +
            '<button type="button" class="check focusable' + (e.destacado ? ' on' : '') + '" id="f-dest"><span class="caja"></span>Mostrar en el banner de inicio</button>' +
            '<div class="botones" style="margin-top:1.4rem">' +
              '<button class="btn btn-primario focusable" type="submit">' + (state.editando ? 'Guardar cambios' : 'Agregar al catálogo') + '</button>' +
              (state.editando ? '<button class="btn focusable" type="button" id="btn-cancelar">Cancelar</button>' : '') +
            '</div>' +
          '</form>' +
        '</div>' +
        '<div>' +
          '<div class="panel">' +
            '<h2>Agregadas por mí (' + state.propios.length + ')</h2>' +
            (state.propios.length
              ? '<ul class="lista-mis">' + state.propios.slice().reverse().map(function (it) {
                  return '<li>' +
                    '<div class="mini">' + posterGenerado(it) + imagen(it.poster || it.fondo) + '</div>' +
                    '<div class="info"><b>' + esc(it.titulo) + '</b><span>' + esc(TIPOS[it.tipo] || '') + '</span></div>' +
                    '<button class="btn btn-chico focusable" type="button" data-editar="' + esc(it.id) + '">Editar</button>' +
                    '<button class="btn btn-chico btn-peligro focusable" type="button" data-borrar="' + esc(it.id) + '">Quitar</button>' +
                  '</li>';
                }).join('') + '</ul>'
              : '<p class="tenue">Aún no agregas nada. Lo que agregues se guarda en este dispositivo.</p>') +
          '</div>' +
          (sinClave ? '' : panelTmdb) +
          '<div class="panel">' +
            '<h2>Compartir con tus amigos</h2>' +
            '<p class="tenue" style="line-height:1.55">Cada ficha tiene un botón <b>Compartir</b> que genera un enlace y un código QR. ' +
            'Para que tus amigos vean <b>todo</b> tu catálogo al abrir la página, descarga el archivo y súbelo a <code>data/catalogo.json</code> en tu repositorio.</p>' +
            '<div class="botones">' +
              '<button class="btn btn-primario focusable" type="button" id="btn-exportar">Descargar catalogo.json</button>' +
              '<button class="btn focusable" type="button" id="btn-importar">Importar archivo</button>' +
              '<input type="file" id="f-importar" accept="application/json,.json" hidden>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    actualizarBloques(tipoSel);
    enlazarFormulario();
  }

  /* ---------- TMDB (carátulas automáticas) ---------- */

  function tmdbKey() {
    try { return localStorage.getItem(LS_TMDB) || ''; } catch (e) { return ''; }
  }

  function tmdbPedir(ruta, params) {
    var key = tmdbKey();
    if (!key) return Promise.reject(new Error('sin-clave'));
    var opts = { headers: { accept: 'application/json' } };
    // Token v4 (largo, tipo JWT) va en la cabecera; la clave v3 va en la URL
    if (key.length > 40) opts.headers.Authorization = 'Bearer ' + key;
    else params += '&api_key=' + encodeURIComponent(key);
    return fetch(TMDB_API + ruta + '?' + params, opts).then(function (r) {
      if (r.status === 401) throw new Error('clave-mala');
      if (!r.ok) throw new Error('red');
      return r.json();
    }, function () { throw new Error('red'); });
  }

  function tmdbNormalizar(r) {
    var fecha = r.release_date || r.first_air_date || '';
    return {
      titulo: r.title || r.name,
      anio: parseInt(fecha.slice(0, 4), 10) || undefined,
      descripcion: r.overview || undefined,
      poster: r.poster_path ? TMDB_IMG + 'w500' + r.poster_path : undefined,
      fondo: r.backdrop_path ? TMDB_IMG + 'w1280' + r.backdrop_path : undefined
    };
  }

  function tmdbBuscar(titulo, tipo, anio) {
    // Series buscan primero en TV; lo demás primero en películas y luego en TV
    var rutas = tipo === 'series' ? ['tv', 'movie'] : ['movie', 'tv'];
    var intentos = [];
    rutas.forEach(function (ruta) {
      if (anio) intentos.push({ ruta: ruta, anio: anio });
      intentos.push({ ruta: ruta });
    });
    var probar = function (i) {
      if (i >= intentos.length) return Promise.resolve([]);
      var it = intentos[i];
      var params = 'query=' + encodeURIComponent(titulo) + '&language=es-MX&include_adult=false';
      if (it.anio) params += (it.ruta === 'tv' ? '&first_air_date_year=' : '&year=') + encodeURIComponent(it.anio);
      return tmdbPedir('search/' + it.ruta, params).then(function (d) {
        var lista = (d.results || []).map(tmdbNormalizar).filter(function (r) { return r.poster || r.fondo; });
        return lista.length ? lista : probar(i + 1);
      });
    };
    return probar(0);
  }

  function mensajeTmdb(err) {
    var m = err && err.message;
    if (m === 'sin-clave') return 'Primero guarda tu clave de TMDB';
    if (m === 'clave-mala') return 'La clave de TMDB no es válida';
    return 'No se pudo conectar con TMDB';
  }

  /* Rellena el formulario; los campos que ya escribiste no se pisan (salvo las imágenes si eliges a mano) */
  function aplicarTmdb(r, forzarImagenes) {
    if (!r) return;
    var poner = function (id, valor, forzar) {
      var campo = $(id);
      if (valor && (forzar || !campo.value.trim())) campo.value = valor;
    };
    poner('#f-poster', r.poster, forzarImagenes);
    poner('#f-fondo', r.fondo, forzarImagenes);
    poner('#f-anio', r.anio, false);
    poner('#f-desc', r.descripcion, false);
  }

  function completarCaratulas() {
    if (!tmdbKey()) { toast('Primero guarda tu clave de TMDB'); return; }
    var faltan = state.propios.filter(function (p) { return !p.poster && !p.fondo && !EN_VIVO[p.tipo]; });
    if (!faltan.length) { toast('Todas tus películas ya tienen carátula'); return; }
    toast('Buscando ' + faltan.length + ' carátulas…');
    var hechas = 0;
    var siguiente = function (i) {
      if (i >= faltan.length) {
        guardarPropios();
        toast(hechas + ' de ' + faltan.length + ' carátulas agregadas');
        vistaMis();
        return;
      }
      var p = faltan[i];
      tmdbBuscar(p.titulo, p.tipo, p.anio).then(function (lista) {
        var r = lista[0];
        if (r) {
          p.poster = r.poster;
          p.fondo = r.fondo;
          if (!p.anio && r.anio) p.anio = r.anio;
          if (!p.descripcion && r.descripcion) p.descripcion = r.descripcion;
          hechas++;
        }
      }).catch(function () {}).then(function () { siguiente(i + 1); });
    };
    siguiente(0);
  }

  function actualizarBloques(tipo) {
    var serie = tipo === 'series';
    $('#bloque-eps').hidden = !serie;
    $('#bloque-video').hidden = serie;
  }

  function enlazarFormulario() {
    var form = $('#form-item');
    var tipo = $('#chips-tipo .chip.on').getAttribute('data-tipo');

    $('#chips-tipo').addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip) return;
      $$('#chips-tipo .chip').forEach(function (c) { c.classList.toggle('on', c === chip); });
      tipo = chip.getAttribute('data-tipo');
      actualizarBloques(tipo);
    });

    $('#f-dest').addEventListener('click', function () { this.classList.toggle('on'); });

    $('#btn-tmdb').addEventListener('click', function () {
      var titulo = $('#f-titulo').value.trim();
      if (!titulo) { toast('Escribe primero el título'); $('#f-titulo').focus(); return; }
      if (!tmdbKey()) { toast('Primero guarda tu clave de TMDB'); $('#f-tmdb').focus(); return; }
      var res = $('#tmdb-res');
      res.innerHTML = '<p class="tenue">Buscando…</p>';
      tmdbBuscar(titulo, tipo, $('#f-anio').value.trim()).then(function (lista) {
        state.tmdbRes = lista.slice(0, 12);
        res.innerHTML = state.tmdbRes.length
          ? '<p class="ayuda">Elige la correcta:</p><div class="tmdb-lista">' + state.tmdbRes.map(function (r, i) {
              return '<button type="button" class="tmdb-op focusable" data-tmdb="' + i + '">' +
                '<div class="poster">' + posterGenerado(r) + imagen(r.poster, r.titulo) + '</div>' +
                '<b>' + esc(r.titulo) + '</b><span>' + esc(r.anio || '') + '</span></button>';
            }).join('') + '</div>'
          : '<p class="tenue">No se encontró nada con ese título.</p>';
        var primero = $('.tmdb-op', res);
        if (primero) primero.focus();
      }).catch(function (err) {
        res.innerHTML = '';
        toast(mensajeTmdb(err));
      });
    });

    $('#tmdb-res').addEventListener('click', function (ev) {
      var op = ev.target.closest('[data-tmdb]');
      if (!op) return;
      aplicarTmdb(state.tmdbRes[parseInt(op.getAttribute('data-tmdb'), 10)], true);
      $('#tmdb-res').innerHTML = '';
      toast('Carátula lista');
      $('#f-titulo').focus();
    });

    $('#btn-tmdb-guardar').addEventListener('click', function () {
      var clave = $('#f-tmdb').value.trim();
      try { if (clave) localStorage.setItem(LS_TMDB, clave); else localStorage.removeItem(LS_TMDB); } catch (e) {}
      if (!clave) { toast('Clave borrada'); return; }
      tmdbBuscar('Sintel', 'peliculas').then(function () { toast('¡Clave guardada y funcionando!'); })
        .catch(function (err) { toast(mensajeTmdb(err)); });
    });

    $('#btn-tmdb-completar').addEventListener('click', completarCaratulas);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var boton = $('#form-item [type=submit]');
      // Sin carátula y con clave: se busca sola antes de guardar
      if (!$('#f-poster').value.trim() && !$('#f-fondo').value.trim() && tmdbKey() && !EN_VIVO[tipo] && $('#f-titulo').value.trim()) {
        boton.disabled = true;
        toast('Buscando carátula…');
        tmdbBuscar($('#f-titulo').value.trim(), tipo, $('#f-anio').value.trim())
          .then(function (lista) { if (lista[0]) aplicarTmdb(lista[0], false); })
          .catch(function () {})
          .then(function () { boton.disabled = false; guardarFormulario(); });
        return;
      }
      guardarFormulario();
    });

    function guardarFormulario() {
      var titulo = $('#f-titulo').value.trim();
      var video = $('#f-video').value.trim();
      var eps = [];
      if (tipo === 'series') {
        $('#f-eps').value.split('\n').forEach(function (linea, i) {
          if (!linea.trim()) return;
          var partes = linea.split('|');
          var url = partes.length > 1 ? partes.slice(1).join('|').trim() : partes[0].trim();
          var nombre = partes.length > 1 ? partes[0].trim() : 'Episodio ' + (i + 1);
          if (url) eps.push({ titulo: nombre || 'Episodio ' + (i + 1), video: url });
        });
      }
      if (!titulo) { toast('Escribe un título'); $('#f-titulo').focus(); return; }
      if (tipo === 'series' ? !eps.length : !video) {
        toast(tipo === 'series' ? 'Agrega al menos un episodio' : 'Pega el enlace del video');
        return;
      }

      var item = {
        id: state.editando ? state.editando.id : 'mi-' + Date.now().toString(36),
        titulo: titulo,
        tipo: tipo,
        anio: $('#f-anio').value.trim() ? parseInt($('#f-anio').value, 10) || undefined : undefined,
        descripcion: $('#f-desc').value.trim() || undefined,
        poster: $('#f-poster').value.trim() || undefined,
        fondo: $('#f-fondo').value.trim() || undefined,
        destacado: $('#f-dest').classList.contains('on') || undefined
      };
      if (tipo === 'series') item.episodios = eps; else item.video = video;

      var idx = -1;
      state.propios.forEach(function (p, i) { if (p.id === item.id) idx = i; });
      if (idx >= 0) state.propios[idx] = item; else state.propios.push(item);
      guardarPropios();
      state.editando = null;
      toast(idx >= 0 ? 'Cambios guardados' : '¡Agregado a tu catálogo!');
      vistaMis();
      enfocarPrimero();
    }

    var cancelar = $('#btn-cancelar');
    if (cancelar) cancelar.addEventListener('click', function () { state.editando = null; vistaMis(); enfocarPrimero(); });

    $('#btn-exportar').addEventListener('click', exportar);
    $('#btn-importar').addEventListener('click', function () { $('#f-importar').click(); });
    $('#f-importar').addEventListener('change', importar);
  }

  function manejarListaMis(b, ed) {
    if (b) {
      var id = b.getAttribute('data-borrar');
      var it = buscarItem(id);
      if (!confirm('¿Quitar "' + (it ? it.titulo : '') + '" de tu catálogo?')) return;
      state.propios = state.propios.filter(function (p) { return p.id !== id; });
      guardarPropios();
      toast('Quitado');
      vistaMis();
      enfocarPrimero();
    } else if (ed) {
      state.editando = buscarItem(ed.getAttribute('data-editar'));
      vistaMis();
      window.scrollTo(0, 0);
      $('#f-titulo').focus();
    }
  }

  function exportar() {
    var datos = todos().map(function (it) {
      var c = {};
      Object.keys(it).forEach(function (k) { if (it[k] !== undefined) c[k] = it[k]; });
      return c;
    });
    var blob = new Blob([JSON.stringify(datos, null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'catalogo.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Archivo descargado');
  }

  function importar(ev) {
    var archivo = ev.target.files && ev.target.files[0];
    if (!archivo) return;
    var lector = new FileReader();
    lector.onload = function () {
      try {
        var datos = JSON.parse(lector.result);
        if (!Array.isArray(datos)) throw new Error();
        var n = 0;
        datos.forEach(function (it) {
          if (!it || !it.titulo || !TIPOS[it.tipo]) return;
          if (!it.id) it.id = 'mi-' + Date.now().toString(36) + n;
          state.propios = state.propios.filter(function (p) { return p.id !== it.id; });
          state.propios.push(it);
          n++;
        });
        guardarPropios();
        toast(n + ' elementos importados');
        vistaMis();
      } catch (e) {
        toast('Ese archivo no es un catálogo válido');
      }
    };
    lector.readAsText(archivo);
  }

  /* ---------- Detalle ---------- */

  function icoPlay() {
    return '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>';
  }

  function abrirDetalle(id) {
    var it = buscarItem(id);
    if (!it) return;
    var compartidoNuevo = state.compartido && state.compartido.id === id && !esPropio(id) && !todos().some(function (x) { return x.id === id; });
    $('#modal-fondo').style.backgroundImage = fondoCss(it);

    var meta = [];
    if (EN_VIVO[it.tipo]) meta.push('<span><span class="punto-vivo"></span>En vivo</span>');
    if (TIPOS[it.tipo]) meta.push('<span>' + esc(TIPOS[it.tipo]) + '</span>');
    if (it.anio) meta.push('<span>' + esc(it.anio) + '</span>');
    if (it.episodios) meta.push('<span>' + it.episodios.length + ' episodios</span>');

    var eps = it.episodios && it.episodios.length
      ? '<div class="episodios">' + it.episodios.map(function (e, i) {
          return '<button class="episodio focusable" type="button" data-play="' + esc(it.id) + '" data-ep="' + i + '">' +
            '<span class="num">' + (i + 1) + '</span><span>' + esc(e.titulo) + '</span></button>';
        }).join('') + '</div>'
      : '';

    $('#modal-cuerpo').innerHTML =
      '<h2 id="modal-titulo">' + esc(it.titulo) + '</h2>' +
      '<div class="modal-meta">' + meta.join('') + '</div>' +
      (it.descripcion ? '<p>' + esc(it.descripcion) + '</p>' : '') +
      '<div class="botones">' +
        '<button class="btn btn-primario focusable" type="button" data-play="' + esc(it.id) + '" data-ep="0">' + icoPlay() + (it.episodios ? 'Ver episodio 1' : 'Ver ahora') + '</button>' +
        '<button class="btn focusable" type="button" data-compartir="' + esc(it.id) + '">Compartir</button>' +
        (compartidoNuevo ? '<button class="btn focusable" type="button" data-guardar="' + esc(it.id) + '">Guardar en mi catálogo</button>' : '') +
        '<button class="btn focusable" type="button" data-cerrar>Cerrar</button>' +
      '</div>' + eps;

    abrirCapa('#modal');
  }

  function abrirCapa(sel) {
    if (!state.focoPrevio || !$('.capa:not([hidden])')) state.focoPrevio = document.activeElement;
    $(sel).hidden = false;
    var primero = $(sel + ' .btn-primario') || $(sel + ' .focusable');
    if (primero) primero.focus();
  }

  function cerrarCapa(capa) {
    capa.hidden = true;
    if (!$('.capa:not([hidden])') && state.focoPrevio && document.body.contains(state.focoPrevio)) {
      state.focoPrevio.focus({ preventScroll: true });
      state.focoPrevio = null;
    } else if (!$('.capa:not([hidden])')) {
      enfocarPrimero();
    }
  }

  /* ---------- Compartir ---------- */

  function compartir(item) {
    var link, texto;
    if (item) {
      var publicado = state.catalogo.some(function (c) { return c.id === item.id; }) && !esPropio(item.id);
      link = urlBase() + (publicado ? '#/ver/' + encodeURIComponent(item.id) : '#/c/' + codificar(item));
      texto = 'Mira “' + item.titulo + '” en NovMox';
    } else {
      link = urlBase();
      texto = 'Abre NovMox en tu celular, compu o tele';
    }
    $('#compartir-texto').textContent = texto + '. Escanea el código o envía el enlace.';
    $('#compartir-link').value = link;

    var qr = $('#qr');
    qr.innerHTML = '';
    cargarScript(QR_JS).then(function () {
      /* global QRCode */
      new QRCode(qr, { text: link, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.L });
    }).catch(function () { qr.innerHTML = ''; });

    var nativo = $('#btn-share-nativo');
    nativo.hidden = !navigator.share;
    nativo.onclick = function () {
      navigator.share({ title: 'NovMox', text: texto, url: link }).catch(function () {});
    };
    $('#btn-copiar').onclick = function () { copiar(link); };
    abrirCapa('#compartir');
  }

  function copiar(txt) {
    var ok = function () { toast('Enlace copiado'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(ok, function () { copiarViejo(txt) ? ok() : toast('Copia el enlace manualmente'); });
    } else {
      copiarViejo(txt) ? ok() : toast('Copia el enlace manualmente');
    }
  }

  function copiarViejo(txt) {
    var campo = $('#compartir-link');
    campo.value = txt;
    campo.select();
    try { return document.execCommand('copy'); } catch (e) { return false; }
  }

  /* ---------- Reproductor ---------- */

  function cargarScript(src) {
    cargarScript.cache = cargarScript.cache || {};
    if (!cargarScript.cache[src]) {
      cargarScript.cache[src] = new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = function () { delete cargarScript.cache[src]; rej(); };
        document.head.appendChild(s);
      });
    }
    return cargarScript.cache[src];
  }

  function idYoutube(url) {
    var m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/.exec(url);
    return m ? m[1] : null;
  }

  function reproducir(id, ep) {
    var it = buscarItem(id);
    if (!it) return;
    var url = it.video;
    var titulo = it.titulo;
    if (it.episodios && it.episodios.length) {
      var e = it.episodios[ep || 0] || it.episodios[0];
      url = e.video;
      titulo = it.titulo + ' — ' + e.titulo;
    }
    if (!url) return toast('Esta ficha no tiene enlace de video');

    var zona = $('#player-zona');
    detenerPlayer();
    $('#player-titulo').textContent = titulo;
    $('#player').hidden = false;
    if (!state.focoPrevio) state.focoPrevio = document.activeElement;

    var yt = idYoutube(url);
    if (yt) {
      zona.innerHTML = '<iframe src="https://www.youtube.com/embed/' + yt + '?autoplay=1&rel=0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
      $('#btn-salir-player').focus();
      return;
    }

    zona.innerHTML = '<video controls autoplay playsinline></video>';
    var video = $('video', zona);
    video.addEventListener('error', function () { errorPlayer(url); });

    var esHls = /\.m3u8(\?|$)/i.test(url);
    if (esHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
      cargarScript(HLS_JS).then(function () {
        /* global Hls */
        if (!Hls.isSupported()) return errorPlayer(url);
        state.hls = new Hls();
        state.hls.on(Hls.Events.ERROR, function (_, d) { if (d.fatal) errorPlayer(url); });
        state.hls.loadSource(url);
        state.hls.attachMedia(video);
      }).catch(function () { errorPlayer(url); });
    } else {
      video.src = url;
    }
    video.focus();
    var p = video.play && video.play();
    if (p && p.catch) p.catch(function () {});
    activarAutoOcultar();
  }

  function errorPlayer(url) {
    detenerPlayer();
    $('#player-zona').innerHTML =
      '<div class="player-error"><h2>No se pudo reproducir</h2>' +
      '<p>Revisa que el enlace sea directo a un video (.mp4, .webm, .m3u8) o de YouTube, y que permita reproducirse desde otras páginas.</p>' +
      '<p style="word-break:break-all;font-size:.85rem">' + esc(url) + '</p></div>';
    $('#btn-salir-player').focus();
  }

  function detenerPlayer() {
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    var v = $('#player-zona video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    $('#player-zona').innerHTML = '';
  }

  function cerrarPlayer() {
    detenerPlayer();
    $('#player').hidden = true;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    var capa = $('.capa:not([hidden]) .focusable');
    if (capa) capa.focus();
    else if (state.focoPrevio && document.body.contains(state.focoPrevio)) { state.focoPrevio.focus(); state.focoPrevio = null; }
    else enfocarPrimero();
  }

  function activarAutoOcultar() {
    var player = $('#player');
    var t;
    var mostrar = function () {
      player.classList.remove('quieto');
      clearTimeout(t);
      t = setTimeout(function () { player.classList.add('quieto'); }, 3000);
    };
    player.onmousemove = mostrar;
    player.onkeydown = mostrar;
    mostrar();
  }

  /* ---------- Navegación con control remoto (flechas) ---------- */

  function visible(el) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function ambito() {
    if (!$('#player').hidden) return $('#player');
    var capas = $$('.capa:not([hidden])');
    return capas.length ? capas[capas.length - 1] : document;
  }

  function mover(dir) {
    var scope = ambito();
    var cands = $$('.focusable', scope).filter(visible);
    var actual = document.activeElement;
    if (!actual || cands.indexOf(actual) === -1) {
      enfocar(preferido(scope, cands));
      return;
    }
    var a = actual.getBoundingClientRect();
    var acx = a.left + a.width / 2;
    var acy = a.top + a.height / 2;
    var mejor = null;
    var mejorPuntaje = Infinity;

    cands.forEach(function (c) {
      if (c === actual) return;
      var r = c.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var principal, lateral;
      if (dir === 'der') { if (r.left < a.right - 4) return; principal = r.left - a.right; lateral = Math.abs(cy - acy); }
      else if (dir === 'izq') { if (r.right > a.left + 4) return; principal = a.left - r.right; lateral = Math.abs(cy - acy); }
      else if (dir === 'abajo') { if (r.top < a.bottom - 4) return; principal = r.top - a.bottom; lateral = Math.abs(cx - acx); }
      else { if (r.bottom > a.top + 4) return; principal = a.top - r.bottom; lateral = Math.abs(cx - acx); }
      var puntaje = Math.max(principal, 0) + lateral * (dir === 'izq' || dir === 'der' ? 3 : 1.2);
      if (puntaje < mejorPuntaje) { mejorPuntaje = puntaje; mejor = c; }
    });

    if (mejor) enfocar(mejor);
  }

  function preferido(scope, cands) {
    if (scope === document) {
      var enVista = $$('#vista .focusable').filter(visible);
      if (enVista.length) return enVista[0];
    }
    return cands[0];
  }

  function enfocar(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    var r = el.getBoundingClientRect();
    // Desplazamiento horizontal dentro del carril
    var carril = el.closest('.carril');
    if (carril) {
      var cr = carril.getBoundingClientRect();
      if (r.right > cr.right - 20) carril.scrollLeft += r.right - cr.right + 60;
      else if (r.left < cr.left + 20) carril.scrollLeft -= cr.left - r.left + 60;
    }
    // Desplazamiento vertical de la página (o del modal) para que se vea completo
    var cont = el.closest('.modal');
    var topLim = cont ? cont.getBoundingClientRect().top : parseFloat(getComputedStyle(document.documentElement).fontSize) * 5.5;
    var botLim = cont ? cont.getBoundingClientRect().bottom : window.innerHeight;
    var margen = 40;
    if (el.closest('.topbar') || el.closest('.lateral')) return;
    if (r.top < topLim + margen) (cont || window).scrollBy(0, r.top - topLim - margen * 2);
    else if (r.bottom > botLim - margen) (cont || window).scrollBy(0, r.bottom - botLim + margen * 2);
  }

  function enfocarPrimero() {
    var el = $$('#vista .focusable').filter(visible)[0];
    if (el) el.focus({ preventScroll: true });
  }

  var TECLAS = {
    37: 'izq', 38: 'arriba', 39: 'der', 40: 'abajo',
    ArrowLeft: 'izq', ArrowUp: 'arriba', ArrowRight: 'der', ArrowDown: 'abajo',
    Left: 'izq', Up: 'arriba', Right: 'der', Down: 'abajo'
  };
  // Atrás: Escape, Backspace, Samsung Tizen (10009), LG webOS (461), Android TV (GoBack)
  var ATRAS = { Escape: true, Esc: true, Backspace: true, GoBack: true, BrowserBack: true, 10009: true, 461: true, 27: true, 8: true };

  function alPresionar(ev) {
    var dir = TECLAS[ev.key] || TECLAS[ev.keyCode];
    var t = ev.target;
    var escribiendo = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.readOnly;
    var enVideo = t && t.tagName === 'VIDEO';

    if (ATRAS[ev.key] || ATRAS[ev.keyCode]) {
      if (escribiendo && (ev.key === 'Backspace' || ev.keyCode === 8)) return;
      ev.preventDefault();
      atras();
      return;
    }

    if (dir) {
      // En un campo de texto, izquierda/derecha mueven el cursor; arriba/abajo cambian de campo
      if (escribiendo && (dir === 'izq' || dir === 'der')) return;
      if (escribiendo && t.tagName === 'TEXTAREA' && t.value.indexOf('\n') !== -1) {
        var antes = t.value.slice(0, t.selectionStart).indexOf('\n') !== -1;
        var despues = t.value.slice(t.selectionEnd).indexOf('\n') !== -1;
        if ((dir === 'arriba' && antes) || (dir === 'abajo' && despues)) return;
      }
      // En el video: izq/der adelantan o atrasan 10 s, arriba sube a la barra
      if (enVideo && (dir === 'izq' || dir === 'der')) {
        ev.preventDefault();
        t.currentTime = Math.max(0, t.currentTime + (dir === 'der' ? 10 : -10));
        return;
      }
      ev.preventDefault();
      mover(dir);
      return;
    }

    if (enVideo && (ev.key === 'Enter' || ev.keyCode === 13 || ev.key === ' ' || ev.key === 'MediaPlayPause')) {
      ev.preventDefault();
      if (t.paused) t.play(); else t.pause();
    }
  }

  function atras() {
    if (!$('#player').hidden) return cerrarPlayer();
    var capas = $$('.capa:not([hidden])');
    if (capas.length) return cerrarCapa(capas[capas.length - 1]);
    if (ruta().nombre !== 'inicio') { location.hash = '#/inicio'; return; }
  }

  /* ---------- Rutas ---------- */

  function ruta() {
    var partes = (location.hash || '#/inicio').replace(/^#\/?/, '').split('/');
    return { nombre: partes[0] || 'inicio', arg: partes.slice(1).join('/') };
  }

  function render() {
    var r = ruta();
    clearInterval(state.heroTimer);
    $$('.capa').forEach(function (c) { c.hidden = true; });
    state.focoPrevio = null;

    var activa = r.nombre;
    if (r.nombre === 'ver' || r.nombre === 'c') activa = 'inicio';
    $$('[data-ruta]').forEach(function (a) { a.classList.toggle('activa', a.getAttribute('data-ruta') === activa); });

    if (TIPOS[r.nombre]) vistaSeccion(r.nombre);
    else if (r.nombre === 'buscar') vistaBuscar();
    else if (r.nombre === 'mis') vistaMis();
    else vistaInicio();

    window.scrollTo(0, 0);
    if (r.nombre !== 'buscar') enfocarPrimero();

    if (r.nombre === 'ver' && r.arg) {
      abrirDetalle(decodeURIComponent(r.arg));
    } else if (r.nombre === 'c' && r.arg) {
      var it = decodificar(r.arg);
      if (it) {
        if (!it.id) it.id = 'c-' + hashStr(r.arg).toString(36);
        state.compartido = it;
        abrirDetalle(it.id);
      } else {
        toast('El enlace compartido está dañado');
      }
    }
  }

  /* ---------- Eventos globales ---------- */

  function alClic(ev) {
    var t = ev.target;
    var el;
    if ((el = t.closest('[data-play]'))) {
      reproducir(el.getAttribute('data-play'), parseInt(el.getAttribute('data-ep') || '0', 10));
    } else if ((el = t.closest('[data-compartir]'))) {
      compartir(buscarItem(el.getAttribute('data-compartir')));
    } else if ((el = t.closest('[data-guardar]'))) {
      var it = buscarItem(el.getAttribute('data-guardar'));
      if (it) {
        var copia = JSON.parse(JSON.stringify(it));
        if (copia.id.indexOf('mi-') !== 0) copia.id = 'mi-' + Date.now().toString(36);
        state.propios.push(copia);
        guardarPropios();
        state.compartido = null;
        toast('Guardado en tu catálogo');
        el.remove();
      }
    } else if ((el = t.closest('[data-borrar]')) || (el = t.closest('[data-editar]'))) {
      manejarListaMis(el.hasAttribute('data-borrar') ? el : null, el.hasAttribute('data-editar') ? el : null);
    } else if ((el = t.closest('[data-cerrar]'))) {
      cerrarCapa(el.closest('.capa'));
    } else if ((el = t.closest('.tarjeta[data-id], .btn[data-id]'))) {
      abrirDetalle(el.getAttribute('data-id'));
    } else if (t.classList && t.classList.contains('capa')) {
      cerrarCapa(t);
    }
  }

  function reloj() {
    var d = new Date();
    var hh = d.getHours();
    var mm = d.getMinutes();
    $('#reloj').textContent = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function iniciar() {
    state.propios = cargarPropios();
    document.addEventListener('keydown', alPresionar);
    document.addEventListener('click', alClic);
    window.addEventListener('hashchange', render);
    $('#btn-salir-player').addEventListener('click', cerrarPlayer);
    $('#btn-compartir-app').addEventListener('click', function () { compartir(null); });
    reloj();
    setInterval(reloj, 15000);

    cargarCatalogo().then(function (cat) {
      state.catalogo = cat;
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
