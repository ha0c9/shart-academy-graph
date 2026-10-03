#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 策展：读取本项目资料，调用 OpenAI 兼容接口（DeepSeek 等）生成结构化策展方案。

环境变量：
  AI_API_KEY        模型 API Key（GitHub Secret）
  AI_BASE_URL       接口地址，如 https://api.deepseek.com 或 https://xxx/v1（GitHub Variable）
  AI_MODEL_PLANNER  模型名，如 deepseek-chat（GitHub Variable）
  CURATION_REQUEST  策展需求文本（Issue 正文或手动输入）
  CURATION_TITLE    可选，标题
  CURATION_FEEDBACK 可选，修改意见（基于已有方案修订）
  CURATION_ISSUE    可选，Issue 编号（用于文件名与回链）
  CURATION_SLUG     可选，指定输出文件名（修订时覆盖原方案）

输出：curations/<slug>.json、curations/<slug>.md，并更新 curations/index.json；
      同时把评论用 Markdown 写到 curations/.last-comment.md 供工作流回帖。
"""
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = 'ShanghaiArtSchoolAtlas-Curator/1.0 (+https://github.com/ha0c9/shart-academy-graph)'
MAX_TOOL_ROUNDS = int(os.environ.get('CURATION_MAX_ROUNDS', '14'))
REQUEST_TIMEOUT = 300

# ---------------------------------------------------------------- 数据


def load_js_global(path):
    src = open(path, encoding='utf-8').read()
    start = src.index('{')
    end = src.rindex('}')
    return json.loads(src[start:end + 1])


DATA = load_js_global(os.path.join(ROOT, 'data', 'people.js'))
PEOPLE = DATA['people']
BY_ID = {p['id']: p for p in PEOPLE}
HISTORY = load_js_global(os.path.join(ROOT, 'data', 'history.js'))

ARCHIVE = {}
_arch = os.path.join(ROOT, 'archive', 'people.jsonl')
if os.path.exists(_arch):
    for line in open(_arch, encoding='utf-8'):
        line = line.strip()
        if line:
            rec = json.loads(line)
            ARCHIVE[rec['id']] = rec

ROLE_LABEL = {'founder': '创办人/校长', 'teacher': '教师', 'both': '校友兼教师', 'student': '校友'}
PLACE_LABEL = {'memorial': '纪念馆/美术馆', 'collection': '作品收藏/陈列', 'institution': '任职机构',
               'residence': '故居', 'hometown': '故里', 'tomb': '墓园'}


def primary_place(p):
    pls = p.get('places') or []
    for pl in pls:
        if pl.get('primary'):
            return pl
    return pls[0] if pls else None


def index_line(p):
    pp = primary_place(p)
    bits = [p['id'], p['name'], p.get('life', ''), ROLE_LABEL.get(p['role'], p['role'])]
    if p.get('gender') == 'female':
        bits.append('女性')
    bits.append('/'.join(p.get('fields', [])))
    bits.append(p.get('relationShort', ''))
    if pp:
        bits.append('主要地点:%s·%s' % (pp.get('city', ''), pp.get('name', '')))
    return ' | '.join(b for b in bits if b)


def person_detail(pid, full_text_chars=2500):
    p = BY_ID.get(pid)
    if not p:
        return {'error': '未找到人物 id=%s' % pid}
    d = {k: p[k] for k in ('id', 'name', 'alias', 'life', 'born', 'gender', 'fields', 'relation', 'bio',
                           'timeline', 'contributions', 'works', 'status', 'notes') if p.get(k)}
    d['role'] = ROLE_LABEL.get(p['role'], p['role'])
    d['places'] = [{'type': PLACE_LABEL.get(pl['type'], pl['type']), 'name': pl['name'], 'city': pl.get('city', ''),
                    'address': pl.get('address', ''), 'note': pl.get('note', ''), 'primary': bool(pl.get('primary'))}
                   for pl in p.get('places', [])]
    d['sources'] = p.get('sources', [])
    a = ARCHIVE.get(pid)
    if a:
        if a.get('quotes'):
            d['source_quotes'] = a['quotes'][:6]
        if a.get('full_text') and full_text_chars:
            d['archive_text_excerpt'] = a['full_text'][:full_text_chars]
    return d


def search_people(keyword='', role='', field='', gender='', place_type='', limit=40):
    kws = [k for k in re.split(r'\s+', (keyword or '').strip()) if k]
    out = []
    for p in PEOPLE:
        if role and ROLE_LABEL.get(p['role']) != role and p['role'] != role:
            continue
        if gender and p.get('gender', '') != gender and not (gender in ('女', '女性') and p.get('gender') == 'female'):
            continue
        if field and not any(field in f for f in p.get('fields', [])):
            continue
        if place_type and not any(pl['type'] == place_type or PLACE_LABEL.get(pl['type']) == place_type for pl in p.get('places', [])):
            continue
        if kws:
            blob = json.dumps(p, ensure_ascii=False)
            a = ARCHIVE.get(p['id'])
            if a:
                blob += a.get('full_text', '')
            if not all(k in blob for k in kws):
                continue
        out.append(index_line(p))
        if len(out) >= limit:
            break
    return {'count': len(out), 'results': out}

# ---------------------------------------------------------------- 网络工具


def http_get(url, timeout=30, as_json=False, max_bytes=2_000_000):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(max_bytes)
        charset = r.headers.get_content_charset() or 'utf-8'
    text = raw.decode(charset, errors='replace')
    return json.loads(text) if as_json else text


def wiki_search(query, lang='zh', limit=8):
    url = 'https://%s.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=%d&srsearch=%s' % (
        lang, limit, urllib.parse.quote(query))
    d = http_get(url, as_json=True)
    return {'results': [{'title': r['title'], 'snippet': re.sub(r'<[^>]+>', '', r.get('snippet', ''))}
                        for r in d.get('query', {}).get('search', [])]}


def wiki_read(title, lang='zh', max_chars=6000):
    url = ('https://%s.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&converttitles=1&format=json'
           '&variant=zh-cn&titles=%s') % (lang, urllib.parse.quote(title))
    d = http_get(url, as_json=True)
    for p in d.get('query', {}).get('pages', {}).values():
        if 'missing' in p:
            return {'error': '条目不存在: %s' % title}
        return {'title': p.get('title'), 'url': 'https://%s.wikipedia.org/wiki/%s' % (lang, urllib.parse.quote(p.get('title', '').replace(' ', '_'))),
                'text': (p.get('extract') or '')[:max_chars]}
    return {'error': '无结果'}


def html_to_text(s):
    s = re.sub(r'(?is)<(script|style|noscript|svg|header|footer|nav)[^>]*>.*?</\1>', ' ', s)
    s = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</li>|</h\d>', '\n', s)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s)
    s = re.sub(r'[ \t\r\f\v]+', ' ', s)
    return re.sub(r'\n\s*\n+', '\n', s).strip()


def web_search(query, limit=8):
    url = 'https://html.duckduckgo.com/html/?q=' + urllib.parse.quote(query)
    page = http_get(url, timeout=25)
    results = []
    for m in re.finditer(r'(?s)<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?(?:class="result__snippet"[^>]*>(.*?)</a>)?', page):
        href = html.unescape(m.group(1))
        q = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
        if 'uddg' in q:
            href = q['uddg'][0]
        results.append({'title': html_to_text(m.group(2)), 'url': href, 'snippet': html_to_text(m.group(3) or '')})
        if len(results) >= limit:
            break
    return {'results': results} if results else {'error': '搜索无结果或搜索服务不可用，请改用 search_wikipedia'}


def fetch_url(url, max_chars=6000):
    if not re.match(r'^https?://', url or ''):
        return {'error': '仅支持 http/https'}
    text = html_to_text(http_get(url, timeout=30))
    return {'url': url, 'text': text[:max_chars]}


TOOLS = [
    {'type': 'function', 'function': {
        'name': 'search_people',
        'description': '在上海美专名人图谱数据库中检索人物，返回索引行（id | 姓名 | 生卒 | 身份 | 性别 | 领域 | 与美专关系 | 主要地点）。所有条件可选。',
        'parameters': {'type': 'object', 'properties': {
            'keyword': {'type': 'string', 'description': '关键词，可用空格分隔多个（同时匹配），会检索资料全文'},
            'role': {'type': 'string', 'description': '创办人/校长、教师、校友兼教师、校友'},
            'field': {'type': 'string', 'description': '艺术领域，如 国画、油画、雕塑、音乐、美术教育'},
            'gender': {'type': 'string', 'description': 'female 表示女性'},
            'place_type': {'type': 'string', 'description': '纪念馆/美术馆、作品收藏/陈列、任职机构、故居、故里、墓园'}}}}},
    {'type': 'function', 'function': {
        'name': 'get_people',
        'description': '按 id 获取人物完整资料（生平、年表、贡献、作品、地点含收藏机构、来源与原文摘录）。一次最多 12 人。',
        'parameters': {'type': 'object', 'properties': {'ids': {'type': 'array', 'items': {'type': 'string'}}}, 'required': ['ids']}}},
    {'type': 'function', 'function': {
        'name': 'search_wikipedia',
        'description': '搜索维基百科条目（默认中文），用于查找作品收藏机构、展览、人物等补充信息。',
        'parameters': {'type': 'object', 'properties': {'query': {'type': 'string'}, 'lang': {'type': 'string', 'enum': ['zh', 'en', 'fr', 'ja']}}, 'required': ['query']}}},
    {'type': 'function', 'function': {
        'name': 'read_wikipedia',
        'description': '读取维基百科条目正文（纯文本，截取前 6000 字）。',
        'parameters': {'type': 'object', 'properties': {'title': {'type': 'string'}, 'lang': {'type': 'string', 'enum': ['zh', 'en', 'fr', 'ja']}}, 'required': ['title']}}},
    {'type': 'function', 'function': {
        'name': 'web_search',
        'description': '通用网页搜索（可能不稳定），用于查找博物馆官网、馆藏信息、展览报道等。',
        'parameters': {'type': 'object', 'properties': {'query': {'type': 'string'}}, 'required': ['query']}}},
    {'type': 'function', 'function': {
        'name': 'fetch_url',
        'description': '读取网页正文（纯文本，前 6000 字），用于核实馆藏、地址等。',
        'parameters': {'type': 'object', 'properties': {'url': {'type': 'string'}}, 'required': ['url']}}},
]


def run_tool(name, args):
    try:
        if name == 'search_people':
            return search_people(**{k: v for k, v in args.items() if k in ('keyword', 'role', 'field', 'gender', 'place_type')})
        if name == 'get_people':
            ids = args.get('ids') or []
            full = 2500 if len(ids) <= 4 else 800
            return {'people': [person_detail(i, full) for i in ids[:12]]}
        if name == 'search_wikipedia':
            return wiki_search(args['query'], args.get('lang') or 'zh')
        if name == 'read_wikipedia':
            return wiki_read(args['title'], args.get('lang') or 'zh')
        if name == 'web_search':
            return web_search(args['query'])
        if name == 'fetch_url':
            return fetch_url(args['url'])
        return {'error': '未知工具 %s' % name}
    except Exception as e:  # 网络错误等不应中断策展
        return {'error': '%s: %s' % (type(e).__name__, e)}

# ---------------------------------------------------------------- 提示词

SYSTEM_PROMPT = """你是一位资深的中国近现代美术史研究者与展览策展人，熟悉上海美术专科学校（上海美专，1912—1952，刘海粟等创办）的历史，也熟悉博物馆借展、展陈设计与公共教育的实际流程。

你的任务：根据用户的策展想法，以“上海美专名人图谱”数据库为核心资料，写出一份可执行的结构化策展方案。

工作方法：
1. 先用 search_people 从多个角度（身份、领域、性别、关键词、地点类型）检索候选人物，再用 get_people 阅读完整资料。不要只凭索引行下结论。
2. 数据库之外的信息（作品现藏何处、展览、借展机构等）需要时用 search_wikipedia / read_wikipedia / web_search / fetch_url 查找，并记录来源 URL。
3. 工具调用要高效：通常 4—10 轮即可，资料足够后立即输出最终方案。

事实纪律（非常重要）：
- 人物与上海美专的关系、生卒、作品、收藏机构，必须来自数据库或你查到的来源；没有来源的内容一律标注 certainty 为“待核实”，不要编造作品名、馆藏号、联系人或日期。
- 每个展品写明信息来源（数据库条目写“图谱:<person_id>”，网络来源写 URL）。
- 不确定某件作品是否现存或在哪里收藏时，可以写成“××（若干件，具体待与馆方核实）”。
- 借展方案只列出确有依据的收藏机构；依据不足的写入 data_gaps。

方案要求：
- 紧扣用户的主题与诉求，有清晰的策展叙事（不是名单罗列），分 3—6 个单元。
- 每单元列出代表人物与展品（作品、文献、照片、影像、实物等），说明入选理由及其与主题的关系。
- 作品或捐赠分布在多地乃至海外时，给出借展方案：出借机构、所在城市/国家、拟借内容、优先级、联络与手续要点（含海外借展的保险、海关、展期、点交、温湿度等）、风险与替代方案（高清复制品、数字展示等）。
- 给出展陈与空间建议、公共教育活动、筹备时间表、主要风险，以及需要进一步核实的问题清单。
- 语言为简体中文，专业、准确、可读。

最终输出：只输出一个 JSON 对象（可以放在 ```json 代码块中），不要输出其他文字。结构如下（字段都要有，没有内容用空数组或空字符串）：
{
  "title": "展览标题",
  "subtitle": "副标题",
  "theme_statement": "策展理念与叙事主线（400—800 字）",
  "target_audience": "目标观众",
  "key_messages": ["观众应获得的 3—5 个核心认识"],
  "sections": [
    {"title": "单元标题", "narrative": "单元叙事（150—300 字）",
     "people": ["person_id", "..."],
     "exhibits": [{"person_id": "可为空", "person_name": "", "item": "展品名称或描述", "item_type": "作品|文献|照片|影像|实物|数字展项",
                   "holder": "收藏/出借机构（未知则写待核实）", "holder_city": "城市，国家", "reason": "入选理由",
                   "source": "图谱:<id> 或 URL", "certainty": "已证实|待核实"}]}
  ],
  "loan_plan": [{"lender": "出借机构", "city": "城市", "country": "国家/地区", "person_ids": [], "items": ["拟借内容"],
                 "priority": "核心|重要|可选", "basis": "依据（来源）", "procedure": "联络与手续要点", "risk": "风险与替代方案"}],
  "venue_and_layout": "展陈空间与动线建议",
  "public_programs": ["公共教育与活动"],
  "timeline": [{"phase": "阶段", "duration": "时长", "tasks": "主要工作"}],
  "budget_notes": "经费构成要点（不必给具体金额）",
  "risks": ["主要风险与对策"],
  "data_gaps": ["需要进一步核实或补充的资料"],
  "references": [{"title": "", "url": ""}]
}"""


def build_user_prompt(request, title='', feedback='', previous=None):
    lines = []
    lines.append('【策展需求】')
    if title:
        lines.append('标题/主题：' + title)
    lines.append(request.strip())
    if previous:
        lines.append('\n【已有方案（请在此基础上修订）】')
        lines.append(json.dumps(previous, ensure_ascii=False)[:20000])
    if feedback:
        lines.append('\n【修改意见】')
        lines.append(feedback.strip())
    lines.append('\n【上海美专简史】')
    lines.append('\n'.join(HISTORY.get('intro', [])))
    lines.append('\n【图谱人物索引】共 %d 人（id | 姓名 | 生卒 | 身份 | 性别 | 领域 | 与美专关系 | 主要地点）：' % len(PEOPLE))
    lines.extend(index_line(p) for p in PEOPLE)
    lines.append('\n请先检索、阅读相关人物资料，必要时查找外部资料，然后输出最终 JSON 方案。')
    return '\n'.join(lines)

# ---------------------------------------------------------------- 模型调用


def endpoint():
    base = (os.environ.get('AI_BASE_URL') or 'https://api.deepseek.com').strip().rstrip('/')
    if base.endswith('/chat/completions'):
        return base
    return base + '/chat/completions'


class ToolsUnsupported(Exception):
    pass


def chat(messages, tools=None, temperature=0.4):
    body = {'model': os.environ.get('AI_MODEL_PLANNER') or 'deepseek-chat', 'messages': messages,
            'temperature': temperature, 'max_tokens': 8192, 'stream': False}
    if tools:
        body['tools'] = tools
        body['tool_choice'] = 'auto'
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    for attempt in range(4):
        req = urllib.request.Request(endpoint(), data=data, headers={
            'Content-Type': 'application/json', 'Authorization': 'Bearer ' + os.environ['AI_API_KEY'], 'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', errors='replace')[:800]
            if tools and e.code in (400, 422) and re.search(r'tool|function', detail, re.I):
                raise ToolsUnsupported(detail)
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError('模型接口返回 HTTP %d：%s' % (e.code, detail))
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError('无法连接模型接口：%s' % e)


def extract_json(text):
    text = (text or '').strip()
    m = re.search(r'```(?:json)?\s*(\{.*\})\s*```', text, re.S)
    cand = m.group(1) if m else text[text.find('{'):text.rfind('}') + 1]
    return json.loads(cand)


def preselect_context(request, n=30):
    """不支持工具调用时：按关键词粗选人物并直接附上资料。"""
    req = request
    scored = []
    for p in PEOPLE:
        blob = json.dumps(p, ensure_ascii=False)
        s = 0
        for tok in set(re.findall(r'[\u4e00-\u9fff]{2,4}|[A-Za-z]{3,}', req)):
            if tok in blob:
                s += 1
        if ('女' in req) and p.get('gender') == 'female':
            s += 5
        scored.append((s, p['id']))
    scored.sort(key=lambda x: -x[0])
    ids = [i for s, i in scored[:n] if s > 0] or [i for s, i in scored[:n]]
    return json.dumps([person_detail(i, 600) for i in ids], ensure_ascii=False)


def generate(request, title='', feedback='', previous=None, log=print):
    messages = [{'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': build_user_prompt(request, title, feedback, previous)}]
    trace = []
    use_tools = os.environ.get('CURATION_NO_TOOLS') != '1'
    final_text = None
    rounds = 0
    while use_tools:
        try:
            resp = chat(messages, TOOLS if rounds < MAX_TOOL_ROUNDS else None)
        except ToolsUnsupported as e:
            log('模型不支持工具调用，改为直接附资料模式：%s' % str(e)[:200])
            use_tools = False
            break
        msg = resp['choices'][0]['message']
        calls = msg.get('tool_calls') or []
        if not calls:
            final_text = msg.get('content') or ''
            break
        rounds += 1
        # DeepSeek 推理模型不接受回传 reasoning_content，只保留 content 与 tool_calls
        messages.append({'role': 'assistant', 'content': msg.get('content') or '', 'tool_calls': calls})
        for c in calls:
            name = c['function']['name']
            try:
                args = json.loads(c['function'].get('arguments') or '{}')
            except json.JSONDecodeError:
                args = {}
            result = run_tool(name, args)
            trace.append({'tool': name, 'args': args, 'ok': 'error' not in result})
            log('  工具 %s %s' % (name, json.dumps(args, ensure_ascii=False)[:120]))
            messages.append({'role': 'tool', 'tool_call_id': c['id'], 'content': json.dumps(result, ensure_ascii=False)[:12000]})
        if rounds >= MAX_TOOL_ROUNDS:
            messages.append({'role': 'user', 'content': '资料检索已足够，请立即只输出最终 JSON 方案。'})
    if final_text is None:
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': build_user_prompt(request, title, feedback, previous) +
                     '\n\n【候选人物完整资料】\n' + preselect_context(request + ' ' + (feedback or ''))}]
        final_text = chat(messages)['choices'][0]['message'].get('content') or ''
    try:
        plan = extract_json(final_text)
    except Exception:
        log('JSON 解析失败，请求模型修正格式')
        messages.append({'role': 'assistant', 'content': final_text})
        messages.append({'role': 'user', 'content': '上面的输出不是合法 JSON。请只输出符合要求结构的 JSON 对象。'})
        final_text = chat(messages, temperature=0.1)['choices'][0]['message'].get('content') or ''
        plan = extract_json(final_text)
    return plan, trace

# ---------------------------------------------------------------- 后处理


def norm(s):
    return re.sub(r'[\s·・（）()《》「」“”"\'，,。.\-—]', '', s or '')


def locate(lender, city, country, person_ids):
    """为借展机构找坐标：先匹配图谱已有地点，再用 Nominatim 地理编码。"""
    nl = norm(lender)
    cands = []
    pool = [BY_ID[i] for i in person_ids if i in BY_ID] + PEOPLE
    for p in pool:
        for pl in p.get('places', []):
            n = norm(pl['name'])
            if nl and n and (nl in n or n in nl):
                return {'lat': pl['lat'], 'lng': pl['lng'], 'approx': bool(pl.get('approx')), 'matched': pl['name']}
            cands.append(pl)
    for q in [' '.join(x for x in (lender, city, country) if x), ' '.join(x for x in (city, country) if x)]:
        if not q.strip():
            continue
        try:
            time.sleep(1.1)
            r = http_get('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=zh&q=' + urllib.parse.quote(q), as_json=True)
            if r:
                return {'lat': float(r[0]['lat']), 'lng': float(r[0]['lon']), 'approx': q != ' '.join(x for x in (lender, city, country) if x), 'matched': 'geocode'}
        except Exception:
            pass
    return None


def as_list(x):
    if isinstance(x, list):
        return x
    if not x:
        return []
    return [x]


def postprocess(plan):
    plan.setdefault('title', '未命名策展方案')
    for k in ('key_messages', 'sections', 'loan_plan', 'public_programs', 'timeline', 'risks', 'data_gaps', 'references'):
        plan[k] = as_list(plan.get(k))
    unknown = set()
    for s in plan['sections']:
        s['people'] = [i for i in as_list(s.get('people')) if isinstance(i, str)]
        for i in s['people']:
            if i not in BY_ID:
                unknown.add(i)
        s['people'] = [i for i in s['people'] if i in BY_ID]
        for ex in as_list(s.get('exhibits')):
            pid = ex.get('person_id') or ''
            if pid and pid not in BY_ID:
                unknown.add(pid)
                ex['person_id'] = ''
            elif pid and not ex.get('person_name'):
                ex['person_name'] = BY_ID[pid]['name']
        s['exhibits'] = as_list(s.get('exhibits'))
    for ln in plan['loan_plan']:
        ln['person_ids'] = [i for i in as_list(ln.get('person_ids')) if i in BY_ID]
        ln['items'] = as_list(ln.get('items'))
        loc = locate(ln.get('lender', ''), ln.get('city', ''), ln.get('country', ''), ln['person_ids'])
        if loc:
            ln.update(loc)
    if unknown:
        plan['data_gaps'].append('模型引用了图谱中不存在的人物 id（已移除）：' + '、'.join(sorted(unknown)))
    return plan


def plan_to_markdown(plan, meta):
    L = []
    L.append('# %s' % plan.get('title', ''))
    if plan.get('subtitle'):
        L.append('### %s' % plan['subtitle'])
    L.append('')
    L.append('> 由 AI 根据上海美专名人图谱资料生成（模型：%s，%s）。方案中标注“待核实”的内容请与馆方或档案核对后再使用。' % (meta['model'], meta['created']))
    L.append('')
    L.append('**策展需求：** ' + meta['request'].replace('\n', ' ')[:500])
    L.append('')
    L.append('## 策展理念')
    L.append(plan.get('theme_statement', ''))
    if plan.get('target_audience'):
        L.append('\n**目标观众：** ' + plan['target_audience'])
    if plan['key_messages']:
        L.append('\n**核心认识：**')
        L.extend('- ' + str(x) for x in plan['key_messages'])
    L.append('\n## 展览单元')
    for n, s in enumerate(plan['sections'], 1):
        L.append('\n### 第%d单元　%s' % (n, s.get('title', '')))
        L.append(s.get('narrative', ''))
        if s['people']:
            L.append('\n人物：' + '、'.join(BY_ID[i]['name'] for i in s['people']))
        if s['exhibits']:
            L.append('\n| 展品 | 类型 | 相关人物 | 收藏/出借 | 理由 | 来源 | 状态 |')
            L.append('| --- | --- | --- | --- | --- | --- | --- |')
            for ex in s['exhibits']:
                cells = [ex.get('item', ''), ex.get('item_type', ''), ex.get('person_name', ''),
                         ' '.join(x for x in (ex.get('holder', ''), ex.get('holder_city', '')) if x),
                         ex.get('reason', ''), ex.get('source', ''), ex.get('certainty', '')]
                L.append('| ' + ' | '.join(str(c).replace('|', '／').replace('\n', ' ') for c in cells) + ' |')
    if plan['loan_plan']:
        L.append('\n## 借展方案')
        L.append('\n| 出借机构 | 地点 | 拟借内容 | 优先级 | 依据 | 手续要点 | 风险与替代 |')
        L.append('| --- | --- | --- | --- | --- | --- | --- |')
        for ln in plan['loan_plan']:
            cells = [ln.get('lender', ''), ' '.join(x for x in (ln.get('city', ''), ln.get('country', '')) if x),
                     '；'.join(map(str, ln['items'])), ln.get('priority', ''), ln.get('basis', ''), ln.get('procedure', ''), ln.get('risk', '')]
            L.append('| ' + ' | '.join(str(c).replace('|', '／').replace('\n', ' ') for c in cells) + ' |')
    if plan.get('venue_and_layout'):
        L.append('\n## 展陈与空间')
        L.append(plan['venue_and_layout'])
    if plan['public_programs']:
        L.append('\n## 公共教育')
        L.extend('- ' + str(x) for x in plan['public_programs'])
    if plan['timeline']:
        L.append('\n## 筹备时间表')
        for t in plan['timeline']:
            if isinstance(t, dict):
                L.append('- **%s**（%s）：%s' % (t.get('phase', ''), t.get('duration', ''), t.get('tasks', '')))
            else:
                L.append('- ' + str(t))
    if plan.get('budget_notes'):
        L.append('\n## 经费要点')
        L.append(plan['budget_notes'])
    if plan['risks']:
        L.append('\n## 风险与对策')
        L.extend('- ' + str(x) for x in plan['risks'])
    if plan['data_gaps']:
        L.append('\n## 待核实问题')
        L.extend('- ' + str(x) for x in plan['data_gaps'])
    if plan['references']:
        L.append('\n## 参考来源')
        for r in plan['references']:
            if isinstance(r, dict):
                L.append('- [%s](%s)' % (r.get('title') or r.get('url'), r.get('url', '')) if r.get('url') else '- ' + r.get('title', ''))
            else:
                L.append('- ' + str(r))
    return '\n'.join(L) + '\n'


def slugify(issue, title):
    if issue:
        return 'issue-%s' % issue
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).strftime('%Y%m%d-%H%M%S')


def main():
    for k in ('AI_API_KEY',):
        if not os.environ.get(k):
            sys.exit('缺少环境变量 %s（请在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置）' % k)
    request = os.environ.get('CURATION_REQUEST', '').strip()
    if not request:
        sys.exit('CURATION_REQUEST 为空')
    title = os.environ.get('CURATION_TITLE', '').strip()
    feedback = os.environ.get('CURATION_FEEDBACK', '').strip()
    issue = os.environ.get('CURATION_ISSUE', '').strip()
    out_dir = os.path.join(ROOT, 'curations')
    os.makedirs(out_dir, exist_ok=True)
    slug = os.environ.get('CURATION_SLUG', '').strip() or slugify(issue, title)
    prev_path = os.path.join(out_dir, slug + '.json')
    previous = None
    if feedback and os.path.exists(prev_path):
        previous = json.load(open(prev_path, encoding='utf-8')).get('plan')

    print('模型：%s  接口：%s' % (os.environ.get('AI_MODEL_PLANNER') or 'deepseek-chat', endpoint()))
    plan, trace = generate(request, title, feedback, previous)
    plan = postprocess(plan)
    created = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).replace(microsecond=0).isoformat() + 'Z'
    meta = {'slug': slug, 'created': created, 'model': os.environ.get('AI_MODEL_PLANNER') or 'deepseek-chat',
            'request': request, 'title_hint': title, 'feedback': feedback, 'issue': issue,
            'data_version': DATA.get('updated', ''), 'people_count': len(PEOPLE), 'tool_calls': trace}
    record = {'meta': meta, 'plan': plan}
    json.dump(record, open(prev_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    md = plan_to_markdown(plan, meta)
    open(os.path.join(out_dir, slug + '.md'), 'w', encoding='utf-8').write(md)

    idx_path = os.path.join(out_dir, 'index.json')
    idx = json.load(open(idx_path, encoding='utf-8')) if os.path.exists(idx_path) else {'curations': []}
    idx['curations'] = [c for c in idx['curations'] if c['slug'] != slug]
    idx['curations'].insert(0, {'slug': slug, 'title': plan.get('title', ''), 'subtitle': plan.get('subtitle', ''),
                                'created': created, 'issue': issue, 'model': meta['model'],
                                'request': request[:200], 'sections': len(plan['sections']), 'loans': len(plan['loan_plan'])})
    json.dump(idx, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    site = os.environ.get('SITE_URL', '').rstrip('/')
    link = ('\n\n在线查看（部署完成后约 1—2 分钟可见）：%s/#c=%s' % (site, slug)) if site else ''
    comment = md + link + '\n\n---\n如需修改，请在本 Issue 下回复以 `/curate` 开头的评论并写明修改意见，AI 会在此方案基础上修订。\n'
    if len(comment) > 60000:
        comment = comment[:59000] + '\n\n（内容过长已截断，完整方案见仓库 curations/%s.md）\n' % slug
    open(os.path.join(out_dir, '.last-comment.md'), 'w', encoding='utf-8').write(comment)
    print('已生成：curations/%s.json（%d 个单元，%d 项借展）' % (slug, len(plan['sections']), len(plan['loan_plan'])))
    gh_out = os.environ.get('GITHUB_OUTPUT')
    if gh_out:
        with open(gh_out, 'a') as f:
            f.write('slug=%s\n' % slug)


if __name__ == '__main__':
    main()
