# 录音转写（LASR / 长音频 ASR）线上传输协议

> 目标 App：vivo/BBK 录音机 `com.android.bbksoundrecorder`（版本 1.7.3.9）
> 反编译 Java 源码根目录：`F:/Repositories/GitHub/luyinji-rev/decompiled/sources`
> 本文档只覆盖 **录音转写（长音频文件转写，LASR）的应用层线上协议**，以及与它并列的**实时流式 ASR（WebSocket）**协议。认证/签名、端点目录、App 集成由其他 agent 负责，这里仅在需要时引用。

---

## 0. 结论速览（CERTAIN）

vivo 语音 SDK 里有**两条不同的转写路径**：

| 路径 | 用途 | 传输 | 地址 | 关键类 |
|---|---|---|---|---|
| **LASR（长音频文件转写）** | 录音文件离线转写（“录音转写”） | **HTTPS POST（JSON + multipart 文件分片）** | `https://asr-v2.vivo.com.cn/lasr/*`（国内默认）或 `https://aispeech.vivo.com.cn/lasr/*`（折叠屏覆盖） | `com.vivo.speechsdk.module.lasr.b` |
| **实时流式 ASR** | 麦克风实时识别（语音输入等） | **WSS（WebSocket，JSON 文本帧 + 二进制音频帧）** | `wss://asr-v2.vivo.com.cn/asr/v2`（新鉴权）或 `wss://aispeech.vivo.com.cn/asr/v2`（旧鉴权） | `com.vivo.speechsdk.module.asronline.i.g` |

**录音转写（文件）走的是 HTTP，不是 WebSocket。** 完整流程是：`/lasr/create` 建音频 → `/lasr/upload` 分片上传 → `/lasr/run` 提交转写任务 → `/lasr/progress` 轮询进度 → `/lasr/result` 取最终结果。无中间/流式部分结果，只有最终结果（`result` 数组）。

`request_id` 只在 `/lasr/lang`（方言支持查询）和 WebSocket 流式 ASR 里使用；LASR 文件转写流程用的是 `x-sessionId`（随机 UUID）+ `audio_id` + `task_id` 作为会话标识。

---

## 1. LASR 端到端流程（CERTAIN，读自代码）

实现类：`com.vivo.speechsdk.module.lasr.b`（`LASRServiceImpl`，`b.java`）。对外接口 `ILASRService`（`com/vivo/speechsdk/module/api/lasr/ILASRService.java`）只有 6 个业务方法：

```java
public interface ILASRService {
    void uploadAudioFile(String uri, Bundle bundle);     // 1. 创建音频 + 分片上传（内部闭环）
    LasrSqlEntity uploadResume();                        // 断点续传
    void cancelUploadFile();
    void createTaskWithAudioId(String audioId, String xSessionId);  // 2. 提交转写任务
    void queryTaskProcess(String taskId, String xSessionId);        // 3. 轮询进度
    void queryTaskResult(String taskId, String xSessionId);         // 4. 取最终结果
    ...
}
```

### 1.1 阶段一：创建音频并分片上传（`uploadAudioFile` → `/lasr/create` + `/lasr/upload`）

`b.java:619` `uploadAudioFile(String str, Bundle bundle)`：

1. 校验本地文件（存在、非空、`<= 500MB`，见 `LasrSqlEntity.FILE_MAX_SIZE_500M = 524288000`）。
2. 生成会话标识：`String uuid = UUID.randomUUID().toString()`（`b.java:671`）—— 这就是 **`x-sessionId`**。
3. 计算分片参数（`LasrSqlEntity.calculateBlockSize / calculateSliceNum`，见 §5）：
   - `blockSize = 5242880`（5 MB）
   - `sliceNum = ceil(fileLength / blockSize)`
4. 构造 `LasrSqlEntity`，`POST /lasr/create`（JSON body，见 §3.1），从响应 `data.audio_id` 拿到 **`audio_id`**。
5. 循环 `POST /lasr/upload`（multipart，每片 5MB），直到 `isUploadSuccess()`（`sliceIndex` 从 -1 递增，`(sliceIndex+1)*100/sliceNum == 100` 即完成）。
6. 服务器返回 `data.slices`（总片数）、`code=20005` 表示该片已存在（跳过重传）。

关键代码（`b.java:736` `b()` 方法，上传单片）：

```java
this.f13103i.set(true);
String strA = com.vivo.speechsdk.module.lasr.c.a.a(this.f13098d, this.f13102h);
ReqMultiBody reqMultiBody = new ReqMultiBody("application/octet-stream",
        this.f13098d.getFileLength(), this.f13098d.getUri(),
        this.f13098d.getUploadOffset(), this.f13098d.getBlockSize(),
        this.f13098d.getAudioName());
reqMultiBody.mContent = strA;   // 注意：该 JSON 实际上未被 multipart body 使用（见 §3.2）
iHttp.request(a("/lasr/upload", reqMultiBody, this.f13098d), new C0171b());
```

> **片偏移**：`LasrSqlEntity.getUploadOffset() = blockSize * (sliceIndex + 1)`（`sliceIndex` 初值 `-1`，首片 offset = 0）。

### 1.2 阶段二：提交转写任务（`createTaskWithAudioId` → `/lasr/run`）

`b.java:507` `createTaskWithAudioId(audioId, xSessionId)`，`POST /lasr/run`，body 携带 `audio_id` / `x-sessionId` / `audio_time` / `language_code`。响应 `data.task_id` 拿到 **`task_id`**。

### 1.3 阶段三：轮询进度（`queryTaskProcess` → `/lasr/progress`）

`b.java:585`，`POST /lasr/progress`，body 携带 `task_id` / `x-sessionId` / `language_code`。响应 `data.progress`（0–100 整数）。**无中间文本结果，只有进度百分比**。

### 1.4 阶段四：取最终结果（`queryTaskResult` → `/lasr/result`）

`b.java:602`，`POST /lasr/result`，body 同 `/lasr/progress`。响应 `data.result` 是一个 `LasrResultEntity` 数组（完整转写结果，见 §4）。同时 `data.language_code` 回写识别出的语言。

### 1.5 完整回调序列（`LASRServiceListener`，`module/api/lasr/listener/LASRServiceListener.java`）

```java
void onInitSuccess();
void onInitFailed(int code, String msg);
void onUploadFileProcess(String uri, int progress);                                    // 每片上传后
void onUploadFileResult(LasrSqlEntity e, String uri, String audioId, String xSessionId,
                        int code, String msg);                                          // 上传完成
void onTaskCreate(LasrSqlEntity e, String taskId, String xSessionId, int code, String msg);
void onTaskProcess(LasrSqlEntity e, String taskId, String xSessionId, int progress,
                   int code, String msg);
void onTaskResult(LasrSqlEntity e, List<LasrResultEntity> list, int code, String msg);
void onEvent(int event, Bundle bundle);                                                // 7000 = 方言结果
```

时序（CERTAIN）：`onUploadFileResult`（audioId 就绪）→ 上层调 `createTaskWithAudioId` → `onTaskCreate`（taskId 就绪）→ 上层循环 `queryTaskProcess` → `onTaskProcess(progress)` → `queryTaskResult` → `onTaskResult(resultList)`。

### 1.6 断点续传（`uploadResume`）

`LasrSqlEntity` 整体通过 `SpUtil` 序列化到 SP（key `key_lasr_sql_entity`），包含 `sliceIndex` / `audioId` / `uuid` 等，`uploadResume()`（`b.java:692`）读回后从 `sliceIndex+1` 继续 `b()` 上传。

---

## 2. 网络地址（URL）构造（CERTAIN）

### 2.1 域名来源

`com/vivo/speechsdk/module/net/NetModule.java:117`：

```java
public String getDomain(int i10) {
    return i10 == 1 ? com.vivo.speechsdk.module.net.utils.f.b().a()
                    : com.vivo.speechsdk.module.net.utils.f.b().c();
}
```

`com/vivo/speechsdk/module/net/utils/f.java`：国内（`!isOversea()`）`a()` 返回 **`asr-v2.vivo.com.cn`**；海外按国家返回 `asia-asr-v2.vivoglobal.com` / `in-asr-v2.vivoglobal.com`。

LASR 基础域名（`b.java:801`）：

```java
String string3 = this.f13099e.getString("key_server_url");
if (TextUtils.isEmpty(string3)) {
    string3 = "https://" + this.f13096b.getDomain(1);
}
```

App 侧两种配置（`v0/t.java:640`、`com/vivo/aiaudiokit/service/RecognizeService.java:503`）：

| 机型 | `key_engine_type` | `key_new_authentication_enable` | `key_server_url` | 实际基础域名 |
|---|---|---|---|---|
| 折叠屏（`u.c0()`） | `fileasrrole` | `false` | `https://aispeech.vivo.com.cn` | `https://aispeech.vivo.com.cn` |
| 非折叠在线 | `fileasrrecorder` | `true` | （未设） | `https://asr-v2.vivo.com.cn` |
| 离线 | （`key_engine_mode=6`） | — | — | 本地 ASR，不走网络 |

> 团队任务提示里的 `aispeech.vivo.com.cn` 是**旧鉴权（折叠屏）路径**；国内非折叠机默认走 `asr-v2.vivo.com.cn`。

### 2.2 完整 URL = 基础域名 + 路径 + 排序后的查询串

`b.java:795`（私有方法 `a(String path, String systemTime, LasrSqlEntity entity)`）与 `c/a.java:182`（`a(Bundle, str, str2, z10, lasrSqlEntity)`）拼接查询串，最后经 `StringUtils.asciiSort`（按参数名 ASCII 升序重排）与 `StringUtils.filterSpecialCharacters` 处理。

**查询参数清单（CERTAIN，`c/a.java:201` 起）：**

| 参数 | 来源 |
|---|---|
| `android_version` | `Constants.KEY_ANDROID_VERSION` |
| `brand` | `Constants.KEY_BRAND`（非空才带） |
| `client_version` | `Constants.KEY_CLIENT_VERSION` |
| `engineid` | `key_engine_type`（如 `fileasrrecorder` / `fileasrrole`） |
| `imei` | 仅当 `!key_url_did_remove`（实际两类路径都设了 `true`，故**不带**） |
| `model` | `Constants.KEY_MODEL` |
| `net_type` | `"1"`(WiFi) / `"0"`(蜂窝) |
| `package` | `key_package` |
| `product` | `Constants.KEY_PRODUCT` |
| `rom` | `Constants.KEY_ROM` |
| `sdk_version` | `Constants.KEY_SDK_VERSION` |
| `system_time` | 新鉴权 = 秒级时间戳，旧鉴权 = 毫秒级时间戳 |
| `system_version` | `Constants.KEY_SYS_VERSION` |
| `user_id` | `c/a.a()`（SP 里 `key_user_id`，否则随机 UUID 去 `-`） |
| `audio_id` / `slice_index` / `slice_num` / `x-sessionId` | **仅 `/lasr/upload`**（`lasrSqlEntity != null`） |
| 海外 | `country_code_mobile` / `country_code_sim` / `country_code_custom` / `country_code` |
| 旧鉴权（`!z10`） | `appid`（或 `business_name`）+ `asr=1&tts=0&nlu=0` + `nonce_str` + `sign` |

**6 个端点路径（CERTAIN）：**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/lasr/create` | 创建音频，返回 `audio_id` |
| POST | `/lasr/upload` | 分片上传（multipart） |
| POST | `/lasr/run` | 提交转写任务，返回 `task_id` |
| POST | `/lasr/progress` | 查询进度 |
| POST | `/lasr/result` | 查询最终结果 |
| POST | `/lasr/lang` | 支持方言查询（事件 7000） |

### 2.3 `request_id` 生成（CERTAIN，但仅用于 `/lasr/lang` 与 WebSocket）

`com/vivo/speechsdk/common/utils/SessionUtils.java:8`：

```java
public static int generateReqId() {
    return Math.abs(new Object().hashCode());
}
```

`/lasr/lang` 请求体 `request_id` 用 `String.valueOf(SessionUtils.generateReqId())`（`b.java:771`）；WebSocket 流式 ASR 的 `key_request_id` 同样来源于此（`OfflineLasrAdapter.java:367` 里 `bundle.putString("key_request_id", String.valueOf(SessionUtils.generateReqId()))`）。

### 2.4 鉴权（简要，细节见认证 agent）

- **新鉴权（`key_new_authentication_enable=true`）**：HTTP 头 `X-AI-GATEWAY-APP-ID` / `X-AI-GATEWAY-TIMESTAMP` / `X-AI-GATEWAY-NONCE` / `X-AI-GATEWAY-SIGNED-HEADERS` / `X-AI-GATEWAY-SIGNATURE`（`c/a.java:152`）。签名串为 6 段以 `\n` 连接：`POST`、路径、查询串、appid、时间戳、`x-ai-gateway-*` 三头拼接。
- **旧鉴权**：查询串追加 `&nonce_str=%s&sign=%s`（`ConfigConstants.TEMP_SIGN_QUERY_STRING`），sign 输入为 `appid=…`、`nonce_str=…`、`package=…`、`system_time=…`、`user_id=…` 五个 key-value 数组。
- 通用头（两者都有，`b.java:851` 起）：`imei`(DID)、`vaid`、`appid`、`token`、`openid`。

---

## 3. 消息 / 帧格式（CERTAIN）

LASR 全部为 **HTTP POST + JSON**（`application/json; charset=utf-8`），只有 `/lasr/upload` 用 `multipart/form-data`。

### 3.1 `/lasr/create` 请求体

构造代码 `c/a.java:32` `a(LasrSqlEntity, String[])`：

```java
jSONObject.put(VivoLasrConstants.PROTOCOL_REQ_X_SESSION_ID, lasrSqlEntity.getUuid()); // "x-sessionId"
jSONObject.put("slice_num", lasrSqlEntity.getSliceNum());
jSONObject.put("audio_type", lasrSqlEntity.getAudioType());
// 附加 key_extend_params，每个形如 "k=v"，逐条 put
```

示例（折叠屏 `audio_type=auto`，`scene=smart`）：

```json
{ "x-sessionId": "<uuid>", "slice_num": 12, "audio_type": "auto", "scene": "smart" }
```

响应（`b.java:98` 起解析）：

```json
{ "code": 0, "desc": "…", "sid": "…", "data": { "audio_id": "<audio_id>" } }
```

`audio_id` 取 `data.getString("audio_id")`（`PROTOCOL_REQ_AUDIO_ID = "audio_id"`）。

### 3.2 `/lasr/upload` 请求（multipart，音频分片）

`HttpHelper`（`module/net/utils/b.java:37`）把 `ReqMultiBody` 转成 `MultipartBody.FORM`：

```java
new MultipartBody.Builder().setType(MultipartBody.FORM)
    .addFormDataPart("file", a(reqMultiBody.getFileName()),
        new MultiRequestBody(reqMultiBody, reqMultiBody.mContentType)).build();
```

- 单个 form 字段名：**`file`**，filename = URL 编码后的音频文件名。
- 内容：`MultiRequestBody`（`module/net/http/MultiRequestBody.java`）按 `offset=blockSize*(sliceIndex+1)`、长度 `min(blockSize, fileLength-offset)` 从本地文件读取，`Content-Type: application/octet-stream`，5120 字节一循环写出。
- **元数据（audio_id / slice_index / slice_num / x-sessionId）全部在 URL 查询串里**（见 §2.2）。`reqMultiBody.mContent = strA` 这行赋值在 `HttpHelper` 里被忽略（`ReqMultiBody` 分支不使用 `mContent`）—— 属于冗余代码（INFERRED：无害残留）。

响应（`b.java:182` 起解析）：

```json
{ "code": 0, "desc": "…", "sid": "…", "data": { "slices": 12 } }
```

- `code=0`：`sliceIndex++`，`slices` 更新；若 `isUploadSuccess()` 结束，否则继续下一片。
- `code=20005`：该片已存在，`sliceIndex++` 后继续（幂等重传）。
- 其余 code：失败回调。

### 3.3 `/lasr/run` 请求体

`c/a.java:84` `a(LasrSqlEntity, String[], boolean, String)`（注意 `boolean` 参数**未被使用**，`enable_speaker` 实际上不会出现在 body 里）：

```java
jSONObject.put(PROTOCOL_REQ_AUDIO_ID, lasrSqlEntity.getAudioId());      // "audio_id"
jSONObject.put(PROTOCOL_REQ_X_SESSION_ID, lasrSqlEntity.getUuid());     // "x-sessionId"
jSONObject.put(PROTOCOL_REQ_AUDIO_TIME, lasrSqlEntity.getAudioLength()); // "audio_time"
if (!TextUtils.isEmpty(languageCode))
    jSONObject.put(PROTOCOL_REQ_LANGUAGE_CODE, languageCode);           // "language_code"
// 附加 key_extend_params
```

示例：

```json
{ "audio_id": "<audio_id>", "x-sessionId": "<uuid>", "audio_time": 60, "language_code": "zh-Hans-CN", "scene": "smart" }
```

响应：

```json
{ "code": 0, "desc": "…", "sid": "…", "data": { "task_id": "<task_id>" } }
```

### 3.4 `/lasr/progress` 与 `/lasr/result` 请求体

`c/a.java:113` `a(String taskId, String xSessionId, String languageCode, String[])`：

```java
jSONObject.put(PROTOCOL_REQ_TASK_ID, taskId);        // "task_id"
jSONObject.put(PROTOCOL_REQ_X_SESSION_ID, xSessionId);
if (!TextUtils.isEmpty(languageCode))
    jSONObject.put(PROTOCOL_REQ_LANGUAGE_CODE, languageCode);
// 附加 key_extend_params
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

### 3.5 `/lasr/lang` 请求体

`c/a.java:138` `a(requestId, userId, lang, engineid)`：

```json
{ "request_id": "123456789", "user_id": "…", "lang": "zh", "engineid": "fileasrrecorder" }
```

响应用 `err_code` 字段（非 `code`），结果以字符串形式塞进事件 7000 的 `key_dialect_result`。

### 3.6 通用响应外层字段（CERTAIN）

所有 LASR 响应统一为：`code`（int，0=成功）、`desc`（string）、`sid`（string，会话 sid，客户端用 `a(String sid)` 追加到 `sids` 缓冲）、`data`（object）。

---

## 4. 结果数据模型（CERTAIN）

### 4.1 `LasrResultEntity`（`module/api/lasr/bean/LasrResultEntity.java`）

| 字段 | 类型 | JSON key | 含义 |
|---|---|---|---|
| `onebest` | String | `onebest` | 识别文本（最优结果） |
| `bg` | long | `bg` | 片段起始时间（毫秒） |
| `ed` | long | `ed` | 片段结束时间（毫秒） |
| `speaker` | int | `speaker` | 说话人 / 角色编号（diarization，`fileasrrole` 折叠屏路径返回） |
| `lid` | long | `lid` | 语言 ID（语种识别） |

解析代码（`b.java:406`）：

```java
arrayList.add(new LasrResultEntity(
    obj.optString("onebest"), obj.optLong("bg"), obj.optLong("ed"),
    obj.optInt("speaker"), obj.optLong("lid")));
```

- **无逐字时间戳、无置信度（confidence）、无标点字段、无中间态**——LASR 文件转写只返回整句片段级结果（`onebest` + 起止 + 说话人 + 语言）。
- 说话人分离开关 `key_separation_roles_enable` 被读取（`b.java:660`）但**没有**被写进 LASR body（`PROTOCOL_REQ_ENABLE_SPEAKER = "enable_speaker"` 常量未在 `c/a.java` 中使用）；说话人信息只由引擎类型（`fileasrrole`）决定回传。
- 离线路径（`OfflineLasrAdapter.java:542`）用 4 参构造（无 `lid`），字段名是 `data.onebest` / `data.bg` / `data.end` / `data.speaker`（注意离线用 **`end`**，线上用 **`ed`**）。

### 4.2 `LasrSqlEntity`（`module/api/lasr/bean/LasrSqlEntity.java`，会话状态）

| 字段 | 含义 |
|---|---|
| `audioId` | `/lasr/create` 返回的音频 ID |
| `uuid` | `x-sessionId`（`UUID.randomUUID().toString()`） |
| `taskId` | `/lasr/run` 返回的任务 ID |
| `audioType` | `key_audio_stream_type`（如 `auto` / `pcm` / `wav`） |
| `audioLength` | `key_audio_length`（秒） |
| `uri` / `audioName` / `fileLength` | 本地文件路径/名/字节数 |
| `blockSize` | 分片大小，固定 `5242880`（5MB） |
| `sliceNum` | 总分片数 `ceil(fileLength/blockSize)` |
| `sliceIndex` | 当前已上传片下标（初值 `-1`） |
| `slices` | 服务器返回的总片数 |
| `progress` | `/lasr/progress` 进度 0–100 |
| `languageCode` | 语言 |
| `type` | 0=本地文件，1=HTTP |
| `sids` | 服务器 sid 串（逗号拼接） |

关键计算（`LasrSqlEntity.java`）：

```java
public static int calculateBlockSize(long j10) { return j10 <= 0 ? 0 : 5242880; }
public static int calculateSliceNum(long j10, int i10) {
    long j11 = i10;
    int i11 = (int)(j10 / j11);
    return j10 % j11 > 0 ? i11 + 1 : i11;
}
public int getUploadOffset() { return this.blockSize * (this.sliceIndex + 1); }
public boolean isUploadSuccess() { return this.sliceIndex >= 0 && ((this.sliceIndex+1)*100)/this.sliceNum == 100; }
```

---

## 5. 状态机与轮询（CERTAIN）

上传由两个 `AtomicBoolean` 保护（`b.java`）：
- `f13104j`（create-in-progress）：`/lasr/create` 期间置位，防止重复创建。
- `f13103i`（uploading）：`/lasr/upload` 期间置位；`isUploadFile()` 返回该值。

`/lasr/upload` 每片一次请求 → `code=0` 时 `sliceIndex++` → 未完成则再次 `b()` 递归（其实是顺序回调驱动，不是线程死循环）。`/lasr/progress` 由**上层（App）轮询**，SDK 内部没有定时器。

错误码（CERTAIN，回调里硬编码）：

| code | 含义 |
|---|---|
| 0 | 成功 |
| 60001 | URI 为空 |
| 60002 | 文件不存在/空 |
| 60003 | 文件 > 500MB |
| 60004 | 未指定音频流类型（或离线不支持的类型） |
| 60005 | 正在上传（重复调用） |
| 60006 | 文件内容被修改（长度不一致） |
| 60007 | JSON 解析异常 |
| 60008 | 网络失败 |
| 60009 | `/lasr/create` HTTP 非 2xx |
| 60010 | 用户取消（`"Canceled".equals(str)`） |
| 60011 | taskId/xSessionId 为空 |
| 60012 | 无可续传实体 |
| 60013 | 非本地文件 |
| 20005 | （服务器）该分片已存在，跳过 |
| 7000 | 事件：方言结果 |

---

## 6. 实时流式 ASR（WebSocket，与文件转写并列）

实现类：`com.vivo.speechsdk.module.asronline.i.g`（连接/状态机）、`com.vivo.speechsdk.module.asronline.b`（`IASRService` 实现，结果分发）、`com.vivo.speechsdk.module.asronline.i.f`（协议组装）。

### 6.1 地址

- 新鉴权（`key_new_authentication_enable=true`，国内非折叠）：`wss://asr-v2.vivo.com.cn/asr/v2`（`asronline/i/c.java:17`），备选 `wss://asr-ali-v2.vivo.com.cn/asr/v2`。
- 旧鉴权：`wss://aispeech.vivo.com.cn/asr/v2`（`asronline/i/d.java:17`），备选 `aispeech-ali.vivo.com.cn`。
- 查询串与 LASR 相同风格（`asronline/i/f.java:422`，多了 `user_info` 参数）。

### 6.2 帧格式（CERTAIN）

标准 RFC 6455，客户端帧带掩码（`WebSocketWriter` 是 OkHttp `RealWebSocket` 的拷贝，无 permessage-deflate/gzip 扩展）。

- **文本帧（opcode 1）**：控制/结果 JSON。
  - 开始帧：`f.d(bundle)` 生成（`asronline/i/f.java:217`）：
    ```json
    { "type": "started", "mode": 1, "request_id": "…", "asr_info": { "front_vad_time":…, "end_vad_time":…, "audio_type":"opus", "punctuation":1, "lang":"auto", "roletype":1, … }, "nlu_info":…, "business_info":… }
    ```
    `roletype` = `key_separation_roles_enable`（默认 true）→ 1/0（`f.java:526`）。
  - 结束帧：**二进制帧** `"--end--".getBytes()`（`g.java:315`，opcode 2）。
  - 热词帧：文本 JSON `{"type":"hotword","hotword_info":{"business":{"hotWord":"…"}}}`。
- **二进制帧（opcode 2）**：音频数据（`g.java:518` `a(byte[])` → `iWebSocket.send(bArr)`）。
- **Ping**：`ping("keepalive")`（`g.java:346`，action 103 触发）。

### 6.3 响应消息（CERTAIN）

`asronline/b.java:138` `onResult(String)` 解析文本帧 JSON，靠 `type` + `action` 区分：

| `action` | 含义 |
|---|---|
| `started` | 握手成功，`sid` 回传（事件 10002） |
| `error` | 错误，`desc="session_id is not found"` 特判触发重连 |
| `result` | 识别结果 |

结果帧字段（`asronline/b.java:187` 起）：`vad_code`、`data.is_last`、`data.text`、`code`、`desc`、`sid`、顶层 `type`（`asr`/`nlu`/`tts`/`ast`）。

```json
{ "type": "asr", "request_id": "…", "action": "result", "code": 0, "sid": "…",
  "vad_code": 0, "data": { "is_last": true, "text": "你好世界" } }
```

`code=9` 或 `is_last=true` 表示结束。

---

## 7. CERTAIN vs INFERRED

**CERTAIN（直接读自代码）**
- LASR 文件转写走 HTTP，6 个端点路径与请求/响应 JSON 字段名（§2、§3）。
- 域名映射与 App 传入的 `key_server_url` / `key_engine_type` / `key_appid` / `key_appkey`（§2.1）。
- `x-sessionId` = `UUID.randomUUID()`；`request_id` = `Math.abs(new Object().hashCode())`（§2.3）。
- 分片大小 5MB、offset 计算、进度公式（§5）。
- 结果实体字段 `onebest/bg/ed/speaker/lid`（线上）与 `onebest/bg/end/speaker`（离线）（§4）。
- WebSocket 文本/二进制帧用法、`--end--` 二进制结束标记、`type/action` 消息结构（§6）。

**INFERRED（从代码推断，未抓包验证）**
- 完整 URL 的**最终字节形态**（参数 ASCII 排序 + URL 编码细节）——排序逻辑已确认，但具体某台设备的参数值（model/rom/sdk_version 等）未逐一确认。
- 服务器返回字段 `bg`/`ed` 的**时间单位**（代码未做换算，按约定推断为毫秒；`OfflineLasrAdapter` 里 `ed*32` 换算暗示离线单位为 32ms 帧，线上 LASR 未换算，需要抓包确认）。
- `reqMultiBody.mContent` 在 `/lasr/upload` 中为冗余赋值（HttpHelper 的 multipart 分支不使用它）。
- `enable_speaker` 常量未被 LASR body 使用（说话人分离靠 `fileasrrole` 引擎 + `roletype`/`speaker` 回传）。

---

## 附：关键文件索引

| 文件（相对 `decompiled/sources`） | 内容 |
|---|---|
| `com/vivo/speechsdk/module/lasr/b.java` | LASR 线上实现（端点、请求构造、回调、状态机） |
| `com/vivo/speechsdk/module/lasr/c/a.java` | LASR 协议 JSON/URL/鉴权头构造 |
| `com/vivo/speechsdk/module/lasr/OfflineLasrAdapter.java` | LASR 离线实现（本地 ASR 代理） |
| `com/vivo/speechsdk/module/lasr/LASRModule.java` | 引擎模式选择（1=线上，else=离线） |
| `com/vivo/speechsdk/module/api/lasr/bean/LasrResultEntity.java` | 结果实体 |
| `com/vivo/speechsdk/module/api/lasr/bean/LasrSqlEntity.java` | 会话状态实体 |
| `com/vivo/speechsdk/module/api/lasr/VivoLasrConstants.java` | 协议常量 |
| `com/vivo/speechsdk/module/api/lasr/listener/LASRServiceListener.java` | 回调接口 |
| `com/vivo/speechsdk/module/net/NetModule.java` | `getDomain(1)` 映射 |
| `com/vivo/speechsdk/module/net/utils/f.java` | 域名常量（asr-v2 / aispeech） |
| `com/vivo/speechsdk/module/net/utils/b.java` | Req → OkHttp Request（含 multipart） |
| `com/vivo/speechsdk/module/net/http/MultiRequestBody.java` | 文件分片流式写出 |
| `com/vivo/speechsdk/module/asronline/i/g.java` | WebSocket 流式 ASR 连接/状态机 |
| `com/vivo/speechsdk/module/asronline/b.java` | 在线 ASR 服务（结果分发） |
| `com/vivo/speechsdk/module/asronline/i/f.java` | 流式 ASR 协议组装 |
| `com/vivo/speechsdk/module/asronline/i/c.java` / `d.java` | WebSocket 主机选择（新/旧鉴权） |
| `com/vivo/speechsdk/module/net/websocket/VivoWebSocket.java` | RFC6455 帧收发（文本=1/二进制=2） |
