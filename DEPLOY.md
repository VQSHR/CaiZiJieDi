# 生产部署指南

本文给出两种部署方式：
- 方式 A：Docker Compose（推荐，最快）
- 方式 B：Ubuntu + systemd + Nginx（传统方式）

## 通用准备

1. 复制环境变量文件：

   cp .env.example .env

2. 修改 .env 中的 SECRET_KEY，务必使用高强度随机字符串。

## 方式 A：Docker Compose

### 1. 启动

docker compose up -d --build

### 2. 查看日志

docker compose logs -f

### 3. 访问

默认访问地址：
- http://127.0.0.1:5000

### 4. 停止

docker compose down

## 方式 B：Ubuntu + systemd + Nginx

### 1. 安装依赖

sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx

### 2. 部署代码

将项目放到：/srv/CaiZiJieDi

### 3. 安装 Python 依赖

cd /srv/CaiZiJieDi
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt

### 4. 配置环境变量

cp .env.example .env

编辑 .env，设置 SECRET_KEY。

### 5. 配置 systemd

将 deploy/caizijiedi.service 复制到：
/etc/systemd/system/caizijiedi.service

然后执行：
sudo systemctl daemon-reload
sudo systemctl enable --now caizijiedi
sudo systemctl status caizijiedi

### 6. 配置 Nginx

将 deploy/nginx.conf 复制到：
/etc/nginx/sites-available/caizijiedi

启用站点：
sudo ln -s /etc/nginx/sites-available/caizijiedi /etc/nginx/sites-enabled/caizijiedi
sudo nginx -t
sudo systemctl reload nginx

### 7. 配置 HTTPS（可选但推荐）

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example.com

## 多实例扩展说明

当前房间状态使用进程内内存（rooms 字典）。
如果未来要水平扩容为多实例，需要引入 Redis 消息队列并启用会话粘性策略。
