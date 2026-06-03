# 服务器部署步骤（示例）

## 方式一：直接 Node 运行

1. 把项目上传到服务器
2. 准备 `.env`
3. 安装依赖并构建：

```bash
npm ci
npm run build
```

4. 启动服务：

```bash
npm run serve
```

建议配合 PM2：

```bash
npm install -g pm2
pm2 start server/index.mjs --name tirtc-web
pm2 save
```

## 方式二：Docker 运行

```bash
docker build -t tirtc-web:latest .
docker run -d \
  --name tirtc-web \
  --restart unless-stopped \
  --env-file .env \
  -p 8787:8787 \
  tirtc-web:latest
```

## 反向代理

使用 `deploy/nginx.conf.example` 把域名流量代理到 `127.0.0.1:8787`。

## HTTPS

推荐使用 Certbot 给 Nginx 配证书，最终用户访问：

```text
https://your-domain/
```

## 调试入口

生产环境建议：

```env
ENABLE_DEVICE_DEBUG=0
```

这样 `/device-remote.html` 和 `/api/device/*` 默认拒绝访问。
