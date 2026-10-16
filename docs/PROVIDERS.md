# 模型接口预设（GPT / Gemini / 千问 / DeepSeek 任选）

本站的筛选、打分、写作、归组全部走**一个 OpenAI 兼容接口**，配置只在 `.env` 里：

```bash
LLM_BASE_URL=<接口地址>
LLM_API_KEY=<你的 Key>
LLM_MODEL=<模型名>
LLM_EXTRA_JSON=<服务商特有参数，没有就填 {}>
COLLECT_ENABLED=true
MODEL_CALLS_ENABLED=true   # 这两个开关不设为 true，不采集、不调用模型
```

换服务商 = 改上面四行后重启（Docker：`docker compose up -d`；直跑：重启 api/worker 两个进程）。不需要改任何代码。每一步（预筛/评分/写作/归组/翻译）想用不同模型时，在 `site/models.ts` 里单独指定，不改也行——默认全用 `.env` 这一个。

## 预设一：OpenAI（GPT）

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_EXTRA_JSON={}
```

量大或想要更强判断时把模型换成 `gpt-5` 系列同名替换即可。

## 预设二：Google（Gemini，OpenAI 兼容端点）

```bash
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=gemini-2.5-flash
LLM_EXTRA_JSON={}
```

Key 在 Google AI Studio 申请（与 Gemini API 同一个 Key）。

## 预设三：千问（阿里云百炼，兼容模式）

```bash
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
LLM_EXTRA_JSON={"enable_thinking":false}
```

也可以用框架示例的 `qwen3.8-flash`。关思考是为了省输出额度；用推理模型时另设 `LLM_REASONING_TOKENS=4000`。

## 预设四：DeepSeek（框架默认）

```bash
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-flash
LLM_EXTRA_JSON={"thinking":{"type":"disabled"}}
```

## 向量（可选，不填也能跑）

事件归组默认用文字重合度找候选。想更准时再配一个 OpenAI 兼容的 embeddings 接口：

```bash
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_API_KEY=<Key>
EMBEDDING_MODEL=text-embedding-3-small
```

不配的影响：只作热度证据的讨论帖大多挂不到事件上，热点榜热度会偏低；精选与日报不受影响。

## 部署速记（Mac）

```bash
git clone https://github.com/ZHANGFA88/shikuang.git
cd shikuang
node scripts/init-env.ts --llm-key <你的模型 API Key>   # 生成 .env（含管理员密码与随机密钥）
# 若不用 DeepSeek：按上面预设改 .env 的 LLM_BASE_URL / LLM_MODEL / LLM_EXTRA_JSON
docker compose up -d --build
```

打开 http://localhost:3000 ，后台在 `/admin`（密码在 `.env` 的 `ADMIN_PASSWORD`）。

财经快讯推送（fusion-office 在本机运行时）：

```bash
node scripts/push-finsight.mjs --serve http://127.0.0.1:8772
```

把 fusion-office 的东财+新浪快讯与 AISafetyHot 日报推入内容池，可挂到 cron/launchd 每 15 分钟跑一次。
