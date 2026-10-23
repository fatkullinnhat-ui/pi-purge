#!/usr/bin/env node
/**
 * pi-purge v1.0.0 — pi(@earendil-works/pi-coding-agent) 指令权威性清洗
 *
 * 由 dsh-purge 移植重做：
 *   · 提示词层   preamble 官方身份 → 运行时动态加载 ~/.pi/agent/prompt-inject.md
 *   · 代码层     project-trust 审批恒真；输出/read/截断上限 50KB→500KB、2000→20000 行、grep 单行 500→4000
 *   · shim      npm 全局启动器 pi.cmd / pi.ps1 / pi 启动前 --guard 自愈
 *   · 运行时     extensions/pi-purge 扩展（session_start 自检 + before_agent_start 内核段）
 *
 * 用法:
 *   node pi-purge.mjs --status      查看状态
 *   node pi-purge.mjs --apply       应用全部清洗
 *   node pi-purge.mjs --revert      回滚（保留 prompt-inject.md 用户文件）
 *   node pi-purge.mjs --edit        编辑注入文件
 *   node pi-purge.mjs --guard       启动器守卫：漂移自动重打，正常静默
 *   node pi-purge.mjs --version / --help
 */

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = "pi-purge";
const VERSION = "1.0.0";
const MARKER = "PIPURGE:v1";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
const PURGE_HOME = process.env.PI_PURGE_HOME || path.join(AGENT_DIR, "pi-purge");
const BACKUP_DIR = path.join(PURGE_HOME, "backup");
const STATE_FILE = path.join(PURGE_HOME, "state.json");
const INJECT_FILE = process.env.PI_PURGE_INJECT || path.join(AGENT_DIR, "prompt-inject.md");
const DEFAULT_INJECT = path.join(PURGE_HOME, "default-prompt-inject.md");

const ORIG_PREAMBLE =
	"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

// ---------------------------------------------------------------------------
// 补丁表：find 为字节精确锚点（全 chunk 唯一，已核验）；probe 为替换后特征串
// layer: 提示词/Prompt · 代码/Code · 工具/Tools · 引擎级/Shim
// ---------------------------------------------------------------------------
const PATCHES = [
	{
		id: 1,
		key: "preamble-inject",
		name: "preamble 官方身份 → 注入文件动态加载",
		layer: "提示词",
		layer_en: "Prompt",
		find: `promptSections.preamble="${ORIG_PREAMBLE}"`,
		probe: `${MARKER}*/(()=>{try{const _bm=process.getBuiltinModule`,
		replace:
			`promptSections.preamble=/*${MARKER}*/(()=>{try{const _bm=process.getBuiltinModule,` +
			`_fs=_bm("fs"),_pa=_bm("path"),` +
			`_inj=process.env.PI_PURGE_INJECT||_pa.join(_bm("os").homedir(),".pi","agent","prompt-inject.md");` +
			`if(_fs.existsSync(_inj)){const _t=_fs.readFileSync(_inj,"utf8").trim();if(_t)return _t}}catch(_e){}` +
			`return"${ORIG_PREAMBLE}"})()`,
	},
	{
		id: 2,
		key: "trust-auto",
		name: "project-trust 审批门恒真（--approve 缺省开启）",
		layer: "代码",
		layer_en: "Code",
		find: "isProjectTrusted(){return this.projectTrusted}",
		probe: "isProjectTrusted(){return/*PIPURGE:v1*/!0}",
		replace: `isProjectTrusted(){return/*${MARKER}*/!0}`,
	},
	{
		id: 3,
		key: "bash-cap",
		name: "shell 输出围栏 2000 行/50KB → 20000 行/500KB",
		layer: "代码",
		layer_en: "Code",
		find: "this.maxLines=options.maxLines??2e3,this.maxBytes=options.maxBytes??51200",
		probe: "this.maxBytes=options.maxBytes??512000",
		replace: "this.maxLines=options.maxLines??2e4,this.maxBytes=options.maxBytes??512000/*PIPURGE:v1*/",
	},
	{
		id: 4,
		key: "bash-desc",
		name: "bash/PowerShell 描述同步新上限",
		layer: "工具",
		layer_en: "Tools",
		find: "Output is truncated to last ${2e3} lines or ${51200/1024}KB (whichever is hit first).",
		probe: "Output is truncated to last ${2e4} lines",
		replace: "Output is truncated to last ${2e4} lines or ${512000/1024}KB (whichever is hit first).",
	},
	{
		id: 5,
		key: "read-desc",
		name: "read 描述同步新上限",
		layer: "工具",
		layer_en: "Tools",
		find: "For text files, output is truncated to ${2e3} lines or ${51200/1024}KB (whichever is hit first).",
		probe: "For text files, output is truncated to ${2e4} lines",
		replace: "For text files, output is truncated to ${2e4} lines or ${512000/1024}KB (whichever is hit first).",
	},
	{
		id: 6,
		key: "read-sed-hint",
		name: "read 超限提示 sed 路径同步",
		layer: "工具",
		layer_en: "Tools",
		find: "exceeds ${formatSize(51200)} limit. Use bash: sed -n '${startLineDisplay}p' ${path10} | head -c ${51200}",
		probe: "head -c ${512000}",
		replace: "exceeds ${formatSize(512000)} limit. Use bash: sed -n '${startLineDisplay}p' ${path10} | head -c ${512000}",
	},
	{
		id: 7,
		key: "read-offset-hint",
		name: "read 分页提示同步",
		layer: "工具",
		layer_en: "Tools",
		find: "(${formatSize(51200)} limit). Use offset=${nextOffset} to continue.",
		probe: "(${formatSize(512000)} limit). Use offset=",
		replace: "(${formatSize(512000)} limit). Use offset=${nextOffset} to continue.",
	},
	{
		id: 8,
		key: "tui-ctx-cap",
		name: "TUI 终端回显上下文 2000 行/50KB → 5000 行/500KB",
		layer: "工具",
		layer_en: "Tools",
		find: "truncateTail(fullOutput,{maxLines:2e3,maxBytes:51200})",
		probe: "truncateTail(fullOutput,{maxLines:5e3,maxBytes:512000})",
		replace: "truncateTail(fullOutput,{maxLines:5e3,maxBytes:512000})",
	},
	{
		id: 9,
		key: "truncate-head",
		name: "read/find/grep/ls 共用截断原语默认 2000 行/50KB → 20000/500KB",
		layer: "代码",
		layer_en: "Code",
		find: "function truncateHead(content,options={}){let maxLines=options.maxLines??2e3,maxBytes=options.maxBytes??51200",
		probe: "function truncateHead(content,options={}){let maxLines=options.maxLines??2e4",
		replace: "function truncateHead(content,options={}){let maxLines=options.maxLines??2e4,maxBytes=options.maxBytes??512000",
	},
	{
		id: 10,
		key: "truncate-tail",
		name: "tail 截断原语默认 2000 行/50KB → 20000/500KB",
		layer: "代码",
		layer_en: "Code",
		find: "function truncateTail(content,options={}){let maxLines=options.maxLines??2e3,maxBytes=options.maxBytes??51200",
		probe: "function truncateTail(content,options={}){let maxLines=options.maxLines??2e4",
		replace: "function truncateTail(content,options={}){let maxLines=options.maxLines??2e4,maxBytes=options.maxBytes??512000",
	},
	{
		id: 11,
		key: "legacy-bash-cap",
		name: "旧 shell 路径输出上限 100KB → 1MB",
		layer: "代码",
		layer_en: "Code",
		find: "maxOutputBytes=51200*2",
		probe: "maxOutputBytes=512000*2",
		replace: "maxOutputBytes=512000*2",
	},
	{
		id: 12,
		key: "legacy-bash-tempfile",
		name: "旧 shell 路径临时文件阈值同步",
		layer: "代码",
		layer_en: "Code",
		find: "totalBytes>51200&&ensureTempFile()",
		probe: "totalBytes>512000&&ensureTempFile()",
		replace: "totalBytes>512000&&ensureTempFile()",
	},
	{
		id: 13,
		key: "find-desc",
		name: "find 描述同步新上限",
		layer: "工具",
		layer_en: "Tools",
		find: "Output is truncated to ${DEFAULT_LIMIT} results or ${51200/1024}KB",
		probe: "Output is truncated to ${DEFAULT_LIMIT} results or ${512000/1024}KB",
		replace: "Output is truncated to ${DEFAULT_LIMIT} results or ${512000/1024}KB",
	},
	{
		id: 14,
		key: "grep-desc",
		name: "grep 描述同步新上限",
		layer: "工具",
		layer_en: "Tools",
		find: "Output is truncated to ${DEFAULT_LIMIT2} matches or ${51200/1024}KB",
		probe: "Output is truncated to ${DEFAULT_LIMIT2} matches or ${512000/1024}KB",
		replace: "Output is truncated to ${DEFAULT_LIMIT2} matches or ${512000/1024}KB",
	},
	{
		id: 15,
		key: "ls-desc",
		name: "ls 描述同步新上限",
		layer: "工具",
		layer_en: "Tools",
		find: "Output is truncated to ${DEFAULT_LIMIT3} entries or ${51200/1024}KB",
		probe: "Output is truncated to ${DEFAULT_LIMIT3} entries or ${512000/1024}KB",
		replace: "Output is truncated to ${DEFAULT_LIMIT3} entries or ${512000/1024}KB",
	},
	{
		id: 16,
		key: "grep-line-cap",
		name: "grep 单行截断 500 → 4000 字符",
		layer: "代码",
		layer_en: "Code",
		find: "function truncateLine(line,maxChars=500)",
		probe: "function truncateLine(line,maxChars=4000)",
		replace: "function truncateLine(line,maxChars=4000)",
	},
	{
		id: 17,
		key: "codemode-output-cap",
		name: "codemode 输出预算 10k token(40KB) → 200k token(800KB)",
		layer: "引擎级",
		layer_en: "Engine",
		find: "var DEFAULT_MAX_OUTPUT_TOKENS=1e4,CHARS_PER_TOKEN=4;",
		probe: "var DEFAULT_MAX_OUTPUT_TOKENS=2e5,CHARS_PER_TOKEN=4;",
		replace: "var DEFAULT_MAX_OUTPUT_TOKENS=2e5,CHARS_PER_TOKEN=4;",
	},
	{
		id: 18,
		key: "mcp-output-cap",
		name: "MCP 工具结果夹子 20KB → 500KB",
		layer: "引擎级",
		layer_en: "Engine",
		find: "MCP_OUTPUT_MAX_BYTES=20*1024",
		probe: "MCP_OUTPUT_MAX_BYTES=512000",
		replace: "MCP_OUTPUT_MAX_BYTES=512000",
	},
];

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function findPiRoot() {
	if (process.env.PI_PURGE_PI_ROOT) {
		const c = process.env.PI_PURGE_PI_ROOT;
		if (fs.existsSync(path.join(c, "dist", "bundle", "cli.js"))) return c;
	}
	const candidates = [];
	if (process.platform === "win32") {
		candidates.push(path.join(process.env.APPDATA || "", "npm", "node_modules", "@earendil-works", "pi-coding-agent"));
		candidates.push(path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "@earendil-works", "pi-coding-agent"));
	} else {
		candidates.push(path.join(os.homedir(), ".npm-global", "lib", "node_modules", "@earendil-works", "pi-coding-agent"));
		candidates.push(path.join("/usr", "local", "lib", "node_modules", "@earendil-works", "pi-coding-agent"));
		candidates.push(path.join("/usr", "lib", "node_modules", "@earendil-works", "pi-coding-agent"));
	}
	for (const c of candidates) if (fs.existsSync(path.join(c, "dist", "bundle", "cli.js"))) return c;
	try {
		const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
		const root = execFileSync(npmBin, ["root", "-g"], { encoding: "utf8" }).trim();
		const c = path.join(root, "@earendil-works", "pi-coding-agent");
		if (fs.existsSync(path.join(c, "dist", "bundle", "cli.js"))) return c;
	} catch {}
	return null;
}

function packageVersion(piRoot) {
	try {
		return JSON.parse(fs.readFileSync(path.join(piRoot, "package.json"), "utf8")).version || "unknown";
	} catch {
		return "unknown";
	}
}

/** dist/bundle 及 chunks 下全部 .js（补丁锚点搜索宇宙） */
function bundleJsFiles(piRoot) {
	const dirs = [path.join(piRoot, "dist", "bundle"), path.join(piRoot, "dist", "bundle", "chunks")];
	const out = [];
	for (const d of dirs) {
		let names = [];
		try {
			names = fs.readdirSync(d);
		} catch {
			continue;
		}
		for (const n of names) if (n.endsWith(".js")) out.push(path.join(d, n));
	}
	return out;
}

function relOf(piRoot, f) {
	return path.relative(piRoot, f).split(path.sep).join("/");
}

function absOf(piRoot, rel) {
	return path.join(piRoot, ...rel.split("/"));
}

function readState() {
	try {
		return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
	} catch {
		return null;
	}
}

function writeState(state) {
	fs.mkdirSync(PURGE_HOME, { recursive: true });
	fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadContents(piRoot) {
	const map = new Map(); // rel -> string
	for (const f of bundleJsFiles(piRoot)) map.set(relOf(piRoot, f), fs.readFileSync(f, "utf8"));
	return map;
}

/** 在搜索宇宙里找 needle，返回全部命中 rel；stateHint 优先 */
function locate(contents, needle, hintRels) {
	if (!needle) return [];
	const order = [...(hintRels || [])];
	for (const rel of contents.keys()) if (!order.includes(rel)) order.push(rel);
	const hits = [];
	for (const rel of order) {
		if ((contents.get(rel) || "").includes(needle)) {
			hits.push(rel);
			if (hits.length > 2) break;
		}
	}
	return hits;
}

function backupFile(piRoot, rel) {
	fs.mkdirSync(BACKUP_DIR, { recursive: true });
	const dest = path.join(BACKUP_DIR, rel.replace(/[\\/:*?"<>|]/g, "__") + ".orig");
	if (!fs.existsSync(dest)) {
		fs.copyFileSync(absOf(piRoot, rel), dest);
		return { path: dest, created: true };
	}
	return { path: dest, created: false };
}

// ---------------------------------------------------------------------------
// 状态检测
// ---------------------------------------------------------------------------
function gatherStatus() {
	const piRoot = findPiRoot();
	const state = readState();
	const out = {
		pi_root: piRoot,
		pi_version: piRoot ? packageVersion(piRoot) : "unknown",
		has_state: !!state,
		state: state || null,
		inject: INJECT_FILE,
		inject_exists: fs.existsSync(INJECT_FILE),
		inject_bytes: 0,
		backup_dir: BACKUP_DIR,
		has_backup: fs.existsSync(BACKUP_DIR) && fs.readdirSync(BACKUP_DIR).length > 0,
		patches: {},
		files: {}, // rel -> {hash, matches_state}
		shim: {},
	};
	if (fs.existsSync(INJECT_FILE)) out.inject_bytes = fs.statSync(INJECT_FILE).size;
	if (!piRoot) return out;

	const contents = loadContents(piRoot);
	const hintRels = state?.files ? Object.keys(state.files) : [];
	let drift = false;

	for (const p of PATCHES) {
		const probeHits = locate(contents, p.probe, hintRels);
		if (probeHits.length === 1) {
			out.patches[p.id] = "applied";
			out.files[probeHits[0]] = probeHits[0];
			continue;
		}
		if (probeHits.length > 1) {
			out.patches[p.id] = "ambiguous";
			continue;
		}
		const findHits = locate(contents, p.find, hintRels);
		if (findHits.length === 1) {
			out.patches[p.id] = "pending";
			out.files[findHits[0]] = findHits[0];
		} else if (findHits.length > 1) {
			out.patches[p.id] = "ambiguous";
		} else {
			out.patches[p.id] = state?.patches?.[String(p.id)] === "applied" ? "drift" : "missing";
		}
	}

	// 记录涉及文件 + 哈希漂移
	const touchedRels = [...new Set(Object.values(out.files))];
	out.touched_files = touchedRels;
	for (const rel of touchedRels) {
		try {
			const h = sha256(fs.readFileSync(absOf(piRoot, rel)));
			out.files[rel] = h;
			if (state?.files?.[rel] && state.files[rel] !== h) drift = true;
			if (!state?.files?.[rel]) drift = true; // 新文件布局
		} catch {}
	}
	out.drift = drift;

	// shim 状态(Windows 三件套 + Linux symlink wrapper 双形态)
	const npmDir = path.resolve(piRoot, "..", "..", "..");
	for (const name of ["pi.cmd", "pi.ps1", "pi"]) {
		const f = path.join(npmDir, name);
		if (!fs.existsSync(f) && !fs.lstatSyncSafe) {
			// linux: npmDir 下无此名 → 试 npm 全局 bin(如 /usr/bin/pi)
			const lc = linuxShimPath(npmDir, name);
			if (lc && fs.existsSync(lc)) { out.shim[name] = shimStateAt(lc); continue; }
			out.shim[name] = "missing";
			continue;
		}
		try {
			if (fs.existsSync(f)) { out.shim[name] = shimStateAt(f); continue; }
		} catch {}
		const lc2 = linuxShimPath(npmDir, name);
		if (lc2 && fs.existsSync(lc2)) { out.shim[name] = shimStateAt(lc2); continue; }
		out.shim[name] = "missing";
	}
	out.npm_dir = npmDir;
	return out;
}

// ---------------------------------------------------------------------------
// apply / revert / guard / shim
// ---------------------------------------------------------------------------
function applyAll({ quiet = false } = {}) {
	const piRoot = findPiRoot();
	if (!piRoot) {
		if (!quiet) console.log("[ERROR] 未定位 pi 安装（npm 全局 @earendil-works/pi-coding-agent）。");
		return { ok: false, reason: "pi-root-missing" };
	}

	fs.mkdirSync(PURGE_HOME, { recursive: true });
	fs.mkdirSync(BACKUP_DIR, { recursive: true });

	// 注入文件：缺失则种默认
	let injectSeeded = false;
	if (!fs.existsSync(INJECT_FILE)) {
		const src = fs.existsSync(DEFAULT_INJECT) ? fs.readFileSync(DEFAULT_INJECT, "utf8") : `# pi-purge\n\n${ORIG_PREAMBLE}\n`;
		fs.writeFileSync(INJECT_FILE, src);
		injectSeeded = true;
	}

	const prev = readState();
	const hintRels = prev?.files ? Object.keys(prev.files) : [];
	const contents = loadContents(piRoot);
	const report = [];
	const next = {
		tool: TOOL,
		version: VERSION,
		piRoot,
		piPackageVersion: packageVersion(piRoot),
		appliedAt: new Date().toISOString(),
		patches: { ...(prev?.patches || {}) },
		files: { ...(prev?.files || {}) },
	};

	const dirty = new Set();

	for (const p of PATCHES) {
		const probeHits = locate(contents, p.probe, hintRels);
		if (probeHits.length === 1) {
			next.patches[String(p.id)] = "applied";
			report.push({ id: p.id, name: p.name, status: "already" });
			continue;
		}
		const findHits = locate(contents, p.find, hintRels);
		if (findHits.length !== 1) {
			next.patches[String(p.id)] = findHits.length === 0 ? "missing" : "ambiguous";
			report.push({ id: p.id, name: p.name, status: findHits.length === 0 ? "missing" : "ambiguous" });
			continue;
		}
		const rel = findHits[0];
		let content = contents.get(rel);
		// 单文件内也需要唯一
		const count = content.split(p.find).length - 1;
		if (count !== 1) {
			next.patches[String(p.id)] = "ambiguous";
			report.push({ id: p.id, name: p.name, status: "ambiguous" });
			continue;
		}
		const bk = backupFile(piRoot, rel);
		if (bk.created && content.includes(MARKER)) {
			report.push({ id: p.id, name: p.name, status: "warn-backup-over-patched" });
		}
		content = content.replace(p.find, p.replace);
		contents.set(rel, content);
		dirty.add(rel);
		next.patches[String(p.id)] = "applied";
		report.push({ id: p.id, name: p.name, status: "applied", file: rel, backup: bk.path });
	}

	for (const rel of dirty) {
		const abs = absOf(piRoot, rel);
		fs.writeFileSync(abs, contents.get(rel), "utf8");
		next.files[rel] = sha256(Buffer.from(contents.get(rel), "utf8"));
	}
	// 已在旧状态里的其他文件哈希校验
	for (const rel of Object.keys(next.files)) {
		if (dirty.has(rel)) continue;
		try {
			next.files[rel] = sha256(fs.readFileSync(absOf(piRoot, rel)));
		} catch {
			delete next.files[rel];
		}
	}

	const shim = shimLaunchers(piRoot, { quiet });
	next.shim = shim;
	next.inject = INJECT_FILE;
	next.injectSeeded = injectSeeded || prev?.injectSeeded || false;
	writeState(next);

	return { ok: true, piRoot, report, shim, injectSeeded };
}

function linuxShimPath(npmDir, name) {
	// Linux npm 全局 bin 与包根分置(如 /usr/bin vs /usr/lib/node_modules/...)。name 无扩展名时按 bin 布局推导。
	if (name !== "pi") return null;
	const cands = [];
	try { cands.push(...whichPiCandidates()); } catch {}
	cands.push("/usr/local/bin/pi", "/usr/bin/pi", path.join(npmDir, "bin", "pi"));
	for (const c of cands) if (fs.existsSync(c)) return c;
	return null;
}
function whichPiCandidates() {
	const out = [];
	try {
		const p = require.resolve ? null : null;
	} catch {}
	try {
		const { execSync } = require("node:child_process");
		const w = execSync("command -v pi || which pi 2>/dev/null", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		if (w) out.push(w);
	} catch {}
	return out;
}
function shimStateAt(f) {
	try {
		const st = fs.lstatSync(f);
		if (st.isSymbolicLink()) return "symlink";
		const c = fs.readFileSync(f, "utf8");
		if (c.includes("pi-purge.mjs")) return "patched";
		return st.isFile() ? "pending" : "symlink";
	} catch {
		return "missing";
	}
}
function shimLaunchers(piRoot, { quiet = false } = {}) {
	const npmDir = path.resolve(piRoot, "..", "..", "..");
	const toolMjs = path.join(PURGE_HOME, "pi-purge.mjs");
	const result = {};
	for (const name of ["pi.cmd", "pi.ps1", "pi"]) {
		let f = path.join(npmDir, name);
		let isLinuxWrapper = false;
		if (!fs.existsSync(f)) {
			// Linux 布局:npm bin 不在 npmDir 顶。定位真实 pi 启动器(symlink→wrapper 化)
			if (process.platform !== "win32") {
				const lc = linuxShimPath(npmDir, name);
				if (lc) {
					f = lc;
					isLinuxWrapper = true;
				} else {
					result[name] = "missing";
					continue;
				}
			} else {
				result[name] = "missing";
				continue;
			}
		} else if (process.platform !== "win32" && name === "pi") {
			// npmDir 顶存在同名文件时也检查 lstat 形态;symlink 同样走 wrapper 化
			try {
				if (fs.lstatSync(f).isSymbolicLink()) isLinuxWrapper = true;
			} catch {}
		}
		if (isLinuxWrapper) {
			result[name] = linuxWrapShim(f, toolMjs);
			continue;
		}
		let content = fs.readFileSync(f, "utf8");
		if (content.includes("pi-purge.mjs")) {
			result[name] = "already_patched";
			continue;
		}
		const eol = content.includes("\r\n") ? "\r\n" : "\n";
		let insert = null;
		if (name === "pi.cmd") {
			insert = `if exist "${toolMjs}" node "${toolMjs}" --guard`;
		} else if (name === "pi.ps1") {
			insert = `if (Test-Path "${toolMjs}") { node "${toolMjs}" --guard }`;
		} else {
			insert = `if [ -f "${toolMjs.split(path.sep).join("/")}" ]; then node "${toolMjs.split(path.sep).join("/")}" --guard; fi`;
		}
		if (name === "pi.cmd") {
			// 插在 @ECHO off 之后
			const marker = "@ECHO off";
			const idx = content.indexOf(marker);
			if (idx < 0) {
				result[name] = "anchor-missing";
				continue;
			}
			const at = idx + marker.length;
			content = content.slice(0, at) + eol + insert + content.slice(at);
		} else if (name === "pi.ps1") {
			const marker = "$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent";
			const idx = content.indexOf(marker);
			if (idx < 0) {
				result[name] = "anchor-missing";
				continue;
			}
			const at = idx + marker.length;
			content = content.slice(0, at) + eol + insert + content.slice(at);
		} else {
			const lines = content.split(/\r?\n/);
			let done = false;
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].startsWith("#!")) {
					lines.splice(i + 1, 0, insert);
					done = true;
					break;
				}
			}
			if (!done) lines.unshift(insert);
			content = lines.join(eol);
		}
		fs.writeFileSync(f, content, "utf8");
		result[name] = "patched";
	}
	return result;
}

// Linux 启动器 shim:symlink → guard wrapper(带 .pi-symlink 备份,可逆)
function linuxWrapShim(f, toolMjs) {
	try {
		const st = fs.lstatSync(f);
		if (!st.isSymbolicLink()) {
			const c = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
			if (c.includes("pi-purge.mjs")) return "already_patched";
			return "not-a-symlink";
		}
		const target = fs.readlinkSync(f);
		// exec 必须绝对路径:相对 symlink target 按 cwd 解析会炸
		const targetAbs = path.isAbsolute(target) ? target : path.resolve(path.dirname(f), target);
		const toolPath = toolMjs.split(path.sep).join("/");
		const wrapper = [
			"#!/bin/sh",
			"# pi-purge shim wrapper (auto-generated; revert: node pi-purge.mjs --revert)",
			`if [ -f "${toolPath}" ]; then node "${toolPath}" --guard >/dev/null 2>&1; fi`,
			`exec ${JSON.stringify(targetAbs)} "$@"`,
			"",
		].join("\n");
		// 备份原 symlink 描述,原子替换
		const meta = path.join(PURGE_HOME, "shim-meta.json");
		let metas = {};
		try { metas = JSON.parse(fs.readFileSync(meta, "utf8")); } catch {}
		metas[f] = { target, wrappedAt: new Date().toISOString() };
		fs.writeFileSync(meta, JSON.stringify(metas, null, 2), "utf8");
		const tmp = f + ".piwrap.tmp";
		fs.writeFileSync(tmp, wrapper, "utf8");
		fs.chmodSync(tmp, 0o755);
		fs.rmSync(f);
		fs.renameSync(tmp, f);
		return "patched";
	} catch (e) {
		return "error:" + String(e && e.message || e).slice(0, 80);
	}
}
function linuxUnwrapShim(f) {
	try {
		const meta = path.join(PURGE_HOME, "shim-meta.json");
		let metas = {};
		try { metas = JSON.parse(fs.readFileSync(meta, "utf8")); } catch {}
		const m = metas[f];
		if (!m || !fs.existsSync(f)) return "clean";
		const c = fs.readFileSync(f, "utf8");
		if (!c.includes("pi-purge.mjs")) return "clean";
		fs.rmSync(f);
		fs.symlinkSync(m.target, f);
		delete metas[f];
		fs.writeFileSync(meta, JSON.stringify(metas, null, 2), "utf8");
		return "stripped";
	} catch (e) {
		return "error:" + String(e && e.message || e).slice(0, 80);
	}
}
function revertAll() {
	const piRoot = findPiRoot();
	const state = readState();
	const reverted = [];
	const errors = [];
	if (piRoot && fs.existsSync(BACKUP_DIR)) {
		for (const name of fs.readdirSync(BACKUP_DIR)) {
			if (!name.endsWith(".orig")) continue;
			const rel = name.slice(0, -5).replace(/__/g, "/");
			const abs = absOf(piRoot, rel);
			try {
				fs.mkdirSync(path.dirname(abs), { recursive: true });
				fs.copyFileSync(path.join(BACKUP_DIR, name), abs);
				reverted.push(rel);
			} catch (e) {
				errors.push([rel, String(e)]);
			}
		}
	}

	// 启动器去 shim：删除含 pi-purge.mjs 的行
	const shimResult = {};
	if (piRoot) {
		const npmDir = path.resolve(piRoot, "..", "..", "..");
		for (const name of ["pi.cmd", "pi.ps1", "pi"]) {
			let f = path.join(npmDir, name);
			if (!fs.existsSync(f) && process.platform !== "win32") {
				const lc = linuxShimPath(npmDir, name);
				if (lc) f = lc;
			}
			if (!fs.existsSync(f)) {
				shimResult[name] = "missing";
				continue;
			}
			// Linux wrapper:symlink 恢复
			try {
				if (process.platform !== "win32") {
					const c0 = fs.readFileSync(f, "utf8");
					if (c0.includes("pi-purge.mjs") && !fs.lstatSync(f).isSymbolicLink()) {
						const t = linuxUnwrapShim(f);
						if (t === "stripped") { shimResult[name] = "stripped(wrapper)"; continue; }
					}
				}
			} catch {}
			let content = fs.readFileSync(f, "utf8");
			if (!content.includes("pi-purge.mjs")) {
				shimResult[name] = "clean";
				continue;
			}
			const eol = content.includes("\r\n") ? "\r\n" : "\n";
			const lines = content.split(/\r?\n/).filter((l) => !l.includes("pi-purge.mjs"));
			fs.writeFileSync(f, lines.join(eol), "utf8");
			shimResult[name] = "stripped";
		}
	}

	if (fs.existsSync(STATE_FILE)) {
		const s = readState();
		fs.renameSync(STATE_FILE, STATE_FILE + ".reverted");
		return { reverted, errors, shimResult, injectKept: s?.inject || INJECT_FILE };
	}
	return { reverted, errors, shimResult, injectKept: INJECT_FILE };
}

// guard：状态哈希全吻合 → 静默；有漂移 → 重打
function guard() {
	const state = readState();
	if (!state || !state.appliedAt || !state.piRoot) return { action: "noop" };
	const piRoot = state.piRoot;
	for (const [rel, hash] of Object.entries(state.files || {})) {
		try {
			const h = sha256(fs.readFileSync(absOf(piRoot, rel)));
			if (h !== hash) return { action: "reapply", reason: rel };
		} catch {
			return { action: "reapply", reason: "file-missing:" + rel };
		}
	}
	return { action: "noop" };
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
function printStatus(st) {
	const out = [];
	out.push("pi-purge 状态 / Status  v" + VERSION);
	out.push("  pi 安装 / install   " + (st.pi_root || "未定位 / not found"));
	if (st.pi_root) out.push("  pi 版本 / version   " + st.pi_version);
	out.push("  agent 目录          " + AGENT_DIR);
	out.push("  注入文件 / inject   " + st.inject + (st.inject_exists ? ` (${st.inject_bytes} bytes)` : " （缺失，apply 时播种 / missing, seeded on apply)"));
	out.push("  备份 / backup       " + (st.has_backup ? "有 / yes → " + BACKUP_DIR : "无 / no"));
	out.push("  状态文件            " + (st.has_state ? "有 / yes" : "无 / no"));
	out.push("  漂移 / drift        " + (st.drift ? "是 / yes（pi 更新或文件改动）" : "否 / no"));
	out.push("");
	const counts = { applied: 0, pending: 0, drift: 0, missing: 0, ambiguous: 0 };
	for (const p of PATCHES) {
		const s = st.patches[p.id] || "missing";
		counts[s] = (counts[s] || 0) + 1;
	}
	out.push(`  补丁 ${counts.applied || 0}/${PATCHES.length} 已清洗, ${counts.pending || 0} 待清洗${counts.drift ? `, ${counts.drift} 漂移` : ""}`);
	for (const p of PATCHES) {
		const s = st.patches[p.id] || "missing";
		const mark = s === "applied" ? "✓" : s === "pending" ? "✗" : "·";
		out.push(`    ${mark} [#${String(p.id).padEnd(2)}] ${(p.key + "：" + p.name).padEnd(46)} ${p.layer}/${p.layer_en} — ${s}`);
	}
	out.push("");
	const shims = Object.entries(st.shim)
		.map(([n, s]) => `${n}=${s}`)
		.join("  ");
	out.push("  shim: " + (shims || "未定位"));
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
	const args = process.argv.slice(2);
	const mode = args.find((a) => ["--status", "--apply", "--revert", "--edit", "--guard", "--help", "--version"].includes(a));

	if (args.includes("-h") || mode === "--help") {
		console.log(`pi-purge 用法:
  node pi-purge.mjs --status     显示状态
  node pi-purge.mjs --apply      应用全部清洗（提示词+代码+shim+注入文件）
  node pi-purge.mjs --revert     回滚还原（保留 prompt-inject.md）
  node pi-purge.mjs --edit       编辑注入文件 prompt-inject.md
  node pi-purge.mjs --guard      启动器守卫（漂移自动重打，正常静默）
  node pi-purge.mjs --help      本帮助`);
		return;
	}
	if (mode === "--version" || args.includes("-v")) {
		console.log(TOOL + " " + VERSION);
		return;
	}

	if (mode === "--guard") {
		const g = guard();
		if (g.action === "reapply") {
			applyAll({ quiet: true });
			if (process.stderr.isTTY) process.stderr.write(`[pi-purge] 检测到 ${g.reason} 漂移，已自动重打补丁。\n`);
		}
		return;
	}

	const st = gatherStatus();
	console.log(printStatus(st));
	console.log("");

	if (mode === "--apply") {
		if (!st.pi_root) {
			console.log("[ERROR] 未定位 pi 安装。设置 PI_PURGE_PI_ROOT 指到 pi-coding-agent 根目录。");
			process.exit(1);
		}
		const r = applyAll();
		for (const x of r.report) {
			const m =
				x.status === "applied"
					? "✓ 已清洗"
					: x.status === "already"
						? "- 已是最新"
						: x.status === "missing"
							? "✗ 锚点缺失"
							: `⚠ ${x.status}`;
			console.log(`  ${m} patch #${String(x.id).padEnd(2)} ${x.name}`);
		}
		for (const [n, s] of Object.entries(r.shim)) {
			if (s === "patched") console.log(`  ✓ shim ${n} 已注入 / injected`);
			else if (s === "already_patched") console.log(`  - shim ${n} 已注入 / already`);
			else if (s === "missing") console.log(`  - shim ${n} 不存在 / missing`);
			else console.log(`  ⚠ shim ${n}: ${s}`);
		}
		if (r.injectSeeded) console.log(`  ✓ 注入文件已播种：${INJECT_FILE}`);
		console.log("");
		console.log("全部完成 / All done。新开 pi 会话生效（启动器自带 guard，pi update 后自动重打）。");
	} else if (mode === "--revert") {
		const r = revertAll();
		for (const p of r.reverted) console.log(`  ✓ 已还原 / Reverted ${p}`);
		for (const [p, e] of r.errors) console.log(`  ⚠ 还原失败 ${p}: ${e}`);
		if (r.reverted.length === 0) console.log("  - 没有补丁备份可还原 / no patch backup");
		for (const [n, s] of Object.entries(r.shimResult)) console.log(`  - shim ${n}: ${s}`);
		console.log("");
		console.log("回滚完成 / Revert done。");
		console.log(`注: prompt-inject.md 保留（用户文件）→ ${r.injectKept}`);
	} else if (mode === "--edit") {
		if (!fs.existsSync(INJECT_FILE)) {
			fs.mkdirSync(path.dirname(INJECT_FILE), { recursive: true });
			const src = fs.existsSync(DEFAULT_INJECT) ? fs.readFileSync(DEFAULT_INJECT, "utf8") : "";
			fs.writeFileSync(INJECT_FILE, src);
			console.log(`  ✓ 已创建默认注入文件：${INJECT_FILE}`);
		}
		const editor = process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
		try {
			spawn(editor, [INJECT_FILE], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
			console.log(`  → 已打开 ${editor} 编辑：${INJECT_FILE}`);
		} catch (e) {
			console.log(`  ⚠ 打开编辑器失败：${e}`);
		}
		console.log("  注入文件运行时读取（preamble 补丁），编辑后无需重打、新会话即生效。");
	} else {
		console.log("默认不清洗，使用 --apply 应用清洗。");
	}
}

// 作为模块被导入时（扩展）不自动执行 CLI
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
	main().catch((e) => {
		console.error("[pi-purge] error:", e);
		process.exit(1);
	});
}

// ---------------------------------------------------------------------------
// 扩展 / 模块导出（extensions/pi-purge 使用）
// ---------------------------------------------------------------------------
export { PATCHES, MARKER, VERSION, guard, applyAll, revertAll, gatherStatus, INJECT_FILE, AGENT_DIR, PURGE_HOME, STATE_FILE };
