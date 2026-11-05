# 安装

发布后，把“请安装 @petercjl/xhscli 和配套 Skill”发给当前使用的 Agent。

Agent 安装 CLI 后，用 `skill source` 读取规范来源和安装提示。按自身环境解析 Skill 父目录，明确提供给 `skill install`，由 CLI 安装独立副本及运行时。以 `skill status` 的当前状态和实际运行时版本校验结果，再用宿主的发现机制确认 Skill 可用。关闭 npm 安装脚本时使用相同流程。CLI 安装后若 Skill 仍缺失，继续执行上述 Skill 安装与校验流程。
