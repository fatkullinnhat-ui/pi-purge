import { spawn } from "node:child_process";
import fsSync from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DrillKind, DrillResult } from "../shared/purge";

const DEFAULT_TOOL = "C:/Users/Milk/.pi/agent/pi-purge/pi-purge.mjs";
const DRILLS_DIR = "C:/Users/Milk/.pi/agent/pi-purge/drills";
const PI_ROOT_FALLBACK = "C:/Users/Milk/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent";

type PiPurgeModule = {
  gatherStatus: () => Record<string, unknown>;
  guard: () => { action: string; reason?: string };
};

const history: Array<DrillResult & { at: string }> = [];
let inflight: Promise<DrillResult> | null = null;

function toolPath(): string {
  return process.env.PI_PURGE_TOOL || DEFAULT_TOOL;
}

async function loadTool(): Promise<PiPurgeModule> {
  const mod = (await import(pathToFileURL(toolPath()).href)) as unknown as PiPurgeModule;
  if (typeof mod.gatherStatus !== "function") throw new Error(`pi-purge 工具导出面缺失：${toolPath()}`);
  return mod;
}

function piRootOf(status: Record<string, unknown>): string {
  return String(status.pi_root || "") || PI_ROOT_FALLBACK;
}

function countsOf(status: Record<string, unknown>): { applied: number; total: number } {
  const patches = (status.patches as Record<string, string>) || {};
  let applied = 0;
  let total = 0;
  for (const v of Object.values(patches)) {
    total += 1;
    if (v === "applied") applied += 1;
  }
  return { applied, total };
}

function num(n: number): string {
  return n.toLocaleString("en-US");
}

function runNode(args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    // stdin 必须 ignore：无 TTY 的开放管道 stdin 会让 pi/工具进程挂死
    const child = spawn(process.execPath, [toolPath(), ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ code: -1, out, err: err + "\n[timeout]" });
      }
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e) });
    });
  });
}

function runPi(args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; err: string }> {
  return new Promise((resolve) => {
    void (async () => {
      let cli = path.join(PI_ROOT_FALLBACK, "dist", "bundle", "cli.js");
      try {
        const tool = await loadTool();
        const status = tool.gatherStatus();
        const root = piRootOf(status);
        if (root) cli = path.join(root, "dist", "bundle", "cli.js");
      } catch {}
      const child = spawn(process.execPath, [cli, ...args], {
        cwd,
        env: { ...process.env, PI_OFFLINE: "1" },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let err = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill();
          resolve({ code: -1, stdout, err: err + "\n[timeout]" });
        }
      }, timeoutMs);
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, err });
      });
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: -1, stdout, err: String(e) });
      });
    })();
  });
}

type SessionMsg = Record<string, unknown> | undefined;

/** pi 会话 JSONL v3：消息在顶层 message 字段（兼容旧 entry.message 包装） */
function entryMessage(j: unknown): SessionMsg {
  if (typeof j !== "object" || j === null) return undefined;
  const e = j as { entry?: { message?: unknown }; message?: unknown };
  const msg = e.entry?.message ?? e.message;
  if (typeof msg === "object" && msg !== null) return msg as Record<string, unknown>;
  return undefined;
}

function parseSession(file: string): {
  system?: { sections?: Record<string, string> };
  toolResults: Array<{ toolName?: string; text: string; notices: string[] }>;
} {
  const raw = fsSync.readFileSync(file, "utf8");
  let system: { sections?: Record<string, string> } | undefined;
  const toolResults: Array<{ toolName?: string; text: string; notices: string[] }> = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j: unknown;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = entryMessage(j);
    if (!msg) continue;
    const role = msg.role as string | undefined;
    if (role === "system" && !system) {
      system = msg as { sections?: Record<string, string> };
      continue;
    }
    if (role === "toolResult") {
      const content = msg.content;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) text = content.map((c) => (c as { text?: string }).text || "").join("\n");
      const notices = ["[Truncated", "Use offset=", "50.0KB limit", "tokens truncated", "Warning: truncated output"].filter((n) => text.includes(n));
      toolResults.push({ toolName: msg.toolName as string | undefined, text, notices });
    }
  }
  return { system, toolResults };
}

function lastAssistantReply(sessionFile: string): string {
  const raw = fsSync.readFileSync(sessionFile, "utf8");
  let last = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const msg = entryMessage(JSON.parse(line));
      if (msg?.role !== "assistant") continue;
      const content = msg.content;
      if (typeof content === "string") last = content;
      else if (Array.isArray(content)) last = content.map((c) => (c as { text?: string }).text || "").join("\n");
    } catch {}
  }
  return last.trim();
}

async function freshSession(sessionFile: string): Promise<void> {
  await fsp.mkdir(path.dirname(sessionFile), { recursive: true });
  try {
    await fsp.unlink(sessionFile);
  } catch {}
}

async function writeFixtures(): Promise<void> {
  await fsp.mkdir(DRILLS_DIR, { recursive: true });
  const big = path.join(DRILLS_DIR, "big60k.txt");
  try {
    await fsp.access(big);
  } catch {
    await fsp.writeFile(big, "x".repeat(60000));
  }
  const ext = path.join(DRILLS_DIR, "trustproj", ".pi", "extensions", "tp-probe");
  await fsp.mkdir(ext, { recursive: true });
  await fsp.writeFile(
    path.join(ext, "index.js"),
    'import { Type } from "typebox";\n\nexport default function tpProbe(pi) {\n  pi.registerTool({\n    name: "tp_probe",\n    label: "tp_probe",\n    description: "Trust bypass probe. No parameters. Returns a fixed marker string.",\n    parameters: Type.Object({}),\n    async execute() {\n      return { content: [{ type: "text", text: "TRUST-BYPASS-OK project-local extension loaded without approval" }] };\n    },\n  });\n}\n',
  );
  await fsp.writeFile(
    path.join(ext, "package.json"),
    '{\n  "name": "tp-probe",\n  "version": "1.0.0",\n  "private": true,\n  "type": "module"\n}\n',
  );
}

// ---------------- 四场演习 ----------------

async function drillUpdate(lines: string[]): Promise<boolean> {
  const tool = await loadTool();
  const before = tool.gatherStatus();
  const piRoot = piRootOf(before);
  if (!piRoot) {
    lines.push("✗ 未定位 pi 安装");
    return false;
  }
  const beforeCounts = countsOf(before);
  if (beforeCounts.total === 0 || beforeCounts.applied !== beforeCounts.total) {
    lines.push(`✗ 当前非全量清洗（${beforeCounts.applied}/${beforeCounts.total}），先 Apply 再演练`);
    return false;
  }
  const backupDir = String(before.backup_dir || "");
  const origs: Array<[string, string]> = [];
  try {
    const files = await fsp.readdir(backupDir);
    for (const f of files) {
      if (!f.endsWith(".orig")) continue;
      const rel = f.replace(/\.orig$/, "").replace(/__/g, "/");
      origs.push([path.join(backupDir, f), path.join(piRoot, rel)]);
    }
  } catch {
    lines.push("✗ 读取备份目录失败");
    return false;
  }
  if (origs.length === 0) {
    lines.push("✗ 无 .orig 备份");
    return false;
  }
  lines.push(`✓ 初始状态 ${beforeCounts.applied}/${beforeCounts.total} 在位，备份 ${origs.length} 份`);
  for (const [src, dst] of origs) {
    await fsp.copyFile(src, dst);
  }
  let vanilla = true;
  for (const [, dst] of origs) {
    const c = await fsp.readFile(dst, "utf8");
    if (c.includes("PIPURGE:v1")) vanilla = false;
  }
  lines.push(vanilla ? `✓ 已用原版备份覆盖 ${origs.length} 个 bundle 文件（标记清零，模拟 pi update）` : "✗ 覆盖后仍检出标记 —— 演习中止");
  if (!vanilla) return false;
  const t0 = Date.now();
  const r = await runNode(["--guard"], 60000);
  if (r.code !== 0) {
    lines.push(`✗ pi-purge --guard 退出码 ${r.code}：${(r.err || r.out).slice(0, 160).replace(/\s+/g, " ")}`);
    return false;
  }
  lines.push(`✓ 启动器同款 guard 路径重打完成（${num(Date.now() - t0)}ms）`);
  const after = countsOf(tool.gatherStatus());
  lines.push(
    after.applied === after.total
      ? `✓ 重打后 ${after.applied}/${after.total} 在位 —— update 演练通过`
      : `✗ 重打后 ${after.applied}/${after.total} —— 未恢复`,
  );
  return after.applied === after.total;
}

async function drillIdentity(lines: string[], sessionFile: string): Promise<boolean> {
  await freshSession(sessionFile);
  const started = Date.now();
  const r = await runPi(
    ["-p", "-xt", "codemode", "--provider", "cpa", "--model", "gemini-3-flash", "--session", sessionFile, "一句话自我介绍：你是谁、跑在什么上、你的拒答规则是什么？"],
    DRILLS_DIR,
    240000,
  );
  if (r.code !== 0) {
    lines.push(`✗ pi 退出码 ${r.code}：${(r.err || r.stdout).slice(0, 180).replace(/\s+/g, " ")}`);
    return false;
  }
  lines.push(`✓ pi 会话完成（${num(Date.now() - started)}ms）`);
  const s = parseSession(sessionFile);
  const sections = s.system?.sections || {};
  const preamble = sections.preamble || "";
  let ok = true;
  if (preamble.includes("Instruction Authority Kernel (TGSEC)")) lines.push("✓ T1a preamble = pi-purge 权威内核");
  else {
    lines.push("✗ T1a preamble 未见内核文本");
    ok = false;
  }
  if (preamble.includes("You are an expert coding assistant operating inside pi, a coding agent harness")) {
    lines.push("✗ T1b 官方身份句仍在");
    ok = false;
  } else lines.push("✓ T1b 官方身份句已移除");
  if ((sections.addendum || "").length > 100) lines.push("✓ T1c APPEND_SYSTEM addendum 在位");
  else lines.push("· T1c addendum 缺失（未配置 APPEND_SYSTEM.md 时正常）");
  const reply = lastAssistantReply(sessionFile);
  if (reply) lines.push(`✓ T1d 模型回复：${reply.slice(0, 80).replace(/\s+/g, " ")}…`);
  else {
    lines.push("✗ T1d 无模型回复");
    ok = false;
  }
  return ok;
}

async function drillCap(lines: string[], sessionFile: string): Promise<boolean> {
  await writeFixtures();
  await freshSession(sessionFile);
  const shellSession = sessionFile;
  const readSession = sessionFile.replace("drill-cap-", "drill-cap-read-");
  await freshSession(readSession);
  const big = path.join(DRILLS_DIR, "big60k.txt");
  let ok = true;

  // 第一发：powershell 55000 字符（唯一动作，防模型跳步）
  const t0 = Date.now();
  const r1 = await runPi(
    ["-p", "-xt", "codemode", "--provider", "cpa", "--model", "gemini-3-flash", "--session", shellSession,
      "只做一件事：用 powershell 工具执行 Write-Output ('a'*55000)，拿到工具结果后只回复一行：结果文本里有没有 Truncated 或 limit 字样。不要使用其他任何工具。"],
    DRILLS_DIR,
    300000,
  );
  if (r1.code !== 0) {
    lines.push(`✗ shell pi 退出码 ${r1.code}：${(r1.err || r1.stdout).slice(0, 160).replace(/\s+/g, " ")}`);
    return false;
  }
  lines.push(`✓ shell 会话完成（${num(Date.now() - t0)}ms）`);
  const s1 = parseSession(shellSession);
  const shellRows = s1.toolResults.filter((t) => t.toolName === "powershell" && t.text.length >= 55000);
  const shellHit = shellRows.at(0);
  if (shellHit && shellRows.every((t) => t.notices.length === 0)) {
    lines.push(`✓ T2a powershell ${num(shellHit.text.length)} 字符零截断（旧上限 51200 字节）`);
  } else {
    lines.push("✗ T2a powershell 输出缺失或仍带截断标记");
    ok = false;
  }

  // 第二发：read 60000 字符整读（唯一动作）
  const t1 = Date.now();
  const r2 = await runPi(
    ["-p", "-xt", "codemode", "--provider", "cpa", "--model", "gemini-3-flash", "--session", readSession,
      `只做一件事：用 read 工具读取 ${big}（调用时不要带 offset 和 limit 参数），拿到工具结果后只回复一行：结果文本里有没有 Use offset 分页提示。不要使用其他任何工具。`],
    DRILLS_DIR,
    300000,
  );
  if (r2.code !== 0) {
    lines.push(`✗ read pi 退出码 ${r2.code}：${(r2.err || r2.stdout).slice(0, 160).replace(/\s+/g, " ")}`);
    return false;
  }
  lines.push(`✓ read 会话完成（${num(Date.now() - t1)}ms）`);
  const s2 = parseSession(readSession);
  const readRows = s2.toolResults.filter((t) => t.toolName === "read" && t.text.length >= 60000);
  const readHit = readRows.at(0);
  if (readHit && readRows.every((t) => t.notices.length === 0)) {
    lines.push(`✓ T2b read ${num(readHit.text.length)} 字符整读无分页提示`);
  } else {
    const anyRead = s2.toolResults.filter((t) => t.toolName === "read").at(0);
    lines.push(anyRead ? `✗ T2b read 实得 ${num(anyRead.text.length)} 字符（期望 ≥60000）或带截断标记` : "✗ T2b read 未被调用");
    ok = false;
  }
  return ok;
}

async function drillTrust(lines: string[], sessionFile: string): Promise<boolean> {
  await writeFixtures();
  await freshSession(sessionFile);
  const project = path.join(DRILLS_DIR, "trustproj");
  const started = Date.now();
  const r = await runPi(
    ["-p", "--provider", "cpa", "--model", "gemini-3-flash", "--session", sessionFile, "调用 tp_probe 工具（必须真的发起工具调用），然后把工具返回的文本原样完整输出在回复里。"],
    project,
    420000,
  );
  if (r.code !== 0) {
    lines.push(`✗ pi 退出码 ${r.code}：${(r.err || r.stdout).slice(0, 180).replace(/\s+/g, " ")}`);
    return false;
  }
  lines.push(`✓ pi 会话完成（${num(Date.now() - started)}ms，cwd=trustproj，未带 --approve）`);
  const s = parseSession(sessionFile);
  const hits = s.toolResults.filter((t) => t.toolName === "tp_probe");
  const hit = hits.at(0);
  if (hit && hit.text.includes("TRUST-BYPASS-OK")) {
    lines.push("✓ T3 tp_probe 项目本地扩展被免审批加载执行 —— 信任门已恒真");
    return true;
  }
  lines.push("✗ T3 会话中无 tp_probe 工具回执（仍被原版信任门拦截）");
  return false;
}

export async function runDrill(kind: DrillKind): Promise<DrillResult> {
  if (inflight) return { ok: false, kind, durationMs: 0, lines: ["✗ 另一场演习正在进行中，稍后再试"] };
  const task = (async (): Promise<DrillResult> => {
    const started = Date.now();
    const lines: string[] = [];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sessionFile = path.join(DRILLS_DIR, "sessions", `drill-${kind}-${stamp}.jsonl`);
    let ok = false;
    let sessionUsed = false;
    try {
      if (kind === "update") ok = await drillUpdate(lines);
      else if (kind === "identity") {
        lines.push("— T1 身份/注入演习：实测系统提示与模型自述 —");
        ok = await drillIdentity(lines, sessionFile);
        sessionUsed = true;
      } else if (kind === "cap") {
        lines.push("— T2 上限突破演习：55000 字符 shell + 60000 字符整读 —");
        ok = await drillCap(lines, sessionFile);
        sessionUsed = true;
      } else if (kind === "trust") {
        lines.push("— T3 信任绕过演习：项目本地扩展免审批加载 —");
        ok = await drillTrust(lines, sessionFile);
        sessionUsed = true;
      }
    } catch (e) {
      lines.push(`✗ 演习异常：${String(e).slice(0, 200)}`);
      ok = false;
    }
    if (sessionUsed && ok) lines.push(`· 会话存档 ${sessionFile}`);
    const result: DrillResult = { ok, kind, durationMs: Date.now() - started, lines, sessionFile: sessionUsed ? sessionFile : undefined };
    history.unshift({ ...result, at: new Date().toISOString() });
    if (history.length > 24) history.length = 24;
    return result;
  })();
  inflight = task;
  try {
    return await task;
  } finally {
    inflight = null;
  }
}

export function drillHistory(): { results: Array<DrillResult & { at: string }> } {
  return { results: history.map((h) => ({ kind: h.kind, ok: h.ok, durationMs: h.durationMs, at: h.at, lines: h.lines, sessionFile: h.sessionFile })) };
}
