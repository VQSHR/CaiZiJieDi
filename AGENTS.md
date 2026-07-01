# 部署方案

项目已配置好 Docker + Gunicorn + gevent-websocket 生产环境。

## 方案 A：Render（免费，推荐先试）

1. 注册 [render.com](https://render.com)，关联 GitHub 仓库
2. New Web Service → 选择 `VQSHR/CaiZiJieDi`
3. Runtime: **Docker**，Port: **8000**
4. Environment Variable: `SECRET_KEY` = 随机长字符串
5. 点 Deploy

> 免费版 15 分钟无人访问会休眠，唤醒约需 30 秒。

## 方案 B：轻量 VPS（$4-6/月，更稳定）

在 DigitalOcean / Vultr 开一台 Ubuntu 最低配：

```bash
git clone https://github.com/VQSHR/CaiZiJieDi.git && cd CaiZiJieDi
cp .env.example .env
# 编辑 .env，修改 SECRET_KEY
docker compose up -d --build
```

访问 `http://<VPS_IP>:5000`，也可按 `DEPLOY.md` 配 Nginx + HTTPS。

## 方案 C：ngrok 临时联机（无需部署）

```bash
ngrok http 5000
```

开着 `python app.py`，把 ngrok 生成的临时地址发给朋友即可。
