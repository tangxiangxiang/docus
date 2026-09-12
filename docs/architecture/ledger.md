# Ledger Architecture

> [!IMPORTANT]
> 本文是 Ledger 当前运行时架构的技术 authority，依据 shared contracts、server implementation、SQLite migrations 和 tests 编写。历史 PRD 记录设计来源，但不能覆盖当前 runtime facts。

## 1. Module Map

- shared/ledgerProtocol.ts：浏览器与服务端共用的 DTO、请求类型、枚举和内置图标目录。
- server/ledger/：validation 负责边界解析，repository 负责 SQLite，service 负责写入与生命周期，balance 负责自然余额，projections 负责读模型，routes/ 暴露 HTTP API，idempotency 与 writeTransaction 负责可靠写入。
- src/features/ledger/：API client、store、金额/时间适配、错误和新建恢复。
- src/components/ledger/：初始化、账户、交易表单、交易详情、图标和选择器渲染。
- src/views/LedgerView.vue、LedgerTransactionsView.vue、LedgerAccountsView.vue、LedgerAccountDetailView.vue：四个页面级入口。
- server/migrations/0013_* 至 0023_*：Ledger SQLite schema 演进。

## 2. Domain Model

核心实体是 LedgerSettings、LedgerAccount、LedgerCategory 和 LedgerTransaction。

~~~text
Account nature:  asset | liability
Category kind:   income | expense
Transaction:     income | expense | transfer | adjustment
Transfer kind:   general | repayment | withdrawal
Fee mode:        extra | deducted
System key:      interest | fee
~~~

金额在跨运行时协议和数据库中都使用安全整数 minor units；显示层根据 currency exponent 转换为小数金额。Account 保存期初余额和期初日期，current balance 由有效交易投影得到。Category 的身份是 kind 加 trim/lowercase 后的 normalized name。

Transfer 的 amountMinor 只表示本金或提现请求金额，不包含 feeMinor。feeMinor 是可选的附加 Expense 金额；它在写入时由 transfer kind 决定系统分类。

## 3. Natural Balance Model

server/ledger/balance.ts 的 transactionEffectForAccount 是唯一余额效果 authority。不能用“转出账户减、转入账户加”概括所有账户：

- 资产：收入和转入增加自然余额；支出和转出减少自然余额。
- 负债：支出和转出增加债务自然余额；收入和转入减少债务自然余额。

因此资产 → 负债的 repayment 会同时得到资产减少和负债减少。还款本金不会进入 Expense；若有利息，利息 Expense 另行作用于转出资产账户。删除的交易效果为零，调整记录的 amountMinor 必须等于目标余额减计算余额。

## 4. Transfer Semantics

服务端 assertTransferKindAccounts 是最终校验，前端只负责根据子类型收窄选择项：

- general：允许合法的账户组合，表示普通资金移动。
- repayment：只允许 asset → liability。
- withdrawal：只允许 asset → asset。

账户必须不同、属于同一基础货币且处于可用状态。普通 transfer 不产生收支；服务器拒绝 general 携带 fee。repayment 不接受 feeMode，withdrawal 的 feeMode 默认是 extra。

## 5. Composite Transactions

还款和提现在账务层是多条 atomic rows，在产品层是一次操作。存在附加金额时，服务端在同一个写事务中创建 parent Transfer 和 companion Expense，并用同一个 groupId 绑定：

~~~text
repayment  = transfer(principal) + optional expense(interest)
withdrawal = transfer(received/requested amount) + optional expense(fee)
~~~

利息、手续费从不直接加进 transfer.amountMinor。group 的编辑会校验并同步更新 companion row；group 的删除会把仍有效的相关 rows 一起 soft-delete。

## 6. Interest / Fee

系统分类是 expense kind 的受保护 Category：

- systemKey interest 对应“利息”，由 repayment 的 feeMinor 使用。
- systemKey fee 对应“手续费”，由 withdrawal 的 feeMinor 使用。

服务端通过 systemKey 查找，而不是通过可变的中文名称查找。系统分类不能重命名、改 kind、归档或删除；普通分类仍按 kind 加 normalized name 保持唯一。

## 7. feeMode

提现的 feeMode 只影响 transfer row 的金额与两个账户的效果：

| 模式 | transfer.amountMinor | 转出资产 | 转入资产 | Expense |
| --- | ---: | ---: | ---: | ---: |
| extra | 请求金额 | 请求金额 + 手续费 | 请求金额 | 手续费 |
| deducted | 请求金额 - 手续费 | 请求金额 | 请求金额 - 手续费 | 手续费 |

deducted 必须保证扣费后 transfer 金额仍为正数。读取时 bundle.totalMinor 为 transfer.amountMinor 加 chargeMinor：extra 下表示实际总扣款，deducted 下还原为请求金额。

## 8. Read Projection / Bundle

LedgerTransferBundleSummary 提供 chargeMinor 和 totalMinor，只属于读取投影，不改变原子交易的 amountMinor。交易表格和详情可以把 parent Transfer 渲染成一行完整业务；账户余额仍逐行通过 balance engine 计算。对 repayment，目标负债只受本金 Transfer 影响；对 withdrawal，目标资产只受 transfer 金额影响。

Overview 投影提供当前资产、负债、净资产、收支、账户、分类切片、四个固定期间、趋势和最近交易。固定期间按 Ledger 时区计算，过去日期可以作为 anchor；趋势是 anchor 所在月份及其前 11 个连续日历月。current snapshot 与期间收支是不同语义，系统没有把历史期间伪装成历史资产负债表快照。

## 9. Companion Expense Visibility

普通全局 transaction query 隐藏带 groupId 的 Expense companion row，因此用户不会看到两行互相脱离的利息或手续费。显式按 groupId 查询时仍可取回完整 group，includeDeleted 可用于内部一致性检查。

行可见性不等于聚合可见性：cashflow、category breakdown、账户余额和账户 movement 都会统计 companion Expense。全局分页的 total 隐藏 companion row，但 expenseMinor 仍包含真实支出。

## 10. Transaction Query & Pagination

transaction query 支持 type、accountId、categoryId、groupId、from、to、search、includeDeleted、limit、cursor 和 offset。cursor 是按 occurredAt、createdAt、id 排序的 keyset cursor；offset 供页码式读取使用，两者不能同时提供。服务端默认 limit 为 50，最大为 200。

交易记录页当前使用服务端 offset 分页，UI 页大小为 5、25、50、100。repository 会多取一行判断 nextCursor；默认只返回未删除且非 companion Expense 的普通列表。

## 11. Lifecycle

- Settings 首次创建时同时生成默认 Category；第一个账户创建后 hasCreatedAccount 单调变为 true，base currency 和 timezone 锁定。
- Account 创建校验 type/nature 配对和 currency；有历史后 type、nature、opening balance、opening date 不可改。无历史账户可物理删除；归档要求自然余额为 0，之后可以 restore。
- Category 可创建、改名、换图标、归档、恢复或在无历史时物理删除；系统分类不允许改名、归档、删除。当前设置 UI 暴露创建、改名、换图标和归档等操作。
- Income、Expense、Transfer 可创建和 PATCH；Adjustment 只能通过 account adjust endpoint 产生。Transaction 删除是 terminal soft delete；带 groupId 的操作按 group 原子删除。
- PATCH、archive、restore、delete 使用 expectedVersion 做乐观并发控制。

## 12. Idempotency / Recovery

POST settings、accounts、categories 和 transactions 通过 operation scope、规范化请求指纹和 Idempotency-Key 保护。客户端把新建 intent 暂存于当前标签页 sessionStorage；结果不明确时进入 UNCERTAIN，必须用原 intent 和原 key 重试或确认，不能直接创建第二笔相同操作。服务端事务边界保证 parent 与 companion 一起提交或回滚。

## 13. Routes

页面 canonical routes 是 /ledger、/ledger/transactions、/ledger/accounts 和 /ledger/accounts/:id。旧 /bills、/bills/transactions 只在 router 层重定向到相应 Ledger 页面。

API 以 /api/ledger 为前缀，包含 settings、accounts、categories、transactions、overview 和 trend；账户还提供 /:id/transactions、/:id/adjust、archive 和 restore。Ledger route 统一使用 no-store，并继承服务端 owner-auth 边界。

## 14. Schema Evolution

当前仓库 Ledger schema version 为 23，迁移顺序如下：

~~~text
0013_ledger_foundation
0014_ledger_account_icon
0015_ledger_account_icon_preferences
0016_ledger_account_card_number
0017_seed_demo_card_numbers
0018_ledger_category_icon
0019_ledger_transaction_location
0020_ledger_transfer_kind
0021_ledger_transaction_groups
0022_ledger_system_categories
0023_ledger_system_category_icons
~~~

后续 schema 变更必须新增迁移，不应回写已执行文件；领域字段仍需同步 shared protocol、repository、service、projection 和测试。

## 15. Core Invariants

- 所有金额计算使用 minor units 和 checked safe-integer arithmetic。
- records 是 source of truth，余额与概览数字是可重建 projections。
- Transfer principal 不属于 income 或 expense；repayment principal 不会污染支出。
- interest 和 fee 是 Expense，且分别绑定受保护 system category。
- companion Expense 不作为普通独立 UI 行出现，但必须参与财务聚合。
- composite group 的写入、修改和删除保持原子性。
- 服务端拥有账户性质、transfer kind、货币、时间和生命周期校验。
- Entity mutation 遵循 expectedVersion；create 遵循幂等重放。

## 16. Known Boundaries

- 共享 Transfer request 和表单仍带 payee 字段，但 repository 对 transfer 按 schema invariant 写入空 payee；当前文档不把 Transfer 交易对象描述为已持久化能力。
- Category API 有 restore endpoint，但当前 SettingsLedgerCategoriesSection 未提供可见的分类恢复入口；本用户指南只描述已确认的归档操作。
- /bills 是已确认的兼容路径，不是当前 Ledger product surface。

## 17. Tests

服务端 Ledger 测试覆盖 migration/API/auth/concurrency，以及 balance.test.ts、validation.test.ts、service.test.ts、projections.test.ts、idempotency.test.ts、time.test.ts 和 money.test.ts。客户端测试覆盖 API、store/recovery、时间与金额、初始化、Dashboard/period navigation、transaction sheet、transactions view、accounts view 和 account detail；相关测试位于 src/**/__tests__/ 和 src/views/__tests__/。

