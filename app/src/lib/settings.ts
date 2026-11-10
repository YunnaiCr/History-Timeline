/**
 * 设置项：与数据分开保存。
 *
 * 设置很小、也必须在"还没有数据文件"时就能读到，所以留在 localStorage；
 * 真正的数据走文件（见 repository.ts）。这样即使数据文件损坏或路径不可用，
 * 用户仍然能打开应用去改设置。
 */
export interface Settings {
  /** 数据目录；null 表示用默认目录（文档\HistoryTimeline） */
  dataDir: string | null;
  /** 数据文件名 */
  fileName: string;
  /** 保留几份自动备份；0 表示不备份 */
  backupCount: number;
  /** 备份间隔（分钟）：距上一份备份不足这个时间就不再新建 */
  backupIntervalMinutes: number;
  /** 卡片上是否显示时间文本（单个事件还能再关） */
  showDates: boolean;
}

const SETTINGS_KEY = "history-timeline.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  dataDir: null,
  fileName: "history-timeline.json",
  backupCount: 5,
  backupIntervalMinutes: 10,
  showDates: true,
};

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      dataDir: typeof parsed.dataDir === "string" && parsed.dataDir.trim() ? parsed.dataDir : null,
      fileName:
        typeof parsed.fileName === "string" && parsed.fileName.trim()
          ? parsed.fileName.trim()
          : DEFAULT_SETTINGS.fileName,
      backupCount: clampInt(parsed.backupCount, 0, 50, DEFAULT_SETTINGS.backupCount),
      backupIntervalMinutes: clampInt(
        parsed.backupIntervalMinutes,
        1,
        1440,
        DEFAULT_SETTINGS.backupIntervalMinutes
      ),
      showDates: typeof parsed.showDates === "boolean" ? parsed.showDates : true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (err) {
    console.warn("[settings] 保存失败：", err);
  }
}
