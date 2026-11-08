/**
 * 备份策略：什么时候该创建一份新备份。
 *
 * 为什么不是"每次保存都备份"：
 * 保存有 600ms 防抖，连续编辑时每 600ms 就会产生一份备份并挤掉最旧的，
 * 结果 5 份备份只覆盖最近几秒——误删十分钟前的数据反而救不回来。
 * 按时间节流后，同样的 5 份能覆盖几十分钟。
 *
 * 纯函数，便于自检。
 */

/** 备份文件名里的时间戳格式：20261108-140233 */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** 从备份文件名里解析时间戳；解析不出返回 null */
export function parseStamp(name: string): number | null {
  const m = name.match(/(\d{8})-(\d{6})/);
  if (!m) return null;
  const [, day, time] = m;
  const y = Number(day.slice(0, 4));
  const mo = Number(day.slice(4, 6));
  const d = Number(day.slice(6, 8));
  const h = Number(time.slice(0, 2));
  const mi = Number(time.slice(2, 4));
  const s = Number(time.slice(4, 6));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

/**
 * 现在该不该新建备份？
 *
 * @param lastBackupMs 最近一份备份的时间；没有备份传 null
 * @param nowMs        当前时间
 * @param intervalMin  间隔分钟数；0 或负数表示不备份
 */
export function shouldCreateBackup(
  lastBackupMs: number | null,
  nowMs: number,
  intervalMin: number
): boolean {
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) return false;
  if (lastBackupMs === null) return true;
  // 时钟回拨（同步盘、系统时间被改）时 lastBackupMs 可能比现在大，也当作该备份
  if (lastBackupMs > nowMs) return true;
  return nowMs - lastBackupMs >= intervalMin * 60_000;
}

/** 人类可读的间隔说明，给设置界面用 */
export function describeInterval(minutes: number): string {
  if (minutes <= 0) return "不备份";
  if (minutes < 60) return `约每 ${minutes} 分钟一份`;
  const h = minutes / 60;
  return h === Math.floor(h) ? `约每 ${h} 小时一份` : `约每 ${minutes} 分钟一份`;
}
