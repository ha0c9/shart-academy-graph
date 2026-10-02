(function () {
  'use strict';

  var DATA = window.SHART_DATA;
  var HISTORY = window.SHART_HISTORY;

  var ROLES = {
    founder: { label: '创办人·校长', color: '#b7791f' },
    teacher: { label: '教师', color: '#1f5f8b' },
    both: { label: '校友兼教师', color: '#6b3fa0' },
    student: { label: '校友', color: '#a3271f' }
  };
  var ROLE_ORDER = ['founder', 'teacher', 'both', 'student'];

  var PLACE_TYPES = {
    memorial: { label: '纪念馆·美术馆', color: '#a3271f' },
    collection: { label: '捐赠·收藏·陈列', color: '#c05621' },
    institution: { label: '任职院校·机构', color: '#1f5f8b' },
    residence: { label: '故居·旧居', color: '#2f7d4f' },
    hometown: { label: '故里', color: '#6b6b6b' },
    tomb: { label: '墓园', color: '#4a4a4a' }
  };

  var STATUS = {
    verified: '已核实',
    partial: '部分核实',
    pending: '待核实'
  };

  var people = DATA.people.slice();
  var byId = {};
  people.forEach(function (p) {
    byId[p.id] = p;
    p._birth = parseInt((p.life || '').match(/\d{4}/) || 9999, 10);
    p._enroll = p.schoolYear || 9999;
    p._search = [
      p.name, p.alias, p.born, p.relation, (p.fields || []).join(' '),
      (p.bio || []).join(' '), (p.works || []).join(' '), (p.contributions || []).join(' '),
      (p.places || []).map(function (x) { return x.name + ' ' + (x.address || '') + ' ' + (x.city || ''); }).join(' ')
    ].join(' ').toLowerCase();
  });

  var state = {
    roles: {}, fields: {}, placeTypes: {},
    q: '', onlyPrimary: false, sort: 'year',
    gcj: true, current: null
  };

  // ---------------- 工具 ----------------
  function $(s, el) { return (el || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function surname(p) { return p.initial || p.name.charAt(0); }
  function avatarHtml(p, cls) {
    var col = ROLES[p.role].color;
    if (p.photo && p.photo.src) {
      return '<div class="' + (cls || 'avatar') + '" style="background-image:url(\'' + esc(p.photo.src) + '\')"></div>';
    }
    return '<div class="' + (cls || 'avatar') + '" style="background:' + col + '">' + esc(surname(p)) + '</div>';
  }
  function primaryPlace(p) {
    var pl = p.places || [];
    for (var i = 0; i < pl.length; i++) if (pl[i].primary) return pl[i];
    return pl[0];
  }
  function ll(lat, lng) { return state.gcj ? Coord.wgs2gcj(lat, lng) : [lat, lng]; }
  function anyOn(obj) { for (var k in obj) if (obj[k]) return true; return false; }

  // ---------------- 过滤 ----------------
  function personMatches(p) {
    if (anyOn(state.roles) && !state.roles[p.role]) return false;
    if (anyOn(state.fields) && !(p.fields || []).some(function (f) { return state.fields[f]; })) return false;
    if (state.q) {
      var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) if (p._search.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }
  function placeMatches(p, pl) {
    if (state.onlyPrimary && pl !== primaryPlace(p)) return false;
    if (anyOn(state.placeTypes) && !state.placeTypes[pl.type]) return false;
    return true;
  }
  function filtered() {
    return people.filter(function (p) {
      return personMatches(p) && (p.places || []).some(function (pl) { return placeMatches(p, pl); });
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      if (key === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN');
      if (key === 'enroll') return a._enroll - b._enroll || a._birth - b._birth;
      return a._birth - b._birth;
    });
  }

  // ---------------- 筛选器 ----------------
  function buildChips() {
    var roleCount = {}, fieldCount = {}, placeCount = {};
    people.forEach(function (p) {
      roleCount[p.role] = (roleCount[p.role] || 0) + 1;
      (p.fields || []).forEach(function (f) { fieldCount[f] = (fieldCount[f] || 0) + 1; });
      (p.places || []).forEach(function (pl) { placeCount[pl.type] = (placeCount[pl.type] || 0) + 1; });
    });

    function make(container, items, stateObj) {
      container.innerHTML = '';
      items.forEach(function (it) {
        var b = document.createElement('button');
        b.className = 'chip';
        b.innerHTML = (it.color ? '<span class="dot" style="background:' + it.color + '"></span>' : '') +
          esc(it.label) + ' <span class="n">' + it.n + '</span>';
        b.onclick = function () {
          stateObj[it.key] = !stateObj[it.key];
          b.classList.toggle('on', !!stateObj[it.key]);
          refresh();
        };
        container.appendChild(b);
      });
    }
    make($('#filter-role'), ROLE_ORDER.filter(function (k) { return roleCount[k]; }).map(function (k) {
      return { key: k, label: ROLES[k].label, color: ROLES[k].color, n: roleCount[k] };
    }), state.roles);
    make($('#filter-field'), Object.keys(fieldCount).sort(function (a, b) { return fieldCount[b] - fieldCount[a]; }).map(function (k) {
      return { key: k, label: k, n: fieldCount[k] };
    }), state.fields);
    make($('#filter-place'), Object.keys(PLACE_TYPES).filter(function (k) { return placeCount[k]; }).map(function (k) {
      return { key: k, label: PLACE_TYPES[k].label, n: placeCount[k] };
    }), state.placeTypes);
  }

  // ---------------- 列表 ----------------
  function renderList(list) {
    var ul = $('#person-list');
    ul.innerHTML = '';
    $('#result-count').textContent = '共 ' + list.length + ' / ' + people.length + ' 人';
    var groups = {};
    list.forEach(function (p) { (groups[p.role] = groups[p.role] || []).push(p); });
    ROLE_ORDER.forEach(function (r) {
      if (!groups[r]) return;
      var gt = document.createElement('li');
      gt.className = 'group-title';
      gt.textContent = ROLES[r].label + '（' + groups[r].length + '）';
      ul.appendChild(gt);
      sorted(groups[r]).forEach(function (p) {
        var li = document.createElement('li');
        li.className = 'person-item' + (state.current === p.id ? ' active' : '');
        li.dataset.id = p.id;
        li.innerHTML = avatarHtml(p) +
          '<div class="meta"><div class="nm">' + esc(p.name) + '<small>' + esc(p.life || '') + '</small></div>' +
          '<div class="rel">' + esc(p.relationShort || p.relation || '') + '</div></div>';
        li.onclick = function () { openPerson(p.id, true); };
        ul.appendChild(li);
      });
    });
    if (!list.length) ul.innerHTML = '<li style="padding:20px;color:#888;font-size:14px">没有符合条件的人物。</li>';
  }

  // ---------------- 地图 ----------------
  var map, cluster, schoolLayer, markerIndex = {};
  var baseLayers;

  function initMap() {
    map = L.map('map', { zoomControl: true, minZoom: 2, worldCopyJump: true }).setView([31.5, 117], 5);
    var gaode = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: '1234', maxZoom: 18, attribution: '底图 &copy; 高德地图'
    });
    var gaodeSat = L.layerGroup([
      L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', { subdomains: '1234', maxZoom: 18, attribution: '影像 &copy; 高德地图' }),
      L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', { subdomains: '1234', maxZoom: 18 })
    ]);
    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    });
    var carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO'
    });
    gaode._gcj = gaodeSat._gcj = true;
    baseLayers = {
      '高德地图（国内推荐）': gaode,
      '高德影像': gaodeSat,
      'OpenStreetMap（海外推荐）': osm,
      'CARTO 浅色': carto
    };
    gaode.addTo(map);
    cluster = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false, spiderfyOnMaxZoom: true });
    schoolLayer = L.layerGroup();
    map.addLayer(cluster);
    map.addLayer(schoolLayer);
    L.control.layers(baseLayers, { '人物地点': cluster, '上海美专校址': schoolLayer }, { collapsed: true }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);

    map.on('baselayerchange', function (e) {
      state.gcj = !!e.layer._gcj;
      renderMarkers(filtered());
      renderSchools();
      try { localStorage.setItem('shart-base', e.name); } catch (err) { /* ignore */ }
    });
    var saved = null;
    try { saved = localStorage.getItem('shart-base'); } catch (err) { /* ignore */ }
    if (saved && baseLayers[saved] && saved !== '高德地图（国内推荐）') {
      map.removeLayer(gaode);
      baseLayers[saved].addTo(map);
      state.gcj = !!baseLayers[saved]._gcj;
    }

    var lg = '<div><b>人物身份</b></div>' + ROLE_ORDER.map(function (k) {
      return '<div class="row"><span class="sw" style="background:' + ROLES[k].color + '"></span>' + ROLES[k].label + '</div>';
    }).join('') + '<hr><div class="row"><span class="sw sq" style="background:#333"></span>上海美专校址</div>' +
      '<div class="row" style="color:#777">大标记＝主要贡献地；小标记＝其他相关地</div>';
    $('#legend').innerHTML = lg;
  }

  function pinIcon(p, secondary, hl) {
    var size = secondary ? 24 : 34;
    return L.divIcon({
      className: '',
      html: '<div class="pin' + (secondary ? ' secondary' : '') + (hl ? ' hl' : '') + '" style="background:' + ROLES[p.role].color + '"><span>' + esc(surname(p)) + '</span></div>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size],
      popupAnchor: [0, -size]
    });
  }

  function popupHtml(p, pl) {
    var t = PLACE_TYPES[pl.type] || { label: pl.type };
    return '<div class="popup">' + avatarHtml(p) + '<div>' +
      '<h4>' + esc(p.name) + ' <small style="font-weight:400;color:#888">' + esc(p.life || '') + '</small></h4>' +
      '<div class="pl"><span class="ptype">' + esc(t.label) + '</span> ' + esc(pl.name) +
      (pl.approx ? ' <span class="approx">近似</span>' : '') + '</div>' +
      (pl.note ? '<div class="pl" style="color:#777">' + esc(pl.note.length > 60 ? pl.note.slice(0, 60) + '…' : pl.note) + '</div>' : '') +
      '<button data-open="' + esc(p.id) + '">查看详情</button></div></div>';
  }

  function renderMarkers(list) {
    cluster.clearLayers();
    markerIndex = {};
    list.forEach(function (p) {
      var prim = primaryPlace(p);
      (p.places || []).forEach(function (pl, i) {
        if (!placeMatches(p, pl) || pl.lat == null) return;
        var secondary = pl !== prim;
        var m = L.marker(ll(pl.lat, pl.lng), {
          icon: pinIcon(p, secondary, state.current === p.id),
          title: p.name + ' · ' + pl.name,
          zIndexOffset: secondary ? 0 : 500
        });
        m.bindPopup(popupHtml(p, pl));
        m.on('click', function () { openPerson(p.id, false); });
        m._person = p; m._secondary = secondary;
        cluster.addLayer(m);
        (markerIndex[p.id] = markerIndex[p.id] || []).push({ marker: m, place: pl, idx: i });
      });
    });
  }

  function renderSchools() {
    schoolLayer.clearLayers();
    (HISTORY.sites || []).forEach(function (s) {
      var icon = L.divIcon({
        className: '',
        html: '<div class="pin school"><span>校</span></div>',
        iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12]
      });
      L.marker(ll(s.lat, s.lng), { icon: icon, title: s.name, zIndexOffset: 1000 })
        .bindPopup('<div style="min-width:220px"><b>' + esc(s.name) + '</b><div style="font-size:12.5px;color:#666;margin:3px 0">' +
          esc(s.period) + '</div><div style="font-size:13px;line-height:1.7">' + esc(s.note) + '</div></div>')
        .addTo(schoolLayer);
    });
  }

  function highlight(id) {
    Object.keys(markerIndex).forEach(function (pid) {
      markerIndex[pid].forEach(function (o) {
        o.marker.setIcon(pinIcon(o.marker._person, o.marker._secondary, pid === id));
      });
    });
  }

  function flyToPlace(p, pl, openPopup) {
    var arr = markerIndex[p.id] || [];
    var hit = arr.filter(function (o) { return o.place === pl; })[0];
    if (hit) {
      map.once('moveend', function () {
        cluster.zoomToShowLayer(hit.marker, function () {
          if (openPopup) hit.marker.openPopup();
        });
      });
      map.flyTo(hit.marker.getLatLng(), Math.max(map.getZoom(), pl.approx ? 11 : 15));
    } else if (pl.lat != null) {
      map.flyTo(ll(pl.lat, pl.lng), 14);
    }
  }

  function fitPerson(p) {
    var pts = (p.places || []).filter(function (pl) { return pl.lat != null; }).map(function (pl) { return ll(pl.lat, pl.lng); });
    if (!pts.length) return;
    var prim = primaryPlace(p);
    if (pts.length === 1) {
      flyToPlace(p, prim, true);
    } else {
      map.flyToBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 12, duration: 0.8 });
      setTimeout(function () { flyToPlace(p, prim, true); }, 900);
    }
  }

  // ---------------- 详情 ----------------
  function section(title, html) {
    return html ? '<section class="d-section"><h3>' + esc(title) + '</h3>' + html + '</section>' : '';
  }
  function listHtml(arr, cls) {
    if (!arr || !arr.length) return '';
    return '<ul' + (cls ? ' class="' + cls + '"' : '') + '>' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
  }

  function renderDetail(p) {
    var role = ROLES[p.role];
    var photo = p.photo && p.photo.src
      ? '<div class="d-photo" style="background-image:url(\'' + esc(p.photo.src) + '\')" data-lb="' + esc(p.photo.src) + '" data-cap="' + esc(p.name + (p.photo.caption ? '：' + p.photo.caption : '') + (p.photo.credit ? '（' + p.photo.credit + '）' : '')) + '"></div>'
      : '<div class="d-photo noimg" style="background:' + role.color + '">' + esc(surname(p)) + '</div>';

    var h = '<div class="d-hero">' + photo + '<div>' +
      '<h2>' + esc(p.name) + '</h2>' +
      '<div class="life">' + esc(p.life || '') + (p.born ? ' · ' + esc(p.born) + '人' : '') + '</div>' +
      (p.alias ? '<div class="alias">' + esc(p.alias) + '</div>' : '') +
      '<div><span class="badge" style="background:' + role.color + '">' + role.label + '</span>' +
      (p.fields || []).map(function (f) { return '<span class="badge field">' + esc(f) + '</span>'; }).join('') +
      '<span class="badge status-' + p.status + '" title="资料核实状态">' + (STATUS[p.status] || '') + '</span></div>' +
      '</div></div>';

    h += section('与上海美专的关系', '<div class="relation-box">' + esc(p.relation) + '</div>');
    h += section('生平简介', (p.bio || []).map(function (x) { return '<p>' + esc(x) + '</p>'; }).join(''));
    if (p.timeline && p.timeline.length) {
      h += section('生平年表', '<ul class="timeline">' + p.timeline.map(function (t) {
        return '<li><b>' + esc(t[0]) + '</b>' + esc(t[1]) + '</li>';
      }).join('') + '</ul>');
    }
    h += section('主要贡献', listHtml(p.contributions));
    h += section('代表作品 / 著述', listHtml(p.works));

    var prim = primaryPlace(p);
    h += section('贡献所在地与纪念场所', (p.places || []).map(function (pl, i) {
      var t = PLACE_TYPES[pl.type] || { label: pl.type, color: '#777' };
      return '<div class="place-card" data-place="' + i + '">' +
        '<div><span class="pt" style="background:' + t.color + '">' + esc(t.label) + '</span>' +
        '<span class="pn">' + esc(pl.name) + '</span>' + (pl === prim ? ' <small style="color:#a3271f">★ 主要贡献地</small>' : '') + '</div>' +
        (pl.address || pl.city ? '<div class="pa">📍 ' + esc([pl.city, pl.address].filter(Boolean).join(' · ')) +
          (pl.approx ? ' <span class="approx" title="坐标为城市级或近似位置，仅示意">近似坐标</span>' : '') + '</div>' : '') +
        (pl.note ? '<div class="pd">' + esc(pl.note) + '</div>' : '') + '</div>';
    }).join(''));

    if (p.gallery && p.gallery.length) {
      h += section('相关图片', '<div class="gallery">' + p.gallery.map(function (g) {
        return '<figure data-lb="' + esc(g.src) + '" data-cap="' + esc((g.caption || '') + (g.credit ? '（' + g.credit + '）' : '')) + '">' +
          '<img loading="lazy" src="' + esc(g.thumb || g.src) + '" alt="' + esc(g.caption || '') + '"><figcaption>' + esc(g.caption || '') + '</figcaption></figure>';
      }).join('') + '</div>');
    }

    var src = (p.sources || []).map(function (s) {
      return '<li>' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' : esc(s.title)) + '</li>';
    });
    if (p.photo && p.photo.credit) {
      src.push('<li class="credit">照片：' + (p.photo.page ? '<a href="' + esc(p.photo.page) + '" target="_blank" rel="noopener">' + esc(p.photo.credit) + '</a>' : esc(p.photo.credit)) + '</li>');
    }
    h += section('参考来源', src.length ? '<ul class="sources">' + src.join('') + '</ul>' : '');
    if (p.notes) h += section('研究备注', '<p style="color:#7a5a20">' + esc(p.notes) + '</p>');

    var q = encodeURIComponent(p.name);
    h += '<div class="d-actions">' +
      '<button class="btn" data-act="copy">复制本条链接</button>' +
      '<button class="btn ghost" data-act="cite">复制引用信息</button>' +
      '<a class="btn ghost" target="_blank" rel="noopener" href="https://baike.baidu.com/search?word=' + q + '">百度百科</a>' +
      '<a class="btn ghost" target="_blank" rel="noopener" href="https://zh.wikipedia.org/w/index.php?search=' + q + '">维基百科</a>' +
      '</div>';

    var body = $('#detail-body');
    body.innerHTML = h;
    body.parentNode.scrollTop = 0;

    body.querySelectorAll('.place-card').forEach(function (el) {
      el.onclick = function () {
        if (isMobile()) closeDetail();
        flyToPlace(p, p.places[+el.dataset.place], true);
      };
    });
    body.querySelectorAll('[data-act]').forEach(function (el) {
      el.onclick = function () {
        var text = el.dataset.act === 'copy'
          ? location.href
          : '《上海美专名人图谱》“' + p.name + '”条，' + location.href + '，访问日期：' + new Date().toISOString().slice(0, 10) + '。';
        copyText(text, el);
      };
    });
  }

  function copyText(text, btn) {
    var done = function () {
      var o = btn.textContent; btn.textContent = '已复制 ✓';
      setTimeout(function () { btn.textContent = o; }, 1500);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done);
    else {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove(); done();
    }
  }

  var mobileMq = window.matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)');
  function isMobile() { return mobileMq.matches; }

  function openPerson(id, fly, fromRoute) {
    var p = byId[id];
    if (!p) return;
    var wasOpen = !!state.current;
    state.current = id;
    switchView('map', true);
    renderDetail(p);
    $('#detail').classList.add('open');
    $('#detail').setAttribute('aria-hidden', 'false');
    $('#view-map').classList.add('detail-open');
    document.querySelectorAll('.person-item').forEach(function (el) { el.classList.toggle('active', el.dataset.id === id); });
    highlight(id);
    if (fly) fitPerson(p);
    if (isMobile()) $('#sidebar').classList.add('collapsed');
    // 手机上新开详情时压入一条历史记录，iOS 左滑返回 / 返回键即关闭详情而不是离开页面
    setHash('p=' + id, !wasOpen && isMobile() && !fromRoute);
  }

  function closeDetail(fromRoute) {
    if (fromRoute !== true && history.state === 'detail') { history.back(); return; }
    state.current = null;
    $('#view-map').classList.remove('detail-open');
    $('#detail').classList.remove('open');
    $('#detail').setAttribute('aria-hidden', 'true');
    highlight(null);
    document.querySelectorAll('.person-item.active').forEach(function (el) { el.classList.remove('active'); });
    if (fromRoute !== true) setHash('');
  }

  // ---------------- 名录表 ----------------
  var tableSort = { key: 'birth', desc: false };
  function rowValues(p) {
    var pr = primaryPlace(p) || {};
    return {
      name: p.name, birth: p.life || '', role: ROLES[p.role].label, relation: p.relation || '',
      fields: (p.fields || []).join('、'), place: [pr.city, pr.name].filter(Boolean).join(' · '),
      status: STATUS[p.status] || ''
    };
  }
  function renderTable() {
    var q = ($('#table-search').value || '').trim().toLowerCase();
    var list = people.filter(function (p) { return !q || p._search.indexOf(q) >= 0; });
    list.sort(function (a, b) {
      var r;
      if (tableSort.key === 'birth') r = a._birth - b._birth;
      else r = String(rowValues(a)[tableSort.key]).localeCompare(String(rowValues(b)[tableSort.key]), 'zh-Hans-CN');
      return tableSort.desc ? -r : r;
    });
    $('#table-count').textContent = '共 ' + list.length + ' 人';
    var tb = $('#people-table tbody');
    tb.innerHTML = list.map(function (p) {
      var v = rowValues(p);
      return '<tr data-id="' + esc(p.id) + '"><td class="name">' + esc(v.name) + '</td><td>' + esc(v.birth) + '</td>' +
        '<td><span class="badge" style="background:' + ROLES[p.role].color + '">' + esc(v.role) + '</span></td>' +
        '<td>' + esc(v.relation) + '</td><td>' + esc(v.fields) + '</td><td>' + esc(v.place) + '</td>' +
        '<td><span class="badge status-' + p.status + '">' + esc(v.status) + '</span></td></tr>';
    }).join('');
    tb.querySelectorAll('tr').forEach(function (tr) { tr.onclick = function () { openPerson(tr.dataset.id, true); }; });
    document.querySelectorAll('#people-table th').forEach(function (th) {
      th.classList.toggle('sorted', th.dataset.key === tableSort.key);
      th.classList.toggle('desc', th.dataset.key === tableSort.key && tableSort.desc);
    });
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function exportCsv() {
    var head = ['姓名', '别名/备注', '生卒', '籍贯', '身份', '与上海美专的关系', '领域', '主要贡献', '代表作品', '地点类型', '地点名称', '城市', '地址', '纬度(WGS84)', '经度(WGS84)', '近似坐标', '地点说明', '核实状态', '参考来源'];
    var rows = [head];
    people.forEach(function (p) {
      (p.places || [{}]).forEach(function (pl) {
        rows.push([p.name, p.alias || '', p.life || '', p.born || '', ROLES[p.role].label, p.relation || '', (p.fields || []).join('、'),
          (p.contributions || []).join('；'), (p.works || []).join('；'), (PLACE_TYPES[pl.type] || {}).label || '', pl.name || '', pl.city || '',
          pl.address || '', pl.lat == null ? '' : pl.lat, pl.lng == null ? '' : pl.lng, pl.approx ? '是' : '', pl.note || '', STATUS[p.status] || '',
          (p.sources || []).map(function (s) { return s.title + (s.url ? ' ' + s.url : ''); }).join('；')]);
      });
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
    }).join('\r\n');
    download('上海美专名人图谱.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
  }
  function exportJson() {
    var clean = people.map(function (p) {
      var o = {};
      Object.keys(p).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = p[k]; });
      return o;
    });
    download('上海美专名人图谱.json', JSON.stringify(clean, null, 2), 'application/json');
  }

  // ---------------- 校史 / 说明 ----------------
  function renderHistory() {
    var h = '<h2>' + esc(HISTORY.title) + '</h2>' + HISTORY.intro.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('');
    h += '<h3>沿革年表</h3><div class="tl">' + HISTORY.timeline.map(function (t) {
      return '<div class="tl-item"><b>' + esc(t[0]) + '</b>' + esc(t[1]) + '</div>';
    }).join('') + '</div>';
    h += '<h3>主要校址</h3><table><thead><tr><th>校址</th><th>时期</th><th>说明</th></tr></thead><tbody>' +
      HISTORY.sites.map(function (s) {
        return '<tr><td><b>' + esc(s.name) + '</b></td><td>' + esc(s.period) + '</td><td>' + esc(s.note) + '</td></tr>';
      }).join('') + '</tbody></table>';
    h += '<p class="note">校址已在地图上以黑色方形“校”字标记显示，可在地图右上角图层控件中开关。</p>';
    h += '<h3>参考来源</h3><ul>' + HISTORY.sources.map(function (s) {
      return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></li>';
    }).join('') + '</ul>';
    $('#history-body').innerHTML = h;
  }

  function renderAbout() {
    var counts = {};
    people.forEach(function (p) { counts[p.status] = (counts[p.status] || 0) + 1; });
    var nPlaces = people.reduce(function (s, p) { return s + (p.places || []).length; }, 0);
    $('#about-body').innerHTML =
      '<h2>关于本图谱</h2>' +
      '<p>上海美术专科学校（简称“上海美专”）由刘海粟等于 1912 年在上海创办，是中国最早的新式美术专科学校之一，开创了男女同校、人体写生、美术函授、旅行写生等多项先例。四十年间培养学生数千人，遍布海内外。本图谱以地图形式呈现上海美专的创办人、教师与校友，<b>每个人物按其主要贡献所在地（纪念馆、美术馆、作品捐赠与陈列地、任职机构等）标注</b>，并附故里、故居、墓园等相关地点，方便研究者从空间维度考察上海美专人物的分布与影响。</p>' +
      '<p>当前收录 <b>' + people.length + '</b> 位人物、<b>' + nPlaces + '</b> 个地点。其中“已核实” ' + (counts.verified || 0) + ' 人，“部分核实” ' + (counts.partial || 0) + ' 人，“待核实” ' + (counts.pending || 0) + ' 人。</p>' +
      '<h3>使用方法</h3><ul>' +
      '<li><b>地图</b>：点击标记弹出摘要，点击“查看详情”或左侧名单可打开完整资料（照片、生平、年表、贡献、作品、地点、来源）。大标记为主要贡献地，小标记为其他相关地点；聚合圆圈表示该区域有多个地点，点击可展开。</li>' +
      '<li><b>筛选</b>：左侧可按“与美专关系”“艺术领域”“地点类型”多选组合筛选，或输入姓名、地名、作品关键词搜索（多个关键词以空格分隔）。</li>' +
      '<li><b>名录</b>：表格形式浏览全部人物，可点击表头排序，并可导出 CSV（每个地点一行，含 WGS-84 坐标，可直接导入 Excel / GIS）或 JSON。</li>' +
      '<li><b>坐标精度</b>：标有“近似坐标”的地点（多为故里、城市级地点）仅示意其所在城市或街区，并非精确门牌位置；精确定位请以馆方公布的地址为准。</li>' +
      '<li><b>引用</b>：详情页可复制本条永久链接（形如 <code>#p=chen-shuliang</code>）与引用信息。</li>' +
      '<li><b>底图</b>：地图右上角可切换高德地图（中国大陆访问更快）与 OpenStreetMap（海外访问更快）。</li></ul>' +
      '<h3>资料说明与核实状态</h3>' +
      '<p class="note">本图谱资料综合自维基百科、各地博物馆/纪念馆公开信息及相关研究文献，并结合 AI 整理。<b>“已核实”</b>表示人物与上海美专的关系及主要地点已与公开来源逐条对照；<b>“部分核实”</b>表示主要事实有来源，但个别细节（如具体年份、馆址）仍需以档案或馆方资料复核；<b>“待核实”</b>表示仅有零散来源，使用前请务必复核。人物与上海美专的关系（学生/教师）、入学与毕业年份等在不同文献中常有出入，正式引用前请以一手档案为准。</p>' +
      '<h3>图片版权</h3><p>人物照片与作品图片主要来自维基共享资源（Wikimedia Commons），已下载至本站以便国内访问，作者与授权信息见各条目“参考来源”。未找到合适开放授权图片的人物以姓氏字符占位，欢迎补充。</p>' +
      '<h3>补充与纠错</h3><p>全部数据位于仓库 <code>data/people.js</code>，结构清晰、可直接编辑。补充人物时请复制任一条目，填写 <code>places</code>（地点，含 WGS-84 经纬度）与 <code>sources</code>（来源），并标注 <code>status</code> 核实状态。照片可放入 <code>images/people/</code> 目录后在 <code>photo.src</code> 中引用。</p>';
  }

  // ---------------- 视图 & 路由 ----------------
  function switchView(v, silent) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === v); });
    document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('active', s.id === 'view-' + v); });
    if (v === 'map') setTimeout(function () { map.invalidateSize(); }, 0);
    if (v === 'table') renderTable();
    if (!silent) setHash(v === 'map' ? '' : 'view=' + v);
  }
  var hashLock = false;
  function setHash(h, push) {
    hashLock = true;
    var url = h ? '#' + h : location.pathname + location.search;
    if (push) history.pushState('detail', '', url);
    else history.replaceState(h ? history.state : null, '', url);
    setTimeout(function () { hashLock = false; }, 0);
  }
  function route() {
    if (hashLock) return;
    var h = location.hash.slice(1);
    var m;
    if ((m = h.match(/^p=(.+)$/))) {
      var id = decodeURIComponent(m[1]);
      if (id !== state.current) openPerson(id, true, true);
      return;
    }
    if (state.current) closeDetail(true);
    switchView((m = h.match(/^view=(table|history|about)$/)) ? m[1] : 'map', true);
  }

  function refresh() {
    var nActive = [state.roles, state.fields, state.placeTypes].reduce(function (s, o) {
      return s + Object.keys(o).filter(function (k) { return o[k]; }).length;
    }, 0) + (state.onlyPrimary ? 1 : 0);
    $('#filter-count').textContent = nActive || '';
    var list = filtered();
    renderList(list);
    renderMarkers(list);
    if (state.current) highlight(state.current);
  }

  // ---------------- 灯箱 ----------------
  function initLightbox() {
    var lb = $('#lightbox');
    // 委托在 <main> 而非 document 上：iOS Safari 不会为仅在 document 上监听的 div 派发 click
    $('main').addEventListener('click', function (e) {
      var t = e.target.closest('[data-lb]');
      if (t) {
        $('img', lb).src = t.dataset.lb;
        $('figcaption', lb).textContent = t.dataset.cap || '';
        lb.classList.add('open');
        return;
      }
      var o = e.target.closest('[data-open]');
      if (o) openPerson(o.dataset.open, false);
    });
    lb.onclick = function (e) { if (e.target.tagName !== 'IMG') lb.classList.remove('open'); };
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (lb.classList.contains('open')) lb.classList.remove('open');
        else closeDetail();
      }
    });
  }

  // ---------------- 启动 ----------------
  function init() {
    initMap();
    buildChips();
    renderSchools();
    renderHistory();
    renderAbout();
    initLightbox();
    refresh();

    var t;
    $('#search').oninput = function (e) {
      clearTimeout(t);
      t = setTimeout(function () { state.q = e.target.value.trim(); refresh(); }, 150);
    };
    $('#only-primary').onchange = function (e) { state.onlyPrimary = e.target.checked; refresh(); };
    $('#sort').onchange = function (e) { state.sort = e.target.value; refresh(); };
    $('#detail-close').onclick = closeDetail;
    $('#filter-toggle').onclick = function () {
      var open = $('#sidebar').classList.toggle('filters-open');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    $('#search').onkeydown = function (e) { if (e.key === 'Enter') e.target.blur(); };
    $('#sidebar-toggle').onclick = function () {
      $('#sidebar').classList.toggle('collapsed');
      setTimeout(function () { map.invalidateSize(); }, 300);
    };
    document.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { switchView(b.dataset.view); }; });
    $('#table-search').oninput = renderTable;
    document.querySelectorAll('#people-table th').forEach(function (th) {
      th.onclick = function () {
        if (tableSort.key === th.dataset.key) tableSort.desc = !tableSort.desc;
        else { tableSort.key = th.dataset.key; tableSort.desc = false; }
        renderTable();
      };
    });
    $('#export-csv').onclick = exportCsv;
    $('#export-json').onclick = exportJson;
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
    map.on('click', function () { if (isMobile()) $('#sidebar').classList.add('collapsed'); });
    if (isMobile()) $('#sidebar').classList.add('collapsed');
    route();
  }

  init();
})();
