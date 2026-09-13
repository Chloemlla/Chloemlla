# 录音机「录音转写 / 转文本」API 逆向文档

> **目标 App**：`com.android.bbksoundrecorder`（vivo/BBK 原生录音机）版本 `1.7.3.9`（versionCode `1070309`）
> **逆向产物**：jadx 1.5.6 反编译 Java 源码，根目录 `F:/Repositories/GitHub/luyinji-rev/decompiled/sources`
> **转写引擎**：`com.vivo.speechsdk` 的 **LASR**（Long-form ASR，大文件语音识别），SDK 版本 `5.2.5.66`
> 标注约定：**CERTAIN** = 直接读自反编译代码；**INFERRED** = 依据调用链/命名推断（未抓包验证）。

---

## 0. 结论速览（CERTAIN）

录音转写有两条独立路径，**文件转写走 HTTP，不是 WebSocket**：

| 路径 | 用途 | 传输 | 地址 | 关键类 |
|---|---|---|---|---|
| **LASR 文件转写**（“录音转写”） | 已录制文件离线转文本 | **HTTPS POST**（JSON + multipart 分片） | `https://{ASR域名}/lasr/*` | `speechsdk.module.lasr.b` |
| **实时流式 ASR** | 麦克风实时识别 | **WSS**（JSON 文本帧 + 二进制音频帧） | `wss://{ASR域名}/asr/v2` | `speechsdk.module.asronline.i.g` |

文件转写完整流程（CERTAIN）：

```
POST /lasr/create   建音频会话  →  data.audio_id
POST /lasr/upload   5MB 分片上传（multipart "file"）→  data.slices
POST /lasr/run      提交转写任务 →  data.task_id
POST /lasr/progress 轮询进度    →  data.progress (0–100)
POST /lasr/result   取最终结果  →  data.result[]（无中间/流式部分结果）
```

会话标识：`x-sessionId` = `UUID.randomUUID().toString()`（客户端生成）；`audio_id` / `task_id` 由服务端返回。

---

## 1. 端点目录（CERTAIN）

### 1.1 LASR 文件转写（核心）

基础地址：`key_server_url`，缺省 `"https://" + getDomain(1)`（`lasr/b.java:795-803`）。

| 方法 | 路径 | 用途 | 请求体 | 关键响应 |
|---|---|---|---|---|
| POST | `/lasr/create` | 创建音频会话 | JSON | `data.audio_id` |
| POST | `/lasr/upload` | 上传音频分片 | multipart `file` + URL 元数据 | `data.slices` |
| POST | `/lasr/run` | 提交转写任务 | JSON | `data.task_id` |
| POST | `/lasr/progress` | 查询进度 | JSON | `data.progress` |
| POST | `/lasr/result` | 取最终结果 | JSON | `data.result[]`、`data.language_code` |
| POST | `/lasr/lang` | 查询支持方言 | JSON | `err_code` + 方言结果（事件 7000） |

### 1.2 实时流式 ASR（WebSocket，与文件转写并列）

| 方案 | 地址 | 备选 | 来源 |
|---|---|---|---|
| 新鉴权 | `wss://asr-v2.vivo.com.cn/asr/v2` | `wss://asr-ali-v2.vivo.com.cn/asr/v2` | `asronline/i/c.java` |
| 旧鉴权 | `wss://aispeech.vivo.com.cn/asr/v2` | `wss://aispeech-ali.vivo.com.cn/asr/v2` | `asronline/i/d.java` |
| 动态海外 | `wss://{getDomain(1)}/asr/v2` | — | `asronline/i/e.java` |

### 1.3 相邻子系统端点（详细见 `section-endpoints-hosts.md`）

- **TTS**：`wss://tts-v2.vivo.com.cn/tts`、`https://vivotrans.vivo.com.cn/fy/tts`、`https://%s/vcns_config`、`https://%s/upload_full_text?request_id=`
- **热词上报**：`https://jovivauc.vivo.com.cn/datacollect/upload`
- **httpdns**：`https://vhs.wwstat.com/v1/get.do`（主）、`https://vhs.vivo.com.cn/v1/get.do`（备）
- **统一鉴权**：`https://copilot-api-auth-prd.vivo.com.cn/user/blacklist/status`；GPT-kit SSE `https://gptkit-proxy.vivo.com.cn/gpt_api/servant_request`
- **账号 token 校验**：`https://usrsys.vivo.com.cn/login/validateVivoToken`、`.../validateSDKToken`

---

## 2. 认证与签名

由 bundle 键 `key_new_authentication_enable` 控制两套方案（默认 `true`）。

### 2.1 新版 AI 网关签名（`X-AI-GATEWAY-*`，CERTAIN）

算法 **HMAC-SHA256(appKey, canonicalString) → Base64(NO_WRAP)**，权威参考实现 `com/vivo/ai/gpt/kit/sse/auth/AuthSigHelper.java`。

请求头（发送时）：

| 头名 | 值 |
|---|---|
| `X-AI-GATEWAY-APP-ID` | appId |
| `X-AI-GATEWAY-TIMESTAMP` | 秒级时间戳 |
| `X-AI-GATEWAY-NONCE` | 8 位随机字母数字 |
| `X-AI-GATEWAY-SIGNED-HEADERS` | `x-ai-gateway-app-id;x-ai-gateway-timestamp;x-ai-gateway-nonce` |
| `X-AI-GATEWAY-SIGNATURE` | `Base64(HMAC-SHA256(appKey, 原串))` |

签名原串 = 6 行以 `\n` 连接（CERTAIN）：

```
<HTTP方法>              # 文件转写 POST；WebSocket ASR 为 GET；TTS HTTP 硬编码 GET
<路径>                  # 如 /lasr/create、/asr/v2
<查询串>                # 已 ASCII 排序 + 过滤特殊字符后的 queryString
<appId>
<timestamp(秒)>
x-ai-gateway-app-id:<appId>
x-ai-gateway-timestamp:<timestamp>
x-ai-gateway-nonce:<nonce>
```

### 2.2 旧版签名（`nonce_str` + `sign`，结构 CERTAIN，算法 INFERRED）

当 `key_new_authentication_enable=false`（折叠屏路径），URL 追加：

```
&nonce_str=<16位随机>&sign=<native Sign.sign(...)>
```

待签数组（有序）：`["appid=…", "nonce_str=…", "package=…", "system_time=…", "user_id=…"]`。核心 `Sign.sign` 在 `libspeech_sec.so`（本 APK 为 split 基础包，**不含 .so**，算法 UNKNOWN；疑似与 vivo `VivoSign` v2 同源：`"2|" + hex(SHA-256(sorted))`）。

### 2.3 通用身份头（两套方案都带，CERTAIN）

```java
builder.header("imei",  did);     // key_did
builder.header("vaid",  vaid);    // key_vaid（无则回退 "00000000000000"）
builder.header("appid", appid);   // key_appid
builder.header("token", token);   // key_token = vivoToken
builder.header("openid", openid); // key_openid
```

### 2.4 令牌来源（CERTAIN）

- `vivoToken` / `openid` 来自 vivo 账号系统（`AccountManager`，账号类型 `BBKOnLineService`）。
- `opentoken` 由 `validateVivoToken` / `validateSDKToken` 换取；`stat==441`/`20002` 表示失效需重登。
- 设备标识 `VAID/OAID/UDID/GUID/AAID` 来自 `content://com.vivo.vms.IdProvider/IdentifierId`。

---

## 3. 请求 / 响应细节（逐端点）

所有 LASR 响应统一外层：`code`(int，0=成功)、`desc`(string)、`sid`(string)、`data`(object)。

### 3.1 `POST /lasr/create`

请求体（`module/lasr/c/a.java:32`）：

```json
{ "x-sessionId": "<uuid>", "slice_num": 12, "audio_type": "auto", "scene": "smart" }
```

- `audio_type` 来自 `key_audio_stream_type`（`auto`/`pcm`/`wav`）；`key_extend_params`（形如 `k=v`）逐条附加。

响应：

```json
{ "code": 0, "desc": "…", "sid": "…", "data": { "audio_id": "<audio_id>" } }
```

### 3.2 `POST /lasr/upload`（multipart 分片）

- **表单字段名固定 `file`**，filename = URL 编码后的音频文件名，`Content-Type: application/octet-stream`，内容经 `MultiRequestBody` 流式写出（5120 字节/次）。
- **元数据在 URL 查询串**：`audio_id`、`slice_index`、`slice_num`、`x-sessionId`。
- 每片 `offset = blockSize * (sliceIndex + 1)`，长度 `min(blockSize, fileLength - offset)`。

响应：

```json
{ "code": 0, "desc": "…", "sid": "…", "data": { "slices": 12 } }
```

- `code==0` → `sliceIndex++`，未完成继续下一片。
- `code==20005` → 该片已存在，`sliceIndex++` 跳过（幂等重传）。
- 其余 code → 失败回调。

### 3.3 `POST /lasr/run`

```json
{ "audio_id": "<audio_id>", "x-sessionId": "<uuid>", "audio_time": 60, "language_code": "zh-Hans-CN", "scene": "smart" }
```

响应：`data.task_id`。注意 `enable_speaker` 常量未实际写入 body（说话人分离靠引擎类型 `fileasrrole`）。

### 3.4 `POST /lasr/progress` 与 `POST /lasr/result`

请求体（两者相同）：

```json
{ "task_id": "<task_id>", "x-sessionId": "<uuid>", "language_code": "zh-Hans-CN" }
```

进度响应：

```json
{ "code": 0, "desc": "…", "sid": "…", "data": { "progress": 100 } }
```

结果响应：

```json
{ "code": 0, "desc": "…", "sid": "…",
  "data": { "language_code": "zh-Hans-CN",
            "result": [ { "onebest": "你好世界", "bg": 0, "ed": 3200, "speaker": 1, "lid": 0 } ] } }
```

### 3.5 `POST /lasr/lang`

```json
{ "request_id": "123456789", "user_id": "…", "lang": "zh", "engineid": "fileasrrecorder" }
```

响应用 `err_code` 字段（非 `code`），结果经事件 7000 回传。

### 3.6 通用查询参数（所有 LASR 请求，CERTAIN）

`android_version`、`brand`(非空)、`client_version`、`engineid`、`model`、`net_type`(`1`WiFi/`0`蜂窝)、`package`、`product`、`rom`、`sdk_version`、`system_time`(新鉴权秒/旧鉴权毫秒)、`system_version`、`user_id`；旧鉴权追加 `appid`+`asr=1&tts=0&nlu=0`+`nonce_str`+`sign`；海外追加 `country_code*`。最终按参数名 ASCII 升序重排（`StringUtils.asciiSort`）。

---

## 4. 上传机制（CERTAIN）

- 分片大小 `blockSize = 5242880`（**5 MB**），`sliceNum = ceil(fileLength / 5MB)`，文件上限 500MB（`FILE_MAX_SIZE_500M = 524288000`）。
- `getUploadOffset() = blockSize * (sliceIndex + 1)`；`isUploadSuccess()` 判据 `(sliceIndex+1)*100/sliceNum == 100`。
- 断点续传：`LasrSqlEntity` 序列化到 SP（key `key_lasr_sql_entity`），`uploadResume()` 从 `sliceIndex+1` 继续。
- App 侧文件格式默认 `m4a`；上传前的转码/编码走 `bb.a`（在线）或 `db.b`（离线 `engine_mode=6`）。

---

## 5. 数据模型

### 5.1 SDK 结果 `LasrResultEntity`（`module/api/lasr/bean/LasrResultEntity.java`）

| 字段 | 类型 | JSON key | 含义 |
|---|---|---|---|
| `onebest` | String | `onebest` | 识别文本（最优） |
| `bg` | long | `bg` | 片段起始时间（毫秒，INFERRED 单位） |
| `ed` | long | `ed` | 片段结束时间（毫秒，INFERRED 单位） |
| `speaker` | int | `speaker` | 说话人/角色编号（diarization） |
| `lid` | long | `lid` | 语言 ID |

> 无逐字时间戳、无置信度、无标点字段、无中间态。离线路径字段名不同：`data.end`（非 `ed`）。

### 5.2 会话状态 `LasrSqlEntity`

`audioId / uuid(x-sessionId) / taskId / audioType / audioLength / uri / audioName / fileLength / blockSize(5MB) / sliceNum / sliceIndex / slices / progress / languageCode / type(0本地/1HTTP) / sids`。

### 5.3 UI 结果 `RecognizeItem`（`com.vivo.recordbase.core.data.bean`）

`id, recFileId, speakerName, speaker, content, startTime, endTime, aWholeSentence, isLastSentence, textCanConvert, textType, lid, isUserVisible, mIsBackground, mLanguage`。`textType==10001` 为「AI 摘要」条。子类 `SummaryRecognizeItem` 承载摘要/待办三段式。

---

## 6. 硬编码凭据（CERTAIN）

| 用途 | appId | appKey | 引擎 | 鉴权 | 域名 |
|---|---|---|---|---|---|
| 主流（非折叠）转写/ASR | `8735273056` | `NIhyMZRWZUGdDnrW` | `fileasrrecorder` / `longasrlisten` | 新 `X-AI-GATEWAY` | `asr-v2.vivo.com.cn` |
| 折叠屏分角色 | `96yw39m52niisyhg` | `xkkz9f7u4xg6z35eec3k3hn62qwf4uw3` | `fileasrrole` | 旧 `nonce_str`+`sign` | `aispeech.vivo.com.cn` |

来源：`j1/a.java`、`v0/t.java`、`l7/n0.java`、`RecognizeService.java`、`AppFeature.java`、`w6/b.java`。

---

## 7. 域名解析（`getDomain`，CERTAIN）

`NetModule.getDomain(int)`：`1`=ASR 域、其他=TTS 域。

| 环境 | ASR（getDomain(1)） | TTS（getDomain(2)） |
|---|---|---|
| 国内 CN | `asr-v2.vivo.com.cn` | `tts-v2.vivo.com.cn` |
| ID / SG | `asia-asr-v2.vivoglobal.com` | 配置键 `speechsdk_oversea_tts_key`（默认 `"xxx"`） |
| IN | `in-asr-v2.vivoglobal.com` | 同上 |
| 其他海外 | `asia-asr-v2.vivoglobal.com` | 同上 |

判定：`DeviceUtils.isOversea()` + 国家码（`net/utils/f.java`）。

**覆盖优先级（由低到高）**：代码硬编码 → damons 域名文件（`data/bbkcore/domains/`）→ oem 域名文件（`oem/etc/domains/<包名>`）→ Bundle 运行时键 **`key_server_url` / `key_ws_host`**（最高）。DNS 走 httpdns，失败回退系统 DNS。

---

## 8. 功能开关与入口（CERTAIN）

- **入口**：`RecordPlayDetailFragment.l5()` → `RecognizeService.L(filePath, fileName, true)` → `za.b`(FileConvertManager) → `za.c`(SpeechController) → `cb.a` → `LASREngine.uploadAudioFile()`。
- 触发事件：livedatabus `"detail_start_convert"`；结果事件 `"details_mark_covert_change"`。
- **引擎模式** `key_engine_mode`：`1`=在线 LASR，`6`=离线本地 ASR。
- **核心门槛键**：`offline_convert_switch_state_key`（离线转文本开关）、`offline_convert_is_used_key`。
- 离线模型下载：`MLUpdateManager` 绑定 `vivo.intent.action.AI_MLUPDATE_SERVICE`，`algorithm=asr`，`appId=8735273056`。

---

## 9. 错误码（CERTAIN）

| code | 含义 | | code | 含义 |
|---|---|---|---|---|
| 0 | 成功 | | 60008 | 网络失败 |
| 60001 | URI 为空 | | 60009 | `/lasr/create` 非 2xx |
| 60002 | 文件不存在/空 | | 60010 | 用户取消 |
| 60003 | 文件 > 500MB | | 60011 | taskId/xSessionId 为空 |
| 60004 | 未指定音频流类型 | | 60012 | 无可续传实体 |
| 60005 | 正在上传（重复） | | 60013 | 非本地文件 |
| 60006 | 文件内容被修改 | | 20005 | 分片已存在（跳过） |
| 60007 | JSON 解析异常 | | 7000 | 事件：方言结果 |

---

## 10. CERTAIN vs INFERRED

**CERTAIN**：LASR 6 端点与 JSON 字段名、`x-sessionId`/`request_id` 生成方式、5MB 分片与进度公式、结果实体字段、X-AI-GATEWAY 签名头与 HMAC-SHA256 算法、两套凭据、域名映射、上传表单字段 `file`。

**INFERRED（未抓包）**：`bg`/`ed` 时间单位（推测毫秒；离线路径 `ed*32` 暗示 32ms 帧）、旧版 `Sign.sign` 的 native 算法（UNKNOWN）、最终 URL 字节形态的设备相关参数值、`reqMultiBody.mContent` 为冗余赋值。

---

## 11. 附：章节文件索引

| 文件 | 内容 |
|---|---|
| `docs/section-asr-lasr-protocol.md` | LASR + 实时 ASR 线协议、帧格式、状态机、回调序列（最详细） |
| `docs/section-auth-signing.md` | 签名算法、token 流程、native/JNI 职责、设备标识 |
| `docs/section-endpoints-hosts.md` | 全量端点目录、httpdns、域名解析、云盘/升级/VCode |
| `docs/section-app-integration.md` | UI 入口、上传调用链、数据模型、功能开关、aiwriter 区分 |

> 关键源码索引（相对 `decompiled/sources`）：`com/vivo/speechsdk/module/lasr/b.java`（线上实现）、`.../lasr/c/a.java`（协议/签名构造）、`.../api/lasr/bean/LasrResultEntity.java`、`.../api/lasr/bean/LasrSqlEntity.java`、`.../module/net/utils/f.java`（域名）、`.../ttsonline/net/Protocol.java`（签名模板）、`com/vivo/ai/gpt/kit/sse/auth/AuthSigHelper.java`（签名权威实现）。
