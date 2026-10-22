import { pathToFileURL } from "node:url";
import type { StatusResult } from "../shared/purge";

const DEFAULT_TOOL = "C:/Users/Milk/.pi/agent/pi-purge/pi-purge.mjs";

type AnyRecord = Record<string, unknown>;

type PiPurgeModule = {
  PATCHES: Array<{ id: number; key: string; name: string; layer: string }>;
  gatherStatus: () => AnyRecord;
  applyAll: (opts?: { quiet?: boolean }) => AnyRecord;
  revertAll: () => AnyRecord;
  guard: () => { action: string; reason?: string };
};

async function loadTool(): Promise<PiPurgeModule> {
  const tool = process.env.PI_PURGE_TOOL || DEFAULT_TOOL;
  const mod = (await import(pathToFileURL(tool).href)) as unknown as PiPurgeModule;
  if (typeof mod.gatherStatus !== "function") throw new Error(`pi-purge 工具导出面缺失：${tool}`);
  return mod;
}

export async function readStatus(): Promise<StatusResult> {
  try {
    const tool = await loadTool();
    const st = tool.gatherStatus() as {
      pi_root?: string | null;
      pi_version?: string;
      patches?: Record<string, string>;
      drift?: boolean;
      inject_bytes?: number;
      inject_exists?: boolean;
      has_backup?: boolean;
      has_state?: boolean;
      shim?: Record<string, string>;
    };
    const patches = (tool.PATCHES || []).map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      layer: p.layer,
      status: (st.patches?.[String(p.id)] as string) || "missing",
    }));
    const applied = patches.filter((p) => p.status === "applied").length;
    const pending = patches.filter((p) => p.status === "pending").length;
    const other = patches.length - applied - pending;
    return {
      ok: true,
      piRoot: st.pi_root || "",
      piVersion: st.pi_version || "unknown",
      applied,
      pending,
      other,
      total: patches.length,
      drift: !!st.drift,
      injectBytes: st.inject_bytes || 0,
      hasInject: !!st.inject_exists,
      hasBackup: !!st.has_backup,
      hasState: !!st.has_state,
      shims: Object.entries(st.shim || {}).map(([name, status]) => ({ name, status: String(status) })),
      patches,
    };
  } catch (error) {
    return {
      ok: false,
      piRoot: "",
      piVersion: "",
      applied: 0,
      pending: 0,
      other: 0,
      total: 0,
      drift: true,
      injectBytes: 0,
      hasInject: false,
      hasBackup: false,
      hasState: false,
      shims: [],
      patches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runApply(): Promise<{ ok: boolean; summary: string; error?: string }> {
  try {
    const tool = await loadTool();
    const r = tool.applyAll({ quiet: true }) as {
      report?: Array<{ id: number; name: string; status: string }>;
      shim?: Record<string, string>;
      injectSeeded?: boolean;
    };
    const report = r.report || [];
    const applied = report.filter((x) => x.status === "applied").length;
    const already = report.filter((x) => x.status === "already").length;
    const failed = report.filter((x) => x.status !== "applied" && x.status !== "already");
    const shim = Object.entries(r.shim || {})
      .map(([n, s]) => `${n}=${s}`)
      .join(" ");
    const parts = [`清洗完成：新增 ${applied}、已在位 ${already}、异常 ${failed.length}`];
    if (shim) parts.push(`shim ${shim}`);
    if (r.injectSeeded) parts.push("注入文件已播种");
    if (failed.length > 0) {
      parts.push("异常项：" + failed.map((x) => `#${x.id}(${x.status})`).join(", "));
    }
    return { ok: failed.length === 0, summary: parts.join("；") };
  } catch (error) {
    return { ok: false, summary: "", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runRevert(): Promise<{ ok: boolean; summary: string; error?: string }> {
  try {
    const tool = await loadTool();
    const r = tool.revertAll() as {
      reverted?: string[];
      errors?: Array<[string, string]>;
      shimResult?: Record<string, string>;
    };
    const reverted = r.reverted || [];
    const errors = r.errors || [];
    const parts = [`已还原 ${reverted.length} 个文件`];
    if (reverted.length > 0) parts.push(reverted.join(", "));
    if (errors.length > 0) parts.push("失败：" + errors.map(([p, e]) => `${p}: ${e}`).join("; "));
    return { ok: errors.length === 0, summary: parts.join("；") };
  } catch (error) {
    return { ok: false, summary: "", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runGuard(): Promise<{ ok: boolean; summary: string; error?: string }> {
  try {
    const tool = await loadTool();
    const g = tool.guard();
    if (g.action === "reapply") {
      const r = tool.applyAll({ quiet: true }) as { report?: Array<{ status: string }> };
      const applied = (r.report || []).filter((x) => x.status === "applied").length;
      return { ok: true, summary: `检测到漂移（${g.reason || "未知文件"}），已自动重打 ${applied} 项补丁` };
    }
    return { ok: true, summary: "健康，无漂移，无需重打" };
  } catch (error) {
    return { ok: false, summary: "", error: error instanceof Error ? error.message : String(error) };
  }
}
