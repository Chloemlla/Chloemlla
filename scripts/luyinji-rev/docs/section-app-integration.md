# 录音转写（转文本）App 集成 · 文件上传 · 数据模型

> 目标 APK：vivo/BBK 原生录音机 `com.android.bbksoundrecorder` v1.7.3.9（ProGuard 混淆）
> 本文件只覆盖 **App 层如何接线「录音转写 / 转文本 / 转文字」功能**：入口、上传机制、结果数据模型、功能开关。
> ASR 的线上/离线协议细节见 `section-asr-lasr-protocol.md`，域名与接口目录见 `section-endpoints-hosts.md`。
> 标注：**CERTAIN** = 直接从反编译代码读出；**INFERRED** = 依据命名/调用链合理推断。

---

## 1. 功能总览（一句话架构）

```
用户点击「转文本」按钮
   └─ livedatabus 事件 "detail_start_convert"
        └─ RecordPlayDetailFragment.l5()  →  g7.a.p(filePath, fileName, true)   // startConvertJob
             └─ RecognizeService.L(filePath, fileName, fromUser)                // 前台 Service
                  └─ 组装 engine Bundle + FileConvertBean
                  └─ za.b (FileConvertManager).z(...)  +  .n(fileConvertBean)
                       └─ za.c (SpeechController).s(...)
                            ├─ 在线: cb.a (SpeechSDK wrapper).y() → LASREngine.uploadAudioFile()
                            │        → speechsdk LASR HTTP: /lasr/create → /lasr/upload → /lasr/run
                            │        → /lasr/progress → /lasr/result
                            └─ 离线: bb.a(转码) → db.b(RecordConvertManager, engine_mode=6)
                  └─ 结果 List<RecognizeItem> 逐层回调回 UI
```

核心结论（CERTAIN）：**转写引擎是 `com.vivo.speechsdk.lasr` 的 `LASREngine`（LASR = 大文件 ASR）**，不是传统实时 ASR 也不是 aiwriter；aiwriter 是另一条「AI 写作 / 摘要」上传链路（见第 6 节）。

---

## 2. 用户流程与入口（UI 层）

### 2.1 转写界面
- `com/vivo/aiaudiokit/fragment/DetailChildRecognizeFragment.java` — 录音详情页里的「转文本」Tab，核心 UI：
  - `R$layout.detail_fragment_recognize_view_stub`（进度、LRC 歌词列表、复制/编辑/导出/分角色按钮）
  - 结果展示控件 `LrcLayoutView`（`com.vivo.aiaudiokit.widget.lyrics.widget.LrcLayoutView`），把 `RecognizeItem` 列表渲染成带时间戳的「歌词式」文本。
  - `CovertView`（`com.vivo.aiaudiokit.widget.CovertView`）转写状态动画。
  - ViewModel：`com.vivo.aiaudiokit.viewmodel.DetailPageViewModel`（父类 `BaseDetailPageViewModel`），保存 `List<RecognizeItem> R()`、`String M()`（playFilePath）、`int i()`（convertState）等。

### 2.2 触发链（CERTAIN，逐层）
1. 空白页/按钮点击：
   - `DetailChildRecognizeFragment.H1()` / `U1()` → `com.vivo.recordplay.livedatabus.b.b().f("detail_start_convert", Bundle.class).setValue(null)`
   - 同样发送点：`ChildDetailWaveFragment`（波形页菜单）、`RecDetailsMainFragment.R2()`（应用层详情页）。
2. 观察者（真正调用 SDK 的地方）：
   - `com/vivo/aiaudiokit/fragment/play/RecordPlayDetailFragment.java` 观察 `"detail_start_convert"`，最终走 `l5()`：

```java
// RecordPlayDetailFragment.java:3743-3758
public void l5() {
    m4();
    this.T0.p0(com.vivo.recordbase.core.utils.u.k0() ? 1 : 0); // 是否离线
    this.T0.m0(3);                                             // convertState = 转写中
    ...
    g7.a aVar = this.I;                                        // RecognizeService 的 Binder
    if (aVar != null) {
        aVar.p(this.T0.M(), this.T0.L(), true);                // startConvertJob(filePath, fileName, fromUser=true)
    } else {
        this.N0 = true; Q2();                                  // 未绑定则先绑定
    }
}
```

3. `g7.a`（`@d(RecognizeService.class)`，`ra.a<RecognizeService>` 包装）的 `p()` 直接转发给 `RecognizeService.L()`。

### 2.3 Binder / Service 绑定（CERTAIN）
- `com/vivo/aiaudiokit/service/RecognizeService.java` 是转写的**前台 Service**（`onBind` 返回 `new g7.a(this)`）。
- 绑定统一走 `sa.a`（`ServiceController` 单例）：
  - `l7.o0.b()`：`sa.a.c().d(RecognizeService.class)` 取已绑定 Binder。
  - `DetailChildRecognizeFragment` 用 `sa.a.c().a(context, P)`（`sa.b<g7.a>` 回调）在需要时绑定。
- 绑定门槛（`sa/a.java:71-76`）：只有 `offline_convert_switch_state_key == true` **或** `o0.w(context)`（网络可用）时才绑定；否则直接跳过。

### 2.4 服务内启动转写（CERTAIN）
`RecognizeService.L(String str /*filePath*/, String str2 /*fileName*/, boolean z10 /*fromUser*/)` 做了三件事：
1. 计算离线开关 `zW`：`u.X() ? !o0.G(getApplication()) : o0.W(ctx, "offline_convert_switch_state_key")`
2. 组装 engine Bundle（见 2.5）
3. `za.b.v().z(getApplication(), bundle, new b(str, z10))`（init）+ `za.b.v().n(fileConvertBean)`（startConvertJob）

### 2.5 engine Bundle 三种模式（CERTAIN，见 RecognizeService.java:491-523）
| 分支 | `key_engine_mode` | `key_engine_type` | `key_appid` / `key_appkey` | `key_server_url` | 说明 |
|---|---|---|---|---|---|
| 折叠屏设备 `u.c0()` | 1 | `fileasrrole` | `96yw39m52niisyhg` / `xkkz9f7u4xg6z35eec3k3hn62qwf4uw3` | `https://aispeech.vivo.com.cn` | 支持分角色（sub-role），`key_new_authentication_enable=false` |
| 在线 `else` | 1 | `fileasrrecorder` | `8735273056` / `NIhyMZRWZUGdDnrW` | 缺省（`key_url_did_remove=true`） | `key_new_authentication_enable=true`，`key_extend_params=scene=user`(用户)/`scene=smart`(智能) |
| 离线 `zW` | 6 | — | — | — | 走 `db.b`（离线 RecordConvertManager） |

> 注：`v0/t.java`（`RecordSmartManager`，智能录音自动转写路径）使用**同一套** `za.b.v().z(...)` + `FileConvertBean` + `za.b.v().n(...)`，区别是 `key_extend_params=scene=smart`。`j1/a.java`（`BackgroundConvertManager`）是后台转写管理。

### 2.6 结果回流 UI（CERTAIN）
`RecognizeService` 内部回调 `b`（实现 `ab.c`）：
- `a(List<RecognizeItem> list)`（onTaskResult）→ 遍历 `f9334c`（注册的 `ab.c`）逐个 `cVar.a(list)`；
- 同时写 `details_mark_covert_change` Bundle（`filePath`/`convertState`/`isShow`/`changePageId`）到 livedatabus；并调用 `d.a().b().c(list, str, ...)`（`e7.d` = AI 摘要管理器）把转写文本送进智能摘要管线。
- `DetailChildRecognizeFragment` 的 `Q`（`ab.c`）收到 `a(list)` → `w2(list)` → 填充 `LrcLayoutView` 与 `DetailPageViewModel.R()`。

UI 使用的 livedatabus 事件（CERTAIN 名单）：
- `detail_start_convert`（触发转写）
- `details_mark_covert_change`（转写状态/进度同步列表页）
- `convert_error_smart_message`（错误 `SmartMsgBean`）
- `refresh_convert_view_state`、`isNeedUpdateText`、`detail_wave_update_time`、`detail_convert_text_clip`、`detail_show_pop_convert_export`

---

## 3. 上传机制（LASR 文件上传）

### 3.1 调用链到上传（CERTAIN）
`za.b`(FileConvertManager) → `za.c`(SpeechController) → `cb.a`(SpeechSDK 包装) → `com.vivo.speechsdk.lasr.api.LASREngine`（SDK 版本 `5.2.5.66`）→ `com.vivo.speechsdk.module.lasr.b`（LASRServiceImpl，`/lasr/*` HTTP）。

`cb/a.java`（CERTAIN）关键点：
- `y(String str, int i10)` = `uploadAudioFile`：若 `!SpeechSdk.isInit()` → `n()` init；若引擎未初始化 → `m()` 创建 `new LASREngine()` 并 `init(bundleT, listener)`；然后 `f805a.uploadAudioFile(str[, bundle])`。
- 上传完成回调 `onUploadFileResult(...)` → `f807c.f(audioId, xSessionId)` → `LASREngine.createTaskWithAudioId(audioId, xSessionId)`。

### 3.2 multipart/form-data 字段名（CERTAIN）
`com/vivo/speechsdk/module/net/utils/b.java:32-51` 是唯一的 HTTP 请求构造点：

```java
} else if (reqBodyBody instanceof ReqMultiBody) {
    ReqMultiBody reqMultiBody = (ReqMultiBody) reqBodyBody;
    requestBodyCreate = new MultipartBody.Builder()
        .setType(MultipartBody.FORM)
        .addFormDataPart("file",                    // <== 表单字段名固定为 "file"
                         a(reqMultiBody.getFileName()),  // 文件名经 URLEncoder.encode(UTF-8)
                         new MultiRequestBody(reqMultiBody, reqMultiBody.mContentType))
        .build();
}
```

- **字段名 = `file`**；`Content-Type` = `MultipartBody.FORM`（OkHttp 自动生成 boundary）。
- 文件内容用 `MultiRequestBody`（`com/vivo/speechsdk/module/net/http/MultiRequestBody.java`）流式写出，避免整文件进内存；内部每次 `FileUtils.readFile` 读一个 block，再以 5120 字节为单元 `write+flush`，支持 `offest`（断点/分片续传）。

### 3.3 分片与上传状态机（CERTAIN，见 LASRServiceImpl `b.java` + `LasrSqlEntity`）
`LasrSqlEntity` 记录分片参数：
- `blockSize = LasrSqlEntity.calculateBlockSize(len)` = **5 MB**（`f12766a = 5242880`，`len>0` 即返回该值）
- `sliceNum = calculateSliceNum(fileLength, blockSize)` = `ceil(fileLength / 5MB)`
- `FILE_MAX_SIZE_500M = 524288000`：超过 500MB 直接报错 `60003`
- `getUploadOffset() = blockSize * (sliceIndex + 1)`；`getUploadProgress() = (sliceIndex+1)*100/sliceNum`；`isUploadSuccess()`。

`uploadAudioFile(str, bundle)`（`b.java:619-689`）：
1. 校验文件存在、非空、≤500MB
2. 读 bundle：`key_language`、`key_extend_params`、`key_separation_roles_enable`、`key_audio_stream_type`、`key_audio_length`
3. 生成 `uuid = UUID.randomUUID()`；`new LasrSqlEntity(0, audioType, uri=filePath, fileLength, null, uuid, blockSize, sliceNum, audioLength)`
4. 第一次请求 `POST /lasr/create`（JSON）→ 返回 `data.audio_id`，存回 `LasrSqlEntity.audioId` 并 `saveBean2Sp(KEY_LASR_SQL_ENTITY)`（断点续传持久化）

`b()`（`b.java:736-765`，真正的上传分片循环）：
```java
ReqMultiBody reqMultiBody = new ReqMultiBody("application/octet-stream",
    this.f13098d.getFileLength(),   // fileLength
    this.f13098d.getUri(),          // 本地文件路径
    this.f13098d.getUploadOffset(), // 本次分片偏移
    this.f13098d.getBlockSize(),    // 5MB
    this.f13098d.getAudioName());   // 文件名
reqMultiBody.mContent = strA;       // JSON 业务参数（见下）
iHttp.request(a("/lasr/upload", reqMultiBody, this.f13098d), new C0171b());
```
- 每次 `POST /lasr/upload` 上传一个分片；响应 `data.slices` 后 `sliceIndex+1`，`onUploadFileProcess(uri, uploadProgress)`；`isUploadSuccess()` 后 `onUploadFileResult(...)` 成功，否则继续 `b()`。
- 服务端返回 `code==20005` 时也会 `sliceIndex+1` 继续（幂等重试）。

### 3.4 上传→识别→结果（CERTAIN 接口时序）
| 步骤 | 接口 | 请求体 | 关键响应字段 |
|---|---|---|---|
| 1. 建会话 | `POST /lasr/create` | JSON（audio 元信息） | `data.audio_id`, `sid` |
| 2. 分片上传 | `POST /lasr/upload`（multipart `file`） | `ReqMultiBody` | `data.slices` |
| 3. 创建识别任务 | `POST /lasr/run` | JSON（audioId） | `data.task_id` |
| 4. 轮询进度 | `POST /lasr/progress` | JSON（taskId, xSessionId） | `data.progress` |
| 5. 拉取结果 | `POST /lasr/result` | JSON（taskId, xSessionId） | `data.result[]` |

`data.result[]` 每个元素（`b.java:406`）→ `new LasrResultEntity(onebest, bg, ed, speaker, lid)`：
- `onebest`（识别文本）、`bg`（起）、`ed`（止）、`speaker`（说话人/角色 id）、`lid`（语言 id）。
- 协议常量见 `VivoLasrConstants`：`audio_id`、`task_id`、`language_code`、`slice_num`、`x-sessionId`、`request_id`、`user_id`。

### 3.5 认证 / 签名（简要，详见 protocol 文档）
`b.java:795-872`：URL = `key_server_url`(或 `https://{domain(1)}`) + path + 签名 query。鉴权两套：
- `key_new_authentication_enable=true`（在线）：Header 带 `imei`/`vaid`/`appid`/`token`/`openid`，query 走 `c.a.a(...)` 生成的签名头。
- `=false`（折叠屏/老协议）：`ISignTool.sign({"appid","nonce_str","package","system_time","user_id"}, appKey)` 拼接签名。
- 身份：`key_openid`/`key_token` 来自 `na.c.g().h()/k()`（vivo 账号）；`key_did`/`key_vaid` 来自 `IdentifierManager.getVAID`。

### 3.6 离线转写（CERTAIN，engine_mode=6）
- `za.c.s()`：`fileConvertBean.isOffline() && !"pcm".equals(fileFormat)` 时走 `bb.a`（转码/编码）+ `db.b`（离线 `RecordConvertManager`，`engine_mode=6`，回调接口 `fb.e`），进度用「codec 阶段百分比」随机占比。
- 离线 ASR 模型下载：`com/vivo/aiaudiokit/voicetotext/offline/ais/b.java`（`MLUpdateManager`）绑定 `vivo.intent.action.AI_MLUPDATE_SERVICE`（`ConfigConstants.ENGINE_NAME`），`MLUpdateRequest` 携带 `appId=8735273056`，`algorithm=asr`（`d.c("asr"); d.d("asr")`），下载成功写 `offline_convert_is_used_key=true`、`offline_convert_switch_state_key=true`。
- 离线模型算法资源元数据 `com/vivo/aiaudiokit/voicetotext/offline/ais/a.java`（`AlgorithmRes`，字段 `algorithmName/algorithmResName/algorithmResVerName/algorithmResVerCode/curResVerName/curResVerCode/fileSize/sourceType/status/isModelSupport`）。

---

## 4. 数据模型（结果与上传 Bean）

### 4.1 结果模型（UI 最终使用，CERTAIN）
`com.vivo.recordbase.core.data.bean.RecognizeItem`（`Comparable`/`Serializable`）字段：
`id, recFileId, speakerName, speaker, content, startTime, endTime, aWholeSentence, isLastSentence, textCanConvert, textType, lid, isUserVisible, mIsBackground, mLanguage`

- `content`：一句话识别文本；`startTime/endTime`：毫秒时间戳；`speaker/speakerName`：角色；`textType==10001` 表示「AI 摘要」条（混在列表首）。
- 子类 `SummaryRecognizeItem`：`title, fileName, addTime, isPlay, stateType, itemState, mSummarySpanTextList[]`（摘要标题/摘要/待办三段式）。

### 4.2 SDK 内部结果 Bean（CERTAIN）
- `com.vivo.speechsdk.module.api.lasr.bean.LasrResultEntity`：`onebest, bg(long), ed(long), speaker(int), lid(long)`
- `com.vivo.speechsdk.module.api.lasr.bean.LasrSqlEntity`：上传/任务实体，字段 `id, timeStamp, audioName, type(0=local/1=http), audioType, uri, fileLength, audioId, uuid, blockSize, sliceNum, sliceIndex, slices, taskId, progress, sids, audioLength, languageCode`；常量 `FILE_MAX_SIZE_500M=524288000`、`TYPE_HTTP_FILE=1`、`TYPE_LOCAL_FILE=0`。
- 实时(在线流式)解析路径 `za/b.java:F()/G()` 用：
  - `com.vivo.recordbase.core.bean.WsLasrResult`（`action, code, type, desc, sid, data`）
  - `WsLasrResult.LasrData`（`mBg, mEd, mSpeaker, mSegId, mOneBest, mRecvid, mVar, mLang`）——注意这是 websocket 流式结果模型，字段与 `LasrResultEntity` 等价（`onebest/bg/ed/speaker`）。
  - `com.vivo.recordbase.core.bean.AsrInfo`（`text, textInfo, pinyin, lastPunct, isLast, sid, mLanguage`）+ `AsrInfo.TextInfo`（`mBg, mEd, mSpeaker, mTextType, mLang`）。

### 4.3 转写配置 Bean（CERTAIN）
- `com.vivo.recordconvert.bean.FileConvertBean`：`fileMediaId, fileName, filePath, fileFormat(默认"m4a"), isOffline, fromUser, needRole, rolePrefix, maxTextNum`
- `com.vivo.recordconvert.bean.RecordConvertBean`：`isOffline, fromUser, needSubRole, asrNumber, needTranslate`
- `com.vivo.recordconvert.bean.ConvertConfigBean`：`appId, appKey, engineType, modelType, needSubRole`
- `com.vivo.recordconvert.bean.ConvertModelType`、`com.vivo.recordconvert.bean.RecognizeSubRoleItem`（角色相关）。

### 4.4 回调接口（CERTAIN）
- `ab.c`（`IConvertCallback`）：`a(List<RecognizeItem>), b(), onError(int,String), onProgress(int), onStart()`
- `ab.a`（上传/识别回调，SpeechController 用）：`a(List<RecognizeItem>), b(int 上传进度), c(int,String onRecognizeError), d(int onTaskProcess), f(String,String onUploadFileComplete), onInitSuccess()`
- `ab.b`（编解码回调）：`e() onCodeStart, g(String,int) onCodeComplete, h(long,long) onCodeProgress, i() onCodeFail`
- `com.vivo.speechsdk.lasr.api.ILasrListener`（SDK 层）：`onTaskCreate/onTaskProcess/onTaskResult/onUploadFileProcess/onUploadFileResult/onEvent` 等。
- `com.vivo.aiaudiokit.voicetotext.realtime.RecordStatus`：`STATUS_NO_READY/READY/START/PAUSE/STOP`（实时转写状态，本文件重点离线文件转写，实时路径另见 protocol 文档）。

---

## 5. 功能开关 / 字符串 / 设置键

### 5.1 设置键（CERTAIN，`SharedPreferences`，经 `o0.W/Y` 或 `d2.M/K` 读写）
- `offline_convert_switch_state_key`（离线转文本开关，最核心的门槛键）
- `offline_convert_is_used_key`（是否已用过/已启用离线转文本）
- `offline_convert_open_steer_key`（离线转文本引导是否已展示）
- `offline_convert_switch_upload_timestamp_key`（离线开关状态上报时间戳）

### 5.2 能力开关（CERTAIN，`com.vivo.recordbase.core.utils.u`）
- `u.S()`：`isSupportSelfOfflineConvert`（离线转写支持，由 `setIsSupportSelfOfflineConvert`/`j0()` 下发）
- `u.X()` = `S() && w()`：离线模型可用
- `u.l()` = `S() && offline_convert_switch_state_key`：离线转文本是否生效
- `u.c0()`：`isSupportSubRoleConvert`（分角色转写，仅折叠屏等机型，硬编码型号集合）
- `u.P()` / `u.Q()`：`isSupport(Convert)`（机型白名单，大量 `PDxxxxF_EX` 型号）
- `u.T()`：`isSupportSelfOnlineConvert`
- `u.k0()`：`ja.g.b()` 回调（离线/本地模型开关的运行时状态）
- `u.Z(application)` = `U(application)`：是否支持智能摘要（AI 摘要，走 GPTKit）

### 5.3 关键用户可见字符串（CERTAIN；中文取自 `values-zh-rCN/strings.xml`，默认 `values/strings.xml` 为英文）
| 键 | 中文 | 英文 |
|---|---|---|
| `rtot_recording_to_text` | 转文本 | Transcribe |
| `rtot_recording_to_text_tips` | 转文本提示 | Convert to Text prompt |
| `offline_covert_text` | 离线转文本 | Transcribe offline |
| `offline_covert_click_start` | 点击"离线转文本"开启录音转写 | Tap "Transcribe offline" to convert recordings |
| `offline_covert_title` | 离线语音转文本 | Offline speech-to-text |
| `convert_to_text` | 语音转文字 | Speech-to-text |
| `asr_success` | 转文本成功 | Transcription successful |
| `check_text` | 点击查看文本 | Tap to view transcription |
| `convert_fail` | 转文本失败 | Transcription failed |
| `recognize_progress` | 转文本中 %s | Converting to text... %s |
| `convert_copy_all` | 复制全文 | Copy all |
| `convert_export_text` | 导出文本 | Export text |
| `sub_role` / `role` | 分角色 / 角色 | sub-role / role |
| `rtot_attention_one` | （需联网上传录音文件） | network required to upload recording files |
| `rtot_attention_two*` | （仅支持普通话，分角色建议 2–6 人） | Mandarin only, 2-6 people |

> 说明：`asr_data_warning/asr_login_required/asr_verify_required/asr_maintenance/asr_no_network` 等 `asr_*` 键是转写功能的前置校验文案（登录/网络/维护态），`convert_text_*` 是额度/时长限制文案。

### 5.4 初始化（CERTAIN）
`AppFeature.h()`（`Application.onCreate` 触发）用 `com.vivo.aiaudiokit.download.b.W().g0(ctx, map)` 初始化离线模型下载 SDK，map：
```java
map.put("appId", "8735273056");
map.put("appKey", "NIhyMZRWZUGdDnrW");
map.put("businessName", "recorder");
map.put("vivoToken", q1.b.d().i());
```
`u.E()` 为 `SmartOffline7B` 相关，`l7.c`/`j7.b`（`SmartOfflineModelManager`，`llm_common_3b`）是「AI 摘要」离线 LLM，与转写 ASR 解耦。

---

## 6. 附：aiwriter 文件上传（另一条链路，勿与转写混淆）

`com/vivo/aiwriter/fileupload/` 属于 **AI 写作 / 摘要**（GPTKit），**不是**转写 ASR 的上传。仅记录以防混淆（CERTAIN）：
- `a.java` = `FileUploadManager` 单例；`b.java` = 假进度生成器；`c.java` = 抽象回调；`UploadState` = `none/smallFile/bigFileUploading/uploadNetworkException/parseNetworkException/bigFileParsing/succeed/failed`。
- 入口 `F(File, String suffix, String verifyCode, boolean, boolean, c)`：构造 `com.vivo.ai.gpt.kit.upload.http.chunk.ChunkUploadRequest`（`file_name, filePath, verify_code, type, module, sid, openid`），>6MB(`6291456`) 走 `IFileUpload` 分片上传 + `CheckFileRequest` 轮询 `pending/finish/fail`。
- 其 multipart 由 `com/vivo/ai/gpt/kit/upload/http/OkManager.java` / `ChunkFileManager.java` 的 `addFormDataPart` 构造（GPTKit 内部），与 speechsdk 的 `file` 字段无关。
- bean 目录（`com/vivo/aiwriter/bean/`）为 AI 写作面板配置/推荐/摘要类（`SummaryBean/SummaryPanelBean/SummaryEntranceBean/ConfigBean/...`），非转写结果模型。

---

## 7. CERTAIN vs INFERRED 汇总

**CERTAIN（代码直接可见）**
- 引擎为 `LASREngine`（speechsdk `5.2.5.66`），入口 `RecognizeService.L()` → `za.b` → `za.c` → `cb.a`。
- 上传表单字段名 `file`，`Content-Type` = `MultipartBody.FORM`，`MultiRequestBody` 流式写出。
- 分片 `blockSize=5MB`，`/lasr/create → /lasr/upload → /lasr/run → /lasr/progress → /lasr/result` 时序。
- 结果模型 `RecognizeItem`/`LasrResultEntity`/`LasrSqlEntity` 字段。
- 设置键 `offline_convert_switch_state_key` 等；appId/appKey 两套（8735273056 / 96yw39m52niisyhg）。
- livedatabus 事件名 `detail_start_convert`、`details_mark_covert_change` 等。

**INFERRED（依据命名与调用链合理推断）**
- `/lasr/*` 具体路径语义与 query 签名规则由 `com.vivo.speechsdk.module.lasr.c.a` 生成（未逐行展开，属 protocol 文档范围）。
- `o0.w(context)` 的「网络可用」判定语义、`u.w()`/`ja.g` 的运行时开关来源（多为 GPTKit/系统能力查询）。
- 实时(录音中)转写 `realtime/RecordStatus` 与文件转写的关系：本文件聚焦文件转写，实时路径证据较少，未展开。
