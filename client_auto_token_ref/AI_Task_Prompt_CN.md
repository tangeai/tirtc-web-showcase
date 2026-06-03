你现在要在目标工程里完成 TiRTC 客户端自动取 token 适配。不要修改 `client_auto_token_ref/` 里的参考文件，它们只用于阅读和移植逻辑。你的目标不是重写 RTC 模块，而是在当前已经比较完整的状态机基础上，把“静态 client token”升级成“客户端自己在线获取 token 后再 TiRtcConnect”。

请先阅读这些文件：

1. `client_auto_token_ref/07_client_auto_token.c`
2. `client_auto_token_ref/Client_AutoToken_Adaptation_CN.md`
3. `main/intercom_rtc.h`
4. `main/intercom_rtc_auth.h`
5. `main/intercom_rtc_auth.c`
6. `main/intercom_rtc.c`
7. `main/Kconfig.projbuild`
8. `main/CMakeLists.txt`

这些资料的使用方式如下：

1. 先读 main 下的现有代码，再读参考资料。
   原因：你要改的是目标工程，不是 4_19 示例工程。现有 `main/intercom_rtc.c`、`main/intercom_rtc_auth.c`、`main/intercom_rtc.h` 才是真实接入点和真实状态机。
2. `07_client_auto_token.c` 只当“token 协议逻辑参考”，不要当可直接拷贝进目标工程的成品文件。
   你要从它里面提取的是：
   - TGServer 签名算法
   - `/v1/user_token` 请求结构
   - `/v1/token` 请求结构
   - `user_token -> client token -> TiRtcConnect` 的调用时序
   不要照搬它的仓库内依赖、日志风格、示例 main 函数结构。
3. `Client_AutoToken_Adaptation_CN.md` 只当“接入边界和拆分建议说明”。
   你要从这份文档里拿的是：
   - 该加哪些配置项
   - 该新增哪些模块
   - token 逻辑应该挂到哪些连接入口
   - 哪些现有媒体/状态机逻辑不应该被你顺手改掉
4. 当“参考资料”和“目标工程现状”发生冲突时，按下面优先级处理：
   - 对接入位置、函数命名、状态机收口：以当前 `main/` 代码为准
   - 对 token 签名算法、请求字段、两段式流程：以 `07_client_auto_token.c` 和 tests 脚本逻辑为准
   - 对模块边界和改造范围：以 `Client_AutoToken_Adaptation_CN.md` 为准
5. 你的工作方式应该是“翻译协议逻辑并嵌入当前工程”，不是“把参考资料整包复制进来”。
   也就是说：
   - 复制思路，不复制工程结构
   - 复制算法，不复制 4_19 内部依赖
   - 优先复用目标工程已有的 HTTP、JSON、日志、状态机
6. 不要修改 `tirtc4_19_esp32s3_bundle/client_auto_token_ref/` 里的参考文件。
   它们的用途只是：
   - 给你看协议原理
   - 给你看接入边界
   - 给你看这次任务的约束条件
7. 实际动手顺序建议固定为：
   - 先补 `intercom_rtc_config_t` 和 `Kconfig`
   - 再新增独立 token 模块
   - 再把 token 获取收口到 `intercom_rtc_ensure_client_token()`
   - 最后再接到 `intercom_rtc_do_connect()` 和缓存过期重连路径

当前这版代码的真实状态是：

1. intercom_rtc.c 已经有完整的 worker queue、角色切换、网络联动、连接生命周期、远端订阅重试、远端 JPEG 解码显示、本地音视频上行回调，不要为做 token 适配去重写这些逻辑。
2. intercom_rtc.c 已经有时间有效性和 SNTP 等待逻辑，函数是 intercom_rtc_has_valid_wall_clock() 和 intercom_rtc_sync_wall_clock()，token 请求里的 UTC 时间戳优先复用现有能力，不要再造第二套时间同步逻辑。
3. intercom_rtc_auth.c 目前仍然只会从 Kconfig 读取静态 service_endpoint、device_license、client_peer_id、client_token，没有任何在线取 token 逻辑。
4. intercom_rtc.h 的 intercom_rtc_config_t 还没有 openapi/access/secret/uid/ttl/auto_fetch_token 这些字段。
5. intercom_rtc.c 的 intercom_rtc_do_connect() 里，如果没有显式 client_token，会直接报 RTC TOKEN MISSING。
6. intercom_rtc.c 现在只支持“显式 token”或“SDK 缓存 token”两条路径，不支持在线取 token。
7. intercom_rtc.h 声明了 intercom_rtc_connect_with_auth()，但当前 intercom_rtc.c 没有对应实现。你需要让声明和实现保持一致。优先做法是把它真正实现成“显式 token 覆盖路径”。

你要完成的改动范围只限于目标工程。为了避免把配置加载和在线鉴权混在一个文件里，优先采用“新增独立 token 模块”的做法：

1. main/intercom_rtc.h
2. main/intercom_rtc_auth.h
3. main/intercom_rtc_auth.c
4. main/intercom_rtc.c
5. main/Kconfig.projbuild
6. main/CMakeLists.txt
7. main/intercom_rtc_token.h
8. main/intercom_rtc_token.c

实现要求：

1. 在 intercom_rtc_config_t 中增加：client_openapi_endpoint、client_access_id、client_secret_key、client_uid、client_user_token_ttl、client_channel_token_ttl、client_auto_fetch_token。
   - `client_uid` 不是目标设备 uuid。
   - 当前参考示例统一使用 `uid1`，如果只是先跑通，请先用 `client_uid = "uid1"`。
   - `client_uid` 表示“谁在申请 token”；`peer_id/device_id` 才表示“要连接哪台设备”。
2. 在 Kconfig.projbuild 中增加对应配置项。
3. 不要把在线取 token 逻辑继续堆进 intercom_rtc_auth_load_config() 所在文件。优先新增独立模块：
   - main/intercom_rtc_token.h
   - main/intercom_rtc_token.c
4. 在新模块中提供统一接口，例如：
   - intercom_rtc_token_fetch_client(config, peer_id, out_token, out_token_size)
5. intercom_rtc_auth.c 继续只负责加载配置，避免把 Kconfig 读取、HTTP 请求、签名算法、JSON 解析搅在一起。
6. 用 esp_http_client + cJSON + mbedtls 实现两段式流程：
   - POST /v1/user_token
   - POST /v1/token
7. POST /v1/user_token 的签名算法必须严格按参考示例实现：
   - StringToSign = METHOD + "\n" + path + "\n" + query + "\n" + timestamp + "\n" + sha256(body)
   - query 当前为空串
   - signature = Base64URL(HMAC-SHA256(secret_key, StringToSign))
   - header 形如 Authorization: TGServer <access_id>:<signature>
   - 还要带 X-TG-Timestamp
8. POST /v1/token 必须使用 Authorization: Bearer <user_token>。
9. device_id 必须使用当前连接目标 peer_id，TiRtcConnect(peer_id, token, ...) 里的 peer_id 也必须是同一个目标设备 ID。
10. 在 intercom_rtc.c 中新增类似 intercom_rtc_ensure_client_token(peer_id, force_refresh) 的收口函数，不要把 token 请求逻辑散到多个事件分支里。
11. intercom_rtc.c 只负责判断“何时需要 token”以及“何时重试”，不要在里面实现 TGServer 签名、HTTP 组包、JSON 解析。
12. 把自动取 token 路径接到 intercom_rtc_do_connect()、intercom_rtc_handle_connect_request()、intercom_rtc_handle_connect_result() 这些真实连接入口上。
13. 首次连接时，如果没有显式 token 且启用了 auto fetch，则先在线申请 token，再调用 TiRtcConnect()。
14. 命中 TIRTC_E_CACHE_EXPIRED 时，如果启用了 auto fetch，则重新在线申请 token，再重连；不要只做“拿已有静态 token 重试”。
15. 当目标 peer_id 变化且没有显式新 token 时，清空旧 client_token，避免误用旧设备 token。
16. 保留显式 token 覆盖路径。也就是说，最终既支持 intercom_rtc_connect_with_auth(peer_id, token)，也支持只传 peer_id 后自动在线取 token；显式 token 的优先级更高。
17. 不要因为本次 token 适配去改当前媒体状态机、订阅重试、远端 JPEG 解码显示、本地音视频回调、UI 状态流转，除非这些逻辑与你的 token 改动直接冲突。
18. 当前 main/CMakeLists.txt 已经有 esp_http_client、json、mbedtls；如果 OpenAPI 使用 HTTPS，再按需补 esp_crt_bundle，否则不要引入无关依赖。

额外约束：

1. 当前 intercom_rtc.c 的本地音频默认发 16K16B1C，本地视频默认发 JPEG；这些不是这次 token 任务的重点，不要顺手改动。
2. 当前远端视频只支持 JPEG，遇到 H264 会走 unsupported 日志；这也不是这次 token 任务的重点。
3. 当前客户端订阅逻辑已经有 remote stream probe/retry 机制，不要把它改回写死单一 stream 号。

联调约定：

1. 如果当前客户端对接 Linux tests/device.c，至少保证能继续请求到 JPEG/音频那组远端流，不要把现有订阅探测机制破坏掉。
2. 不要把 stream0 当成 JPEG；当前参考契约里 stream0 是 H264，stream1 才是 JPEG。
3. 如果你需要在日志里证明 token 流程已经工作，请分别打印：
   - /v1/user_token 的 HTTP 状态和摘要结果
   - /v1/token 的 HTTP 状态和摘要结果
   - 最终使用的 peer_id
   - 本次是 explicit token、online token，还是 cache token

实现完成后，请输出：

1. 修改了哪些文件
2. 自动取 token 的调用链
3. TIRTC_E_CACHE_EXPIRED 的处理方式
4. intercom_rtc_connect_with_auth() 最终是如何实现或收口的
5. 为什么把 token 协议逻辑放在独立模块而不是 intercom_rtc_auth.c
6. 还需要我人工补什么配置项