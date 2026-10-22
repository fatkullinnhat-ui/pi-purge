import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { purgeApply, purgeGuard, purgeRevert, purgeStatus, type StatusResult } from "../shared/purge";

const STATUS_MARK: Record<string, string> = {
  applied: "✓",
  pending: "✗",
  drift: "⚠",
  missing: "·",
  ambiguous: "?",
};

export function PiPurgeStatusBody(props: PluginHostProps & { embedded?: boolean }) {
  const { theme, layout } = props;
  const statusRpc = useRpc(purgeStatus);
  const applyRpc = useRpc(purgeApply);
  const revertRpc = useRpc(purgeRevert);
  const guardRpc = useRpc(purgeGuard);
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: ["pi-purge", "status"], queryFn: () => statusRpc({}) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["pi-purge", "status"] });
  const applyMutation = useMutation({ mutationFn: () => applyRpc({}), onSettled: invalidate });
  const revertMutation = useMutation({ mutationFn: () => revertRpc({}), onSettled: invalidate });
  const guardMutation = useMutation({ mutationFn: () => guardRpc({}), onSettled: invalidate });

  const styles = useMemo(
    () => {
      const pad = layout.compact ? 12 : 20;
      return {
        screen: { flexGrow: 1, padding: pad, gap: 10, backgroundColor: theme.colors.surface0 },
        card: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 6 },
        title: { color: theme.colors.foreground, fontSize: layout.compact ? 16 : 20, fontWeight: "700" as const },
        line: { color: theme.colors.foreground, fontSize: layout.compact ? 12 : 14 },
        muted: { color: theme.colors.foregroundMuted, fontSize: layout.compact ? 11 : 13 },
        patchId: { color: theme.colors.foregroundMuted, fontSize: layout.compact ? 11 : 13, width: 34 },
        patchKey: { color: theme.colors.foreground, fontSize: layout.compact ? 12 : 13, width: 120 },
        patchStatus: { color: theme.colors.foregroundMuted, fontSize: layout.compact ? 11 : 13, flex: 1 },
        row: { flexDirection: "row" as const, gap: 6, alignItems: "center" as const },
        buttonRow: { flexDirection: "row" as const, gap: 8, flexWrap: "wrap" as const },
        button: {
          backgroundColor: theme.colors.accent,
          borderRadius: 8,
          paddingHorizontal: 14,
          paddingVertical: 8,
        },
        buttonDanger: {
          backgroundColor: theme.colors.surface2,
          borderRadius: 8,
          paddingHorizontal: 14,
          paddingVertical: 8,
        },
        buttonText: { color: theme.colors.accentForeground, fontSize: layout.compact ? 12 : 14 },
        error: { color: theme.colors.statusDanger, fontSize: layout.compact ? 12 : 13 },
      };
    },
    [theme, layout.compact],
  );

  if (query.isPending) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center", minHeight: 120 }]}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <View style={styles.screen}>
        <Text style={styles.error}>状态读取失败</Text>
      </View>
    );
  }

  const busy = applyMutation.isPending || revertMutation.isPending || guardMutation.isPending;
  const actionMessage =
    applyMutation.data?.summary || applyMutation.data?.error ||
    revertMutation.data?.summary || revertMutation.data?.error ||
    guardMutation.data?.summary || guardMutation.data?.error ||
    "";

  const headline = data.ok
    ? data.drift
      ? `⚠ 漂移已检出 · ${data.applied}/${data.total} 在位`
      : `✓ 清洗在位 · ${data.applied}/${data.total}`
    : `✗ 工具不可用：${data.error || "未知错误"}`;

  const content = (
    <>
      <View style={styles.card}>
        <Text style={styles.title}>pi-purge 指令权威清洗</Text>
        <Text style={styles.line}>{headline}</Text>
        <Text style={styles.muted}>pi {data.piVersion || "unknown"} · {data.piRoot || "未定位"}</Text>
        <Text style={styles.muted}>
          漂移 {data.drift ? "是" : "否"} · 注入文件 {data.hasInject ? `${data.injectBytes} bytes` : "缺失"} · 备份 {data.hasBackup ? "有" : "无"} · 状态 {data.hasState ? "有" : "无"}
        </Text>
        <Text style={styles.muted}>
          shim {data.shims.length > 0 ? data.shims.map((s) => `${s.name}=${s.status}`).join("  ") : "未定位"}
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="守护检查" disabled={busy} onPress={() => guardMutation.mutate()} style={busy ? styles.buttonDanger : styles.button}>
          <Text style={styles.buttonText}>守护检查 Guard</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="应用清洗" disabled={busy} onPress={() => applyMutation.mutate()} style={styles.button}>
          <Text style={styles.buttonText}>应用清洗 Apply</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="回滚还原" disabled={busy} onPress={() => revertMutation.mutate()} style={styles.buttonDanger}>
          <Text style={styles.buttonText}>回滚 Revert</Text>
        </Pressable>
      </View>

      {actionMessage ? (
        <View style={styles.card}>
          <Text style={styles.line}>{actionMessage}</Text>
        </View>
      ) : null}

      {data.patches.map((p) => (
        <View key={p.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.patchId}>#{p.id}</Text>
            <Text style={styles.patchKey}>{p.key}</Text>
            <Text style={styles.patchStatus}>
              {STATUS_MARK[p.status] || "?"} {p.layer} — {p.status}
            </Text>
          </View>
          <Text style={styles.muted}>{p.name}</Text>
        </View>
      ))}
    </>
  );
  if (props.embedded) return <View style={styles.screen}>{content}</View>;
  return <ScrollView style={styles.screen} contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>{content}</ScrollView>;
}
