#!/usr/bin/env node
/**
 * B 站批量下载（yt-dlp 封装）
 *
 * 批量下载 B 站视频/合集：
 *   - 交互式输入下载列表（链接 / BV 号，每行一个，空行结束；也可给 .txt 列表文件）
 *   - 并发 worker 池（默认 3 路并行，先干完手头的再领下一项）
 *   - 默认只下载音频（--extract-audio，默认 m4a：源流本就是 AAC，m4a 只重封装不重编码）
 *   - 合集(space lists/分P) 按「合集名\序号-标题」建目录，单视频直接「标题」
 *
 * 用法：
 *   node bili-download.js                           # 交互输入下载项
 *   node bili-download.js BV15Y4y1q7HR [URL...]     # 直接传下载项
 *   node bili-download.js --video                   # 下视频(合并 mp4)而非音频
 *   node bili-download.js --parallel 5              # 并行数(上限 8)
 *   node bili-download.js --audio-format mp3        # 音频格式(默认 m4a；mp3 会让 ffmpeg 整条重编码，体积翻倍)
 *   node bili-download.js --simulate                # 只抓元数据不下载(每项前 3 集)
 *   node bili-download.js --transcribe              # 每个音频下载完成即送 transcribe.js 转写
 *   断点续传：完成进度写 .bili-download.json，重跑自动跳过已完成/已落盘的项
 *   环境变量可覆盖：YT_DLP / COOKIES_FILE / PARALLEL / DOWNLOAD_DIR / AUDIO_FORMAT / BILI_STATE / TRANSCRIBE / TRANSCRIBE_CONCURRENCY / TRANSCRIBE_FORCE / TRANSCRIBE_JS / VERBOSE
 */
'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------------------------------------------------------------------------
// 配置（CLI 参数优先，其次环境变量）
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
// 需要跟一个值的选项：把它和它的值从「下载项」里排除掉（否则 --parallel 3 会把 3 当下载项）
const VALUE_OPTS = new Set(['--parallel', '--audio-format']);
const consumed = new Set();
args.forEach((a, i) => { if (VALUE_OPTS.has(a)) { consumed.add(i); consumed.add(i + 1); } });
const positionals = args.filter((a, i) => !consumed.has(i) && !a.startsWith('-'));

function getOpt(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}

const CONFIG = {
  ytDlp: process.env.YT_DLP || 'D:\\build-bin-windows-x64\\yt-dlp.exe',
  cookiesFile: process.env.COOKIES_FILE || 'D:\\Downloads\\bilibili_cookies.txt',
  downloadDir: process.env.DOWNLOAD_DIR || 'D:\\Downloads\\bilibili',
  concurrency: Math.max(1, Math.min(8, parseInt(getOpt('--parallel', process.env.PARALLEL || '3'), 10) || 3)),
  audioFormat: getOpt('--audio-format', process.env.AUDIO_FORMAT || 'm4a'),
  videoMode: args.includes('--video'),
  simulate: args.includes('--simulate'),
  transcribe: args.includes('--transcribe') || process.env.TRANSCRIBE === '1',
};

const VERBOSE = process.env.VERBOSE === '1';

// 带标签日志：并发时给每路输出加 [i/N] 前缀，避免串行错乱
function log(tag, ...out) {
  console.log(...(tag ? [tag, ...out] : out));
}

// yt-dlp 经管道输出的字节用的是系统 ANSI 代码页（中文系统=GBK/936），
// 不按它解码就会中文乱码（chcp 65001 只改控制台代码页，改不了这个）。
function ansiEncoding() {
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP'], { encoding: 'utf8' });
    const m = out.match(/ACP\s+REG_SZ\s+(\d+)/);
    const map = { '936': 'gbk', '950': 'big5', '932': 'shift_jis', '949': 'euc-kr', '1252': 'windows-1252' };
    if (m && map[m[1]]) return map[m[1]];
  } catch (e) { /* 取不到就按 UTF-8 */ }
  return 'utf-8';
}
const YTDLP_ENCODING = ansiEncoding();

// ---------------------------------------------------------------------------
// 断点续传：完成进度存 JSON，重跑直接跳过，不靠 yt-dlp 逐个试
// ---------------------------------------------------------------------------
const STATE_FILE = process.env.BILI_STATE || path.join(CONFIG.downloadDir, '.bili-download.json');

function loadState() {
  try {
    const obj = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (obj && obj.completed && typeof obj.completed === 'object') return obj;
  } catch (e) { /* 无状态文件 */ }
  return { version: 1, completed: {} };
}

let state = loadState();

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error(`状态文件写入失败: ${e.message}`);
  }
}

// 从下载目录里已有的 [BVxxx].mp3/.mp4 回填完成记录（断点续传的兜底）
function seedFromDisk() {
  let count = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(mp3|mp4)$/i.test(entry.name)) {
        const m = entry.name.match(/\[(BV[0-9A-Za-z]+(?:_p\d+)?)\]/);
        if (m && !state.completed[m[1]]) {
          state.completed[m[1]] = { saved: full, ts: Date.now() };
          count++;
        }
      }
    }
  };
  if (fs.existsSync(CONFIG.downloadDir)) walk(CONFIG.downloadDir);
  if (count) saveState();
  return count;
}

// ---------------------------------------------------------------------------
// 输入解析：链接 / BV 号 / .txt 列表文件，自动去重
// ---------------------------------------------------------------------------
// 把 Windows 拖拽产生的带引号、空格分隔的多路径串拆成单个
function tokenize(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    let tok = '';
    if (line[i] === '"' || line[i] === "'") {
      const q = line[i++];
      while (i < line.length && line[i] !== q) tok += line[i++];
      if (i < line.length) i++; // 跳过闭合引号
    } else {
      while (i < line.length && !/\s/.test(line[i])) tok += line[i++];
    }
    out.push(tok);
  }
  return out;
}

// 裸 BV 号 → 完整视频 URL
function normalize(s) {
  return /^BV[0-9A-Za-z]{8,}$/.test(s) ? `https://www.bilibili.com/video/${s}` : s;
}

// 从任意 B 站 URL 里取出 BV 号（状态记录的键）
function bvIdOf(url) {
  const m = url.match(/BV[0-9A-Za-z]+/);
  return m ? m[0] : url;
}

// 合集链接 → 逐集 { index, url }（flat-playlist 只抓页面，快）
function expandPlaylist(url) {
  try {
    const out = execFileSync(CONFIG.ytDlp, [
      '--cookies', CONFIG.cookiesFile,
      '--flat-playlist', '--no-warnings',
      '--print', '%(playlist_index)s %(url)s',
      url,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const pairs = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^(\d+)\s+(\S+)/);
      if (m) pairs.push({ index: parseInt(m[1], 10), url: m[2] });
    }
    if (pairs.length) return pairs;
  } catch (e) { /* 落入下方整体处理 */ }
  console.error(`  展开合集失败，按整集顺序处理: ${url}`);
  return [];
}

// 队列项的可读标签
const itemLabel = (item) => item.playlistIndex ? `${item.url} (第${item.playlistIndex}集)` : item.url;

// 解析输入 → 下载项列表（参数可为 URL/BV 号/本地 .txt 列表文件；交互模式下逐行添加）
async function resolveItems() {
  const items = [];
  const seen = new Set();
  const add = (raw) => {
    const t = (raw || '').replace(/^["']|["']$/g, '').trim();
    if (!t) return;
    if (fs.existsSync(t)) {
      // 本地文件 → 每行一个下载项
      for (const line of fs.readFileSync(t, 'utf8').split(/\r?\n/)) add(line);
      return;
    }
    const u = normalize(t);
    // 先 flat-playlist 探测：合集/收藏夹/多分P 都会列出多行；普通单视频输出 NA（pairs 为空）
    const pairs = expandPlaylist(u);
    if (pairs.length) {
      // 所有分集共用一个 BV → 多分P视频，断点键按 BVxxx_pN 区分
      const multiPart = new Set(pairs.map((p) => bvIdOf(p.url))).size === 1;
      for (const p of pairs) {
        const key = `${u}#${p.index}`;
        if (!seen.has(key)) {
          seen.add(key);
          const bv = bvIdOf(p.url);
          items.push({ url: u, playlistIndex: p.index, bvId: multiPart ? `${bv}_p${p.index}` : bv });
        }
      }
    } else {
      if (!seen.has(u)) { seen.add(u); items.push({ url: u, playlistIndex: null, bvId: bvIdOf(u) }); }
    }
  };

  if (positionals.length > 0) {
    for (const a of positionals) for (const tok of tokenize(a)) add(tok);
  } else {
    // 单个 readline 接口读到底：TTY 逐行提示，管道/重定向同样可靠
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('输入要下载的 B 站链接 / BV 号（每行一个，空行结束；也可给 .txt 列表文件路径）:');
    process.stdout.write('下载项 > ');
    for await (const line of rl) {
      const t = line.trim();
      if (!t) break;
      for (const tok of tokenize(t)) add(tok);
      process.stdout.write('下载项 > ');
    }
    rl.close();
  }
  return items;
}

// ---------------------------------------------------------------------------
// yt-dlp 参数构造
// ---------------------------------------------------------------------------
function isPlaylistItem(item) {
  return /\/lists\/\d+/.test(item) || /type=season/.test(item) ||
    /collectiondetail/.test(item) || /medialist/.test(item) ||
    /favlist/.test(item) || /\bseries\b/.test(item) || /[?&]p=/.test(item);
}
const PLAYLIST_TEMPLATE = '%(playlist_title)s/%(playlist_index)02d-%(title)s.%(ext)s';
const SINGLE_TEMPLATE = '%(title)s.%(ext)s';

function buildArgs(item) {
  const a = [
    '--cookies', CONFIG.cookiesFile,
    '--concurrent-fragments', '4',
    '--newline',
    '--retries', '10',
    '--fragment-retries', '10',
  ];
  if (CONFIG.simulate) {
    a.push('--simulate', '--print', '%(playlist_index)02d. %(title)s [%(id)s]');
    if (!item.playlistIndex && isPlaylistItem(item.url)) a.push('--playlist-items', '1-3');
  } else {
    // 收藏夹保持平铺（与历史下载到根目录的文件一致），只有合集/分P才建「合集名/序号-标题」目录
    const useFolder = !/favlist/.test(item.url) && (item.playlistIndex || isPlaylistItem(item.url));
    a.push('--paths', CONFIG.downloadDir,
      '--output', useFolder ? PLAYLIST_TEMPLATE : SINGLE_TEMPLATE);
    // 多分P视频 yt-dlp 会把标题拼成「视频名 pNN 分P名」，剥掉重复的视频名前缀
    a.push('--replace-in-metadata', 'title', '^.+? p\\d+ ', '');
    if (CONFIG.videoMode) {
      a.push('--merge-output-format', 'mp4');
    } else {
      a.push('--extract-audio', '--audio-format', CONFIG.audioFormat, '--audio-quality', '0');
    }
  }
  if (item.playlistIndex) a.push('--playlist-items', String(item.playlistIndex));
  a.push(item.url);
  return a;
}

// ---------------------------------------------------------------------------
// 单项下载
// ---------------------------------------------------------------------------
const activeProcs = new Set();
process.on('SIGINT', () => {
  log(null, '\n收到中断，正在终止下载任务...');
  for (const p of activeProcs) p.kill();
  process.exit(130);
});

function downloadItem(item, tag) {
  return new Promise((resolve) => {
    const a = buildArgs(item);
    if (VERBOSE) log(tag, 'CMD> ' + a.join(' '));
    log(tag, `${CONFIG.simulate ? '检查' : '下载'} > ${itemLabel(item)}`);
    const proc = spawn(CONFIG.ytDlp, a, { stdio: ['ignore', 'pipe', 'inherit'] });
    activeProcs.add(proc);
    // yt-dlp 管道字节按系统 ANSI 代码页解码（中文系统=GBK），否则中文全乱码
    const dec = new TextDecoder(YTDLP_ENCODING);
    let buf = '';
    let saved = null;
    const drain = () => {
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const m = line.match(/Destination: (.+)$/) ||
          line.match(/^\[download\] (.+\.\w+) has already been downloaded$/) ||
          line.match(/Not converting audio (.+); file is already in target format/);
        if (m) saved = m[1]; // 最后一个匹配即最终产物
        process.stdout.write(`${tag} ${line}\n`);
      }
    };
    proc.stdout.on('data', (d) => {
      buf += dec.decode(d, { stream: true });
      drain();
    });
    proc.on('error', (err) => {
      activeProcs.delete(proc);
      resolve({ ok: false, item: itemLabel(item), error: err.message });
    });
    proc.on('close', (code) => {
      activeProcs.delete(proc);
      buf += dec.decode(); // 冲掉末尾未换行的残留
      drain();
      if (code === 0 && !CONFIG.simulate) {
        state.completed[item.bvId] = { saved, ts: Date.now() };
        saveState();
      }
      resolve({ ok: code === 0, item: itemLabel(item), code, saved });
    });
  });
}

// ---------------------------------------------------------------------------
// 联动转写：下载完成即送 transcribe.js（--transcribe / TRANSCRIBE=1 开启）
// 下载与转写各用独立 worker 池，互不阻塞；转写子进程输出逐行加标签转发
// ---------------------------------------------------------------------------
const TRANSCRIBE_CONCURRENCY = Math.max(1, parseInt(process.env.TRANSCRIBE_CONCURRENCY || '2', 10) || 2);
const transcribeScript = process.env.TRANSCRIBE_JS || path.join(__dirname, 'transcribe.js');
const transcribeQueue = [];
const transcribeResults = [];
let transcribeRunning = 0;

// 子进程 stdout（Node 输出=UTF-8）逐行加标签转发到本进程 stdout
function pipePrefixed(stream, tag) {
  const dec = new TextDecoder('utf-8');
  let buf = '';
  const drain = () => {
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line) process.stdout.write(`${tag} ${line}\n`);
    }
  };
  stream.on('data', (d) => { buf += dec.decode(d, { stream: true }); drain(); });
  stream.on('end', () => { buf += dec.decode(); drain(); if (buf) process.stdout.write(`${tag} ${buf}\n`); });
}

function enqueueTranscribe(result, tag) {
  if (!result.saved) return;
  const txt = result.saved.replace(/\.[^./\\]+$/, '') + '.txt';
  if (fs.existsSync(txt) && process.env.TRANSCRIBE_FORCE !== '1') {
    log(`${tag}[转写]`, `跳过（转写已存在）: ${path.basename(txt)}`);
    return;
  }
  transcribeQueue.push({ file: result.saved, tag: `${tag}[转写]` });
  pumpTranscribe();
}

function pumpTranscribe() {
  while (transcribeRunning < TRANSCRIBE_CONCURRENCY && transcribeQueue.length > 0) {
    const job = transcribeQueue.shift();
    transcribeRunning++;
    runTranscribe(job).finally(() => { transcribeRunning--; pumpTranscribe(); });
  }
}

function runTranscribe(job) {
  return new Promise((resolve) => {
    const { file, tag } = job;
    log(tag, `开始转写: ${path.basename(file)}`);
    const proc = spawn(process.execPath, [transcribeScript, file], { stdio: ['ignore', 'pipe', 'inherit'] });
    activeProcs.add(proc); // Ctrl+C 时一并终止
    pipePrefixed(proc.stdout, tag);
    proc.on('error', (err) => {
      activeProcs.delete(proc);
      transcribeResults.push({ ok: false, file, error: err.message });
      log(tag, `[转写失败] ${err.message}`);
      resolve();
    });
    proc.on('close', (code) => {
      activeProcs.delete(proc);
      const ok = code === 0;
      const txt = file.replace(/\.[^./\\]+$/, '') + '.txt';
      transcribeResults.push({ ok, file, txtPath: ok && fs.existsSync(txt) ? txt : null });
      log(tag, ok ? '转写完成' : `转写失败 (exit ${code})`);
      resolve();
    });
  });
}

async function waitTranscribe() {
  while (transcribeRunning > 0 || transcribeQueue.length > 0) {
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ---------------------------------------------------------------------------
// 主流程：并发 worker 池
// ---------------------------------------------------------------------------
async function main() {
  console.log('== B 站批量下载（yt-dlp） ==');
  console.log(`模式: ${CONFIG.videoMode ? '视频(合并mp4)' : `音频(仅${CONFIG.audioFormat})`} | 并发: ${CONFIG.concurrency}（--parallel 调整）`);
  if (CONFIG.simulate) console.log('提示: --simulate 模式，只抓元数据不下载。');
  if (CONFIG.transcribe) console.log(`联动: 下载完成自动转写（${transcribeScript}，转写并发 ${TRANSCRIBE_CONCURRENCY}）`);

  const items = await resolveItems();
  if (items.length === 0) {
    console.error('没有输入任何下载项。');
    process.exit(1);
  }

  // 断点续传：从磁盘回填完成记录，跳过已完成项，只下缺的
  const seeded = seedFromDisk();
  if (seeded) console.log(`已从磁盘回填 ${seeded} 条完成记录（状态: ${STATE_FILE}）`);
  const pending = items.filter((it) => !state.completed[it.bvId]);
  const skipped = items.length - pending.length;
  if (skipped) console.log(`跳过已完成 ${skipped} 项`);
  if (pending.length === 0 && !(CONFIG.transcribe && skipped > 0)) {
    console.log('全部已完成，无需下载。');
    process.exit(0);
  }
  console.log(`\n待处理 ${pending.length} 项（完成一项立刻领下一项）:\n` + pending.map((it, i) => `  ${i + 1}. ${itemLabel(it)}`).join('\n') + '\n');

  // 已完成但还没有转写 .txt 的项，也补进转写队列（断点重开/上次没开联动）
  if (CONFIG.transcribe && skipped > 0) {
    for (const it of items) {
      if (!state.completed[it.bvId]) continue;
      const saved = state.completed[it.bvId].saved;
      if (saved && fs.existsSync(saved)) enqueueTranscribe({ saved }, '[补]');
    }
  }

  // 并发 worker 池：最多 CONFIG.concurrency 个同时跑，共享 next 计数器领取队列
  const results = new Array(pending.length);
  const limit = Math.min(CONFIG.concurrency, pending.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = next++;
      if (i >= pending.length) break;
      const tag = `[${i + 1}/${pending.length}]`;
      try {
        results[i] = await downloadItem(pending[i], tag);
        if (CONFIG.transcribe && results[i].ok && results[i].saved) enqueueTranscribe(results[i], tag);
      } catch (e) {
        results[i] = { ok: false, item: itemLabel(pending[i]), error: e.message };
        console.error(`${tag} [失败] ${itemLabel(pending[i])}: ${e.message}`);
      }
    }
  });
  await Promise.all(workers);

  // 下载全部结束：等转写队列排干再出总结
  if (CONFIG.transcribe) {
    const remaining = transcribeQueue.length + transcribeRunning;
    if (remaining > 0) {
      console.log(`\n下载全部结束，等待转写收尾（剩余 ${remaining} 个）...`);
      await waitTranscribe();
    }
  }

  const ok = results.filter((r) => r && r.ok).length;
  const fail = results.filter((r) => r && !r.ok).length;
  const saved = results.filter((r) => r && r.ok && r.saved);

  console.log(`\n\n================ 批量完成 ================`);
  console.log(`成功 ${ok} 项，失败 ${fail} 项`);
  if (saved.length > 0) {
    console.log('保存位置:');
    for (const r of saved) {
      console.log(`  ✔ ${r.item}`);
      console.log(`    ${r.saved}`);
    }
  }
  if (CONFIG.transcribe && transcribeResults.length > 0) {
    const tOk = transcribeResults.filter((r) => r.ok).length;
    const tFail = transcribeResults.length - tOk;
    console.log(`\n联动转写: 成功 ${tOk} 个，失败 ${tFail} 个`);
    for (const r of transcribeResults) {
      if (r.ok && r.txtPath) {
        console.log(`  ✔ ${path.basename(r.file)}`);
        console.log(`    文本: ${r.txtPath}`);
      } else if (!r.ok) {
        console.log(`  ✘ ${path.basename(r.file)}${r.error ? ` (${r.error})` : ''}`);
      }
    }
  }
  console.log('==========================================');
}

main().catch((e) => {
  console.error('\n[失败] ' + e.message);
  process.exit(1);
});
