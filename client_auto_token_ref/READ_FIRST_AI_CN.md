# TiRTC 客户端自动取 Token 资料入口

如果你只看一个文件，请先看：

1. `WIN_Token_Usage_CN.md`
2. `AI_Task_Prompt_CN.md`

原因：

1. `WIN_Token_Usage_CN.md` 已经把最新实测可用的地址、配置项、调用顺序、日志判定方式整理成了一页纸，适合先按它联调。
2. `AI_Task_Prompt_CN.md` 再用来补实现边界、改动范围和约束条件。
3. 你可以直接按这两份文件执行，不需要自己再从多个文档里重新摘要求。

如果你准备真正开始改代码，建议按下面顺序看：

1. `WIN_Token_Usage_CN.md`
   先看当前确认可用的地址和配置方式。
2. `AI_Task_Prompt_CN.md`
   再看总要求、改哪些文件、不该改哪些东西。
3. `07_client_auto_token.c`
   只看 token 协议逻辑：
   - TGServer 签名算法
   - `/v1/user_token` 请求结构
   - `/v1/token` 请求结构
   - `user_token -> client token -> TiRtcConnect` 的时序
4. `Client_AutoToken_Adaptation_CN.md`
   只看接入边界：
   - 为什么建议拆独立 token 模块
   - token 逻辑该挂到哪里
   - 当前实跑脚本返回了什么
   - 成功时应该依赖哪些 JSON 字段

这批资料的正确用法是：

1. 先读目标工程 `main/` 下的真实代码，再用这些资料补 token 逻辑。
2. 不要把参考文件原样拷进工程。
3. 要复制的是协议逻辑和接入思路，不是 4_19 示例工程的结构。

你真正要改的是目标工程这些文件：

1. `main/intercom_rtc.h`
2. `main/intercom_rtc_auth.h`
3. `main/intercom_rtc_auth.c`
4. `main/intercom_rtc.c`
5. `main/Kconfig.projbuild`
6. `main/CMakeLists.txt`
7. `main/intercom_rtc_token.h`
8. `main/intercom_rtc_token.c`

任务目标只有一个：

1. 不重写现有 RTC 状态机。
2. 在目标工程里补上“客户端自动在线获取 token，再 TiRtcConnect”的能力。

额外提醒：

1. 最新实测可用的 OpenAPI 地址是 `http://api-test-tirtc.tange365.com`，旧的 `http://openapi-test.tange365.com` 当前返回 nginx `403 Forbidden` HTML。
2. 所以客户端侧要先把地址配对，再看 token 流程，不要继续拿旧地址做联调。
3. 客户端代码不要假设 token 一定是 JWT，也不要依赖固定长度或可本地解码。
4. 成功时只需要从 JSON 里取：
   - `data.user_token`
   - `data.token`
   然后原样传给 `TiRtcConnect(peer_id, token, ...)`
5. `client_uid` 不等于目标设备 uuid。
   - 当前参考值直接用 `uid1`
   - `client_uid` 表示发起 token 申请的客户端/用户标识
   - `peer_id/device_id` 才是目标设备 ID，例如 `1801057CIF4I`

如果你改完代码，请输出：

1. 改了哪些文件
2. token 获取调用链
3. `TIRTC_E_CACHE_EXPIRED` 怎么处理
4. `intercom_rtc_connect_with_auth()` 怎么实现
5. 还需要人工补哪些配置