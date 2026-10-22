import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { PiPurgeStatusBody } from "./status-view";
import { PiPurgeDrillsBody } from "./drills-view";
import { useMemo } from "react";

/**
 * pi-purge 控制台 —— 侧边栏切换面板（Snippets 同款位置：locations ["explorer","workspace"]）里的完整功能面板：
 * 上半 = 清洗状态 + Guard/Apply/Revert + 18 项补丁明细
 * 下半 = 演习台（T4 update / T1 身份 / T2 上限 / T3 信任）+ 历史
 */
export function PiPurgeConsole(props: PluginHostProps) {
  const styles = useMemo(
    () => ({
      divider: { height: 1, backgroundColor: "rgba(128,128,128,0.25)", marginVertical: 6 },
    }),
    [],
  );
  return (
    <View style={{ flexGrow: 1 }}>
      <PiPurgeStatusBody {...props} embedded />
      <View style={styles.divider} />
      <PiPurgeDrillsBody {...props} embedded />
      <Text> </Text>
    </View>
  );
}
