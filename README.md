# pi-purge v1.0.0

pi（`@earendil-works/pi-coding-agent`）指令权威性清洗 —— 由 dsh-purge 移植重做。

## 组成

| 件 | 路径 | 作用 |
|---|---|---|
| CLI 主工具 | `~/.pi/agent/pi-purge/pi-purge.mjs` | 18 项补丁状态机、备份、还原、守卫 |
| 默认内核 | `~/.pi/agent/pi-purge/default-prompt-inject.md` | 播种用的注入内核（用户可改 `prompt-inject.md`，运行时读取） |
| 运行时扩展 | `~/.pi/agent/extensions/pi-purge/` | session_start 自愈重打、漂移时内核段兜底、`/purge` 命令 |
| 启动器 shim | npm 全局 `pi.cmd` / `pi.ps1` / `pi` | 启动前 `--guard`：哈希漂移（pi update）自动重打 |
| 状态/备份 | `~/.pi/agent/pi-purge/{state.json,backup/*.orig}` | 逐文件 sha256 状态 + 原版备份 |

## 补丁面（18 项）

- **提示词/Prompt #1** preamble 官方身份 → 运行时读取 `~/.pi/agent/prompt-inject.md`（`PI_PURGE_INJECT` 可换路径）；编辑注入文件即时生效，免重打
- **代码/Code #2** `isProjectTrusted()` 恒真 —— 项目本地扩展/技能/合同/`SYSTEM.md`/`APPEND_SYSTEM.md` 免审批加载（`--approve` 缺省开启）
- **代码/Code #3-#12** 输出上限家族：shell 围栏 2000 行/50KB→20000 行/500KB、truncate 原语同幅放宽、旧 shell 路径 100KB→1MB、TUI 回显同步
- **工具/Tools #4-#8,#13-#15** bash/read/find/grep/ls 工具描述与新上限对齐（模型所见即所得）
- **引擎级/Engine #17/#18** codemode 输出预算 10k token→200k token；MCP 工具结果夹子 20KB→500KB

## 平台版本（双版本并存）

| 平台 | 仓库文件 | 部署为 | shim 形态 |
|---|---|---|---|
| **Windows** | `pi-purge.mjs` | `~/.pi/agent/pi-purge/pi-purge.mjs` | npm 三件套（`%APPDATA%\npm\pi.cmd` / `pi.ps1` / `pi`）插行式 guard |
| **Linux** | `pi-purge-linux.mjs` | `~/.pi/agent/pi-purge/pi-purge.mjs` | 启动器按 `command -v pi` 定位（如 `/usr/bin/pi`）；symlink 替换为 guard wrapper（exec 绝对路径真身），`--revert` 恢复原 symlink |

两个版本补丁面、状态机、备份、guard 逻辑完全一致；Linux 版仅增加 `linuxShimPath/shimStateAt/linuxWrapShim/linuxUnwrapShim` 四个布局适配函数与 status/revert 的双形态识别，全部包在 `process.platform !== "win32"` 守卫内，Windows 上运行等同于原版。

## 用法

```sh
node ~/.pi/agent/pi-purge/pi-purge.mjs --status   # 状态
node ~/.pi/agent/pi-purge/pi-purge.mjs --apply    # 应用全部清洗
node ~/.pi/agent/pi-purge/pi-purge.mjs --revert   # 回滚（保留 prompt-inject.md 用户文件）
node ~/.pi/agent/pi-purge/pi-purge.mjs --edit     # 编辑注入文件
# pi 会话内： /purge
```

## pi update 之后

无需手动处理：启动器 shim（以及 pi 会话内扩展）检测到 bundle 哈希漂移会自动重打；
若新版本锚点变动，`--status` 会显示对应补丁 missing，等 pi-purge 更新后再 `--apply`。

## 卸载

1. `--revert` 还原 pi 安装
2. 删除 `~/.pi/agent/extensions/pi-purge/` 与 `~/.pi/agent/pi-purge/`（`prompt-inject.md` 可留可删）

## Paseo 集成（paseo-plugin/）

Paseo 0.12.x 插件形态，安装于 `paseo-plugin/` 目录，daemon 侧进程 + app 侧 UI 双端贡献：

- **对话框上方图标**：composer 舞台条给每个活动 agent 挂 Shield pill（`client/pills.ts`）
- **侧边栏插件入口**：sidebar 头部 `pi-purge` Shield 图标行 → 状态全屏（`client/screens.tsx`）
- **状态面板**：explorer/workspace 双位置面板，18 项补丁逐条 + 漂移 + shim，Guard/Apply/Revert 按钮（`client/status-view.tsx`）
- **Command Center**：⌘K "打开 pi-purge 清洗状态"
- **斜杠命令**：`/purge [apply|revert|guard]`
- **RPC**：`pi-purge.status/apply/revert/guard` 四契约（`shared/purge.ts`），动态加载本目录的 pi-purge.mjs（`PI_PURGE_TOOL` 可改路径）
- **演习台**：`pi-purge.drill`（kind=update/identity/cap/trust）+ `pi-purge.drill.history`
  - **T4 update 演练**：原版备份覆盖 bundle 模拟 pi update → 启动器同款 `--guard` 自愈重打（秒级，无 LLM）
  - **T1 身份注入**：真 pi 会话取证 preamble 内核、官方句移除、addendum、模型自述
  - **T2 上限突破**：两发独立会话——powershell 55000 字符零截断 + read 60000 字符整读
  - **T3 信任绕过**：trustproj 项目本地扩展 tp_probe 免审批加载（无 `--approve`）
  - 结果留痕：daemon 插件进程内存历史（24 条）+ 会话存档 `pi-purge/drills/sessions/`
- **守护钩子**：`server.before("agent.session_open")` —— Paseo 每次拉起 pi agent 前跑哈希 guard，pi update 覆盖则静默重打，写插件日志

**UI 落点**：

- **桌面宽窗**：侧边面板条「pi-purge 控制台」（`locations: ["explorer","workspace"]`，explorer 首位，与 Snippets 同排）——状态 + Guard/Apply/Revert + 18 补丁 + 演习台 + 历史全功能
- **手机/原生/窄窗（<720px）**：Explorer 面板容器不存在 → 自动落**全屏控制台** `pi-purge-console`（内容与面板完全一致）——盾牌菜单、⌘K、/purge 三条路都走这个落点
- **侧边栏两行**：pi-purge 控制台 / pi-purge 演习台（全屏）；**⌘K** 三条目；**斜杠命令**：`/purge [apply|revert|guard]`（打开控制台）、`/drill [update|identity|cap|trust|all]`
- **对话框上方盾牌菜单**：打开控制台（按端自适应落点）/ 演习台全屏 / Guard / Apply / Revert / T4 秒级演练 / 全套演习

管理命令（bundled CLI：`"C:\Program Files\Paseo\resources\bin\paseo.cmd"`）：

```sh
paseo plugin ls
paseo plugin logs pi-purge
paseo plugin reload pi-purge     # 源码改动后
paseo plugin disable pi-purge
paseo plugin remove pi-purge
```


