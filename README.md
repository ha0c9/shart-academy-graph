# 上海美专名人图谱

以地图形式呈现上海美术专科学校（上海美专，1912—1952，刘海粟等创办）的创办人、教师与校友。每位人物按其**主要贡献所在地**（纪念馆、美术馆、作品捐赠与陈列地、任职机构等）标注，并附故里、故居、墓园等相关地点。点击标记可查看照片、生平、年表、主要贡献、代表作品、相关图片与参考来源。

在线访问：<https://ha0c9.github.io/shart-academy-graph/>（启用 GitHub Pages 后可用）

## 功能

- **地图**：大标记为主要贡献地，小标记为其他相关地点，黑色方形“校”字为上海美专历史校址。默认使用高德底图（中国大陆访问快），可切换为高德影像或 OpenStreetMap 等。
- **筛选与检索**：可按与美专的关系（创办人、教师、校友、校友兼教师）、艺术领域、地点类型多选筛选，并支持关键词搜索。
- **详情页**：包括与上海美专的关系、生平简介、年表、主要贡献、代表作品、贡献地与纪念场所、相关图片、参考来源和研究备注。每条有永久链接（如 `#p=chen-shuliang`），并可一键复制引用。
- **名录**：可排序的表格，可导出 CSV（每个地点一行，含 WGS-84 坐标，可导入 Excel 或 GIS）和 JSON。
- **AI 策展**：输入策展想法（如“以女性名人为主题”），由 GitHub Actions 调用配置的大模型，基于本图谱资料（必要时联网检索）生成结构化策展方案，包括展览结构、展品清单、借展方案与借展地图、日程、风险与资料缺口，并自动发布到站点。
- **资料归档**：全部人物的详细资料以 JSONL / Markdown 形式归档在 `archive/`，随站点一同部署，便于 AI 抓取整理。
- **校史 / 说明**：学校沿革、校址、资料核实状态说明与图片版权说明。

## 目录结构

```
index.html          页面入口
css/style.css       样式
js/app.js           应用逻辑（地图、筛选、详情、名录、路由）
js/coord.js         WGS-84 → GCJ-02 坐标转换（用于高德底图）
data/people.js      人物数据（window.SHART_DATA）
data/history.js     校史、校址数据（window.SHART_HISTORY，严格 JSON）
data/config.js      站点配置（GitHub 仓库名，供 AI 策展表单使用）
js/curation.js      AI 策展页面（提交表单、方案列表与方案详情）
archive/            人物资料归档（people.jsonl、index.json、people/<id>.md）
curations/          AI 生成的策展方案（<slug>.json / .md 与 index.json）
tools/curate.py     AI 策展脚本（由 Actions 运行，仅依赖 Python 标准库）
tools/build_archive.py  生成 archive/ 的脚本
llms.txt            面向 AI 的数据说明
images/people/      人物照片
images/places/      地点、作品图片
lib/                Leaflet 与 Leaflet.markercluster（本地化，便于国内访问）
```

纯静态站点，无需构建。可直接双击 `index.html` 打开，也可本地起服务预览：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 补充或修改人物

编辑 `data/people.js`，复制任一条目修改即可。主要字段如下：

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一标识，用于链接（`#p=<id>`） |
| `name` / `alias` / `life` / `born` | 姓名、别名或易误写、生卒年、籍贯 |
| `role` | `founder` 创办人·校长 / `trustee` 校董 / `teacher` 教师 / `both` 校友兼教师 / `student` 校友 |
| `gender` | 可选，女性填 `"female"`（用于“女性”筛选） |
| `schoolYear` | 入学或任教年份（用于排序；来源未载时为 `null`） |
| `relation` / `relationShort` | 与上海美专关系的完整说明、简短说明 |
| `fields` | 艺术领域数组，如 `["国画", "书法篆刻"]` |
| `bio` / `timeline` / `contributions` / `works` | 生平段落、年表 `[["1931", "…"]]`、主要贡献、代表作品 |
| `places` | 地点数组，见下文 |
| `photo` / `gallery` | `{src, caption, credit, page}`，图片放到 `images/` 下 |
| `sources` | 参考来源 `[{title, url}]` |
| `status` | `verified` 已核实 / `partial` 部分核实 / `pending` 待核实 |
| `notes` | 研究备注（待复核事项等） |

`places` 中每个地点的字段：`type`（`memorial` 纪念馆 / `collection` 作品收藏与陈列 / `institution` 任职或执教机构 / `residence` 故居 / `hometown` 故里 / `tomb` 墓园）、`name`、`city`、`address`、`note`、`lat`、`lng`（**WGS-84**，高德底图下自动转换）。另有两个可选标记：`primary: true` 表示主要贡献地，`approx: true` 表示近似（城市级）坐标。

## AI 策展

GitHub Pages 是纯静态托管，不能保存密钥，因此 AI 调用放在 GitHub Actions 中执行，API Key 不会出现在网页里：

1. 用户在“AI策展”页填写想法，点击提交后跳转到 GitHub，自动填好一个带 `ai-curation` 标签的 Issue（模板见 `.github/ISSUE_TEMPLATE/ai-curation.yml`）。
2. Issue 提交后触发 `.github/workflows/curation.yml`，运行 `tools/curate.py`：把图谱人物索引、校史与归档资料交给模型，模型可通过工具调用检索人物详情、维基百科和网页，最后输出 JSON 结构的策展方案。
3. 方案写入 `curations/<slug>.json` 与 `.md`，更新 `curations/index.json`，提交到 `main` 并重新部署站点；同时在 Issue 下回帖附上方案链接。
4. 需要修改时，在该 Issue 下回复 `/curate 修改意见`，会基于原方案重新生成。

**配置**（仓库 Settings → Secrets and variables → Actions）：

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| Secret | `AI_API_KEY` | 模型 API Key |
| Variable | `AI_BASE_URL` | OpenAI 兼容接口地址，如 `https://api.deepseek.com`（脚本自动补 `/chat/completions`） |
| Variable | `AI_MODEL_PLANNER` | 模型名，如 `deepseek-chat` |
| Variable（可选） | `SITE_URL` | 站点地址，默认 `https://<owner>.github.io/<repo>/` |

为避免他人消耗额度，只有仓库所有者、组织成员和协作者（OWNER / MEMBER / COLLABORATOR）创建的 Issue 或评论会触发模型调用。也可在 Actions 页手动运行 “AI 策展” 工作流并直接填写需求。若模型不支持工具调用，脚本会自动改为“预先检索相关人物资料再生成”的模式。

## 资料归档

`archive/` 由 `python3 tools/build_archive.py` 生成（加 `--refresh` 重新抓取维基百科）：

- `archive/people.jsonl`：每行一位人物，包含图谱全部结构化字段、维基百科条目元数据、提到上海美专的原文摘句与条目全文；
- `archive/people/<id>.md`：每人一份 Markdown 档案（YAML 头信息 + 正文 + 来源原文附录）；
- `archive/index.json`：索引与生成时间。

维基百科文字按 CC BY-SA 4.0 转载，每份档案附条目版本永久链接。新增人物时请先改 `data/people.js`，再运行脚本更新归档。

## 部署到 GitHub Pages

仓库已包含工作流 `.github/workflows/pages.yml`，推送到 `main` 分支后会先校验数据，再自动发布。首次使用需在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。

## 资料与版权说明

资料综合自维基百科、各地博物馆和纪念馆的公开信息及相关研究文献，并经 AI 辅助整理。新增人物只收录来源条目中明确写明与上海美专（1912—1952）有就读、任教、任职关系者，不作推测；来源未载的年份留空并在备注中说明。人物与上海美专的关系、入学和毕业年份等在不同文献中常有出入，正式引用前请以一手档案为准，每条记录的核实状态见详情页。人物照片和地点图片主要来自 Wikimedia Commons，作者与授权信息见各条目的“参考来源”。
