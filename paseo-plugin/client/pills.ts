import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { purgeApply, purgeDrill, purgeGuard, purgeRevert } from "../shared/purge";
import { Dimensions, Platform } from "react-native";

type AgentTarget = {
  id: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
  status?: string;
};

/** 宽桌面 → Explorer 侧边面板；手机/原生/窄窗 → 全屏控制台（Explorer 容器在移动端不存在） */
function openConsole(
  client: PluginClientContext,
  workspaceId: string,
  agentId: string,
): void {
  if (Platform.OS !== "web" || Dimensions.get("window").width < 720) {
    client.openScreen({ screenId: "pi-purge-console" });
    return;
  }
  client.openPanel("pi-purge", { workspaceId, agentId, location: "explorer" });
}

/** 对话框上方（composer 舞台条）给每个活动 agent 挂 pi-purge 盾牌菜单：面板直达 + 一键动作 + 一键 update 演练 */
export function registerPiPurgePills(client: PluginClientContext): () => void {
  const lifetime = new AbortController();
  const pills = new Map<string, PluginButtonRegistration>();
  let unsubscribe: (() => void) | undefined;
  let release: (() => Promise<void>) | undefined;

  const remove = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };

  const add = (agent: AgentTarget) => {
    if (lifetime.signal.aborted || !agent.workspaceId || agent.archivedAt || agent.status === "closed") {
      remove(agent.id);
      return;
    }
    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    pills.get(agentId)?.remove();
    pills.set(
      agentId,
      client.addComposerPill({
        id: "pi-purge-composer",
        workspaceId,
        agentId,
        button: {
          title: "pi-purge 清洗控制台",
          icon: "Shield",
          label: "Purge",
          behavior: {
            kind: "menu",
            items: [
              { kind: "item", id: "open-console", title: "打开 pi-purge 控制台（桌面=侧边面板 / 手机=全屏）", icon: "Shield", behavior: { kind: "action", onPress: () => openConsole(client, workspaceId, agentId) } },
              { kind: "item", id: "open-drills", title: "打开演习台全屏", icon: "Swords", behavior: { kind: "action", onPress: () => client.openScreen({ screenId: "pi-purge-drills" }) } },
              { kind: "separator", id: "sep-actions" },
              { kind: "item", id: "guard", title: "守护检查（漂移自动重打）", icon: "ShieldCheck", behavior: { kind: "action", onPress: () => void client.rpc(purgeGuard, {}) } },
              { kind: "item", id: "apply", title: "应用清洗 Apply", icon: "Play", behavior: { kind: "action", onPress: () => void client.rpc(purgeApply, {}) } },
              { kind: "item", id: "revert", title: "回滚 Revert", icon: "Undo2", behavior: { kind: "action", onPress: () => void client.rpc(purgeRevert, {}) } },
              { kind: "separator", id: "sep-drill" },
              { kind: "item", id: "drill-update", title: "跑 update 演练（秒级）", icon: "Swords", behavior: { kind: "action", onPress: () => void client.rpc(purgeDrill, { kind: "update" }) } },
              { kind: "item", id: "drill-all", title: "全套演习（4 场实弹）", icon: "Rocket", behavior: { kind: "action", onPress: () => void (async () => { for (const k of ["update", "identity", "cap", "trust"] as const) await client.rpc(purgeDrill, { kind: k }); })() } },
            ],
          },
        },
      }),
    );
  };

  void (async () => {
    const first = await client.paseo.agents.list({ subscribe: {}, page: { limit: 200 } });
    if (lifetime.signal.aborted) {
      await first.subscription.release();
      return;
    }
    release = () => first.subscription.release();
    let entries = first.entries.map((entry) => entry.agent);
    let pageInfo = first.pageInfo;
    while (pageInfo.hasMore && pageInfo.nextCursor && !lifetime.signal.aborted) {
      const page = await client.paseo.agents.list({ page: { limit: 200, cursor: pageInfo.nextCursor } });
      entries = [...entries, ...page.entries.map((entry) => entry.agent)];
      pageInfo = page.pageInfo;
    }
    if (lifetime.signal.aborted) return;
    for (const agent of entries) add(agent);
    unsubscribe = first.subscription.subscribe({
      snapshot(snapshot) {
        for (const agent of snapshot.entries.map((entry) => entry.agent)) add(agent);
      },
      update(message) {
        if (message.type !== "agent_update") return;
        if (message.payload.kind === "upsert") add(message.payload.agent);
        else remove(message.payload.agentId);
      },
      error(error) {
        if (!lifetime.signal.aborted) console.error("pi-purge Composer 图标订阅失败", error);
      },
    });
  })().catch((error: unknown) => {
    if (!lifetime.signal.aborted) console.error("pi-purge Composer 图标初始化失败", error);
  });

  return () => {
    lifetime.abort();
    unsubscribe?.();
    if (release) void release().catch(() => undefined);
    for (const agentId of [...pills.keys()]) remove(agentId);
  };
}
