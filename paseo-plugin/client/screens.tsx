import type { PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow, SidebarSeparator } from "@getpaseo/plugin/client/ui";
import { ScrollView } from "react-native";
import { PiPurgeStatusBody } from "./status-view";
import { PiPurgeDrillsBody } from "./drills-view";
import { PiPurgeConsole } from "./console-view";

export function PiPurgeScreen(props: PluginScreenProps) {
  return <PiPurgeStatusBody {...props} />;
}

export function PiPurgeDrillsScreen(props: PluginScreenProps) {
  return <PiPurgeDrillsBody {...props} />;
}

/** 全屏控制台：状态 + 演习台合并（手机/窄窗的控制台落点） */
export function PiPurgeConsoleScreen(props: PluginScreenProps) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} contentContainerStyle={{ paddingBottom: 24 }}>
      <PiPurgeConsole {...props} />
    </ScrollView>
  );
}

export function PiPurgeSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const onConsole = currentScreen?.screenId === "pi-purge-console";
  return (
    <>
      <SidebarRow
        icon="Shield"
        label="pi-purge 控制台"
        active={onConsole}
        onPress={() => openScreen({ screenId: "pi-purge-console" })}
      />
      <SidebarRow
        icon="Swords"
        label="pi-purge 演习台"
        active={currentScreen?.screenId === "pi-purge-drills"}
        onPress={() => openScreen({ screenId: "pi-purge-drills" })}
      />
      <SidebarSeparator />
    </>
  );
}
