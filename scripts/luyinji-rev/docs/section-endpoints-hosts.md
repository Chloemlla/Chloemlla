# 端点目录与主机/域名解析 (Endpoint Catalog & Host/Domain Resolution)

> 包名 `com.android.bbksoundrecorder` (vivo/BBK 录音机), 版本 1.7.3.9, ProGuard 混淆。
> 本文只覆盖 **服务端端点目录 + 主机/域名解析 + 配置键**。ASR 线协议 / 鉴权签名 / 应用集成由其他 agent 负责。
> 标注约定: **CERTAIN** = 从反编译代码直接确认; **INFERRED** = 从调用关系推断。

---

## 1. 完整端点目录

### 1.1 语音 SDK — 在线 ASR (WebSocket)

| 端点 (URL) | 方法 | 用途 | 来源 |
|---|---|---|---|
| `wss://asr-v2.vivo.com.cn/asr/v2` | WS | 在线 ASR 主域名 (CN, 新鉴权) | `speechsdk/module/asronline/i/c.java` (CERTAIN) |
| `wss://asr-ali-v2.vivo.com.cn/asr/v2` | WS | 在线 ASR 备份域名 (阿里机房) | `speechsdk/module/asronline/i/c.java` (CERTAIN) |
| `wss://aispeech.vivo.com.cn/asr/v2` | WS | 在线 ASR 旧默认域名 | `speechsdk/module/asronline/i/d.java` (CERTAIN) |
| `wss://aispeech-ali.vivo.com.cn/asr/v2` | WS | 在线 ASR 旧备份域名 | `speechsdk/module/asronline/i/d.java` (CERTAIN) |
| `wss://{getDomain(1)}/asr/v2` | WS | 动态 ASR 域名 (海外) | `speechsdk/module/asronline/i/e.java` (CERTAIN) |

关键代码 (`asronline/i/c.java`):

```java
public static final String f12985a = "asr-v2.vivo.com.cn";       // defaultHost
public static final String f12986b = "asr-ali-v2.vivo.com.cn";   // backupHost
public static final String f12987c = "wss://asr-v2.vivo.com.cn/asr/v2";      // defaultUrl
public static final String f12988d = "wss://asr-ali-v2.vivo.com.cn/asr/v2";  // backupUrl
// hosts(): ["asr-v2.vivo.com.cn", "asr-ali-v2.vivo.com.cn"]
```

`asronline/i/d.java` 同构, 域名换成 `aispeech.vivo.com.cn` / `aispeech-ali.vivo.com.cn`。

`asronline/i/e.java` (动态, 构造器里取 `getDomain(1)`):

```java
public e() {
    INetFactory iNetFactory = (INetFactory) ModuleManager.getInstance().getFactory("Net");
    if (iNetFactory != null) f12993a = iNetFactory.getDomain(1);
}
public String defaultUrl() { return "wss://" + f12993a + "/asr/v2"; }
```

ASR WS 最终 URL 组装 (`asronline/i/f.java:257`, CERTAIN):

```java
String strAsciiSort = StringUtils.asciiSort(bundle.getString("key_ws_host", str2) + string4);
```

即 **`key_ws_host` 可覆盖 ASR WS 的 host**; 默认值 `str2` 来自上表 host selector。

### 1.2 语音 SDK — 在线 TTS

| 端点 (URL) | 方法 | 用途 | 来源 |
|---|---|---|---|
| `wss://tts-v2.vivo.com.cn/tts` | WS | TTS 新鉴权域名 | `ttsonline/net/Protocol.java` (CERTAIN) |
| `wss://tts.vivo.com.cn/tts` | WS | TTS 旧域名 | `ttsonline/net/Protocol.java` (CERTAIN) |
| `wss://{getDomain(2)}/tts` | WS | TTS 海外动态域名 | `ttsonline/net/OverSeaHostSelector.java` (CERTAIN) |
| `https://vivotrans.vivo.com.cn/fy/tts` | POST | HTTP 合成 (离线引擎上传文本取音频) | `ttsonline/net/HttpService.java` / `Protocol.java` (CERTAIN) |
| `https://%s/vcns_config` | GET | 拉取发音人/音色列表 | `Protocol.java` / `TtsExtraServer.java` (CERTAIN) |
| `https://%s/upload_full_text?request_id=` | POST | 上传待合成全文 | `Protocol.java` / `TtsExtraServer.java` (CERTAIN) |

常量 (`ttsonline/net/Protocol.java`, CERTAIN):

```java
public static final String HTTP_URL = "https://vivotrans.vivo.com.cn/fy/tts";
public static final String NEW_AUTH_WS_URL = "wss://tts-v2.vivo.com.cn/tts";
public static final String WS_URL = "wss://tts.vivo.com.cn/tts";
public static final String SPEAKER_URL_TEMPLATE = "https://%s/vcns_config";
public static final String UPLOAD_TEXT_URL_TEMPLATE = "https://%s/upload_full_text?request_id=";
```

`%s` 填充逻辑 (`TtsExtraServer.java:51` 与 `:123`, CERTAIN):

```java
// vcns_config 的 host:
String string6 = bundle.getString("key_server_url", bundle.getString("key_ws_host"));
String strUrl = Protocol.url(bundle,
    !TextUtils.isEmpty(string6) ? String.format("https://%s/vcns_config", Uri.parse(string6).getHost())
                               : String.format("https://%s/vcns_config", this.mFactory.getDomain(2)), ...);

// upload_full_text 的 host:
String str2 = (bundle.containsKey("key_ws_host")
    ? String.format("https://%s/upload_full_text?request_id=", Uri.parse(bundle.getString("key_ws_host")).getHost())
    : String.format("https://%s/upload_full_text?request_id=", this.mFactory.getDomain(2))) + j10;
```

TTS HTTP 合成 URL 覆盖 (`HttpService.java:281`, CERTAIN):

```java
.url(bundle.getString("key_server_url", "https://vivotrans.vivo.com.cn/fy/tts"))
```

### 1.3 语音 SDK — LASR (长语音/文件转写, HTTP, 非 WS)

Base URL = `key_server_url` 或 `"https://" + getDomain(1)` (`lasr/b.java:795-803`, CERTAIN)。路径拼接于其后:

| 相对路径 | 方法 | 用途 | 来源 |
|---|---|---|---|
| `/lasr/create` | POST | 创建转写任务 | `lasr/b.java:687` (CERTAIN) |
| `/lasr/upload` | POST (multipart) | 上传音频分片 | `lasr/b.java:755` (CERTAIN) |
| `/lasr/run` | POST | 启动任务 | `lasr/b.java:525` (CERTAIN) |
| `/lasr/progress` | POST | 查询进度 | `lasr/b.java:597` (CERTAIN) |
| `/lasr/result` | POST | 拉取结果 | `lasr/b.java:614` (CERTAIN) |
| `/lasr/lang` | POST | 查询支持的方言/语言 | `lasr/b.java:780` (CERTAIN) |

`api/CommMethod.java:244-252` 同构逻辑 (CERTAIN): 先取 `key_server_url`, 为空则 `"https://" + getDomain(1)`。

### 1.4 语音 SDK — 热词数据采集 (Hotword)

| 端点 (URL) | 方法 | 用途 | 来源 |
|---|---|---|---|
| `https://jovivauc.vivo.com.cn/datacollect/upload` | POST (form-urlencoded) | 上传热词 (RSA+AES 混合加密) | `asronline/c.java:51,87` / `speechgpt/HotwordService.java:36,158` / `f/a.java:22` (CERTAIN) |

覆盖逻辑 (CERTAIN): `key_server_url` 存在时用它, 否则用 `https://jovivauc.vivo.com.cn/datacollect/upload`。请求体模板 `asronline/c.java:39`:

```java
"imei=%s&vaid=%s&sysVer=%s&model=%s&product=%s&appVer=%s&type=2&dataInfo=%s&encAesKey=%s&userId=%s&flag=%s"
```

### 1.5 httpdns 解析服务 (`com.vivo.httpdns`)

| 端点 (URL) | 方法 | 用途 | 来源 |
|---|---|---|---|
| `https://vhs.wwstat.com/v1/get.do` | GET | httpdns 自身配置拉取 (主) | `http/i2401.java` (CERTAIN) |
| `https://vhs.vivo.com.cn/v1/get.do` | GET | httpdns 自身配置拉取 (备) | `http/i2401.java` (CERTAIN) |
| `https://{httpsServerIps[i]}/{path}` | GET | 实际域名解析请求 | `http/i2401.java:99` (CERTAIN) |
| `http://{httpServerIps[i]}/{path}` | GET | 同上, 非 HTTPS scheme | `http/i2401.java:99` (CERTAIN) |

解析请求 path 由 provider 决定 (`http/i2401.java:144-158`, CERTAIN):

```java
private String a() {
    if (this.f10775b.getProvider() == 4) return "/v3/resolve";
    if (this.f10775b.getProvider() == 3) return "/d";
    if (this.f10775b.getProvider() == 1) return "/index";
    if (this.f10775b.getProvider() != 2) return "";
    return "/" + this.f10775b.getAccountId() + "/d";
}
```

URL 构造 (`http/i2401.java:87-100`, CERTAIN):

```java
public String b(int i10) {
    String strA = a(i10);
    if (TextUtils.isEmpty(strA)) return "";
    if (this.f10778e == 1) return String.format(this.f10774a, strA);   // "https://%s/v1/get.do" → 配置拉取
    Config config = this.f10775b;
    if (config == null) return "";
    return (config.isHttps() ? "https://" : "http://") + strA + a();    // 解析请求
}
```

类型 `1` 用 `{vhs.wwstat.com, vhs.vivo.com.cn}` (`http/i2401.java:54-55`); 类型 `2` 用 config 里的 `httpsServerIps`/`httpServerIps`。

httpdns 入口 (`HttpDnsService.java`, CERTAIN): 同步 `getIpsByHostSync` → `e2401.a().a("", str)`, 而 speech SDK 的 `OkHttpDns.a()` 用反射调用 `HttpDnsService.getIpsByHostSync`。

监控上报 (`a/a2401.java`, CERTAIN — 由 `com.vivo.analytics` 星云 SDK 使用):

```java
"https://moni-onrt-stsdk.vivo.com.cn/client/upload/reportSingleDelay";
"https://moni-ort-stsdk.vivo.com.cn/client/upload/reportSingleImd";
"https://moni-pnrt-stsdk.vivo.com.cn/client/upload/reportTraceDelay";
"https://moni-prt-stsdk.vivo.com.cn/client/upload/reportTraceImd";
```

### 1.6 AI Kit / GPT (`com.vivo.ai.gpt.kit`)

| 端点 (URL) | 方法 | 用途 | 覆盖键 (SystemProperty) | 来源 |
|---|---|---|---|---|
| `wss://copilot-api-auth-prd.vivo.com.cn` | WS | GPT 对话 WebSocket | `sys.copilot_ws_host` | `websocket/HttpApi.java` (CERTAIN) |
| `https://copilot-api-auth-prd.vivo.com.cn/common/upload_doc` | POST | 文档上传 | `sys.copilot_https_host` | `upload/http/UploadApi.java` (CERTAIN) |
| `https://copilot-api-auth-prd.vivo.com.cn/common/upload_chunck_doc` | POST | 分片文档上传 | 同上 | `UploadApi.java` (CERTAIN) |
| `https://copilot-api-auth-prd.vivo.com.cn/common/check_doc_status` | POST | 文档状态查询 | 同上 | `UploadApi.java` (CERTAIN) |
| `https://copilot-api-auth-prd.vivo.com.cn/user/blacklist/status` | GET | 用户黑名单状态 | `sys.copilot_auth_http_host` | `core/account/AccountApi.java` (CERTAIN) |
| `https://gptkit-proxy.vivo.com.cn/gpt_api/servant_request` | POST | SSE 流式请求 | `sys.kit_sse_https_host` | `sse/http/SseApi.java` (CERTAIN) |

覆盖键读取 (`o6/e.java` → `android.os.SystemProperties.get`, CERTAIN)。示例 (`AccountApi.java`):

```java
private static final String KIT_COPILOT_AUTH_HOST = "sys.copilot_auth_http_host";
private static final String PUB_URL = "copilot-api-auth-prd.vivo.com.cn";
private final String createURL() {
    String properties = e.a(KIT_COPILOT_AUTH_HOST);
    return (properties == null || properties.length() == 0) ? PUB_URL : properties;
}
public final String createMethod() { return "/user/blacklist/status"; }
```

### 1.7 账号/鉴权 (`usrsys`)

| 端点 (URL) | 方法 | 用途 | 来源 |
|---|---|---|---|
| `https://usrsys.vivo.com.cn/usrlg/sdk/validateToken` | POST | 校验 SDK token | `b2/l.java:130` (CERTAIN) |
| `https://usrsys.vivo.com.cn/login/user/validateSDKToken` | POST | 校验 SDK token | `b2/j.java:112` (CERTAIN) |
| `https://usrsys.vivo.com.cn/login/validateVivoToken` | POST | 校验 vivo token | `b2/j.java:121` (CERTAIN) |
| `https://usrsys.vivo.com.cn/login/user/getOpenToken` | POST | 换取 open token | `c2/a.java:121` (CERTAIN) |

### 1.8 云盘 / 云相册 (`com.vivo.disk` / `com.bbk.cloud`)

| 端点 (URL) | 方法 | 用途 | 来源 |
|---|---|---|---|
| `https://clouddisk-cn09.vivo.com.cn` | — | 默认上传/下载域名 | `disk/commonlib/util/CoRequestUrl.java` (CERTAIN) |
| `https://clouddisk-api.vivo.com.cn/` | — | 云盘 API 域名 | 同上 (CERTAIN) |
| `https://vcloud-api.vivo.com.cn/` | — | vcloud API 域名 | 同上 (CERTAIN) |
| `https://vcloud-api.vivo.com.cn/vcloud-disk-api/api/app/meta/abortUpload.do` | POST | 中止上传 | `CoRequestUrl.java` (CERTAIN) |
| `.../meta/ctenc/fileInfo.do` | POST | 下载文件信息 | 同上 (CERTAIN) |
| `.../meta/getStsToken.do` | POST | 获取 STS 临时凭证 | 同上 (CERTAIN) |
| `.../cfg/getStandBySSK.do` | POST | 获取备用密钥 | 同上 (CERTAIN) |
| `.../meta/confirmRangeUpload.do` | POST | 确认分段上传 | 同上 (CERTAIN) |
| `.../meta/confirmUpload.do` | POST | 确认上传完成 | 同上 (CERTAIN) |
| `.../meta/tob/preUpload.do` | POST | 预上传申请 | 同上 (CERTAIN) |
| `https://clouddisk-cn09.vivo.com.cn/api/file/download.do` | POST | 文件下载 | 同上 (CERTAIN) |
| `https://cloudalbum-api.vivo.com.cn` | — | 云相册 API 域名 | `bbk/cloud/coresdk/constants/Apis.java` (CERTAIN) |
| `https://cloudalbum-api.vivo.com.cn/api/app/storage/config.do` | POST | 存储空间配置 | `Apis.java` (CERTAIN) |
| `https://cloudalbum-api.vivo.com.cn/api/app/storage/detail.do` | POST | 存储空间详情 | 同上 (CERTAIN) |
| `https://cloudalbum-api.vivo.com.cn/api/app/storage/simple.do` | POST | 存储空间简况 | 同上 (CERTAIN) |
| `https://vcloud-api.vivo.com.cn/vcloud/wholepackage/queryDeviceList` | POST | 整包备份设备列表 | 同上 (CERTAIN) |

实际分片上传/下载域名在运行时由 `PreUploadResp`/`PreDownResp` 返回的 `stsTokenInfo` 等字段动态给出 (INFERRED, 见 `disk/um/uploadlib/preupload/PreUploadResp.java:100-103`)。

### 1.9 应用升级

| 端点 (URL) | 方法 | 用途 | 来源 |
|---|---|---|---|
| `https://appupgrade.vivo.com.cn/pluginUpgrade` | GET/POST | 插件升级检查 | `aiaudiokit/fragment/record/RecordFragment.java:2025` (CERTAIN) |
| `https://appupgrade.vivo.com.cn/appSelfUpgrade` | — | 应用自升级 | `upgradelibrary/normal/d.java` (CERTAIN) |
| `https://182.92.210.113/index` | — | 升级备用 IP | `upgradelibrary/normal/d/a.java:42` (CERTAIN) |
| `https://39.105.6.78/index` | — | 升级备用 IP | `upgradelibrary/normal/d/a.java:43` (CERTAIN) |

域名/IP 通过 Base64 编码硬编码 (`upgradelibrary/normal/d.java:15,35`):

```java
private static final String f15238b = "https://" + new String(Base64.decode("YXBwdXBncmFkZS52aXZvLmNvbS5jbg==", 0)) + "/appSelfUpgrade";
// MTgyLjkyLjIxMC4xMTM= → 182.92.210.113 ; MzkuMTA1LjYuNzg= → 39.105.6.78
```

### 1.10 VCode 数据上报 / 规则配置

| 端点 (URL) | 方法 | 用途 | 来源 |
|---|---|---|---|
| `https://{domain}/api/v1/data/reportpd` | POST | 性能延迟上报 | `vcodeimpl/config/b.java:725` (CERTAIN) |
| `https://{domain}/api/v1/data/reportpr` | POST | 性能即时上报 | `b.java:728` (CERTAIN) |
| `https://{domain}/api/v1/data/reportod` | POST | 单点延迟上报 | `b.java:731` (CERTAIN) |
| `https://{domain}/api/v1/data/reportor` | POST | 单点即时上报 | `b.java:734` (CERTAIN) |
| `https://{domain}/api/v1/rule/get.do` | POST | 规则拉取 | `b.java:737` (CERTAIN) |
| `https://{domain}/api/v1/rule/getAllFNK.do` | POST | 全量规则拉取 | `b.java:740` (CERTAIN) |
| `https://{domain}/api/v1/file/upload` | POST | 文件上传 | `b.java:744` (CERTAIN) |
| `https://vcodevisual.vivo.xyz` | — | 可视化上报基址 | `vcode/visualization/VisualizationReport.java:25` (CERTAIN) |

CN 域名 (`vcodeimpl/config/b.java:716-722`, CERTAIN):

```java
"vcode-api.vivo.com.cn"   // rule get.do / getAllFNK.do / file/upload
"vcode-od.vivo.com.cn"    // reportpd (single delay)
"vcode-or.vivo.com.cn"    // reportpr (single imd)
"vcode-api-fnk.vivo.com.cn" // 额外的 rule get.do (CN)
```

海外域名 (`b.java:691-693`, CERTAIN, 按区域 case): `uk-vcode-api.vivoglobal.com`, `uk-vcode-or.vivoglobal.com`, `uk-vcode-od.vivoglobal.com` 等 (仅展示 UK 分支)。

---

## 2. 主机/域名解析机制 (getDomain)

### 2.1 getDomain(N) 定义

`speechsdk/module/net/NetModule.java:117-119` (CERTAIN):

```java
public String getDomain(int i10) {
    return i10 == 1 ? com.vivo.speechsdk.module.net.utils.f.b().a()   // ASR 域名
                    : com.vivo.speechsdk.module.net.utils.f.b().c();  // TTS 域名
}
```

- `getDomain(1)` → ASR 域名 (`f13242k`)
- `getDomain(2)` (以及任何非 1 值) → TTS 域名 (`f13243l`)

### 2.2 域名初始化与区域切换

`speechsdk/module/net/utils/f.java` (CERTAIN):

```java
private static String f13242k = "asia-asr-v2.vivoglobal.com";  // ASR 默认(海外)
private static String f13243l = "xxx";                          // TTS 默认(海外, 需配置覆盖)

public void a(Context context) {
    if (!DeviceUtils.isOversea()) {
        f13242k = "asr-v2.vivo.com.cn";
        f13243l = "tts-v2.vivo.com.cn";
        return;
    }
    a.b().a(context);
    String countryCode = DeviceUtils.getCountryCode(context);
    switch (countryCode) {
        case "CN": case "CN-ZH":
            f13242k = "asr-v2.vivo.com.cn"; f13243l = "tts-v2.vivo.com.cn"; break;
        case "ID": case "SG":
            f13242k = "asia-asr-v2.vivoglobal.com"; break;
        case "IN":
            f13242k = "in-asr-v2.vivoglobal.com"; break;
    }
    f13242k = a.b().a(f13233b, f13242k, f13232a);   // 键 "speechsdk_oversea_asr_key"
    f13243l = a.b().a(f13234c, f13243l, f13232a);   // 键 "speechsdk_oversea_tts_key"
}
```

常量 (`f.java`, CERTAIN):

```java
public static final String f13235d = "asr-v2.vivo.com.cn";       // CN ASR
public static final String f13236e = "aispeech.vivo.com.cn";     // 旧 ASR
public static final String f13237f = "tts-v2.vivo.com.cn";       // CN TTS (新)
public static final String f13238g = "tts.vivo.com.cn";          // CN TTS (旧)
public static final String f13239h = "in-asr-v2.vivoglobal.com"; // IN
public static final String f13240i = "asia-asr-v2.vivoglobal.com"; // Asia
```

**环境映射汇总**:

| 环境 | ASR (getDomain(1)) | TTS (getDomain(2)) |
|---|---|---|
| CN (国内) | `asr-v2.vivo.com.cn` | `tts-v2.vivo.com.cn` |
| ID / SG | `asia-asr-v2.vivoglobal.com` | 由 `speechsdk_oversea_tts_key` 配置 (默认 `"xxx"`) |
| IN | `in-asr-v2.vivoglobal.com` | 同上 |
| 其他海外 | `asia-asr-v2.vivoglobal.com` (默认) | 同上 |

> 注意: 海外 TTS 域名在 switch 中**不会被赋值**, 默认 `"xxx"`, 必须由域名配置文件提供, 否则 TTS WS 会连到无效域名 (INFERRED, 但 switch 逻辑是 CERTAIN 的缺失)。

### 2.3 域名配置文件覆盖 (vivo damons domains)

`speechsdk/module/net/utils/a.java` (TAG `"DH"`, CERTAIN) 提供两级域名仓库:

1. **动态仓库** `e` (或 AIO 模式 `f`): 读 `data/bbkcore/domains/` 下文件名以 `<包名>` 结尾的文件, 并缓存到 SharedPreferences `sp_vivo_damons_domain_cache`, 键前缀 `sp_key_crc_`。文件内容为 JSON `{"metadatas":[{"key":"...","value":"..."}]}`, 文件名前缀是其 CRC32, 用于校验。
2. **本地默认仓库** `d`: 读 `oem/etc/domains/<包名>` 或 `oem/{oemname}/etc/domains/<包名>` (由系统属性 `ro.vivo.oem.all.in.one.support`, `ro.boot.oem_name`, `ro.vivo.default.oem.name` 决定路径)。

查找顺序 (`a.java:343-355`, CERTAIN): 先动态仓库, 再本地默认仓库; 首个非空值胜出:

```java
if (f13164o) { arrayList.add(new f(str3)); }   // AIO: 直接读 data/bbkcore/domains
else         { arrayList.add(new e(str3)); }   // 正常: SharedPreferences 缓存
arrayList.add(new d(str3));                    // oem/etc/domains 兜底
```

即 **ASR/TTS 域名可被以下三级覆盖**: 代码硬编码默认值 → damons 动态域名文件 → oem 本地域名文件 (通过 `speechsdk_oversea_asr_key` / `speechsdk_oversea_tts_key` 两个键, 包名 `com.vivo.speechsdk`)。

### 2.4 Bundle 配置键覆盖 (运行时, 优先级最高)

| 键 | 作用 | 覆盖哪些 URL | 来源 |
|---|---|---|---|
| `key_server_url` | 服务端 base URL 覆盖 | LASR base、hotword 上传、TTS HTTP 合成 (`vivotrans`)、vcns_config host | `SpeechConstants.KEY_SERVER_URL` (CERTAIN) |
| `key_ws_host` | WebSocket / 上传 host 覆盖 | ASR WS host、TTS WS host、vcns_config / upload_full_text host | `SpeechConstants.KEY_WS_HOST` (CERTAIN) |

`key_server_url` 语义示例 (`asronline/c.java:87`, `lasr/b.java:800-802`, `HttpService.java:281`)。`key_ws_host` 语义示例 (`asronline/i/f.java:257`, `TtsExtraServer.java:51,123`)。

### 2.5 httpdns 解析流程与回退顺序

`speechsdk/module/net/OkHttpDns.java` (CERTAIN) 是 OkHttp 的 `Dns` 实现:

```java
public List<InetAddress> lookup(String str) throws UnknownHostException {
    ...
    String[] strArrA = OkHttpDns.this.a(this.f13136a);  // HttpDnsService.getIpsByHostSync(str)
    return (strArrA == null || strArrA.length <= 0)
        ? Dns.SYSTEM.lookup(this.f13136a)                 // 回退到系统 DNS
        : Arrays.asList(InetAddress.getAllByName(strArrA[0]));
}
```

流程:
1. OkHttp 请求某 host → `OkHttpDns.lookup(host)`。
2. 反射调用 `HttpDnsService.getIpsByHostSync(host)`。
3. 命中 httpdns 缓存/结果 → 返回第一个 IP (`InetAddress.getAllByName(ips[0])`)。
4. httpdns 未命中/失败 → 回退 `Dns.SYSTEM.lookup(host)` (系统 DNS)。
5. httpdns 内部 (`e/b2401.java:498-570`): 先查 `Config`, 若 config 过期/不可用先走 config 拉取 (`vhs.wwstat.com/v1/get.do` → 备 `vhs.vivo.com.cn/v1/get.do`), 拿到 `httpsServerIps`/`accountId`/`secret`/`token` 后, 向这些 server IP 发解析请求; 白名单(`whiteList`)控制哪些域名走 httpdns, 不在白名单的只走本地 DNS。

回退顺序总结 (CERTAIN + INFERRED 结合):
1. httpdns 缓存 (命中即返回)。
2. httpdns 服务端 (config 里的 `httpsServerIps`, 多 IP 轮换 `i2401.a(int)` / `c(int)`)。
3. 系统 DNS (`Dns.SYSTEM.lookup`)。

---

## 3. 配置端点 (config endpoints) 与其返回值

### 3.1 `vcns_config` (TTS 发音人配置)

- 请求: `GET https://{host}/vcns_config?<query>` (`TtsExtraServer.java:51`), 带 `X-AI-GATEWAY-*` 鉴权头 (见 `Protocol.generateAuthHeaders`), 及 `imei`/`vaid`/`appid`/`token`/`openid` 头。
- 响应: JSON `{"code":0,"msg":"OK", ...speaker/vcn 数据}`。`code==0` 时整段 JSON 存为 `mSpeakers` 返回给上层 (`TtsExtraServer.java:84-104`)。
- 作用: 填充 TTS 可选发音人 (`key_support_speakers`), **不是**主机配置。CERTAIN。

### 3.2 httpdns 配置 (`vhs.wwstat.com/v1/get.do`, `vhs.vivo.com.cn/v1/get.do`)

返回字段 (`httpdns/config/Config.java`, CERTAIN), 全部存 SharedPreferences:

```java
accountId, secret, token,           // 鉴权三件套 (group=1)
provider,                           // 1..4, 决定 resolve path
scheme,                             // 1=http, 2=https
httpServerIps, httpsServerIps,      // 解析请求实际使用的 server IP
cacheTime, expireTime, expireCount, // 缓存/过期策略
whiteList / blackList,              // 白名单(黑名单)域名
optimisticSwitch/Time/List,         // 乐观解析
preParseSwitch/PreParseDomains,     // 预解析
backDomains,                        // 主/备域名映射
ipDirectGuaranteedEnable / directGuaranteedDomainIps, // IP 直连保证
errorIpsOrRegexs, dispersionDuration, sampleRatio, monitorSwitch, delayTime, forbiden, dataVersion
```

这些字段**驱动后续 DNS 请求** (provider 决定 path, http(s)ServerIps 决定去向, whiteList 决定哪些域名走 httpdns)。CERTAIN。

### 3.3 VCode 规则配置 (`/api/v1/rule/get.do`, `getAllFNK.do`)

VCode 框架拉取上报规则/采样配置 (`vcodeimpl/config/b.java:737,740`)。返回内容由 `se.c.n(moduleId)` 等本地解析 (`b.java:763`), 具体键值属于 VCode 上报规则 (INFERRED 细节, 端点为 CERTAIN)。

---

## 4. 环境/区域切换总结

| 维度 | CN (国内) | Overseas (海外) | 判定 |
|---|---|---|---|
| ASR WS 域名 | `asr-v2.vivo.com.cn` | `asia-asr-v2.vivoglobal.com` / `in-asr-v2.vivoglobal.com` | `DeviceUtils.isOversea()` + `getCountryCode()` |
| TTS WS 域名 | `tts-v2.vivo.com.cn` | 配置键 `speechsdk_oversea_tts_key` (默认 `"xxx"`) | 同上 |
| VCode 上报域名 | `vcode-*.vivo.com.cn` | `uk-vcode-*.vivoglobal.com` 等 | `SystemUtil.isOversea()` |
| httpdns 配置源 | `vhs.vivo.com.cn` (备) | `vhs.wwstat.com` (主) | 两者都可用, 顺序固定 |
| AI kit 域名 | `copilot-api-auth-prd.vivo.com.cn` / `gptkit-proxy.vivo.com.cn` | 同左 (未见海外分支) | 仅 SystemProperty 覆盖 |

**硬编码 vs 动态主机**:
- **硬编码**: 各 `wss://…` 常量、`vivotrans.vivo.com.cn/fy/tts`、`jovivauc.vivo.com.cn/datacollect/upload`、云盘/云相册/usrsys/升级/moni-* 全部硬编码。
- **动态**: ASR/TTS 的 `getDomain(1/2)` (国家码 + 域名文件), httpdns server IP (远端配置下发), 云盘分片节点 (preUpload 响应下发)。
- **可覆盖**: Bundle 键 `key_server_url` / `key_ws_host`; 系统属性 `sys.copilot_*_host` / `sys.kit_sse_https_host`; 域名文件 `oem/etc/domains/`、`data/bbkcore/domains/`。
