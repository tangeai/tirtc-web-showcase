# TiRTC Web 功能展示站

这是一个 TiRTC Web 功能展示项目，包含 IPC 实时查看、扫码接入、呼叫、微信呼叫、AI 对讲、设备设置等入口，并通过服务端安全签发 token 完成设备连接与音视频播放验证。

## 功能范围

- 首页功能入口展示
- IPC 查看详情页
- 扫码、相册导入、手动输入设备 ID
- 服务端在线签发短时连接 token
- TiRTC Web SDK 初始化、连接、音视频输出挂载和订阅
- 连接阶段日志和媒体诊断信息展示
- 可选 Android 真机远程调试页，仅内部联调使用

## 技术栈

- Vue 3
- Vite
- TypeScript
- Node.js HTTP 服务
- Vercel Serverless Function

## 本地开发

安装依赖：

```powershell
npm install
```

复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

填写 `.env` 中的服务端凭证后启动：

```powershell
npm run dev
```

开发地址：

- 前端页面：http://localhost:5173
- Token API：http://localhost:8787/api/token/issue

## 生产运行

构建前端：

```powershell
npm run build
```

启动一体化服务：

```powershell
npm run serve
```

访问：

```text
http://localhost:8787/
```

生产模式下，`server/index.mjs` 会同时提供：

- `dist` 静态前端资源
- `/api/token/issue` token 签发接口
- `/api/health` 健康检查接口

## 环境变量

最小配置：

```env
PORT=8787
VITE_TIRTC_ENV=test
TIRTC_ACCESS_KEY_ID=your_access_key_id
TIRTC_SECRET_KEY_ID=your_secret_key_id
TIRTC_APP_ID=your_app_id
TIRTC_ENDPOINT=http://ep-test-tirtc.tange365.com
TIRTC_OPENAPI_ENDPOINT=http://api-test-tirtc.tange365.com
ENABLE_DEVICE_DEBUG=0
```

说明：

- `TIRTC_ACCESS_KEY_ID`、`TIRTC_SECRET_KEY_ID`、`TIRTC_APP_ID` 只应配置在服务端环境变量中，不要写入前端代码。
- `TIRTC_OPENAPI_ENDPOINT` 为空时，服务端会优先从 `TIRTC_ENDPOINT` 推导 OpenAPI 地址，最后回落到测试 OpenAPI 默认值。
- `VITE_TIRTC_ENV` 控制前端 TiRTC SDK 环境，支持 `test`、`pre`、`production`。
- `ENABLE_DEVICE_DEBUG=0` 时，`/device-remote.html` 和 `/api/device/*` 不对外开放。

## Token 签发流程

前端只调用相对路径：

```text
POST /api/token/issue
```

服务端执行两段式 OpenAPI 流程：

```text
/v1/user_token -> /v1/token
```

返回给前端：

```json
{
  "appId": "...",
  "remoteId": "...",
  "source": "openapi",
  "token": "..."
}
```

## 静态站发布说明

这个项目的页面可以作为静态前端发布，但完整连接能力不能只依赖纯静态文件。原因是 token 签发必须在服务端完成，不能把密钥暴露给浏览器。

推荐发布方式：

1. 前端由静态托管平台发布 `dist`
2. `/api/token/issue` 由同域 Serverless Function 或后端服务提供
3. 用户访问公开 HTTPS 域名

当前仓库已包含 Vercel 配置：

- `vercel.json`
- `api/token-issue.mjs`

Vercel 环境变量至少需要配置：

```env
VITE_TIRTC_ENV=test
TIRTC_ACCESS_KEY_ID=...
TIRTC_SECRET_KEY_ID=...
TIRTC_APP_ID=...
TIRTC_ENDPOINT=http://ep-test-tirtc.tange365.com
TIRTC_OPENAPI_ENDPOINT=http://api-test-tirtc.tange365.com
ENABLE_DEVICE_DEBUG=0
```

## 关键文件

- `src/App.vue`：应用入口页面
- `src/composables/useMonitorWorkspace.ts`：业务状态和连接流程
- `src/services/token-api.ts`：前端 token API 封装
- `src/services/tirtc-client.ts`：TiRTC Web SDK 播放封装
- `server/index.mjs`：本地一体化 Node 服务
- `server/token/`：服务端 OpenAPI token 签发模块
- `api/token-issue.mjs`：Vercel Serverless Function
- `public/device-remote.html`：可选真机远程调试页

## 发布前检查

```powershell
npm run build
```

上线前确认：

- `.env` 没有提交到仓库
- 服务端凭证只配置在部署平台环境变量里
- 生产环境使用 HTTPS
- `ENABLE_DEVICE_DEBUG=0`
- `/api/token/issue` 能正常返回 token
