import type { PluginServerContext } from "@getpaseo/plugin/server";
import { purgeApply, purgeDrill, purgeDrillHistory, purgeGuard, purgeRevert, purgeStatus } from "./shared/purge";
import { readStatus, runApply, runGuard, runRevert } from "./server/purge";
import { drillHistory, runDrill } from "./server/drills";

export default function contribute(server: PluginServerContext) {
  server.handle(purgeStatus, () => readStatus());
  server.handle(purgeApply, () => runApply());
  server.handle(purgeRevert, () => runRevert());
  server.handle(purgeGuard, () => runGuard());
  server.handle(purgeDrill, ({ kind }) => runDrill(kind));
  server.handle(purgeDrillHistory, () => drillHistory());

  // pi agent 会话启动前自动守护：bundle 漂移（pi update）即静默重打
  const offBefore = server.before("agent.session_open", async ({ request }) => {
    const provider = request.provider || "";
    if (!provider.startsWith("pi")) return;
    try {
      const r = await runGuard();
      console.log(`[pi-purge] session_open 守护（${provider}/${request.reason}）：${r.summary || r.error || ""}`);
    } catch (error) {
      console.error("[pi-purge] session_open 守护失败", error);
    }
  });

  return () => {
    offBefore();
  };
}
