# 猜字解底联机版

一个基于 Flask + Flask-SocketIO 的多人联机文字推理小游戏。

玩家在同一房间内进行多回合对局：

- 每人会拿到一个隐藏字
- 每人提交两个提示字
- 所有人根据提示猜他人的隐藏字，并额外猜中心字
- 按规则累计积分，支持再来一局

项目入口：

- 服务端入口：[app.py](app.py)
- 前端页面：[templates/index.html](templates/index.html)
- 前端逻辑：[static/js/main.js](static/js/main.js)

## 功能特性

- 实时房间系统（创建、加入、退出）
- 房主机制与准备机制
- 四阶段流程：大厅、出题、猜测、结算
- 回合积分累计，结算页按分数排名并展示获胜者
- 刷新自动重连：稳定 client_id，中途断线/刷新可恢复房间、隐藏字、已提交的提示与猜测
- 旁观者模式：游戏进行中可经确认以旁观者身份加入，不分配隐藏字/不出题，可猜测，单独计分排名
- 中途退出保留数据：玩家退出后其隐藏字/提示字/已提交猜测保留至本局结束，其他人仍可猜他的字、他的猜测仍参与计分
- 提交状态实时显示（准备 / 已提交 / 已离开）
- 米字格展示汉字，毛笔字体（Ma Shan Zheng）本地内置
- 房间号使用成语词库生成
- 单页面前端交互，Socket.IO 实时同步状态
- 前端资源全部本地化，不依赖外部 CDN

## 游戏流程

1. 输入昵称进入大厅
2. 创建房间或输入房间名加入
3. 大厅阶段所有玩家准备，房主可开始游戏
4. 出题阶段每位玩家提交两个提示字
5. 猜测阶段猜他人隐藏字并猜中心字
6. 结算阶段展示答案与分数、获胜者，房主可再来一局
7. 任意阶段可点"退出"离开房间：其隐藏字/提示字/已提交猜测保留至本局结束，不影响其他人继续
8. 游戏进行中加入的新玩家会询问是否以旁观者身份加入（旁观者可猜测，单独排名）

## 本地开发启动

### 环境要求

- Python 3.10+
- pip

### 安装依赖

python -m pip install -r requirements.txt

如果你还没有 requirements 文件对应依赖，也可直接安装：

python -m pip install flask flask-socketio

### 启动项目

python app.py

默认访问地址：

- [http://127.0.0.1:5000](http://127.0.0.1:5000)

## 环境变量

可通过 .env 或系统环境变量配置：

- SECRET_KEY：Flask 密钥，生产环境必须替换
- PORT：服务监听端口，默认 5000
- FLASK_DEBUG：是否开启调试模式，默认 false

示例参考：[.env.example](.env.example)

## 生产部署

已经提供完整生产部署资源：

- 详细文档：[DEPLOY.md](DEPLOY.md)
- Docker 文件：[Dockerfile](Dockerfile)
- Compose 文件：[docker-compose.yml](docker-compose.yml)
- Gunicorn 配置：[gunicorn.conf.py](gunicorn.conf.py)
- systemd 模板：[deploy/caizijiedi.service](deploy/caizijiedi.service)
- Nginx 模板：[deploy/nginx.conf](deploy/nginx.conf)

## 项目结构

- [app.py](app.py)：Flask 路由与 Socket.IO 事件入口
- [room.py](room.py)：房间状态机与计分逻辑（按 client_id 记玩家、断线/退出保留数据、重连恢复、旁观者）
- [templates/index.html](templates/index.html)：主页面模板
- [static/js/main.js](static/js/main.js)：前端事件与渲染逻辑（含重连、状态恢复、旁观者视图）
- [static/js/socket.io.min.js](static/js/socket.io.min.js)：Socket.IO 客户端（本地内置）
- [static/css/style.css](static/css/style.css)：页面样式
- [static/fonts/ma-shan-zheng.woff2](static/fonts/ma-shan-zheng.woff2)：毛笔字体（本地内置）
- [words.json](words.json)：中心字与隐藏字词库
- [idioms.json](idioms.json)：房间名成语词库
- [process_hsk.py](process_hsk.py)：词库处理脚本

## 注意事项

- 当前房间状态保存在进程内存中，单实例部署最简单
- 重连机制依赖进程内存中的玩家状态，单实例下生效；多实例需引入共享存储（如 Redis）
- 前端依赖（Socket.IO 客户端、字体）已本地化，无需联网拉取外部 CDN
- 若需要水平扩容，多实例场景建议引入 Redis 消息队列和会话粘性
- 生产环境不要直接暴露 Flask 开发服务器，建议使用 Gunicorn + Nginx

## License

如需开源发布，请补充 License 文件并在此处声明。
