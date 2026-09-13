#!/usr/bin/env node
/**
 * vivo/BBK 录音机「录音转写」逆向 API 一键脚本
 *
 * 复现 com.android.bbksoundrecorder (v1.7.3.9) 的 LASR 大文件转写链路：
 *   POST /lasr/create  →  data.audio_id
 *   POST /lasr/upload  (multipart "file", 5MB 分片)  →  data.slices
 *   POST /lasr/run     →  data.task_id
 *   POST /lasr/progress(轮询) → data.progress
 *   POST /lasr/result  →  data.result[]  { onebest, bg, ed, speaker, lid }
 *
 * 鉴权：新版 X-AI-GATEWAY-* 头，签名 = Base64(HMAC-SHA256(appKey, 6行原串))。
 *
 * 用法：
 *   node transcribe.js "<音频文件或目录路径>"   # 默认只输出 .txt
 *   node transcribe.js --srt "<路径>"            # 额外输出 .srt 字幕
 *   环境变量可覆盖：VIVO_TOKEN / VIVO_OPENID / VAID / DID / LANG / SCENE / LASR_SERVER_URL / SAVE_SRT
 *                    CONCURRENCY（同时转写几个文件）/ UPLOAD_CONCURRENCY（单文件并发上传几片，默认 1=串行）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const readline = require('readline');

// ---------------------------------------------------------------------------
// 配置（对应反编译出的硬编码与 SDK 默认值）
// ---------------------------------------------------------------------------
const CONFIG = {
  appId: process.env.APP_ID || '8735273056',
  appKey: process.env.APP_KEY || 'NIhyMZRWZUGdDnrW',
  serverUrl: process.env.LASR_SERVER_URL || 'https://asr-v2.vivo.com.cn',
  engineType: 'fileasrrecorder',
  packageName: 'com.android.bbksoundrecorder',

  // 设备信息（服务器一般只校验签名，参数值不强制匹配）
  brand: process.env.BRAND || 'vivo',
  model: process.env.MODEL || 'V2309A',
  product: process.env.PRODUCT || 'PD2243',
  rom: process.env.ROM || '14',
  systemVersion: process.env.SYS_VER || '14',
  androidVersion: process.env.AN_VER || '13',
  clientVersion: process.env.CLIENT_VER || '1.7.3.9',
  sdkVersion: process.env.SDK_VER || '5.2.5.66',
  netType: process.env.NET_TYPE || '1', // 1=wifi 0=蜂窝

  // 转写参数
  language: process.env.LANG || 'zh-Hans-CN',
  scene: process.env.SCENE || 'user', // user=手动转写 smart=智能录音

  // 是否输出 .srt 字幕文件（默认只输出 .txt）
  saveSrt: process.env.SAVE_SRT === '1' || process.argv.includes('--srt'),

  // vivo 账号身份（转写可能需要登录态；留空则走未登录路径）
  token: process.env.VIVO_TOKEN || '',
  openid: process.env.VIVO_OPENID || '',
  vaid: process.env.VAID || '00000000000000',
  did: process.env.DID || '',

  blockSize: 5 * 1024 * 1024, // 5MB
  maxFileSize: 500 * 1024 * 1024, // 500MB

  // 批量并发数（同时处理几个文件）
  concurrency: Math.max(1, parseInt(process.env.CONCURRENCY || '3', 10) || 3),

  // 单个文件内部并发上传的分片数（1 = 逐片串行，与官方 App 行为一致）
  // 实测服务端按 slice_index 组装，乱序上传结果正确；但上传仅占单文件链路 ~8%，
  // 调大收益很小，而 4 路 × 6 文件并发时上游会返 10105（ks3 落盘失败），故默认保持串行。
  uploadConcurrency: Math.max(1, Math.min(8, parseInt(process.env.UPLOAD_CONCURRENCY || '1', 10) || 1)),

  // 单个分片的上传重试次数（指数退避），用于吞掉 10105 这类上游瞬时失败
  uploadRetries: Math.max(0, Math.min(10, parseInt(process.env.UPLOAD_RETRIES || '4', 10) || 4)),
};

const VERBOSE = process.env.VERBOSE === '1';

// 带标签日志：并发时给每路输出加 [i/N] 前缀，避免串行错乱
function log(tag, ...args) {
  console.log(...(tag ? [tag, ...args] : args));
}

// ---------------------------------------------------------------------------
// 与 Java 完全一致的编码 / 排序 / 过滤
// ---------------------------------------------------------------------------

// 复刻 java.net.URLEncoder.encode：安全字符 A-Za-z0-9 . - * _ 不编码，其余按 UTF-8 百分号编码(大写)，空格 -> +
// 但调用前 SDK 会先 replaceAll(" ", "") 去掉所有空格。
function javaUrlEncode(s) {
  if (s == null) return '';
  s = String(s).replace(/ /g, '');
  if (s === '') return '';
  let out = '';
  for (const ch of s) {
    if (/[A-Za-z0-9.\-*_]/.test(ch)) {
      out += ch;
    } else {
      for (const b of Buffer.from(ch, 'utf8')) {
        out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}

// 复刻 StringUtils.filterSpecialCharacters
function filterSpecialCharacters(str) {
  return str
    .replace(/\+/g, '%20')
    .replace(/%21/g, '!')
    .replace(/%27/g, "'")
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%7E/g, '~')
    .replace(/%2A/g, '*')
    .replace(/%2D/g, '-')
    .replace(/%2E/g, '.')
    .replace(/%5F/g, '_');
}

// 复刻 Java String.compareToIgnoreCase（ASCII 下等价于忽略大小写比较）
function compareToIgnoreCase(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c1 = a.charCodeAt(i), c2 = b.charCodeAt(i);
    if (c1 !== c2) {
      const u1 = a[i].toUpperCase(), u2 = b[i].toUpperCase();
      if (u1 !== u2) {
        const l1 = a[i].toLowerCase(), l2 = b[i].toLowerCase();
        if (l1 !== l2) return l1 < l2 ? -1 : 1;
      }
    }
  }
  return a.length - b.length;
}

function nonce(n) {
  const cs = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < n; i++) out += cs[crypto.randomInt(cs.length)];
  return out;
}

// 构造查询串（对应 c/a.java 的 queryString），返回已排序+过滤的 query（不含 "?"）
function buildQuery(timestamp, userId, extra) {
  const enc = javaUrlEncode;
  const params = [];
  params.push('android_version=' + enc(CONFIG.androidVersion));
  if (extra && extra.audioId != null) params.push('audio_id=' + enc(extra.audioId));
  if (CONFIG.brand) params.push('brand=' + enc(CONFIG.brand));
  params.push('client_version=' + enc(CONFIG.clientVersion));
  params.push('engineid=' + enc(CONFIG.engineType));
  params.push('model=' + enc(CONFIG.model));
  params.push('net_type=' + enc(CONFIG.netType));
  params.push('package=' + enc(CONFIG.packageName));
  params.push('product=' + enc(CONFIG.product));
  params.push('rom=' + enc(CONFIG.rom));
  params.push('sdk_version=' + enc(CONFIG.sdkVersion));
  if (extra && extra.sliceIndex != null) params.push('slice_index=' + extra.sliceIndex); // 原始整数
  if (extra && extra.sliceNum != null) params.push('slice_num=' + extra.sliceNum); // 原始整数
  params.push('system_time=' + enc(timestamp));
  params.push('system_version=' + enc(CONFIG.systemVersion));
  params.push('user_id=' + enc(userId));
  if (extra && extra.xSessionId != null) params.push('x-sessionId=' + enc(extra.xSessionId));

  // StringUtils.asciiSort：按整条 key=value 忽略大小写升序
  params.sort((a, b) => compareToIgnoreCase(a, b));
  const query = params.join('&');
  return filterSpecialCharacters(query);
}

function sign(path, query, timestamp, nonceStr) {
  const canonical = [
    'POST',
    path,
    query,
    CONFIG.appId,
    timestamp,
    `x-ai-gateway-app-id:${CONFIG.appId}\nx-ai-gateway-timestamp:${timestamp}\nx-ai-gateway-nonce:${nonceStr}`,
  ].join('\n');
  return crypto.createHmac('sha256', CONFIG.appKey).update(canonical, 'utf8').digest('base64');
}

// 发起一次请求：返回 { url, headers, status, body }
function doPost(path, query, body, bodyType, tag, systemTime) {
  const timestamp = systemTime || String(Math.floor(Date.now() / 1000));
  const nonceStr = nonce(8);
  const url = CONFIG.serverUrl + path + '?' + query;
  const headers = {
    'Content-Type': bodyType,
    'User-Agent': 'okhttp/4.9.1',
    'X-AI-GATEWAY-APP-ID': CONFIG.appId,
    'X-AI-GATEWAY-TIMESTAMP': timestamp,
    'X-AI-GATEWAY-NONCE': nonceStr,
    'X-AI-GATEWAY-SIGNED-HEADERS': 'x-ai-gateway-app-id;x-ai-gateway-timestamp;x-ai-gateway-nonce',
    'X-AI-GATEWAY-SIGNATURE': sign(path, query, timestamp, nonceStr),
    'appid': CONFIG.appId,
  };
  if (CONFIG.did) headers['imei'] = CONFIG.did;
  if (CONFIG.vaid) headers['vaid'] = CONFIG.vaid;
  if (CONFIG.token) headers['token'] = CONFIG.token;
  if (CONFIG.openid) headers['openid'] = CONFIG.openid;

  return new Promise((resolve, reject) => {
    const m = url.match(/^https:\/\/([^/]+)(\/.*)$/);
    const req = https.request(
      {
        method: 'POST',
        hostname: m[1],
        path: m[2], // 原样发送，不做二次编码
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: 60000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (VERBOSE) log(tag, `[${res.statusCode}] ${url}`);
          if (VERBOSE) log(tag, `  body: ${text}`);
          resolve({ status: res.statusCode, body: text });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

// 解析统一响应外层 { code, desc, sid, data }
function parseResp(resp) {
  let json;
  try {
    json = JSON.parse(resp.body);
  } catch (e) {
    throw new Error('非 JSON 响应: ' + resp.body.slice(0, 300));
  }
  if (json.code !== 0) {
    throw new Error(`服务端错误 code=${json.code} desc=${json.desc} (HTTP ${resp.status})`);
  }
  return json;
}

// multipart/form-data 单分片 body
function multipartBody(boundary, filename, contentType, data) {
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n` +
      `\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return Buffer.concat([head, data, tail]);
}

// 计算音频时长（秒）：优先 ffprobe，退回解析 m4a mvhd，再退回 0
function audioDurationSec(filePath) {
  try {
    const r = spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ], { encoding: 'utf8' });
    const v = parseFloat(r.stdout);
    if (r.status === 0 && Number.isFinite(v) && v > 0) return Math.round(v);
  } catch (e) { /* ignore */ }
  try {
    const buf = Buffer.alloc(1024 * 1024);
    const fd = fs.openSync(filePath, 'r');
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const idx = buf.indexOf(Buffer.from('mvhd'), 0, n);
    if (idx >= 0) {
      const ver = buf[idx + 4];
      let timescale, duration;
      if (ver === 1) {
        timescale = buf.readUInt32BE(idx + 24);
        duration = Number(buf.readBigUInt64BE(idx + 28));
      } else {
        timescale = buf.readUInt32BE(idx + 16);
        duration = buf.readUInt32BE(idx + 20);
      }
      if (timescale > 0) return Math.round(duration / timescale);
    }
  } catch (e) { /* ignore */ }
  return 0;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const AUDIO_EXTS = new Set([
  '.m4a', '.mp3', '.wav', '.aac', '.amr', '.flac', '.mp4',
  '.ogg', '.opus', '.m4b', '.3gp', '.wma', '.mka', '.ape', '.caf',
]);
const DEFAULT_PATH = 'D:\\Downloads\\古代文化常识（六）骇人的刑罚【学过石油的语文老师】 [BV1ek4y1r7Da_p1].m4a';

function isAudioFile(p) {
  return AUDIO_EXTS.has(path.extname(p).toLowerCase());
}

function scanDir(dir, recursive) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...scanDir(full, recursive));
    } else if (entry.isFile() && isAudioFile(full)) {
      out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh'));
}

// 把 Windows 拖拽产生的带引号、空格分隔的多路径串拆成单个路径
function tokenizePaths(line) {
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

// 解析输入 → 音频文件列表（参数可为文件、目录；交互模式下可连续添加）
async function resolveInputs() {
  const files = [];
  const seen = new Set();
  const add = (raw) => {
    const p = (raw || '').replace(/^["']|["']$/g, '').trim();
    if (!p) return;
    const abs = path.resolve(p);
    if (seen.has(abs)) return;
    let st;
    try { st = fs.statSync(abs); } catch { console.error(`跳过（不存在）: ${abs}`); return; }
    if (st.isDirectory()) {
      const rec = process.env.SCAN_RECURSIVE !== '0';
      for (const f of scanDir(abs, rec)) {
        if (!seen.has(f)) { seen.add(f); files.push(f); }
      }
    } else if (st.isFile()) {
      if (isAudioFile(abs)) { seen.add(abs); files.push(abs); }
      else console.error(`跳过（非音频文件）: ${abs}`);
    }
  };

  const args = process.argv.slice(2);
  if (args.length > 0) {
    for (const a of args) {
      // 整个参数本身就是一个存在的路径（含空格文件名，程序化调用场景）→ 原样收下
      const whole = (a || '').replace(/^["']|["']$/g, '').trim();
      if (whole && fs.existsSync(whole)) add(whole);
      else for (const tok of tokenizePaths(a)) add(tok); // 一参多路径（拖拽进终端）
    }
  } else {
    console.log('交互模式：输入音频文件或目录路径（可拖拽，一次可拖多个文件），回车继续添加，再次回车结束；全程回车则用默认文件。');
    while (true) {
      const ans = (await ask('路径 > ')).trim();
      if (!ans) break;
      for (const tok of tokenizePaths(ans)) add(tok);
    }
    if (files.length === 0) add(DEFAULT_PATH);
  }
  return files;
}

// ---- 断点续传：分片上传进度缓存（与源音频同目录，记录 audio_id + 已传片数）----
function sidecarPath(filePath) {
  return filePath.replace(/\.[^./\\]+$/, '') + '.transcribe.json';
}

function readSidecar(filePath) {
  try {
    const obj = JSON.parse(fs.readFileSync(sidecarPath(filePath), 'utf8'));
    if (!obj || typeof obj.audioId !== 'string' || !obj.audioId) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function writeSidecar(filePath, data) {
  fs.writeFileSync(sidecarPath(filePath), JSON.stringify(data, null, 2), 'utf8');
}

function clearSidecar(filePath) {
  try { fs.unlinkSync(sidecarPath(filePath)); } catch (e) { /* ignore */ }
}

async function transcribeOne(filePath, tag, showText) {
  const stat = fs.statSync(filePath);
  if (stat.size === 0 || stat.size > CONFIG.maxFileSize) {
    throw new Error(`文件大小非法: ${stat.size} 字节（需 >0 且 <=500MB）`);
  }
  const fileSize = stat.size;
  const fileMtimeMs = Math.floor(stat.mtimeMs);
  const sliceNum = Math.ceil(fileSize / CONFIG.blockSize);
  const fileName = path.basename(filePath);

  log(tag, `文件: ${fileName}`);
  log(tag, `大小: ${fileSize} 字节, 分片数: ${sliceNum}`);

  // 读取续传缓存；文件变了（大小/时间戳/分片数）就作废
  let session = readSidecar(filePath);
  if (session && (session.fileSize !== fileSize || session.fileMtimeMs !== fileMtimeMs || session.sliceNum !== sliceNum)) {
    log(tag, '续传缓存与文件不一致，作废重来');
    clearSidecar(filePath);
    session = null;
  }

  const meta = { fileSize, fileMtimeMs, sliceNum, fileName };
  try {
    const r = await processSession(filePath, session, meta, tag, showText);
    clearSidecar(filePath);
    return r;
  } catch (e) {
    if (session) {
      log(tag, `续传失败（${e.message}），清除缓存完整重跑`);
      clearSidecar(filePath);
      const r = await processSession(filePath, null, meta, tag, showText);
      clearSidecar(filePath);
      return r;
    }
    throw e;
  }
}

async function processSession(filePath, session, meta, tag, showText) {
  const { fileSize, sliceNum, fileName } = meta;

  if (!session) {
    // 全新：建会话
    session = {
      version: 1,
      fileSize: meta.fileSize,
      fileMtimeMs: meta.fileMtimeMs,
      sliceNum,
      userId: crypto.randomUUID().replace(/-/g, ''),
      xSessionId: crypto.randomUUID(),
      audioId: null,
      uploadedSlices: 0,
      duration: audioDurationSec(filePath),
    };
    log(tag, '[1/5] /lasr/create');
    const ts = String(Math.floor(Date.now() / 1000));
    const createQuery = buildQuery(ts, session.userId, null);
    const createBody = JSON.stringify({
      'x-sessionId': session.xSessionId,
      'slice_num': sliceNum,
      'audio_type': 'auto',
      'scene': CONFIG.scene,
    });
    const resp = parseResp(await doPost('/lasr/create', createQuery, createBody, 'application/json; charset=utf-8', tag, ts));
    session.audioId = resp.data.audio_id;
    if (!session.audioId) throw new Error('create 未返回 audio_id');
    log(tag, `  audio_id = ${session.audioId}`);
    log(tag, `  时长: ${session.duration}s`);
    writeSidecar(filePath, session);
  } else {
    session.uploadedSlices = session.uploadedSlices || 0;
    if (session.duration == null) session.duration = audioDurationSec(filePath);
    log(tag, `[续传] 复用 audio_id=${session.audioId}，从分片 ${session.uploadedSlices + 1}/${sliceNum} 继续（时长: ${session.duration}s）`);
  }

  // 2) upload（并发 worker 池；UPLOAD_CONCURRENCY=1 即逐片串行）
  // 续传记录双轨：uploadedSet 存所有已完成片号（并发下完成顺序是乱的），
  // uploadedSlices 只记「从 0 起连续完成」的水位，供日志和兼容旧 sidecar。
  const doneSlices = new Set(session.uploadedSet || []);
  for (let i = 0; i < (session.uploadedSlices || 0); i++) doneSlices.add(i);
  const pendingSlices = [];
  for (let i = 0; i < sliceNum; i++) if (!doneSlices.has(i)) pendingSlices.push(i);

  if (pendingSlices.length > 0) {
    const conc = Math.min(CONFIG.uploadConcurrency, pendingSlices.length);
    log(tag, `[2/5] /lasr/upload（待传 ${pendingSlices.length}/${sliceNum} 片，并发 ${conc}）`);
    const boundary = '----vivo' + crypto.randomBytes(16).toString('hex');
    const encName = javaUrlEncode(fileName);
    const fd = fs.openSync(filePath, 'r');
    try {
      let next = 0;
      let failure = null;
      const commit = (sliceIndex) => {
        doneSlices.add(sliceIndex);
        let w = session.uploadedSlices || 0;
        while (doneSlices.has(w)) w++;
        session.uploadedSlices = w;
        session.uploadedSet = [...doneSlices].sort((a, b) => a - b);
        writeSidecar(filePath, session); // 每片落盘，实现片级续传
      };
      const uploadSlice = async (sliceIndex) => {
        const offset = sliceIndex * CONFIG.blockSize;
        const length = Math.min(CONFIG.blockSize, fileSize - offset);
        const buf = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
          const r = fs.readSync(fd, buf, read, length - read, offset + read);
          if (r <= 0) break;
          read += r;
        }
        let lastErr;
        for (let attempt = 0; attempt <= CONFIG.uploadRetries; attempt++) {
          if (attempt > 0) {
            const wait = Math.min(15000, 1000 * 2 ** (attempt - 1));
            log(tag, `  分片 ${sliceIndex + 1} 重试 ${attempt}/${CONFIG.uploadRetries}（等 ${wait}ms）: ${lastErr.message}`);
            await new Promise((r) => setTimeout(r, wait));
          }
          try {
            const upTs = String(Math.floor(Date.now() / 1000));
            const upQuery = buildQuery(upTs, session.userId, {
              audioId: session.audioId, sliceIndex, sliceNum, xSessionId: session.xSessionId,
            });
            const mBody = multipartBody(boundary, encName, 'application/octet-stream', buf);
            const upResp = await doPost('/lasr/upload', upQuery, mBody, `multipart/form-data; boundary=${boundary}`, tag, upTs);
            const upJson = JSON.parse(upResp.body);
            if (upJson.code === 0 || upJson.code === 20005) {
              commit(sliceIndex);
              log(tag, `  分片 ${sliceIndex + 1}/${sliceNum} 完成 (code=${upJson.code}，连续水位 ${session.uploadedSlices})`);
              return;
            }
            lastErr = new Error(`上传分片 ${sliceIndex} 失败 code=${upJson.code} desc=${upJson.desc}`);
          } catch (e) {
            lastErr = e; // 网络异常/非 JSON 响应也进重试
          }
        }
        throw lastErr;
      };
      const workers = Array.from({ length: conc }, async () => {
        while (!failure) {
          const i = next++;
          if (i >= pendingSlices.length) break;
          try {
            await uploadSlice(pendingSlices[i]);
          } catch (e) {
            failure = e; // 一片失败即停领新片，已在途的片跑完；已完成片已落盘可续传
          }
        }
      });
      await Promise.all(workers);
      if (failure) throw failure;
      log(tag, '  上传完成');
    } finally {
      fs.closeSync(fd);
    }
  } else {
    log(tag, '[2/5] 分片已全部上传，跳过');
  }

  // 3) run
  log(tag, '[3/5] /lasr/run');
  const runTs = String(Math.floor(Date.now() / 1000));
  const runQuery = buildQuery(runTs, session.userId, null);
  const runBody = JSON.stringify({
    'audio_id': session.audioId,
    'x-sessionId': session.xSessionId,
    'audio_time': session.duration,
    'language_code': CONFIG.language,
    'scene': CONFIG.scene,
  });
  let resp = parseResp(await doPost('/lasr/run', runQuery, runBody, 'application/json; charset=utf-8', tag, runTs));
  const taskId = resp.data.task_id;
  if (!taskId) throw new Error('run 未返回 task_id');
  log(tag, `  task_id = ${taskId}`);

  // 4) progress（轮询）
  log(tag, '[4/5] /lasr/progress（轮询进度）');
  const progBody = JSON.stringify({
    'task_id': taskId,
    'x-sessionId': session.xSessionId,
    'language_code': CONFIG.language,
    'scene': CONFIG.scene,
  });
  let progress = -1;
  while (progress !== 100) {
    const progTs = String(Math.floor(Date.now() / 1000));
    const progQuery = buildQuery(progTs, session.userId, null);
    resp = parseResp(await doPost('/lasr/progress', progQuery, progBody, 'application/json; charset=utf-8', tag, progTs));
    progress = resp.data.progress;
    log(tag, `  进度: ${progress}%`);
    if (progress >= 100) break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 5) result
  log(tag, '[5/5] /lasr/result');
  const resTs = String(Math.floor(Date.now() / 1000));
  const resQuery = buildQuery(resTs, session.userId, null);
  resp = parseResp(await doPost('/lasr/result', resQuery, progBody, 'application/json; charset=utf-8', tag, resTs));
  const result = resp.data.result || [];

  if (result.length === 0) {
    log(tag, '（无结果）');
    return { ok: true, filePath, segments: 0, txtPath: null, srtPath: null };
  }

  if (showText) {
    log(tag, `共 ${result.length} 段转写文本:`);
    for (const seg of result) {
      const t = seg.onebest || '';
      log(tag, `[${fmtMs(seg.bg)} - ${fmtMs(seg.ed)}]${seg.speaker ? ` 说话人${seg.speaker}` : ''}  ${t}`);
    }
    log(tag, '--- 纯文本 ---');
    log(tag, result.map((s) => s.onebest).join(''));
  }

  const saved = saveResult(filePath, result);
  log(tag, `已保存（${result.length} 段）→ ${saved.txtPath}`);
  if (saved.srtPath) log(tag, `已保存（字幕）→ ${saved.srtPath}`);
  return { ok: true, filePath, segments: result.length, txtPath: saved.txtPath, srtPath: saved.srtPath };
}

// 批量入口
async function main() {
  console.log('== vivo 录音转写（批量） ==');
  console.log(`appId: ${CONFIG.appId}, engine: ${CONFIG.engineType}, 服务器: ${CONFIG.serverUrl}`);
  console.log(`并发数: ${CONFIG.concurrency}（可用环境变量 CONCURRENCY 调整）`);
  if (!CONFIG.token) console.log('提示: 未提供 VIVO_TOKEN/VIVO_OPENID，按未登录路径尝试。');

  const files = await resolveInputs();
  if (files.length === 0) {
    console.error('没有可处理的音频文件。');
    process.exit(1);
  }
  console.log(`\n待处理 ${files.length} 个文件:\n` + files.map((f, i) => `  ${i + 1}. ${f}`).join('\n') + '\n');

  // 并发 worker 池：最多 CONFIG.concurrency 个同时跑
  const showText = files.length === 1;
  const results = new Array(files.length);
  const limit = Math.min(CONFIG.concurrency, files.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = next++;
      if (i >= files.length) break;
      const tag = `[${i + 1}/${files.length}]`;
      try {
        results[i] = await transcribeOne(files[i], tag, showText);
      } catch (e) {
        results[i] = { ok: false, filePath: files[i], error: e.message };
        console.error(`${tag} [失败] ${files[i]}: ${e.message}`);
      }
    }
  });
  await Promise.all(workers);

  const ok = results.filter((r) => r && r.ok).length;
  const fail = results.filter((r) => r && !r.ok).length;
  const saved = results.filter((r) => r && r.ok && r.txtPath);

  console.log(`\n\n================ 批量完成 ================`);
  console.log(`成功 ${ok} 个，失败 ${fail} 个`);
  if (saved.length > 0) {
    console.log('保存位置:');
    for (const r of saved) {
      console.log(`  ✔ ${path.basename(r.filePath)}`);
      console.log(`    文本: ${r.txtPath}`);
      if (r.srtPath) console.log(`    字幕: ${r.srtPath}`);
    }
  }
  console.log('==========================================');
}

// 保存转写结果：纯文本 .txt + 可选时间轴 .srt（与源音频同目录）
function saveResult(filePath, result) {
  const base = filePath.replace(/\.[^./\\]+$/, '');
  const plain = result.map((s) => s.onebest || '').join('');

  const txtPath = base + '.txt';
  fs.writeFileSync(txtPath, plain, 'utf8');

  let srtPath = null;
  if (CONFIG.saveSrt) {
    srtPath = base + '.srt';
    const srt = result
      .map((s, i) => {
        const speaker = s.speaker ? `（说话人${s.speaker}）` : '';
        return `${i + 1}\n${fmtSrt(s.bg)} --> ${fmtSrt(s.ed)}\n${speaker}${s.onebest || ''}\n`;
      })
      .join('\n');
    fs.writeFileSync(srtPath, srt, 'utf8');
  }

  return { txtPath, srtPath, plain };
}

function fmtSrt(v) {
  if (v == null) return '00:00:00,000';
  const ms = Math.floor(v);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`;
}

function fmtMs(v) {
  if (v == null) return '?';
  const s = Math.floor(v / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

main().catch((e) => {
  console.error('\n[失败] ' + e.message);
  process.exit(1);
});
