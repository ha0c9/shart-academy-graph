# 资料归档

本目录归档图谱中每位人物的详细资料，便于后续用 AI 整理、检索与引用。目录内容由 `tools/build_archive.py` 根据 `data/people.js` 自动生成，并与网站一同部署（在线地址：`https://ha0c9.github.io/shart-academy-graph/archive/...`）。

| 文件 | 内容 |
| --- | --- |
| `index.json` | 人物索引：id、姓名、生卒、身份、性别、领域、与美专关系、核实状态、Markdown 路径、维基百科链接 |
| `people.jsonl` | 每行一位人物的完整 JSON：`data/people.js` 的全部字段，加上 `quotes`（来源中提及上海美专的原句）、`full_text`（维基百科条目全文）、`wikipedia`（标题、修订号、永久链接、分类、抓取日期） |
| `people/<id>.md` | 每位人物一份 Markdown：YAML 头信息、生平、年表、贡献、作品、地点表、来源原句、参考来源，以及维基百科全文附录 |

## 更新

修改或新增 `data/people.js` 中的人物后运行：

```bash
python3 tools/build_archive.py            # 只为新增人物抓取维基百科
python3 tools/build_archive.py --refresh  # 重新抓取全部条目
```

## 授权

维基百科文本依 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 授权，每份归档均注明条目修订版本与永久链接。其余结构化整理内容随本仓库发布。
