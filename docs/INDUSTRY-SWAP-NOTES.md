# 行业换装说明（市况台）

本 fork 由 AIHOT 的 AI 行业示范包换装为「政策与市场」行业包（site/ 与 industry/ 的改动清单见提交历史）。换装后的验证状态：

- `npm run typecheck`：全过（主包、后端、api、worker、web、tests）。
- 站点实跑验证：api / worker / web 三进程启动，信源种子（7 条）入库，外部推送通道（push-finsight）灌入成功，首页与分类渲染正常。
- 测试套件：除下列 7 个用例外全过。失败的全部是 topics 家族用例（tests/topics.test.ts、tests/topics-withdrawal.test.ts、tests/topic-cache-deadline.test.ts），原因是它们的固定样本写死了示范行业的主题与公司（anthropic / openai / meta / kimi / cursor / agent / model-releases），新行业包里没有这些 slug——属于 AGENTS.md 所说「改了 taxonomy 后要把测试例子换成新行业对应项」的待办，需要按新行业的公司/主题逐条改写样本（含 Meta/Metadata 这类同名异指的语义样本，不能机械替换）。站点的主题页功能本身已在实跑中验证可用。
