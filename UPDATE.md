# 更新

发布后，把“请更新 @petercjl/xhscli 和配套 Skill”发给当前使用的 Agent。

Agent 先解析并检查自己的已选 Skill 目标，再使用 CLI 的 `update check` 和 `update install`。同版也核对 Skill 和运行时；若存在本地编辑，保留并报告。更新完成后核对版本、`skill status` 和宿主发现结果。出现部分更新时，根据 `operation status` 及 CLI 返回的恢复操作处理。检测可用更新属于提示，可通过 `AGENT_PACKAGE_UPDATE_CHECK=0` 关闭。
