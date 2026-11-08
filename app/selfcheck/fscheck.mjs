/**
 * 文件路径与设置的纯逻辑自检（不碰 Tauri、不碰真实磁盘）。
 * 运行：node build-m0.mjs && node selfcheck/fscheck.mjs
 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { joinPath, dirOf, baseNameOf, stripJsonExt } = await import("../dist-src/lib/paths.js");
const { loadSettings, saveSettings, DEFAULT_SETTINGS } = await import(
  "../dist-src/lib/settings.js"
);

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

// ---------- 路径拼接 ----------
const winDir = "C:\\Users\\me\\Documents\\历史事件线";
check(
  "Windows 路径用反斜杠拼接",
  joinPath(winDir, "data.json") === `${winDir}\\data.json`,
  joinPath(winDir, "data.json")
);
check(
  "目录已带分隔符不会重复",
  joinPath("C:\\a\\", "b.json") === "C:\\a\\b.json",
  joinPath("C:\\a\\", "b.json")
);
check("正斜杠目录也能拼", joinPath("/home/me/", "x.json") === "/home/me/x.json");
check("空目录直接返回文件名", joinPath("", "x.json") === "x.json");

// ---------- 取目录 / 文件名 ----------
check("dirOf 取反斜杠路径", dirOf("C:\\a\\b\\c.json") === "C:\\a\\b", dirOf("C:\\a\\b\\c.json"));
check("dirOf 取正斜杠路径", dirOf("/a/b/c.json") === "/a/b");
check("dirOf 无分隔符返回空串", dirOf("c.json") === "");
check("baseNameOf 取文件名", baseNameOf("C:\\a\\b\\c.json") === "c.json");
check("baseNameOf 无分隔符原样返回", baseNameOf("c.json") === "c.json");

// ---------- 去后缀 ----------
check("去掉 .json", stripJsonExt("history.json") === "history");
check("大写 .JSON 也能去", stripJsonExt("history.JSON") === "history");
check("非 json 后缀不动", stripJsonExt("history.txt") === "history.txt");
check(
  "备份前缀不会互相误伤",
  stripJsonExt("a.b.json") === "a.b",
  stripJsonExt("a.b.json")
);

// ---------- 设置读写 ----------
mem.clear();
const d = loadSettings();
check("空存储返回默认设置", d.fileName === DEFAULT_SETTINGS.fileName && d.backupCount === 5);
check("默认不指定自定义目录", d.dataDir === null);

saveSettings({ dataDir: "D:\\data", fileName: "mine.json", backupCount: 3 });
const back = loadSettings();
check("设置能存能读", back.dataDir === "D:\\data" && back.fileName === "mine.json" && back.backupCount === 3);

saveSettings({ dataDir: "   ", fileName: "  ", backupCount: 999 });
const clamped = loadSettings();
check("空白目录回退为默认", clamped.dataDir === null);
check("空白文件名回退为默认", clamped.fileName === DEFAULT_SETTINGS.fileName);
check("备份份数被上限截断", clamped.backupCount === 50, String(clamped.backupCount));

saveSettings({ dataDir: null, fileName: "x.json", backupCount: -5 });
check(
  "非法负数回退为默认份数",
  loadSettings().backupCount === DEFAULT_SETTINGS.backupCount,
  String(loadSettings().backupCount)
);

mem.set("history-timeline.settings.v1", "{ 坏掉的 json");
const broken = loadSettings();
check("设置损坏时回退默认", broken.fileName === DEFAULT_SETTINGS.fileName);

mem.set("history-timeline.settings.v1", JSON.stringify({ fileName: "x.json", backupCount: "abc" }));
check("类型不对的字段被纠正", loadSettings().backupCount === 5);

console.log(`\n${ok} passed.`);
process.exit(ok === 22 ? 0 : 1);
