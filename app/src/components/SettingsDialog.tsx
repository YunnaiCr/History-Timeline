import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Settings } from "../lib/settings";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { joinPath } from "../lib/fsdata";
import { listBackups } from "../lib/repository";

interface Props {
  open: boolean;
  settings: Settings;
  /** 当前数据文件的完整路径（由默认目录解析后得到） */
  resolvedDir: string;
  isDesktop: boolean;
  onSave: (next: Settings) => void;
  onClose: () => void;
}

export default function SettingsDialog({
  open,
  settings,
  resolvedDir,
  isDesktop,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [backups, setBackups] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setErr(null);
    if (isDesktop) {
      void listBackups(joinPath(resolvedDir, settings.fileName)).then(setBackups);
    }
  }, [open, settings, resolvedDir, isDesktop]);

  if (!open) return null;

  const effectiveDir = draft.dataDir ?? resolvedDir;

  const pickDir = async () => {
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: "选择数据目录",
        defaultPath: effectiveDir,
      });
      if (typeof picked === "string" && picked) {
        setDraft({ ...draft, dataDir: picked });
      }
    } catch (e) {
      setErr(`选择目录失败：${String(e)}`);
    }
  };

  const apply = () => {
    const name = draft.fileName.trim();
    if (!name) {
      setErr("文件名不能为空");
      return;
    }
    if (!name.toLowerCase().endsWith(".json")) {
      setErr("文件名需要以 .json 结尾");
      return;
    }
    onSave({ ...draft, fileName: name, dataDir: draft.dataDir?.trim() || null });
  };

  return (
    <div className="dialog-mask" onMouseDown={onClose}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <span>设置</span>
          <button className="dlg-x" onClick={onClose} title="取消 (Esc)">
            ×
          </button>
        </div>

        <div className="dlg-body">
          <div className="dlg-field">
            <span className="dlg-label">数据目录</span>
            <div className="set-path">
              <input className="dlg-input" value={effectiveDir} readOnly title={effectiveDir} />
              <button className="dlg-btn" onClick={pickDir} disabled={!isDesktop}>
                选择…
              </button>
              {draft.dataDir && (
                <button
                  className="dlg-btn ghost"
                  onClick={() => setDraft({ ...draft, dataDir: null })}
                  title="改回默认目录（文档\HistoryTimeline）"
                >
                  默认
                </button>
              )}
            </div>
            <span className="set-hint">
              {draft.dataDir
                ? "自定义目录。数据文件会保存在这里，导出副本在同级 exports\\ 里。"
                : "默认目录：文档\\HistoryTimeline（导出副本在 exports\\ 子文件夹）"}
            </span>
          </div>

          <label className="dlg-field">
            <span className="dlg-label">文件名</span>
            <input
              className="dlg-input"
              value={draft.fileName}
              onChange={(e) => setDraft({ ...draft, fileName: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
            />
            <span className="set-hint">完整路径：{joinPath(effectiveDir, draft.fileName)}</span>
          </label>

          <label className="dlg-field">
            <span className="dlg-label">自动备份份数</span>
            <div className="set-row">
              <input
                className="dlg-input tiny"
                type="number"
                min={0}
                max={50}
                value={draft.backupCount}
                onChange={(e) =>
                  setDraft({ ...draft, backupCount: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })
                }
              />
              <span className="set-hint">保留最近几份。0 表示不备份。</span>
            </div>
          </label>

          <label className="dlg-field">
            <span className="dlg-label">备份间隔（分钟）</span>
            <div className="set-row">
              <input
                className="dlg-input tiny"
                type="number"
                min={1}
                max={1440}
                value={draft.backupIntervalMinutes}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    backupIntervalMinutes: Math.max(1, Math.min(1440, Number(e.target.value) || 1)),
                  })
                }
              />
              <span className="set-hint">
                距上一份不足这么久就不再新建，避免连续编辑把备份冲光。
              </span>
            </div>
          </label>

          {backups.length > 0 && (
            <div className="dlg-field">
              <span className="dlg-label">现有备份（{backups.length} 份）</span>
              <div className="set-backups">
                {backups.slice(0, 8).map((b) => (
                  <div key={b} className="set-backup-row">
                    {b}
                  </div>
                ))}
                {backups.length > 8 && <div className="set-backup-row">…</div>}
              </div>
            </div>
          )}

          {!isDesktop && (
            <div className="dlg-preview warn">
              浏览器模式（npm run dev）下无法读写文件，数据暂存在浏览器本地存储中。
              要使用文件存储请运行桌面版。
            </div>
          )}

          {err && <div className="dlg-err">{err}</div>}
        </div>

        <div className="dlg-foot">
          <button className="dlg-btn ghost" onClick={() => setDraft({ ...DEFAULT_SETTINGS })}>
            恢复默认设置
          </button>
          <button className="dlg-btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="dlg-btn primary" onClick={apply}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
