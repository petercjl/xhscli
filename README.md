# xhscli

`@petercjl/xhscli` 是用于小红书网页版的 CLI 与配套 Skill。它连接本机 9223 上已启动的 Chrome CDP，复用或打开小红书标签页，并根据可见页面判断当前会话登录态。

## 使用

把以下提示词发给当前使用的 Agent。

> 用 xhscli 打开小红书并检查当前登录状态。

需要 Node.js 22+ 和本机 `127.0.0.1:9223` 上已启动的 Chrome CDP。首次安装见 [INSTALL.md](INSTALL.md)，更新见 [UPDATE.md](UPDATE.md)。

## 开发者验证

运行 `npm test`。本地入口为 `node src/cli.mjs`，支持 `--help` 与 `capabilities --json`。包管理运行时复用了 tbcli 0.13.0 的通用运行时，业务逻辑在 `src/browser.mjs`，配套 Skill 在 `skill/xhscli`。

## 搜索并导出 Excel

> 用 xhscli 搜索“午睡枕”，按最新排序，导出前两页笔记到午睡枕.xlsx。

开发者入口示例：

```sh
xhscli search --keyword "午睡枕" --sort latest --pages 2 --output "午睡枕.xlsx" --json
xhscli search --help
```

| 选项 | 可选值 |
|---|---|
| `--sort` | `general` 综合、`latest` 最新、`likes` 最多点赞、`comments` 最多评论、`saves` 最多收藏 |
| `--note-type` | `all` 不限、`video` 视频、`image` 图文 |
| `--published-within` | `all` 不限、`day` 一天内、`week` 一周内、`half-year` 半年内 |
| `--scope` | `all` 不限、`viewed` 已看过、`unviewed` 未看过、`following` 已关注 |
| `--distance` | `all` 不限、`city` 同城、`nearby` 附近，依赖浏览器可用的定位权限 |
| `--start-page`、`--pages` | 默认从第 1 页导出 1 页，按顺序加载，达到页数上限或平台结束时停止 |
| `--page-size` | 网页固定为 `20`，可显式填写 |
| `--output` | 新建的 `.xlsx` 路径，父目录须已存在 |

排序和筛选通过页面选择，搜索及会话标识、定位值和图片格式由网页生成。命令对每次后续笔记列表请求施加 2000–3000 ms 随机等待，JSON 分别记录主动等待和实际请求间隔。实际间隔还包含平台响应和渲染时间。输出包含笔记及采集记录，热搜推荐卡计入非笔记卡片数。

## 笔记详情与全部评论

> 用 xhscli 获取这个笔记的完整详情、全部评论及回复，保存为 JSON。

把笔记 ID 或链接附在提示词后。开发者命令：

```sh
xhscli note get --id "<笔记ID>" --output "笔记.json" --json
xhscli note get --url "<笔记链接>" --output "笔记.json" --json
```

命令接受网页版笔记链接及 xhslink.com 分享短链。仅提供 ID 时优先使用本机搜索缓存和打开页面里的访问链接，随后尝试 ID 页面；需要补充访问参数时请提供当前完整笔记链接。搜索 Excel 中的“笔记链接”列保留这些参数。

JSON 保存详情页返回的笔记字段（正文、作者、时间、互动、话题、图片或视频等实际可用数据）、评论树、原始评论分页和完整性状态。顶层评论与所有回复串都达到平台结束标记时，`completeness.complete` 为 `true`。平台限制、验证或分页停滞时保留已取得的详情及评论，标记未完成并返回非零退出状态。全量范围为当前会话在采集时可访问的评论及回复。


## 同时下载素材

> 用 xhscli 获取这篇笔记的完整详情、全部评论及回复，同时下载图片和视频，保存到笔记.json。

开发者在笔记命令中增加 `--download-media`：

```sh
xhscli note get --url "<笔记链接>" --output "笔记.json" --download-media --json
```

素材保存到 JSON 旁边的同名 `.media` 文件夹，例如 `笔记.media`。下载笔记图片、视频与封面；动态照片带有可用视频地址时一并保存。素材按 JSON 中的资源地址直接下载，下载环节没有额外等待。采集接口继续使用 2000–3000 ms 随机等待。

JSON 的 `media` 记录每个文件的相对路径、大小、SHA-256 和下载状态。素材未全部保存时保留成功文件，JSON 标记未完成并返回非零退出状态。已有 JSON 或同名素材文件夹时，请选择新的输出文件名。
