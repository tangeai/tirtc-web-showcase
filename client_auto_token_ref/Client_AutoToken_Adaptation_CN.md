# 客户端自动取 Token 适配说明

这份说明是给目标工程用的，不是 SDK 基线文档。目标只有一个：把当前“手工填写 client token”的路径改成“客户端自己在线获取 token 后再 TiRtcConnect”。

参考源码：

1. [07_client_auto_token.c](07_client_auto_token.c)

目标工程通常需要修改的文件：

1. `main/intercom_rtc.h`
2. `main/intercom_rtc_auth.h`
3. `main/intercom_rtc_auth.c`
4. `main/intercom_rtc.c`
5. `main/Kconfig.projbuild`
6. `main/CMakeLists.txt`

## 1. 当前代码状态

当前这版代码状态是：

1. `intercom_rtc_auth.c` 只负责从 Kconfig 读取 `service_endpoint`、`device_license`、`client_peer_id`、`client_token`，没有任何在线取 token 逻辑。
2. `intercom_rtc_auth.h` 只有 `intercom_rtc_auth_load_config()` 声明，没有 `fetch_client_token()` 接口。
3. `intercom_rtc.h` 的 `intercom_rtc_config_t` 还没有 `openapi_endpoint`、`access_id`、`secret_key`、`uid`、`ttl`、`client_auto_fetch_token` 这些字段。
4. `intercom_rtc.c` 的 `intercom_rtc_do_connect()` 里，如果 `client_token` 为空会直接报 `RTC TOKEN MISSING`。
5. `intercom_rtc.c` 当前只在 `TIRTC_E_CACHE_EXPIRED` 时尝试“用已有显式 token 重试”，不会自动重新在线申请 token。
6. `Kconfig.projbuild` 当前没有自动取 token 相关配置项。
7. `intercom_rtc.c` 已经有较完整的 worker queue、角色切换、网络联动、订阅重试、远端 JPEG 解码显示、本地音视频上行回调，不需要为接 token 重写这些结构。
8. `intercom_rtc.c` 已经有 `intercom_rtc_has_valid_wall_clock()` / `intercom_rtc_sync_wall_clock()` 这套时间有效性与 SNTP 等待逻辑，token 签名用到的 UTC 时间戳建议直接复用。
9. `intercom_rtc.h` 声明了 `intercom_rtc_connect_with_auth()`，但当前 `intercom_rtc.c` 没有对应实现；适配时应让声明与实现保持一致，推荐补成“显式 token 覆盖路径”。

结论：如果当前工程符合上述状态，它仍然是“静态 token 模式”，还没有接入真实取 token 流程。

## 2. 参考示例与目标工程的关系

[07_client_auto_token.c](07_client_auto_token.c) 是已经在 4_19 里编译验证过的参考实现，但它不是直接塞进目标工程就能编译的 drop-in 文件。

原因是它依赖的是 4_19 仓库内部组件：

1. `platforms.h`
2. `httpclt.h`
3. `my_base64.h`
4. `crypto_wrapper.h`
5. `tgJSON.h`

目标工程真正要复用的是这份参考代码里的协议逻辑和时序，而不是头文件/函数名原样照抄。

另外要强调一点：

1. 这次适配的目标是把 token 获取逻辑接进当前现有状态机。
2. 不是把现有 `intercom_rtc.c` 的网络/连接/媒体/UI 逻辑整体推倒重写。

## 3. 必须照搬的协议逻辑

需要照搬的不是整份源码，而是下面这几个核心函数的逻辑：

1. `demo_build_tgserver_authorization()`
   负责按脚本规则生成 `Authorization: TGServer access_id:signature`。
2. `demo_request_user_token()`
   请求 `POST /v1/user_token`，提取 `data.user_token`。
3. `demo_request_channel_token()`
   请求 `POST /v1/token`，提取 `data.token`。
4. `demo_fetch_client_token()`
   串起两段式流程。
5. `main()` 里的连接策略
   首轮显式 token 连接，后续优先走缓存；缓存过期时重新在线拉 token。

其中最关键的一点是：

1. `device_id` 必须传当前目标 `peer_id`
2. `TiRtcConnect(peer_id, token, ...)` 里的 `peer_id` 也必须是同一个目标设备 ID

### 3.1 当前脚本实跑示例

为了确认“服务器返回的 token 到底是什么样”，本次直接用仓库现有脚本和测试配置做了实跑。

执行环境：

1. 路径：`<TiRTC tests 目录>`
2. 配置来源：`test.cfg_`
3. OpenAPI 地址：`http://openapi-test.tange365.com`
4. 参数：`uid1`、`device_id=1801057CIF4I`、`user_ttl=36000`、`channel_ttl=36000`

实跑命令：

```bash
cd <TiRTC tests 目录>
source ./test.cfg_
export TIRTC_SERVER_API=http://openapi-test.tange365.com

./call-v1-user-token.sh "$ACCESS_ID" "$SECRET_KEY" uid1 36000
./call-v1-token-via-user-token.sh "$ACCESS_ID" "$SECRET_KEY" uid1 1801057CIF4I 36000 36000
```

本次实际返回结果：

```text
POST /v1/user_token -> HTTP/1.1 403 Forbidden

<html>
<head><title>403 Forbidden</title></head>
<body>
<center><h1>403 Forbidden</h1></center>
<hr><center>nginx</center>
</body>
</html>
```

第二段脚本之所以继续失败，不是 `/v1/token` 的 body 结构不对，而是第一段 `/v1/user_token` 没返回 JSON，导致脚本里这句解析直接报错：

```python
d["data"]["user_token"]
```

所以这次实跑能确认两件事：

1. 当前这个 Linux 环境到 `openapi-test.tange365.com` 的 token 接口访问，被网关直接拦成了 `403 Forbidden`。
2. 当前没有拿到真实的 `user_token` 或 `client token` 文本样本，因此不能在这台机器上进一步判断 token 是不是某种固定格式。

对目标工程适配来说，这个结论反而很重要：

1. 当前不要把问题归因到“脚本 JSON 解析写错了”。
2. 先区分“HTTP 已成功返回 JSON”还是“网关直接返回 HTML/403”。
3. 如果响应不是 JSON，就应该按“接口访问失败”处理，而不是按“token 内容格式异常”处理。

成功时客户端代码真正应该依赖的字段只有这两个：

1. `/v1/user_token` 响应里的 `data.user_token`
2. `/v1/token` 响应里的 `data.token`

也就是说，客户端代码不要假设 token 一定：

1. 是 JWT
2. 可以按 `.` 分段
3. 可以被本地解码
4. 具有固定长度

最稳妥的处理方式是：

1. 只把它当成服务端返回的透明字符串
2. 从 JSON 里取出后原样保存
3. 再原样传给 `TiRtcConnect(peer_id, token, ...)`

如果后面你要在“服务端已放行”的网络环境里再次实跑，建议仍然先跑上面这两条命令。

你真正要观察的不是 token 内部结构，而是：

1. `/v1/user_token` 是否返回 JSON
2. `data.user_token` 是否存在且为字符串
3. `/v1/token` 是否返回 JSON
4. `data.token` 是否存在且为字符串
5. `device_id` 是否确实对应当前连接目标 `peer_id`

## 4. 目标工程建议改法

### 4.1 扩展配置结构

在 `main/intercom_rtc.h` 里扩展 `intercom_rtc_config_t`，增加至少这些字段：

1. `client_openapi_endpoint`
2. `client_access_id`
3. `client_secret_key`
4. `client_uid`
5. `client_user_token_ttl`
6. `client_channel_token_ttl`
7. `client_auto_fetch_token`

同时补对应的长度宏。

`client_uid` 的语义要单独说清楚：

1. 它不是目标设备的 uuid。
2. 它对应的是“发起这次 token 申请的客户端/用户标识”。
3. 当前仓库 tests 和示例里一直用的是 `uid1`，所以如果只是先跑通，推荐直接先用：`client_uid = "uid1"`。
4. 真正量产时，`client_uid` 更适合填你业务里的用户 ID、客户端实例 ID、账号 ID，或者你自己定义的稳定唯一标识。
5. `peer_id/device_id` 才是目标设备 ID，例如 `1801057CIF4I`。

最简单的理解方式是：

1. `client_uid` = 谁在申请 token
2. `peer_id/device_id` = 这次 token 要去连谁

### 4.2 扩展 Kconfig

在 `main/Kconfig.projbuild` 新增：

1. `INTERCOM_TIRTC_CLIENT_AUTO_FETCH_TOKEN`
2. `INTERCOM_TIRTC_OPENAPI_ENDPOINT`
3. `INTERCOM_TIRTC_CLIENT_ACCESS_ID`
4. `INTERCOM_TIRTC_CLIENT_SECRET_KEY`
5. `INTERCOM_TIRTC_CLIENT_UID`
6. `INTERCOM_TIRTC_CLIENT_USER_TOKEN_TTL`
7. `INTERCOM_TIRTC_CLIENT_CHANNEL_TOKEN_TTL`

### 4.3 建议拆出独立 token 模块

如果只是为了“先跑通”，把在线取 token 逻辑继续塞进 `intercom_rtc_auth.c` 也能做。

但从当前代码结构看，更推荐把这段逻辑单独摘出来。

原因很简单：

1. `intercom_rtc_auth_load_config()` 本质上是配置加载，不是 HTTP/OpenAPI 逻辑。
2. 在线取 token 包含签名、时间戳、HTTP 请求、JSON 解析、错误映射，复杂度明显高于“读 Kconfig”。
3. 如果把配置加载和在线鉴权混在一个文件里，后面会很难继续维护。
4. `intercom_rtc.c` 已经足够大了，token 协议层最好再单独隔一层。

推荐拆法：

1. `main/intercom_rtc_auth.c`
   只保留配置读取，例如 `intercom_rtc_auth_load_config()`。
2. 新增 `main/intercom_rtc_token.h`
3. 新增 `main/intercom_rtc_token.c`
   专门处理 `/v1/user_token`、`/v1/token`、签名、Base64URL、JSON 解析。

推荐接口：

```c
esp_err_t intercom_rtc_token_fetch_client(const intercom_rtc_config_t *config,
                                          const char *device_id,
                                          char *out_token,
                                          size_t out_token_size);
```

如果你不想新增模块，次优方案才是：

1. 在 `main/intercom_rtc_auth.h` 新增在线取 token 接口
2. 在 `main/intercom_rtc_auth.c` 中继续实现这段逻辑

但这只是“少改文件”的折中方案，不是最清晰的结构。

如果按推荐拆法实现，在 `main/intercom_rtc_token.c` 中用当前工程自己的组件实现下面逻辑：

```c
esp_err_t intercom_rtc_token_fetch_client(const intercom_rtc_config_t *config,
                                          const char *device_id,
                                          char *out_token,
                                          size_t out_token_size);
```

在 `main/intercom_rtc_token.c` 中用当前工程自己的组件实现下面逻辑：

1. 用 `esp_http_client` 发 `POST /v1/user_token`
2. 用 `mbedtls` 算 SHA256 和 HMAC-SHA256
3. 用 `mbedtls/base64.h` 做 Base64URL
4. 用 `cJSON` 解析响应 JSON
5. 配置结构仍然由 `intercom_rtc_auth_load_config()` 负责填充
6. 如需生成 UTC 时间戳，优先复用 `intercom_rtc.c` 已有的时间有效性与 SNTP 思路，避免应用内出现两套独立时间判断策略

说明：

1. 当前 `main/CMakeLists.txt` 已经有 `esp_http_client`、`json`、`mbedtls`
2. 如果 OpenAPI 用的是 HTTPS，建议补 `esp_crt_bundle`
3. 如果 OpenAPI 固定是 HTTP，可以先不加 `esp_crt_bundle`

### 4.4 在 connect 路径接入自动取 token

在 `main/intercom_rtc.c` 里新增类似：

1. `intercom_rtc_ensure_client_token(peer_id, force_refresh)`

并接到：

1. `intercom_rtc_do_connect()`
2. `intercom_rtc_handle_connect_result()`
3. `intercom_rtc_handle_connect_request()`

最少要满足下面三条：

1. 首次连接时，如果没有显式 token 且启用了 auto fetch，则先在线取 token
2. 目标 `peer_id` 变了且没有显式新 token，则清掉旧 token，避免误用旧设备 token
3. 收到 `TIRTC_E_CACHE_EXPIRED` 后，如果启用了 auto fetch，则重新在线拉 token 再重连

并且要注意：

1. 不要把 token 请求逻辑散落到多个事件分支里，最好统一收口到单独 helper。
2. 不要破坏现有 worker queue、connect result 事件流、网络变化后的 start/stop 流程。
3. `intercom_rtc.c` 只应知道“什么时候需要 token”，不应知道 `/v1/user_token` 的签名细节。

### 4.5 保留显式 token 覆盖路径

当前 `intercom_rtc.h` 已声明 `intercom_rtc_connect_with_auth(peer_id, token)`，适配后应提供真实实现，而不是只留声明。

也就是说目标工程最终应该同时支持两条路径：

1. 手工传入 token
2. 自动在线取 token

显式传入 token 的优先级应高于自动取 token。

## 5. 订阅流约定

如果当前客户端对接的是 Linux `tests/device.c` 这套流契约，则客户端连接成功后建议至少：

1. `TiRtcSubscribeVideo(hconn, 1)`
2. `TiRtcSubscribeAudio(hconn, 2)`

原因是当前参考契约里：

1. `stream0 = H264 主视频`
2. `stream1 = JPEG 子视频`
3. `stream2 = 主音频`
4. `stream3 = 对讲音频`

如果客户端侧暂时不支持 H264，下行视频不要再把 `stream0` 当成 JPEG。

## 6. 最小验收标准

适配完成后，至少要满足：

1. `client_token` 为空时，客户端能够自动在线取 token 后再发起连接
2. `TiRtcConnect(peer_id, NULL, ...)` 命中缓存时仍然能工作
3. 缓存过期后能自动重新在线拉 token
4. 手工 `intercom_rtc_connect_with_auth(peer_id, token)` 路径仍然可用
5. 切换 `peer_id` 时不会复用旧 token
6. 现有远端订阅重试、远端 JPEG 显示、本地音视频上行路径没有被这次 token 适配回归破坏

## 7. 一句话结论

客户端侧真正要做的不是“把参考文件编进工程”，而是：

1. 把 [07_client_auto_token.c](07_client_auto_token.c) 里的 token 协议逻辑翻成当前工程风格
2. 最好把它单独收进 `intercom_rtc_token.*`，再由 `intercom_rtc.c` 调用
3. 补齐 `Kconfig` 和配置结构

做到这三步，客户端就从“静态 token 占位”升级成“真实自动取 token”。