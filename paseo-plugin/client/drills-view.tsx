import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { purgeDrill, purgeDrillHistory, type DrillKind } from "../shared/purge";

const DRILLS: Array<{ kind: DrillKind; title: string; desc: string }> = [
  { kind: "update", title: "T4 · update 演练", desc: "原版备份覆盖 bundle 模拟 pi update → guard 自愈重打（秒级，无 LLM）" },
  { kind: "identity", title: "T1 · 身份注入演习", desc: "拉起真实 pi 会话，取证 preamble 内核/官方句移除/模型自述" },
  { kind: "cap", title: "T2 · 上限突破演习", desc: "55000 字符 powershell + 60000 字符整读，验四层夹子全开" },
  { kind: "trust", title: "T3 · 信任绕过演习", desc: "项目本地扩展 tp_probe 免审批加载执行（无 --approve）" },
];

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function PiPurgeDrillsBody(props: PluginHostProps & { embedded?: boolean }) {
  const { theme, layout } = props;
  const drillRpc = useRpc(purgeDrill);
  const historyRpc = useRpc(purgeDrillHistory);
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<DrillKind | "all" | null>(null);

  const historyQuery = useQuery({ queryKey: ["pi-purge", "drills"], queryFn: () => historyRpc({}) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["pi-purge", "drills"] });

  const [outputs, setOutputs] = useState<Partial<Record<DrillKind, { ok: boolean; lines: string[]; durationMs: number }>>>({});

  const runOne = async (kind: DrillKind) => {
    setRunning(kind);
    try {
      const r = await drillRpc({ kind });
      setOutputs((prev) => ({ ...prev, [kind]: { ok: r.ok, lines: r.lines, durationMs: r.durationMs } }));
      invalidate();
    } finally {
      setRunning(null);
    }
  };

  const runAll = async () => {
    setRunning("all");
    try {
      for (const d of DRILLS) {
        const r = await drillRpc({ kind: d.kind });
        setOutputs((prev) => ({ ...prev, [d.kind]: { ok: r.ok, lines: r.lines, durationMs: r.durationMs } }));
      }
      invalidate();
    } finally {
      setRunning(null);
    }
  };

  const styles = useMemo(
    () => {
      const pad = layout.compact ? 12 : 20;
      return {
        screen: { flexGrow: 1, padding: pad, gap: 10, backgroundColor: theme.colors.surface0 },
        card: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 6 },
        title: { color: theme.colors.foreground, fontSize: layout.compact ? 14 : 16, fontWeight: "700" as const },
        desc: { color: theme.colors.foregroundMuted, fontSize: layout.compact ? 11 : 12 },
        resultLine: { color: theme.colors.foreground, fontSize: layout.compact ? 11 : 12 },
        button: { backgroundColor: theme.colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
        buttonAll: { backgroundColor: theme.colors.surface2, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
        buttonText: { color: theme.colors.accentForeground, fontSize: layout.compact ? 12 : 13 },
        row: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const, flexWrap: "wrap" as const },
        okBadge: { color: theme.colors.statusSuccess, fontSize: layout.compact ? 12 : 13, fontWeight: "700" as const },
        badBadge: { color: theme.colors.statusDanger, fontSize: layout.compact ? 12 : 13, fontWeight: "700" as const },
        muted: { color: theme.colors.foregroundMuted, fontSize: layout.compact ? 11 : 12 },
      };
    },
    [theme, layout.compact],
  );

  const lastOf = (kind: DrillKind) => outputs[kind] || historyQuery.data?.results.find((h) => h.kind === kind);

  const content = (
    <>
      <View style={styles.card}>
        <Text style={styles.title}>pi-purge 演习台</Text>
        <Text style={styles.desc}>四场实弹演习，全部跑真 pi 会话取证（T4 秒级）。结果双向留痕：面板 + daemon 插件日志。</Text>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityLabel="按顺序跑全部演习" disabled={running !== null} onPress={() => void runAll()} style={styles.button}>
            <Text style={styles.buttonText}>{running === "all" ? "演习中…" : "▶ 全套演习"}</Text>
          </Pressable>
        </View>
      </View>

      {DRILLS.map((d) => {
        const last = lastOf(d.kind);
        const busy = running === d.kind || (running === "all");
        return (
          <View key={d.kind} style={styles.card}>
            <Text style={styles.title}>{d.title}</Text>
            <Text style={styles.desc}>{d.desc}</Text>
            <View style={styles.row}>
              <Pressable accessibilityRole="button" accessibilityLabel={`运行${d.title}`} disabled={running !== null} onPress={() => void runOne(d.kind)} style={busy ? styles.buttonAll : styles.button}>
                <Text style={styles.buttonText}>{running === d.kind ? "演习中…" : "▶ 运行"}</Text>
              </Pressable>
              {last ? (
                <Text style={last.ok ? styles.okBadge : styles.badBadge}>
                  {last.ok ? "通过" : "未通过"} · {fmtMs(last.durationMs)}
                  {"at" in last && typeof (last as { at?: string }).at === "string" ? ` · ${(last as { at: string }).at.slice(11, 19)}` : ""}
                </Text>
              ) : null}
            </View>
            {last?.lines.map((l, i) => (
              <Text key={i} style={styles.resultLine}>{l}</Text>
            ))}
          </View>
        );
      })}

      {historyQuery.data && historyQuery.data.results.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.title}>演习历史（daemon 内存态）</Text>
          {historyQuery.data.results.slice(0, 12).map((h, i) => (
            <Text key={i} style={styles.muted}>
              {h.at.slice(11, 19)} {h.kind} → {h.ok ? "通过" : "未通过"}（{fmtMs(h.durationMs)}）
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
  if (props.embedded) return <View style={styles.screen}>{content}</View>;
  return <ScrollView style={styles.screen} contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>{content}</ScrollView>;
}
