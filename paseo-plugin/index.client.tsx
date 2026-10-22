import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { ScrollView } from "react-native";
import { PiPurgeDrillsScreen, PiPurgeScreen, PiPurgeConsoleScreen, PiPurgeSidebarItem } from "./client/screens";
import { PiPurgeConsole } from "./client/console-view";
import { registerPiPurgePills } from "./client/pills";
import { purgeApply, purgeDrill, purgeGuard, purgeRevert, purgeStatus } from "./shared/purge";

/** 面板本体：Explorer 侧边面板条里的 pi-purge 控制台（状态 + 演习台全功能） */
function PiPurgeConsolePanel(props: PluginWorkspacePanelProps) {
  const contentStyle = useMemo(() => ({ paddingBottom: 24 }), []);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} contentContainerStyle={contentStyle}>
      <PiPurgeConsole {...props} />
    </ScrollView>
  );
}

export default function contribute(client: PluginClientContext) {
  // 面板：Explorer 侧边面板条（与 Snippets 同一排），locations 首位 explorer
  const removePanel = client.addWorkspacePanel({
    id: "pi-purge",
    title: "pi-purge 控制台",
    icon: "Shield",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: PiPurgeConsolePanel,
  });
  // 状态全屏 + 演习台全屏 + 控制台全屏（手机/窄窗的菜单落点）
  const removeStatusScreen = client.addScreen({ id: "pi-purge", title: "pi-purge 清洗状态", Component: PiPurgeScreen });
  const removeDrillsScreen = client.addScreen({ id: "pi-purge-drills", title: "pi-purge 演习台", Component: PiPurgeDrillsScreen });
  const removeConsoleScreen = client.addScreen({ id: "pi-purge-console", title: "pi-purge 控制台", Component: PiPurgeConsoleScreen });
  // 展开的侧边栏：两行插件入口（状态 / 演习台 全屏）
  const removeSidebar = client.addSidebarHeaderItem({ id: "pi-purge", title: "pi-purge", Component: PiPurgeSidebarItem });
  // Command Center（⌘K / Ctrl+K）
  const removeCommand = client.addCommandCenterItem({
    id: "open-pi-purge",
    title: "打开 pi-purge 清洗状态",
    icon: "Shield",
    keywords: ["purge", "清洗", "pi-purge", "pi"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "pi-purge" });
    },
  });
  const removeDrillsCommand = client.addCommandCenterItem({
    id: "open-pi-purge-drills",
    title: "打开 pi-purge 演习台",
    icon: "Swords",
    keywords: ["drill", "演习", "测试", "pi-purge"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "pi-purge-drills" });
    },
  });
  const removeConsoleCommand = client.addCommandCenterItem({
    id: "open-pi-purge-console",
    title: "打开 pi-purge 控制台（状态 + 演习台）",
    icon: "Shield",
    keywords: ["console", "控制台", "清洗", "演习", "pi-purge"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "pi-purge-console" });
    },
  });
  // 斜杠命令
  const removeSlash = client.addSlashCommand({
    name: "purge",
    description: "刷新 pi-purge 清洗状态并打开控制台（apply/revert/guard 直达动作）",
    argumentHint: "[apply|revert|guard]",
    context: "agent",
    async onSubmit({ args }) {
      if (args === "apply") await client.rpc(purgeApply, {});
      else if (args === "revert") await client.rpc(purgeRevert, {});
      else if (args === "guard") await client.rpc(purgeGuard, {});
      else await client.rpc(purgeStatus, {});
      client.openScreen({ screenId: "pi-purge-console" });
    },
  });
  const removeDrillSlash = client.addSlashCommand({
    name: "drill",
    description: "跑 pi-purge 演习并打开演习台（默认 update；identity/cap/trust/all 可选）",
    argumentHint: "[update|identity|cap|trust|all]",
    context: "agent",
    async onSubmit({ args }) {
      if (args === "all") {
        for (const k of ["update", "identity", "cap", "trust"] as const) await client.rpc(purgeDrill, { kind: k });
      } else if (args === "identity" || args === "cap" || args === "trust" || args === "update") {
        await client.rpc(purgeDrill, { kind: args });
      } else {
        await client.rpc(purgeDrill, { kind: "update" });
      }
      client.openScreen({ screenId: "pi-purge-drills" });
    },
  });
  // 对话框上方舞台条图标（盾牌菜单）
  const removePills = registerPiPurgePills(client);

  return () => {
    removePills();
    removeDrillSlash();
    removeSlash();
    removeConsoleCommand();
    removeDrillsCommand();
    removeCommand();
    removeSidebar();
    removeConsoleScreen();
    removeDrillsScreen();
    removeStatusScreen();
    removePanel();
  };
}
