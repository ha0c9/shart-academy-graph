#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 archive/ 资料归档：每位人物一份 Markdown，以及汇总的 people.jsonl / index.json。

用法：
  python3 tools/build_archive.py            # 复用已归档的维基百科正文，只为新增人物抓取
  python3 tools/build_archive.py --refresh  # 重新抓取全部维基百科正文

归档内容 = data/people.js 中的结构化字段 + 维基百科条目全文（CC BY-SA 4.0）+ 提及上海美专的原文句子。
"""
import datetime
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCH = os.path.join(ROOT, 'archive')
UA = 'ShanghaiArtSchoolAtlas-Archive/1.0 (+https://github.com/ha0c9/shart-academy-graph)'
SCHOOL_RE = re.compile(r'上海美术专科学校|上海美專|上海美专|上海图画美术院|上海图画美术学校|上海美术专门学校|上海美术学校|上海美术院|刘海粟|'
                       r'Shanghai (?:College|Academy|School|Institute) of (?:Fine )?Arts?|Shanghai Art Academy|Liu Haisu')
ROLE_LABEL = {'founder': '创办人/校长', 'trustee': '校董', 'teacher': '教师', 'both': '校友兼教师', 'student': '校友'}
PLACE_LABEL = {'memorial': '纪念馆/美术馆', 'collection': '作品收藏/陈列', 'institution': '任职机构',
               'residence': '故居', 'hometown': '故里', 'tomb': '墓园'}
STATUS_LABEL = {'verified': '已核实', 'partial': '部分核实', 'pending': '待核实'}


def load_js_global(path):
    src = open(path, encoding='utf-8').read()
    return json.loads(src[src.index('{'):src.rindex('}') + 1])


def wiki_title(p):
    for s in p.get('sources', []):
        m = re.match(r'https://(zh|en)\.wikipedia\.org/wiki/(.+)$', s.get('url', ''))
        if m:
            return m.group(1), urllib.parse.unquote(m.group(2)).replace('_', ' ')
    return None, None


def fetch_wiki(lang, title):
    url = ('https://%s.wikipedia.org/w/api.php?action=query&prop=extracts|info|categories&explaintext=1&redirects=1&converttitles=1'
           '&cllimit=100&clshow=!hidden&format=json&variant=zh-cn&titles=%s') % (lang, urllib.parse.quote(title))
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            d = json.load(urllib.request.urlopen(req, timeout=60))
            break
        except Exception:
            time.sleep(5 * (attempt + 1))
    else:
        return None
    for pg in d.get('query', {}).get('pages', {}).values():
        if 'missing' in pg:
            return None
        return {'title': pg.get('title'), 'lang': lang, 'revid': pg.get('lastrevid'), 'touched': pg.get('touched'),
                'url': 'https://%s.wikipedia.org/wiki/%s' % (lang, urllib.parse.quote(pg.get('title', '').replace(' ', '_'))),
                'permalink': 'https://%s.wikipedia.org/w/index.php?oldid=%s' % (lang, pg.get('lastrevid')),
                'categories': [c['title'].split(':', 1)[-1] for c in pg.get('categories', [])],
                'text': pg.get('extract', '')}
    return None


def quotes(text):
    out = []
    for sent in re.split(r'(?<=[。！？；])|(?<=[.!?])\s+', text.replace('\n', ' ')):
        sent = sent.strip()
        if SCHOOL_RE.search(sent) and 6 < len(sent) < 400 and sent not in out:
            out.append(sent)
    return out


def md_escape_cell(s):
    return str(s or '').replace('|', '／').replace('\n', ' ')


def person_markdown(p, w, q):
    L = ['---']
    L.append('id: %s' % p['id'])
    L.append('name: %s' % p['name'])
    for k in ('alias', 'life', 'born'):
        if p.get(k):
            L.append('%s: %s' % (k, json.dumps(p[k], ensure_ascii=False)))
    L.append('role: %s' % ROLE_LABEL.get(p['role'], p['role']))
    if p.get('gender'):
        L.append('gender: %s' % p['gender'])
    L.append('fields: [%s]' % ', '.join(p.get('fields', [])))
    L.append('status: %s' % STATUS_LABEL.get(p.get('status', 'verified'), p.get('status')))
    L.append('atlas_url: https://ha0c9.github.io/shart-academy-graph/#p=%s' % p['id'])
    if w:
        L.append('wikipedia: %s' % w['url'])
        L.append('wikipedia_revision: %s' % w['permalink'])
    L.append('---')
    L.append('')
    L.append('# %s%s' % (p['name'], '（%s）' % p['life'] if p.get('life') else ''))
    L.append('')
    if p.get('alias'):
        L.append('- 别名 / 备注：%s' % p['alias'])
    if p.get('born'):
        L.append('- 籍贯：%s' % p['born'])
    L.append('- 与上海美专的关系：%s' % p.get('relation', ''))
    L.append('- 艺术领域：%s' % '、'.join(p.get('fields', [])))
    L.append('- 核实状态：%s' % STATUS_LABEL.get(p.get('status', 'verified'), ''))
    if p.get('bio'):
        L.append('\n## 生平简介\n')
        L.extend(x + '\n' for x in p['bio'])
    if p.get('timeline'):
        L.append('## 年表\n')
        L.extend('- %s　%s' % (t[0], t[1]) for t in p['timeline'])
        L.append('')
    if p.get('contributions'):
        L.append('## 主要贡献\n')
        L.extend('- ' + x for x in p['contributions'])
        L.append('')
    if p.get('works'):
        L.append('## 代表作品 / 著述\n')
        L.extend('- ' + x for x in p['works'])
        L.append('')
    if p.get('places'):
        L.append('## 相关地点（WGS-84）\n')
        L.append('| 类型 | 名称 | 城市 | 地址 | 纬度 | 经度 | 说明 |')
        L.append('| --- | --- | --- | --- | --- | --- | --- |')
        for pl in p['places']:
            L.append('| %s | %s%s | %s | %s | %s | %s | %s |' % (
                PLACE_LABEL.get(pl['type'], pl['type']), md_escape_cell(pl['name']), '（主要）' if pl.get('primary') else '',
                md_escape_cell(pl.get('city')), md_escape_cell(pl.get('address')), pl['lat'], pl['lng'],
                md_escape_cell(pl.get('note', '')) + ('（近似坐标）' if pl.get('approx') else '')))
        L.append('')
    if q:
        L.append('## 来源原文：涉及上海美专的句子\n')
        L.extend('> %s\n' % x for x in q)
    if p.get('notes'):
        L.append('## 研究备注\n')
        L.append(p['notes'] + '\n')
    L.append('## 参考来源\n')
    for s in p.get('sources', []):
        L.append('- [%s](%s)' % (s['title'], s['url']) if s.get('url') else '- ' + s['title'])
    if p.get('photo') and p['photo'].get('credit'):
        L.append('- 照片：%s %s' % (p['photo']['credit'], p['photo'].get('page', '')))
    L.append('')
    if w and w.get('text'):
        L.append('## 附录：维基百科条目全文\n')
        L.append('> 来源：[%s](%s)（修订版本 %s，抓取于 %s）。文本依 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 授权。\n' % (
            w['title'], w['permalink'], w['revid'], w.get('retrieved', '')))
        L.append(w['text'].strip())
        L.append('')
    return '\n'.join(L)


def main():
    refresh = '--refresh' in sys.argv
    data = load_js_global(os.path.join(ROOT, 'data', 'people.js'))
    people = data['people']
    old = {}
    jl = os.path.join(ARCH, 'people.jsonl')
    if os.path.exists(jl) and not refresh:
        for line in open(jl, encoding='utf-8'):
            if line.strip():
                r = json.loads(line)
                old[r['id']] = r
    os.makedirs(os.path.join(ARCH, 'people'), exist_ok=True)
    today = datetime.date.today().isoformat()
    records, index = [], []
    for n, p in enumerate(people, 1):
        lang, title = wiki_title(p)
        w = None
        prev = old.get(p['id'])
        if prev and prev.get('wikipedia') and prev['wikipedia'].get('requested') == title:
            w = prev['wikipedia']
        elif title:
            w = fetch_wiki(lang, title)
            if w:
                w['requested'] = title
                w['retrieved'] = today
            time.sleep(0.5)
            print('[%d/%d] %s ← %s %s' % (n, len(people), p['name'], title, 'OK' if w else '未取到'), flush=True)
        q = quotes(w['text']) if w else []
        md = person_markdown(p, w, q)
        open(os.path.join(ARCH, 'people', p['id'] + '.md'), 'w', encoding='utf-8').write(md)
        rec = {k: v for k, v in p.items()}
        rec['role_label'] = ROLE_LABEL.get(p['role'], p['role'])
        rec['quotes'] = q
        rec['full_text'] = w['text'] if w else ''
        rec['wikipedia'] = w
        records.append(rec)
        index.append({'id': p['id'], 'name': p['name'], 'life': p.get('life', ''), 'role': rec['role_label'],
                      'gender': p.get('gender', ''), 'fields': p.get('fields', []), 'relation': p.get('relationShort') or p.get('relation', ''),
                      'status': STATUS_LABEL.get(p.get('status', 'verified'), ''), 'markdown': 'archive/people/%s.md' % p['id'],
                      'wikipedia': w['url'] if w else ''})
    with open(jl, 'w', encoding='utf-8') as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    json.dump({'updated': data.get('updated', today), 'count': len(index), 'people': index},
              open(os.path.join(ARCH, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    keep = {p['id'] + '.md' for p in people}
    for fn in os.listdir(os.path.join(ARCH, 'people')):
        if fn.endswith('.md') and fn not in keep:
            os.remove(os.path.join(ARCH, 'people', fn))
    print('归档完成：%d 人，含维基百科全文 %d 人' % (len(records), sum(1 for r in records if r['full_text'])))


if __name__ == '__main__':
    main()
