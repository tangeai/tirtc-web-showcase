# 客户端侧 TiRTC Token 使用说明

这份文件只讲一件事：当目标工程已经有自动取 token 代码后，联调时应该怎么配、怎么跑、怎么判断是否真的通了。

## 1. 最新确认结果

已经在 Linux 侧用仓库自带脚本实跑确认：

1. token 脚本本身可用。
2. 当前可用的 OpenAPI 地址是：`http://api-test-tirtc.tange365.com`
3. 当前测试用的 TiRTC service endpoint 是：`http://ep-test-tirtc.tange365.com`
4. 旧地址 `http://openapi-test.tange365.com` 现在返回的是 nginx `403 Forbidden`，不要再拿它做客户端侧联调。

也就是说，客户端侧现在必须明确区分两类地址：

1. `service_endpoint`
   给 TiRTC SDK 自己用，负责 `/v1/start`、`/v1/connect` 这一类服务入口。
2. `openapi_endpoint`
   给客户端自动取 token 用，负责 `/v1/user_token`、`/v1/token`。

这两个地址不是一回事，不能混填。

## 2. 客户端侧该怎么配

如果现在目标是“先调通”，建议客户端侧按下面这组值配置：

1. `service_endpoint = http://ep-test-tirtc.tange365.com`
2. `client_openapi_endpoint = http://api-test-tirtc.tange365.com`
3. `client_access_id = <你们当前测试 access_id>`
4. `client_secret_key = <你们当前测试 secret_key>`
5. `client_uid = uid1`
6. `client_peer_id = <当前目标设备 ID，例如 1801057CIF4I>`
7. `client_user_token_ttl = 36000`
8. `client_channel_token_ttl = 36000`
9. `client_auto_fetch_token = true`
10. `client_token = ""`

注意：

1. `client_uid` 不是目标设备 ID。
2. `client_uid` 表示“谁在申请 token”。
3. `client_peer_id` 才表示“这次要连哪台设备”。
4. 如果只是先跑通，`client_uid` 直接固定填 `uid1` 就行。
5. 自动取 token 开启时，`client_token` 保持空字符串，不要同时再塞一份旧 token。

## 3. 当前正确的取 token 流程

客户端侧运行时，流程应该是：

1. 用户发起 connect，目标设备是 `peer_id`。
2. 如果这次传了显式 token，则优先使用显式 token。
3. 如果没有显式 token，但本地已有缓存 token，则先尝试缓存。
4. 如果没有缓存，或者缓存过期，则在线请求 token。
5. 第一步请求 `POST /v1/user_token`。
   - URL 根地址：`client_openapi_endpoint`
   - 请求头：`Authorization: TGServer <access_id>:<signature>`
   - 请求头：`X-TG-Timestamp: <UTC 时间>`
   - body：`{"access_id":"...","uid":"uid1","ttl":36000}`
6. 从响应 JSON 里取 `data.user_token`。
7. 第二步请求 `POST /v1/token`。
   - URL 根地址：`client_openapi_endpoint`
   - 请求头：`Authorization: Bearer <user_token>`
   - body：`{"device_id":"<peer_id>","ttl":36000}`
8. 从响应 JSON 里取 `data.token`。
9. 把这个 `data.token` 原样传给 `TiRtcConnect(peer_id, token, ...)`。

这里最容易写错的地方只有两个：

1. `device_id` 必须等于这次 connect 的目标 `peer_id`。
2. `openapi_endpoint` 不能再填成旧的 `openapi-test.tange365.com`。

## 4. 客户端侧怎么判断已经调通

至少要看到下面这类日志链：

1. `Start fetching client token online: uid=uid1 peer_id=<目标设备>`
2. `POST /v1/user_token status=200`
3. `POST /v1/token status=200 peer_id=<目标设备>`
4. `Calling TiRtcConnect: peer_id=<目标设备> token_mode=online ...`

如果是缓存命中，可能看到的是：

1. `Calling TiRtcConnect: ... token_mode=cache`

如果是外部显式传 token，可能看到的是：

1. `Calling TiRtcConnect: ... token_mode=explicit`

## 5. 出问题时先看什么

### 5.1 `POST /v1/user_token status=403`

优先检查：

1. `client_openapi_endpoint` 有没有还填成 `http://openapi-test.tange365.com`
2. 当前 access_id / secret_key 是否对应这个环境
3. 是否被网关、白名单或权限拦截

如果返回体是 nginx HTML，而不是 JSON，那就先按“地址或权限问题”处理，不要先怀疑 JSON 解析。

### 5.2 `/v1/user_token` 成功，但 `/v1/token` 失败

优先检查：

1. `device_id` 是否真的传了当前 `peer_id`
2. 第二段请求头是不是 `Authorization: Bearer <user_token>`
3. `user_token` 是否取自第一段返回的 `data.user_token`

### 5.3 TiRTC 提示 `TIRTC_E_CACHE_EXPIRED`

这是正常场景，正确处理方式是：

1. 重新在线申请 token
2. 再次调用 `TiRtcConnect`

不要只拿一份旧 token 死循环重试。

## 6. Linux 侧可复现命令

如果客户端接入方怀疑“是不是服务端没给 token”，可以先在 Linux 侧复现这条命令：

```bash
cd <TiRTC tests 目录>
. ./sample-test.cfg
TIRTC_SERVER_API=http://api-test-tirtc.tange365.com \
./call-v1-token-via-user-token.sh "$ACCESS_ID" "$SECRET_KEY" uid1 1801057CIF4I 36000 36000
```

这条命令现在能直接返回 JSON，其中：

1. `data.user_token` 是第一段产物
2. `data.token` 是最终给 `TiRtcConnect` 用的 client token

## 7. 交给客户端接入方的最短结论

可以直接转发下面这段：

> 现在 token 脚本已经确认可用，问题不在算法本身。客户端侧要用的 OpenAPI 地址不是 openapi-test，而是 `http://api-test-tirtc.tange365.com`；TiRTC 的 service endpoint 继续用 `http://ep-test-tirtc.tange365.com`。`client_uid` 先固定填 `uid1`，`client_peer_id` 填目标设备 ID，开启 `client_auto_fetch_token`，把 `client_token` 留空。运行时先拿 `/v1/user_token` 的 `data.user_token`，再拿 `/v1/token` 的 `data.token`，最后把 `data.token` 原样传给 `TiRtcConnect(peer_id, token, ...)`。如果 `/v1/user_token` 还是 403，先查 openapi 地址、环境权限和白名单，不要先查 token 算法。
