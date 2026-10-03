(function () {
  'use strict';

  var CFG = window.SHART_CONFIG || {};
  var api = null;
  var miniMap = null;
  var indexCache = null;

  var EXAMPLES = [
    { t: '女性名人', v: '以上海美专的女性名人为主题策展，突出她们作为女性，在美术教育事业中的开拓，以及在美专学习的经历对中国社会发展的贡献。' },
    { t: '西画先驱', v: '梳理上海美专师生在中国早期西洋画（油画、水彩、素描、人体写生）引进与本土化中的作用，策划一个学术性展览。' },
    { t: '美专与新中国美术教育', v: '展示上海美专师生在 1949 年后创办或主持各地美术院校、建立新中国美术教育体系中的贡献，适合高校巡展。' },
    { t: '海外校友', v: '以走向世界的上海美专校友为主题（东南亚、欧洲、美国、台湾等），讲述他们如何在海外传播和发展中国艺术，需要国际借展方案。' },
    { t: '跨界人物', v: '展示上海美专培养的跨界人物——电影、音乐、文学、外交、政治领域的校友，说明美术教育对现代中国各领域的影响。' },
    { t: '浙江台州专题', v: '以陈叔亮等浙江籍（特别是台州）上海美专校友为线索，策划一个在黄岩博物馆举办的地方专题展。' }
  ];

  function esc(s) { return api.esc(s); }
  function $(s, el) { return (el || document).querySelector(s); }
  function body() { return $('#curation-body'); }
  function paras(text) {
    return String(text || '').split(/\n+/).filter(function (x) { return x.trim(); })
      .map(function (x) { return '<p>' + esc(x.trim()) + '</p>'; }).join('');
  }
  function list(arr) {
    arr = (arr || []).filter(Boolean);
    return arr.length ? '<ul>' + arr.map(function (x) { return '<li>' + esc(typeof x === 'string' ? x : JSON.stringify(x)) + '</li>'; }).join('') + '</ul>' : '';
  }
  function link(url, text) {
    if (!url) return esc(text || '');
    if (/^图谱[:：]/.test(url)) {
      var id = url.replace(/^图谱[:：]\s*/, '');
      return api.byId[id] ? '<a href="#p=' + esc(id) + '">图谱：' + esc(api.byId[id].name) + '</a>' : esc(url);
    }
    if (!/^https?:\/\//.test(url)) return esc(url);
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text || url.replace(/^https?:\/\//, '').slice(0, 40)) + '</a>';
  }
  function repoUrl() { return 'https://github.com/' + (CFG.repo || ''); }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  // ---------------- 表单与列表 ----------------
  function renderHome() {
    destroyMap();
    var h = '<h2>AI 策展</h2>' +
      '<p>基于本图谱收录的全部人物资料，由大模型帮助梳理策展思路：输入你的想法，AI 会检索图谱人物、阅读生平与收藏地点，必要时查找维基百科与网页资料，生成<b>结构化策展方案</b>，包括策展理念、展览单元、展品清单、<b>借展方案</b>（出借机构分布地图）、展陈与公共教育建议、筹备时间表以及待核实问题。</p>' +
      '<div class="cu-steps"><div><b>1</b>填写想法并提交</div><div><b>2</b>在 GitHub 确认创建 Issue</div><div><b>3</b>约 2—6 分钟后在本页与 Issue 中查看方案</div></div>' +
      '<form class="cu-form" id="cu-form">' +
      '<label>策展想法 <span class="req">*</span><textarea id="cu-idea" rows="5" required placeholder="例如：以上海美专的女性名人为主题策展，突出她们作为女性在美术教育以及在美专学习对中国发展的贡献。"></textarea></label>' +
      '<div class="cu-examples">示例：' + EXAMPLES.map(function (e, i) { return '<button type="button" class="chip" data-ex="' + i + '">' + esc(e.t) + '</button>'; }).join('') + '</div>' +
      '<div class="cu-grid">' +
      '<label>目标观众<input id="cu-audience" placeholder="大众 / 高校师生 / 研究者"></label>' +
      '<label>举办地点 / 场馆<input id="cu-venue" placeholder="如：刘海粟美术馆，或待定"></label>' +
      '<label>展览规模<select id="cu-scale"><option>小型（单厅，约 50 件以内）</option><option selected>中型（多厅，约 50—150 件）</option><option>大型（150 件以上 / 巡展）</option><option>线上展 / 数字展</option></select></label>' +
      '<label>借展方案<select id="cu-loans"><option>需要（含国内外借展）</option><option>仅国内借展</option><option>不需要</option></select></label>' +
      '</div>' +
      '<label>其他要求<textarea id="cu-notes" rows="2" placeholder="时间、预算、必须包含 / 排除的内容等"></textarea></label>' +
      '<div class="cu-actions"><button class="btn" type="submit">提交到 GitHub 生成方案</button>' +
      '<a class="btn ghost" href="' + esc(repoUrl()) + '/issues?q=label%3Aai-curation" target="_blank" rel="noopener">查看全部策展请求</a></div>' +
      '<p class="note">提交需要登录 GitHub，仅仓库所有者与协作者的请求会调用模型（防止 API 额度被滥用）。模型与密钥在仓库 Settings → Secrets and variables → Actions 中配置：Secret <code>AI_API_KEY</code>，Variables <code>AI_BASE_URL</code>、<code>AI_MODEL_PLANNER</code>。生成后，可在 Issue 下回复 <code>/curate 修改意见</code> 让 AI 修订方案。</p>' +
      '</form>' +
      '<h3>已生成的策展方案</h3><div id="cu-list" class="cu-list"><p class="muted">加载中…</p></div>';
    body().innerHTML = h;
    body().parentNode.scrollTop = 0;

    body().querySelectorAll('[data-ex]').forEach(function (b) {
      b.onclick = function () { $('#cu-idea').value = EXAMPLES[+b.dataset.ex].v; $('#cu-idea').focus(); };
    });
    $('#cu-form').onsubmit = function (e) {
      e.preventDefault();
      var idea = $('#cu-idea').value.trim();
      if (!idea) { $('#cu-idea').focus(); return; }
      var short = idea.replace(/\s+/g, ' ').slice(0, 40) + (idea.length > 40 ? '…' : '');
      var q = {
        template: 'ai-curation.yml', labels: 'ai-curation', title: '[AI策展] ' + short, idea: idea,
        audience: $('#cu-audience').value.trim(), venue: $('#cu-venue').value.trim(),
        scale: $('#cu-scale').value, loans: $('#cu-loans').value, notes: $('#cu-notes').value.trim()
      };
      var qs = Object.keys(q).filter(function (k) { return q[k]; }).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]);
      }).join('&');
      window.open(repoUrl() + '/issues/new?' + qs, '_blank', 'noopener');
    };
    loadList();
  }

  function loadList() {
    var el = $('#cu-list');
    var p = indexCache ? Promise.resolve(indexCache) : getJson('curations/index.json');
    p.then(function (idx) {
      indexCache = idx;
      var items = (idx && idx.curations) || [];
      if (!items.length) {
        el.innerHTML = '<p class="muted">暂无方案。提交第一个策展想法吧。</p>';
        return;
      }
      el.innerHTML = items.map(function (c) {
        return '<a class="cu-card" href="#c=' + esc(c.slug) + '"><h4>' + esc(c.title) + '</h4>' +
          (c.subtitle ? '<div class="sub">' + esc(c.subtitle) + '</div>' : '') +
          '<p>' + esc(c.request) + '</p>' +
          '<div class="meta">' + esc((c.created || '').slice(0, 10)) + ' · ' + esc(c.sections) + ' 个单元 · ' + esc(c.loans) + ' 项借展' +
          (c.issue ? ' · Issue #' + esc(c.issue) : '') + '</div></a>';
      }).join('');
    }).catch(function () {
      el.innerHTML = '<p class="muted">无法读取方案列表（本地直接打开文件时浏览器会禁止读取，请通过网站或本地服务器访问）。</p>';
    });
  }

  // ---------------- 方案详情 ----------------
  function personChip(id) {
    var p = api.byId[id];
    if (!p) return '';
    return '<a class="cu-person" href="#p=' + esc(id) + '">' + api.avatarHtml(p, 'avatar sm') + '<span>' + esc(p.name) + '</span></a>';
  }
  function certaintyBadge(c) {
    if (!c) return '';
    var ok = /已证实|已核实|verified/i.test(c);
    return '<span class="badge ' + (ok ? 'status-verified' : 'status-partial') + '">' + esc(c) + '</span>';
  }

  function renderPlan(slug) {
    destroyMap();
    body().innerHTML = '<p class="muted">加载方案…</p>';
    body().parentNode.scrollTop = 0;
    getJson('curations/' + encodeURIComponent(slug) + '.json').then(function (rec) {
      var plan = rec.plan || {}, meta = rec.meta || {};
      var h = '<p><a href="#view=curation">← 返回 AI 策展</a></p>';
      h += '<h2>' + esc(plan.title) + '</h2>';
      if (plan.subtitle) h += '<p class="cu-subtitle">' + esc(plan.subtitle) + '</p>';
      h += '<div class="note">由 AI（' + esc(meta.model) + '）于 ' + esc((meta.created || '').replace('T', ' ').slice(0, 16)) + ' 根据本图谱资料生成。标注“待核实”的内容请与收藏机构或档案核对后再使用。' +
        '<br><b>策展需求：</b>' + esc((meta.request || '').slice(0, 400)) +
        (meta.feedback ? '<br><b>最近一次修改意见：</b>' + esc(meta.feedback.slice(0, 300)) : '') + '</div>';
      h += '<div class="cu-actions">' +
        '<a class="btn ghost" href="curations/' + esc(slug) + '.md" download>下载 Markdown</a>' +
        '<a class="btn ghost" href="curations/' + esc(slug) + '.json" download>下载 JSON</a>' +
        (meta.issue ? '<a class="btn ghost" href="' + esc(repoUrl()) + '/issues/' + esc(meta.issue) + '" target="_blank" rel="noopener">在 GitHub 讨论 / 修订</a>' : '') +
        '<button class="btn ghost" type="button" onclick="window.print()">打印</button></div>';

      h += '<h3>策展理念</h3>' + paras(plan.theme_statement);
      if (plan.target_audience) h += '<p><b>目标观众：</b>' + esc(plan.target_audience) + '</p>';
      if ((plan.key_messages || []).length) h += '<p><b>核心认识：</b></p>' + list(plan.key_messages);

      h += '<h3>展览单元</h3>';
      (plan.sections || []).forEach(function (s, i) {
        h += '<section class="cu-section"><h4>第' + (i + 1) + '单元　' + esc(s.title) + '</h4>' + paras(s.narrative);
        if ((s.people || []).length) h += '<div class="cu-people">' + s.people.map(personChip).join('') + '</div>';
        if ((s.exhibits || []).length) {
          h += '<div class="table-wrap"><table class="cu-table"><thead><tr><th>展品</th><th>类型</th><th>相关人物</th><th>收藏 / 出借</th><th>入选理由</th><th>来源</th><th>状态</th></tr></thead><tbody>' +
            s.exhibits.map(function (ex) {
              var who = ex.person_id && api.byId[ex.person_id] ? '<a href="#p=' + esc(ex.person_id) + '">' + esc(api.byId[ex.person_id].name) + '</a>' : esc(ex.person_name);
              return '<tr><td>' + esc(ex.item) + '</td><td>' + esc(ex.item_type) + '</td><td>' + who + '</td><td>' + esc([ex.holder, ex.holder_city].filter(Boolean).join('，')) +
                '</td><td>' + esc(ex.reason) + '</td><td>' + link(ex.source) + '</td><td>' + certaintyBadge(ex.certainty) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        }
        h += '</section>';
      });

      var loans = plan.loan_plan || [];
      if (loans.length) {
        h += '<h3>借展方案</h3><div id="cu-map" class="cu-map"></div>' +
          '<div class="cu-legend"><span><i style="background:#a3271f"></i>核心</span><span><i style="background:#c05621"></i>重要</span><span><i style="background:#1f5f8b"></i>可选</span><span class="muted">坐标为近似位置时仅示意城市</span></div>' +
          '<div class="table-wrap"><table class="cu-table"><thead><tr><th>出借机构</th><th>地点</th><th>拟借内容</th><th>优先级</th><th>依据</th><th>手续要点</th><th>风险与替代</th></tr></thead><tbody>' +
          loans.map(function (l, i) {
            return '<tr data-loan="' + i + '"><td><b>' + esc(l.lender) + '</b>' + ((l.person_ids || []).length ? '<div class="cu-people">' + l.person_ids.map(personChip).join('') + '</div>' : '') +
              '</td><td>' + esc([l.city, l.country].filter(Boolean).join('，')) + '</td><td>' + esc((l.items || []).join('；')) + '</td><td>' + esc(l.priority) +
              '</td><td>' + (/^https?:/.test(l.basis || '') ? link(l.basis) : esc(l.basis)) + '</td><td>' + esc(l.procedure) + '</td><td>' + esc(l.risk) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      if (plan.venue_and_layout) h += '<h3>展陈与空间</h3>' + paras(plan.venue_and_layout);
      if ((plan.public_programs || []).length) h += '<h3>公共教育</h3>' + list(plan.public_programs);
      if ((plan.timeline || []).length) {
        h += '<h3>筹备时间表</h3><div class="tl">' + plan.timeline.map(function (t) {
          return typeof t === 'object' ? '<div class="tl-item"><b>' + esc(t.phase) + '</b>' + (t.duration ? '<span class="muted">（' + esc(t.duration) + '）</span> ' : '') + esc(t.tasks) + '</div>'
            : '<div class="tl-item">' + esc(t) + '</div>';
        }).join('') + '</div>';
      }
      if (plan.budget_notes) h += '<h3>经费要点</h3>' + paras(plan.budget_notes);
      if ((plan.risks || []).length) h += '<h3>风险与对策</h3>' + list(plan.risks);
      if ((plan.data_gaps || []).length) h += '<h3>待核实问题</h3>' + list(plan.data_gaps);
      if ((plan.references || []).length) {
        h += '<h3>参考来源</h3><ul>' + plan.references.map(function (r) {
          return '<li>' + (typeof r === 'object' ? link(r.url, r.title || r.url) : esc(r)) + '</li>';
        }).join('') + '</ul>';
      }
      body().innerHTML = h;
      if (loans.some(function (l) { return l.lat != null; })) drawLoanMap(loans);
    }).catch(function () {
      body().innerHTML = '<p><a href="#view=curation">← 返回 AI 策展</a></p><p class="muted">未找到该方案，可能仍在生成或部署中，请稍后刷新。</p>';
    });
  }

  function destroyMap() {
    if (miniMap) { miniMap.remove(); miniMap = null; }
  }

  function drawLoanMap(loans) {
    var colors = { '核心': '#a3271f', '重要': '#c05621', '可选': '#1f5f8b' };
    miniMap = L.map('cu-map', { scrollWheelZoom: false, worldCopyJump: true });
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: '1234', maxZoom: 18, attribution: '底图 © 高德地图'
    }).addTo(miniMap);
    var pts = [];
    loans.forEach(function (l, i) {
      if (l.lat == null) return;
      var c = window.Coord.wgs2gcj(l.lat, l.lng);
      var ll = L.latLng(c[0], c[1]);
      pts.push(ll);
      L.circleMarker(ll, { radius: 9, color: '#fff', weight: 2, fillColor: colors[l.priority] || '#6b6b6b', fillOpacity: 0.95 })
        .bindPopup('<b>' + esc(l.lender) + '</b><br>' + esc([l.city, l.country].filter(Boolean).join('，')) + '<br>' + esc((l.items || []).join('；')).slice(0, 160) +
          (l.approx ? '<br><span class="approx">近似坐标</span>' : ''))
        .addTo(miniMap);
    });
    if (pts.length === 1) miniMap.setView(pts[0], 8);
    else miniMap.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 8 });
  }

  window.ShartCuration = {
    init: function (a) { api = a; },
    show: function (slug) { if (slug) renderPlan(slug); else renderHome(); }
  };
})();
