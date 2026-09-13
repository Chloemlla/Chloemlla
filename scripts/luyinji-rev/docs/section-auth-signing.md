# 录音机 App 转写/语音服务的认证与签名机制

> 目标包：`com.android.bbksoundrecorder`（vivo/BBK 官方录音机，版本 1.7.3.9，ProGuard 混淆，类名多为单字母）。
> 本文只讨论 **HTTP / WebSocket 请求的认证、签名、会话与 token 获取**，不涉及 ASR 协议细节与端点清单。
> 结论分两类标注：**CERTAIN**（直接来自反编译 Java 代码）与 **INFERRED**（需要推断，尤其 native 代码部分）。
> 重要提示：本拆包 APK（`app.apk`）是 split 安装的基础包，**不含任何 `.so` 文件**，因此 native 签名算法只能从 Java 侧 + 同一 APK 内的纯 Java 参考实现推断。

---

## 1. 总体结论速览

1. 新版请求（默认，`key_new_authentication_enable = true`）使用 vivo AI 网关签名头 **`X-AI-GATEWAY-*`**，签名算法为 **HMAC-SHA256 + Base64**（CERTAIN，有纯 Java 参考实现）。
2. 旧版请求（`key_new_authentication_enable = false`）使用查询参数 **`nonce_str` + `sign`**，其核心 `sign` 由 native 库 `libspeech_sec.so` 的 `Sign.sign(...)` 计算（算法 INFERRED，与 vivo 通用 `VivoSign` v2 方案 SHA-256 排序后取 hex 高度相关）。
3. 身份 token 来自 vivo 账号体系：`vivoToken` + `openid`，通过 `token` / `openid` 请求头（或 `vivoToken` 头）携带；另有 `appid` / `vaid` / `imei` 等头。
4. 设备标识来自 `com.vivo.vms` 的 ContentProvider（`VAID` / `OAID` / `UDID` / `GUID` / `AAID`）。
5. native 侧承担签名、哈希、防篡改、账号 wave 签名三类功能。

---

## 2. 两套认证方案与开关

请求认证由 bundle 键 `key_new_authentication_enable` 控制（默认 `true`）：

| 方案 | 开关值 | 时间戳 | 签名载体 | 签名算法 |
|---|---|---|---|---|
| 新版 AI 网关 | `true`（默认） | 秒（`System.currentTimeMillis()/1000`） | 请求头 `X-AI-GATEWAY-*` | HMAC-SHA256 + Base64（CERTAIN） |
| 旧版 | `false` | 毫秒（`System.currentTimeMillis()`） | URL 查询参数 `nonce_str` + `sign` | native `Sign.sign(...)`（INFERRED） |

在录音机 App 中的实际使用（CERTAIN，来自 `j1/a.java`、`db/b.java`、`l7/n0.java`、`v0/t.java`）：

- **非折叠屏设备（主流路径）**：`appid=8735273056`, `appkey=NIhyMZRWZUGdDnrW`, `key_new_authentication_enable=true`，engine `fileasrrecorder` / `longasrlisten`，服务地址 `https://asr-v2.vivo.com.cn`。
- **折叠屏设备**：`appid=96yw39m52niisyhg`, `appkey=xkkz9f7u4xg6z35eec3k3hn62qwf4uw3`, `key_new_authentication_enable=false`，engine `fileasrrole`，服务地址 `https://aispeech.vivo.com.cn`（走旧版 `nonce_str`+`sign`）。

---

## 3. 新版认证：X-AI-GATEWAY 签名（CERTAIN）

### 3.1 请求头名称

签名产生 5 个请求头（注意大小写）：

| 头名（发送时） | 值 |
|---|---|
| `X-AI-GATEWAY-APP-ID` | appId（`key_appid`） |
| `X-AI-GATEWAY-TIMESTAMP` | 秒级时间戳字符串 |
| `X-AI-GATEWAY-NONCE` | 8 位随机字母数字 |
| `X-AI-GATEWAY-SIGNED-HEADERS` | 固定 `x-ai-gateway-app-id;x-ai-gateway-timestamp;x-ai-gateway-nonce` |
| `X-AI-GATEWAY-SIGNATURE` | `Base64(HMAC-SHA256(appKey, canonicalString))`，Base64 使用 `NO_WRAP`（flag=2） |

另有与账号/设备相关的普通头（见第 6、7 节）：`appid`、`token`、`openid`、`imei`、`vaid`。

### 3.2 签名原串（canonical string）

原串为 **6 行，以 `\n` 连接**：

```
<HTTP方法>
<路径 path>
<查询串 queryString>
<appId>
<timestamp(秒)>
x-ai-gateway-app-id:<appId>
x-ai-gateway-timestamp:<timestamp>
x-ai-gateway-nonce:<nonce>
```

即：`METHOD + "\n" + PATH + "\n" + QUERY + "\n" + APPID + "\n" + TS + "\n" + SIGNED_HEADERS_BLOCK`

### 3.3 纯 Java 参考实现（CERTAIN，算法唯一权威来源）

`com/vivo/ai/gpt/kit/sse/auth/AuthSigHelper.java:99-134` 是该算法的完整 Java 实现：

```java
public static String getSignature(String appId, String appKey, String method,
        String uri, Map<String,String> params, Map<String,String> outHeaders,
        long tsMillis, String nonce) throws AuthSigException {
    ...
    // 1) 参数排序（TreeMap 字典序），key/value 均 URLEncode，用 "&" 连接
    String paramString = getParamString(true, "&", "=", params, sURLEncodeFunc);
    // 2) 时间戳：毫秒 -> 秒
    String timestamp = Long.toString(tsMillis / 1000);
    // 3) 头部块（不编码，用 "\n" 和 ":" 连接）
    LinkedHashMap<String,String> h = new LinkedHashMap<>();
    h.put("x-ai-gateway-app-id", appId);
    h.put("x-ai-gateway-timestamp", timestamp);
    h.put("x-ai-gateway-nonce", nonce);
    String signedBlock = getParamString(false, "\n", ":", h, sIdentityFunc);
    // 4) 原串
    String toSign = strJoin("\n", method, uri, paramString, appId, timestamp, signedBlock);
    // 5) HMAC-SHA256 + Base64(NO_WRAP)
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(appKey.getBytes(), "HmacSHA256"));
    String sig = Base64.encodeToString(mac.doFinal(toSign.getBytes()), 2);
    // 6) 写入返回头
    outHeaders.put("x-ai-gateway-app-id", appId);
    outHeaders.put("x-ai-gateway-timestamp", timestamp);
    outHeaders.put("x-ai-gateway-nonce", nonce);
    outHeaders.put("X-AI-GATEWAY-SIGNED-HEADERS", "x-ai-gateway-app-id;x-ai-gateway-timestamp;x-ai-gateway-nonce");
    outHeaders.put("X-AI-GATEWAY-SIGNATURE", sig);
    ...
}
```

其中 `getParamString`（`AuthSigHelper.java:60-75`）：`sort=true` 时把 map 转成 `TreeMap`（按 key 字典序），然后对每个 entry 做 `encode(key) + "=" + encode(value)`，用给定分隔符 `"&"` 连接。`sURLEncodeFunc` 是标准 `URLEncoder.encode(s, "UTF-8")`。

### 3.4 语音 SDK 侧的等价实现（CERTAIN 结构，算法 INFERRED）

语音 SDK（`com.vivo.speechsdk`）自己拼原串，然后调用 native `Sign.generateSignature(appKey, toSign)`。二者原串结构完全一致。

**TTS 侧** `com/vivo/speechsdk/module/ttsonline/net/Protocol.java:114-142`：

```java
public static LinkedHashMap<String,String> generateAuthHeaders(Bundle bundle, String path, String query, String ts) {
    ...
    String appid  = bundle.getString("key_appid");
    String appkey = bundle.getString("key_appkey");
    ISignTool iSignTool = (ISignTool) ModuleManager.getInstance().getService(ModuleManager.MODULE_SEC, bundle);
    String nonce = iSignTool.nonce(8);                       // 8 位随机字母数字
    String[] arr = { AccountApi.HTTP_METHOD_NAME /* "GET" */, path, query, appid, ts,
        String.format("x-ai-gateway-app-id:%s\nx-ai-gateway-timestamp:%s\nx-ai-gateway-nonce:%s",
                      appid, ts, nonce) };
    StringBuilder sb = new StringBuilder(96);
    for (int i = 0; i < 6; i++) {
        if (i > 0) sb.append("\n");
        if (arr[i] != null) sb.append(arr[i]);
    }
    linkedHashMap.put("X-AI-GATEWAY-APP-ID", appid);
    linkedHashMap.put("X-AI-GATEWAY-TIMESTAMP", ts);
    linkedHashMap.put("X-AI-GATEWAY-NONCE", nonce);
    linkedHashMap.put("X-AI-GATEWAY-SIGNED-HEADERS", "x-ai-gateway-app-id;x-ai-gateway-timestamp;x-ai-gateway-nonce");
    linkedHashMap.put("X-AI-GATEWAY-SIGNATURE",
        Base64.encodeToString(iSignTool.generateSignature(appkey, sb.toString()), 2));
    return linkedHashMap;
}
```

**ASR/LASR 侧**（`com/vivo/speechsdk/api/CommMethod.java:84-112`、`com/vivo/speechsdk/module/lasr/c/a.java:152-180`）结构相同，但第一行方法为 `VisualizationReport.POST`（即 `"POST"`）：

```java
String[] arr = { VisualizationReport.POST /* "POST" */, str /* path */, str2 /* query */,
                 appid, ts, String.format("x-ai-gateway-app-id:%s\n...", appid, ts, nonce) };
```

**ASR WebSocket 侧**（`com/vivo/speechsdk/module/asronline/i/f.java:392-419`）方法为 `AccountApi.HTTP_METHOD_NAME`（`"GET"`），path 固定 `"/asr/v2"`：

```java
String[] arr = { AccountApi.HTTP_METHOD_NAME /* "GET" */, "/asr/v2", str /* query */,
                 appid, ts, String.format("x-ai-gateway-app-id:%s\n...", appid, ts, nonce) };
```

> 注意（CERTAIN 观察）：TTS 的 `Protocol.generateAuthHeaders` 无论请求实际是 GET 还是 POST（如 `upload_full_text` 为 POST），第一行都硬编码为 `"GET"`；而 LASR/ASR 的 POST 接口第一行为 `"POST"`。

### 3.5 native 签名函数与算法推断

`com/vivo/speechsdk/module/security/Sign.java:22-28`：

```java
public class Sign {
    static { try { System.loadLibrary("speech_sec"); } catch (UnsatisfiedLinkError e) {} }
    public static native byte[] generateSignature(String str, String str2);
    public static native String hash(String str);
    public static native String nonce(int i10);
    public static native String sign(String[] strArr, String str, int i10);
}
```

- `generateSignature(appKey, toSign)` 返回 `byte[]`，与 Java `AuthSigHelper` 中 `mac.doFinal(toSign)` 的返回类型一致 → **INFERRED（高置信度）：`generateSignature` = `HMAC-SHA256(appKey, toSign)`**。
- 语音 SDK 的 `Sign.sign(String[], appKey, mode)` 用于旧版 `nonce_str`+`sign`（见第 4 节），其内部算法 **UNKNOWN**（native 缺失）。

---

## 4. 旧版认证：`nonce_str` + `sign`（结构 CERTAIN，算法 INFERRED）

当 `key_new_authentication_enable=false` 时，不发送 X-AI-GATEWAY 头，而是在 URL 追加查询参数：

```java
// com/vivo/speechsdk/api/CommMethod.java:255-260
String nonce = iSignTool.nonce(16);
sbQuery.append(String.format(ConfigConstants.TEMP_SIGN_QUERY_STRING,
    URLEncode(nonce),
    iSignTool.sign(new String[]{
        "appid=" + appid,
        "nonce_str=" + nonce,
        "package=" + pkg,
        "system_time=" + ts,
        "user_id=" + userId
    }, appkey)));
```

`ConfigConstants.TEMP_SIGN_QUERY_STRING = "&nonce_str=%s&sign=%s"`（另有 `TEMP_SIGN_QUERY_STRING_APPID = "&nonce_str=%s&appid=%s&sign=%s"`）。

即最终 URL 追加：`&nonce_str=<16位随机>&sign=<native Sign.sign 结果>`。

`Sign.sign(String[] params, String appkey, int mode)` 的签名内容为有序的 `key=value` 数组（appid / nonce_str / package / system_time / user_id），算法在 `libspeech_sec.so` 内，**UNKNOWN**。

**相关参考（INFERRED）**：vivo 通用网关签名 `VivoSign`（`com/vivo/disk/oss/network/sign/VivoSign.java` + `SignUtilV2.java`，`com/bbk/cloud/coresdk/sign/` 同款）的算法是：

```java
// SignUtilV2.getStringSign("2", sortedArray)
// 1) 数组按字典序排序（Collections.sort），null 转 ""
// 2) 拼接 ":" + item（并过滤 4 字节 UTF-8 字符）
// 3) 结果 = "2|" + hex(SHA-256(拼接串))
```

另有 `com/vivo/disk/commonlib/util/CoSignUtil.java:62-77` 的 `getSignOfGateway` 用 `[openid, token, appPkgName, timestamp, appVersion]` 排序后调用 `VivoSign.getSign`；`CoSignUtil.getSignForApp` 用 `HmacSHA1` + 固定 `signShortCut`。

> 注意：这些是 disk/cloud 网关的旧签名，与语音 SDK 的 native `Sign.sign` 输入格式不同（后者显式带 `appkey`），不能直接等同，仅作为同一厂商签名风格的参考。

---

## 5. Token / 会话获取与刷新流程

### 5.1 vivo 账号体系（CERTAIN）

App 通过 vivo/BBK 账号 SDK 读取账号数据，键与含义：

| 逻辑名 | 存储键 / 来源 | 说明 |
|---|---|---|
| `openid` | AccountManager `getUserData("openid")` | vivo 账号 openid |
| `vivoToken` | `getUserData("vivotoken")`（旧称 `vivoToken`） | 账号 token |
| `authtoken` | `peekAuthToken(account, "BBKOnLineServiceAuthToken")` | 系统账号 auth token |

相关类：
- `d2/b.java`（`AccountManagerProxy`）：`a()` = `getvivoToken`（优先 `vivotoken` 缓存，回退 `authtoken`），`e()` = `getOpenid`，`i()` = `getvivoTokenNew`。
- `b2/c.java`（`AccountInfoSysAppImpl`，系统应用路径）：从 `AccountManager`（账号类型 `BBKOnLineService`）的 `getUserData` / `peekAuthToken` 读取。
- `b2/b.java`（`AccountInfoNonSysAppImpl`，非系统应用路径）：从 `w1.b` 存储（ContentProvider `com.bbk.account.accountinfo`）读 `openid`/`vivotoken`。
- `q1/b/d.java` 对外暴露：`f()` → `openid`，`i()` → `vivoToken`。
- 录音机 App 里：`na/c.java`（`SR/SoundRecordAccountManager`）的 `h()` 返回 openid、`k()` 返回 vivoToken；`j1/a.java`、`db/b.java`、`v0/t.java` 把 `key_openid` / `key_token` 塞进 SDK bundle。

### 5.2 openToken 校验（CERTAIN，b2/j.java `OpenTokenPresenter`）

用 `vivoToken` 换取 `opentoken` 的两个接口：

- 旧流程：`POST https://usrsys.vivo.com.cn/login/user/validateSDKToken`
  参数：`externalapp=1`, `access_token=<vivoToken>`。
- 新流程：`POST https://usrsys.vivo.com.cn/login/validateVivoToken`
  参数：`externalapp=1`, `openid=<openid>`, `vivotoken=<vivotoken>`。

响应 JSON：`stat`（`200` 成功）、`openid`、`opentoken`、`username`。`stat==441` 或 `stat==20002` 表示 token 失效，触发重新登录。校验成功后 `opentoken` / `openid` 被回传。

### 5.3 统一鉴权状态查询（CERTAIN，copilot-api-auth）

`com/vivo/ai/gpt/kit/core/account/AccountApi.java`：

```java
public static final String HTTP_METHOD_NAME = "GET";
private static final String PUB_URL = "copilot-api-auth-prd.vivo.com.cn";
public final String createMethod() { return "/user/blacklist/status"; }
// URL = https://copilot-api-auth-prd.vivo.com.cn/user/blacklist/status?appid=..&openid=..&business_name=..&request_id=..&vaid=..
```

`AccountApi.urlParams(...)` 拼的参数：`appid`、`openid`、`business_name`、`request_id`（UUID）、`vaid`（来自 `b.f19919a.a()`，即 VAID）。

`com/vivo/ai/gpt/kit/core/account/AccountHttpManager.java:50-87`（`requestAuthStatus`）：
1. 用 `AuthSigHelper.getSignature(appId, appKey, "GET", "/user/blacklist/status", urlParams, headers)` 生成 X-AI-GATEWAY 头；
2. 额外加请求头 `vivoToken`（原样 `str5`）；
3. 响应 JSON 的 `code==0` 为成功。

调用链：`GPTKit.queryAuthStatus` → `AccountHttpManager.requestAuthStatus`。用途是查询用户是否在黑名单/限流（返回字段含 `blacklist_next` / `blacklist_daily_limit`）。

### 5.4 token 在语音请求中的携带方式（CERTAIN）

`com/vivo/speechsdk/api/CommMethod.java:61-80`、`com/vivo/speechsdk/module/ttsonline/net/TtsExtraServer.java`、`WebSocketService.java:298-326`、`lasr/b.java:851-870` 均一致：

```java
if (!TextUtils.isEmpty(did))    builder.header("imei",  did);     // key_did
if (!TextUtils.isEmpty(vaid))   builder.header("vaid",  vaid);    // key_vaid
if (!TextUtils.isEmpty(appid))  builder.header("appid", appid);   // key_appid
if (!TextUtils.isEmpty(token))  builder.header("token",  token);  // key_token (=vivoToken)
if (!TextUtils.isEmpty(openid)) builder.header("openid", openid); // key_openid
```

在 GPT-kit SSE 侧（`OkHttpSse.java:108`）则是 `headerBuilder.add("vivo-token", vivoToken)`，另有 `SseApi` 固定加 `Vaid`、`Content-Type` 头。

---

## 6. 设备标识（Device ID）

### 6.1 vivo 标识符 SDK（CERTAIN）

`com/vivo/identifier/IdentifierManager.java` 提供：`getVAID` / `getOAID` / `getUDID` / `getGUID` / `getAAID` / `getOAIDStatus` / `isLimited`。

底层 `com/vivo/identifier/IdentifierIdClient.java` 通过系统应用 `com.vivo.vms` 的 ContentProvider 查询：

```
URI: content://com.vivo.vms.IdProvider/IdentifierId
type: 0=OAID, 1=VAID, 2=AAID, 3=UDID, 5=GUID, 4=OAIDSTATUS, 12=OAIDLIMIT, ...
```

受 `SystemProperties` 开关控制：`persist.sys.identifierid.supported`、`persist.sys.identifierid`。OAID 受限时返回全零串 `0000...`（64 个 0），OAID 状态常量见 `IdentifierConstant`（`1` 启用 / `0` 受限 / `-2` 不支持）。

### 6.2 录音机 App 侧取值（CERTAIN）

- `key_vaid`：`com/vivo/recordbase/core/utils/w0.e()` → `IdentifierManager.getVAID(context)`，为空时回退 `"00000000000000"`（`l7/n0.java:311`）。
- `key_user_id`：SDK 内随机 UUID（去掉 `-`），见 `Protocol.getUserId()` / `CommMethod.getUserId()`；也可由 `SpeechSdk.Builder.withUserId(...)` 显式设置。
- `key_did`（发送头名 `imei`）：`Constants.KEY_DID`，URL 参数里叫 `imei`（受 `key_url_did_remove` 控制是否放入 URL）。头 `imei` 直接携带 `key_did`。

> 说明：`key_did` / `imei` 在现代 Android 上通常取不到真实 IMEI，实际多是 VAID 或空；URL 里默认 `key_url_did_remove=true` 已不再拼 `imei` 查询参数（见 `lasr/c/a.java:215-217`）。

---

## 7. native（JNI/.so）与 Java 的职责划分

> 本 APK 无 `.so`（split 包），以下 native 方法仅从 `System.loadLibrary` 与 native 声明识别，**具体实现不可见**。

| native 库 | 类 | native 方法 | 职责 | 状态 |
|---|---|---|---|---|
| `libspeech_sec.so` | `com.vivo.speechsdk.module.security.Sign` | `generateSignature(String, String) → byte[]` | 新版签名（推断 HMAC-SHA256） | INFERRED |
| `libspeech_sec.so` | 同上 | `sign(String[], String, int) → String` | 旧版 `nonce_str`+`sign` | UNKNOWN |
| `libspeech_sec.so` | 同上 | `hash(String) → String` | 哈希（Java 回退 `String.hashCode`） | UNKNOWN |
| `libspeech_sec.so` | 同上 | `nonce(int) → String` | 随机串（Java 回退 `Random` 62 字符集） | CERTAIN 用途 |
| `libvivosgmain.so` | `com.vivo.security.jni.SecurityCryptor` | `nativeAesEncrypt/Decrypt`, `nativeGetRsaPublicKey/PrivateKey`, `nativeBase64*`, `nativeSet*Signatures`, `waveString*` 等 | vivo 安全 SDK（AES/RSA/签名校验/文件生成） | CERTAIN 声明 |
| `libvivo_account_wave.so` | `com.vivo.md5.Wave` | `waveStringNet(Context, String) → long` | vivo 账号 "wave" 签名（`Wave.b` 拼 `"2|" + ...` 后 URLEncode） | CERTAIN 声明 |

关键 native 签名（`com/vivo/security/jni/SecurityCryptor.java`）：

```java
public static native String arg0(Context context);
public static native String arg1(Context context);
public static native String arg2(Context context);
public static native Cipher getCipher(int i10);
public static native byte[] nativeAesDecrypt(byte[] bArr, int i10);
public static native byte[] nativeAesEncrypt(byte[] bArr, int i10);
public static native byte[] nativeGetRsaPrivateKey();
public static native byte[] nativeGetRsaPublicKey();
public static native String waveString(String str);
public static native String waveStringEnd(String str);
public static native long nativeWaveStringNet(String str);
```

`com/vivo/md5/Wave.java`（账号 wave，`b(Context, Object[])`）：

```java
// 1) 对每个参数转字符串，前置 ":" 拼接
// 2) 返回 URLEncoder.encode("2|" + waveStringNet(context, ":" + a + ":" + b + ...))
public static native long waveStringNet(Context context, String str);
```

> 这与第 4 节 `VivoSign` v2 的 `"2|" + hash(...)` 前缀格式一致（INFERRED，二者同源）。

**Java 侧承担**：X-AI-GATEWAY 原串拼接、参数排序/URLEncode、Base64 包装、Header 组装、随机串回退（`SecurityModule.a.nonce` 用 `Random` 生成 62 字符集）、token/openid 的读取与缓存、账号登录/校验接口调用。

---

## 8. 具体示例（尽可能还原）

### 8.1 新版 ASR WebSocket（`wss://asr-v2.vivo.com.cn/asr/v2`，GET）

给定：
- `appId = "8735273056"`, `appKey = "NIhyMZRWZUGdDnrW"`
- `timestamp = "1697113916"`（秒）
- `nonce = "AbCd1234"`（8 位）
- 查询串（已 ASCII 排序 + 特殊字符过滤）：`android_version=13&brand=vivo&client_version=1.7.3.9&engineid=fileasrrecorder&model=...&net_type=1&package=com.android.bbksoundrecorder&product=...&rom=...&sdk_version=...&system_time=1697113916&system_version=...&user_id=<uuid>&user_info=1`

原串（`\n` 连接）：
```
GET
/asr/v2
android_version=13&brand=vivo&client_version=1.7.3.9&engineid=fileasrrecorder&model=...&net_type=1&package=com.android.bbksoundrecorder&product=...&rom=...&sdk_version=...&system_time=1697113916&system_version=...&user_id=<uuid>&user_info=1
8735273056
1697113916
x-ai-gateway-app-id:8735273056
x-ai-gateway-timestamp:1697113916
x-ai-gateway-nonce:AbCd1234
```

签名：`X-AI-GATEWAY-SIGNATURE = Base64_NO_WRAP( HMAC-SHA256( "NIhyMZRWZUGdDnrW", 上述原串 ) )`

发送头：
```
X-AI-GATEWAY-APP-ID: 8735273056
X-AI-GATEWAY-TIMESTAMP: 1697113916
X-AI-GATEWAY-NONCE: AbCd1234
X-AI-GATEWAY-SIGNED-HEADERS: x-ai-gateway-app-id;x-ai-gateway-timestamp;x-ai-gateway-nonce
X-AI-GATEWAY-SIGNATURE: <Base64>
appid: 8735273056
vaid: <VAID>
imei: <key_did>
token: <vivoToken>
openid: <openid>
```

> 注意：`AuthSigHelper` 里原串第 3 段是 `TreeMap` 排序后 **再次 URLEncode** 的 key=value；而语音 SDK 直接签的是 URL 中已排序/过滤后的查询串。对纯字母数字查询值二者等价，含特殊字符时可能有细微差异。

### 8.2 旧版（折叠屏，`https://aispeech.vivo.com.cn/...`）

URL 追加（毫秒时间戳）：
```
...&nonce_str=<16位随机>&sign=<Sign.sign(["appid=96yw39m52niisyhg","nonce_str=...","package=...","system_time=<ms>","user_id=<uuid>"], "xkkz9f7u4xg6z35eec3k3hn62qwf4uw3")>
```
头：`appid: 96yw39m52niisyhg` + `vaid` / `imei` / `token` / `openid`。

---

## 9. 硬编码凭证汇总（CERTAIN）

| 用途 | appId | appKey | 来源 |
|---|---|---|---|
| 主流（非折叠）转写/ASR/AI | `8735273056` | `NIhyMZRWZUGdDnrW` | `j1/a.java:314-315`, `v0/t.java:644-645`, `l7/n0.java:308-309`, `RecognizeService.java:509-510`, `AppFeature.java:314-315`, `w6/b.java:746` |
| 折叠屏 `fileasrrole` | `96yw39m52niisyhg` | `xkkz9f7u4xg6z35eec3k3hn62qwf4uw3` | `j1/a.java:302-303`, `v0/t.java:632-633`, `RecognizeService.java:495-496` |

另有配置对象 `ka/b.java`（通过 `ia.b.c().a()` 获取），`e()` 返回 appId、`f()` 返回 appKey、`d()` 返回 engineType，值来自 `v0/x.java` 中的 builder 链（`.j("8735273056").k("NIhyMZRWZUGdDnrW").i("longasrlisten").l("fileasrrecorder")` 等）。

---

## 10. 域名 / 端点（与认证相关的 host）

`com/vivo/speechsdk/module/net/utils/f.java`：

```
asr-v2.vivo.com.cn            (getDomain(1), 国内 ASR)
aispeech.vivo.com.cn          (折叠屏 fileasrrole 专用 server_url)
tts-v2.vivo.com.cn            (getDomain(2), TTS)
tts.vivo.com.cn               (旧 TTS)
in-asr-v2.vivoglobal.com      (印度 ASR)
asia-asr-v2.vivoglobal.com    (亚洲 ASR)
```

其它认证相关 host：
```
copilot-api-auth-prd.vivo.com.cn   (统一鉴权 /user/blacklist/status)
gptkit-proxy.vivo.com.cn           (GPT-kit SSE /gpt_api/servant_request)
usrsys.vivo.com.cn                 (token 校验 validateVivoToken / validateSDKToken)
vivotrans.vivo.com.cn              (TTS 旧 HTTP /fy/tts)
```

---

## 11. CERTAIN vs INFERRED 结论对照

**CERTAIN（直接来自 Java 代码）**
- 新版签名头名称与值、签名原串的 6 行结构、算法 `HMAC-SHA256 + Base64(NO_WRAP)`（`AuthSigHelper` 完整 Java 实现）。
- 两套方案开关 `key_new_authentication_enable` 与时间戳单位（秒/毫秒）。
- 旧版 URL 参数格式 `&nonce_str=%s&sign=%s` 与待签参数数组（appid/nonce_str/package/system_time/user_id）。
- token 来源（vivo 账号 openid/vivoToken/authtoken）、openToken 校验接口、`copilot-api-auth-prd` 黑名单查询接口。
- 请求头 `appid/token/openid/imei/vaid` 的携带逻辑。
- 设备标识 VAID/OAID/UDID/GUID/AAID 的读取路径与硬编码 appId/appKey。

**INFERRED（需推断 / 无法从本拆包确认）**
- `libspeech_sec.so` 的 `generateSignature` 算法（推断 = HMAC-SHA256，因原串结构与 Java 参考实现完全一致）。
- `libspeech_sec.so` 的 `sign(String[], String, int)` 旧版签名算法（UNKNOWN）。
- `libvivosgmain.so`、`libvivo_account_wave.so` 内部实现（UNKNOWN）。
- 旧版 `nonce_str`+`sign` 与 `VivoSign` v2（`"2|" + hex(SHA-256(sorted))`）之间的等价性（仅风格同源，不能直接等同）。
