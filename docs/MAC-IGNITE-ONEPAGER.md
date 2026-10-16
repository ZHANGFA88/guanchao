# Mac 点火一页纸（市况台）

三步，约 10 分钟。详细版见 `docs/IGNITE.md`，模型说明见 `docs/PROVIDERS.md`。
前置（先备齐，缺了看 `docs/IGNITE.md` 的「前置条件」）：**Docker Desktop 已安装并启动**（菜单栏鲸鱼图标稳定）、**Node.js LTS**、**git**。

## 1. 拿到代码

```bash
git clone https://github.com/ZHANGFA88/shikuang.git
cd shikuang
```

（已克隆过就在目录里 `git pull`。）

## 2. 填 Key（主力：千问 Qwen-Plus）

在阿里云百炼控制台开通并复制 API Key 后：

```bash
node scripts/init-env.ts        # 首次生成 .env
```

打开 `.env`，**只需填一行**（生成的 .env 已按主力千问预置好地址、模型与关思考参数）：

```bash
LLM_API_KEY=<你的百炼 Key>
```

顺手核对这三行是预置值、没被改动过：

```bash
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
LLM_EXTRA_JSON={"enable_thinking":false}
```

并确认 `COLLECT_ENABLED=true`、`MODEL_CALLS_ENABLED=true`。
备选（英文归纳明显不够时再换）：Gemini 2.5 Flash，见 `docs/PROVIDERS.md` 预设二。

## 3. 一条命令点火

```bash
bash scripts/ignite.sh
```

脚本会自检 Docker、校验 .env、拉起全栈并等健康检查通过，最后打印访问地址（http://localhost:3000）。

（可选）被墙信源（南华早报/巴伦）推送通道：按 `docs/SCRAPLING.md` 一次性装好 Scrapling 后，`bash scripts/setup-scrapling-cron.sh` 挂每 30 分钟推送。

## 4. 点火后回传截图（最终验收的一部分）

打开 http://localhost:3000 后截这 5 张发回：

1. 首页观测台全景（等蜘蛛爬一会儿，画面里有蜘蛛和星图）
2. 03 新闻流（河流图 + 汇入卡）
3. 04 热点观察（有热点时）
4. 精选流页面（等模型跑完一轮，约点火后 15 分钟）
5. 日报页（次日 08:00 出刊后，或有当期时）

首页「今天收录」数字、精选条数如果明显异常（0 或个位数），把点火脚本的输出也一起发回。
