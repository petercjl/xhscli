---
name: xhscli
description: Use xhscli to check the local Chrome CDP session, open Xiaohongshu, determine the current Xiaohongshu web login state, export keyword search results to Excel, or export full notes with comments and replies to JSON.
---

# 小红书浏览器与登录态

1. 用当前安装的 `xhscli capabilities --json` 发现命令，运行 `xhscli browser status --json` 检查本机 9223 端口的 Chrome CDP。
2. 用户要打开小红书或检查登录态时，运行 `xhscli browser open --json`，复用或打开小红书标签页。只查浏览器状态时停在第 1 步。
3. 执行 `xhscli auth status --json`，按返回的 `state` 和 `evidence` 报告当前会话。遇到页面仍在加载时，短暂等待后复查一次。

`logged_in` 表示当前页面出现了个人导航的正向证据。`login_required` 或 `verification_required` 时，请用户在同一 Chrome 窗口人工操作，完成后重新检查。`unknown` 表示当前页面证据不足。遇到 `CDP_UNAVAILABLE` 时，先恢复本机预配置的电商浏览器，再从第 1 步开始。

CLI 复用现有会话。登录、扫码和验证由用户在浏览器内完成。状态检查只返回页面信号分类。

## 搜索并导出

1. 运行 `xhscli search --help` 或 `xhscli capabilities --json` 获取当前参数。把用户指定的搜索词、排序、筛选和页数传给 CLI，选择一个尚未使用的 Excel 输出路径。
2. 运行 `xhscli search --keyword "午睡枕" --pages 2 --output "午睡枕.xlsx" --json`。命令通过 9223 上的网页搜索，后续笔记列表请求由 CLI 随机等待 2000–3000 ms 后放行。
3. 成功后报告导出路径、实际页码、笔记条数和平台是否还有下一页。遇到 `LOGIN_REQUIRED` 或 `VERIFICATION_REQUIRED` 时，等用户在现有窗口完成操作再重试。位置筛选依赖当前浏览器的定位权限。


## 笔记详情与全部评论

输入笔记 ID 或小红书链接，运行 `xhscli note get --id "<笔记ID>" --output "笔记.json" --json` 或 `xhscli note get --url "<笔记链接>" --output "笔记.json" --json`。两种定位输入选其一。ID 优先从当前机器近期搜索缓存和已打开的小红书页面恢复访问链接，链接缺失或过期时使用用户提供的当前完整链接。

命令通过详情页获取笔记原始字段，按顶层评论和回复分页持续采集，后续笔记及评论接口请求随机等待 2000–3000 ms。输出保存笔记、评论树、原始评论页和完整性记录。只在 CLI 的 `complete` 与文件的 `completeness.complete` 均为 `true` 时报告已完成。当存在部分输出时，报告文件路径与失败原因，恢复后选择新路径重试。平台可见范围以当前会话当时的可访问结果为准。

搜索 Excel 中的“笔记链接”保留平台提供的访问参数，可直接作为 `--url` 输入。
