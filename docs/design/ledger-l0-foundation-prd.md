# L0 — Ledger Foundation PRD

## 文档信息

- **状态：** Proposed design；待 Architecture Review
- **日期：** 2026-09-02
- **依赖：** [Docus Ledger v1 Product Requirements](ledger-v1-prd.md)
- **范围：** Ledger 的领域基础、SQLite schema 契约、API 契约、金额/时间协议、生命周期与测试门槛
- **实现约束：** L0 不写新 UI，不切换 Dashboard 数据源，不导入 mock 数据，不一次性重命名 Bills 文件

本文不是 Implementation Plan。它冻结“实现必须表达什么”；下一步再单独拆 Implementation Plan，决定 migration 文件、服务模块、路由文件、测试文件和提交顺序。

## 1. L0 目标

L0 完成后，后续开发不得再重新解释以下五个概念：

~~~text
Account
Transaction
Transfer
Category
Balance
~~~

具体需要冻结：

1. canonical domain name 与 Bills 兼容边界；
2. 金额的精度、币种和时间表示；
3. Account 的 natural balance 与资产/负债效果；
4. Transaction discriminated union 和字段约束；
5. opening balance、Adjustment、软删除和版本冲突；
6. SQLite 表、外键、索引和 migration 原则；
7. owner-authenticated API 的请求、响应和错误契约；
8. 从原始 records 推导余额和 Dashboard 的测试不变量。

## 2. 现状审计

### 2.1 已有可复用基础

- server/db.ts 已经按编号加载 server/migrations/*.sql，使用 SQLite WAL、foreign_keys=ON，并提供 in-memory/test DB 注入。
- docs/architecture/overview.md 和 docs/architecture/storage.md 已经确立“Markdown 文件 + SQLite metadata + vault Git”的双存储边界。
- 现有 API 由 Hono server 统一处理，owner session 是服务端的访问边界。
- e2e/ledger-workspace.spec.ts 已验证 Ledger 在共享 Docus App Shell 中运行，而不是另一个 Vault shell。

### 2.2 当前原型不能直接升级为生产模型

- [src/features/bills/mockData.ts](../../src/features/bills/mockData.ts) 的注释明确说明数据是 client-side fixtures、无 persistence；BillsTransactionType 只有 income | expense。
- BillsAccount.balance 和交易 amount 是 JS number；这不满足精确金额的 SQLite/API 契约。
- mock liability balance 以正数 debt 展示，当前聚合函数直接求和；代码没有信用卡消费/还款的自然余额效果。
- [src/views/BillsTransactionsView.vue](../../src/views/BillsTransactionsView.vue) 的新增、支出、收入、日期操作仍 disabled，并提示后续开放。
- 当前路由仍是 /bills 和 /bills/transactions，不存在 Ledger API、Ledger migration 或真实 CRUD。

因此 L0 不尝试“把 mock 类型加几个 union member”来冒充领域基础；mock 只作为 UI characterization fixture 保留。

## 3. L0 决策

### 3.1 命名与兼容策略

Ledger 是唯一 canonical product/domain name。新领域类型、服务、表和 API 使用 Ledger 前缀或 ledger_ 命名：

~~~text
LedgerAccount
LedgerTransaction
LedgerCategory
ledger_accounts
ledger_transactions
ledger_categories
/api/ledger/...
~~~

现有 BillsView.vue、BillsTransactionsView.vue、src/features/bills/、src/components/bills/、/bills 路由和已有测试属于 prototype compatibility surface。L0 不做大规模 rename，也不删除 /bills；后续 UI migration 必须单独定义：

- canonical 新路由为 /ledger、/ledger/transactions、/ledger/accounts、/ledger/categories；
- 旧 /bills 路径在迁移期 redirect 或 alias 到对应 Ledger 页面；
- 旧 Bills component 名称不再用于新业务逻辑，但在没有迁移完成前可以保留 characterization tests。

L0 不要求现在引入上述新路由；它只冻结未来不会继续扩张 /bills 命名的方向。

### 3.2 金额协议

所有持久化和 API 金额均为 integer minor units：

~~~text
CNY ¥38.50  →  amountMinor = 3850
USD $10.00  →  amountMinor = 1000
~~~

规则：

- amountMinor 在收入、支出和转账中必须是正整数；
- Adjustment 使用有符号 amountMinor 表示 delta；
- opening balance 和账户 projection 可以是有符号整数，以表示透支或信用余额；
- 服务端不能依赖 IEEE-754 浮点运算来决定余额或聚合；
- API 不同时发送一个可能产生歧义的 decimal amount；UI 格式化由 currency formatter 负责；
- 所有记录带有或可解析出同一 Ledger 的 currency，v1 禁止跨 currency 写入。

SQLite 金额列使用 INTEGER，并由服务端检查安全整数范围；超过运行时安全范围的金额返回 validation error，不发生隐式截断。

### 3.3 时间协议

- 服务端 createdAt、updatedAt、deletedAt、occurredAt 均使用 UTC milliseconds since epoch，与 server/db.ts 现有约定一致。
- LedgerSettings.timezone 是 IANA timezone。
- period 的“今天/本周/本月/今年”和本地日期分组都使用 Ledger timezone，不使用浏览器当前 timezone 作为隐式事实。
- openingDate 使用 Ledger timezone 下的 YYYY-MM-DD，表示该日开始时的 opening position。
- v1 不支持 scheduled/future records；occurredAt 不得晚于服务端当前时间（允许实现统一定义的小 clock-skew tolerance）。
- occurredAt 不能早于相关账户的 openingDate；Transfer 必须同时满足 from/to 两个账户的 opening date。

### 3.4 Account balance 采用 natural balance

为保留 UI 中“资产余额”和“负债金额”的直觉，同时正确处理信用卡，本 PRD 采用 natural balance：

| Account nature | 正数含义 | 普通 UI 显示 |
| --- | --- | --- |
| asset | 持有的资产 | ¥12,640 |
| liability | 欠下的债务 | ¥18,000 欠款 |

余额允许有符号 edge state：资产负数表示透支，负债负数表示信用余额。实现不得在数据库层静默 ABS()；展示层必须说明异常方向。

对一笔金额为 m 的记录，账户 delta 为：

| Transaction | asset account delta | liability account delta |
| --- | ---: | ---: |
| income | +m | -m |
| expense | -m | +m |
| transfer outgoing | -m | +m |
| transfer incoming | +m | -m |

这张表同时覆盖：

~~~text
银行 → 支付宝       asset -m, asset +m
银行 → 信用卡还款    asset -m, liability -m
信用卡消费           liability +m
信用卡退款           liability -m（income）
~~~

因此：

~~~text
currentBalance(account)
  = openingBalance
  + Σ active transaction delta

assets      = Σ balance where nature = asset
liabilities = Σ balance where nature = liability
netWorth    = assets - liabilities
~~~

账户余额、资产、负债和净资产都必须由这些规则推导。不能再引入一个可被表单直接修改的 current_balance source of truth。

### 3.5 Transaction discriminated union

领域层的最小结构如下；实际 TypeScript 可以采用 tagged union，但语义必须相同：

~~~ts
type LedgerTransaction =
  | {
      type: 'income' | 'expense'
      amountMinor: number       // > 0
      accountId: string
      categoryId: string
      occurredAt: number
      payee?: string
      note?: string
    }
  | {
      type: 'transfer'
      amountMinor: number       // > 0
      fromAccountId: string
      toAccountId: string
      occurredAt: number
      note?: string
    }
  | {
      type: 'adjustment'
      amountMinor: number       // signed delta, !== 0
      accountId: string
      adjustmentCalculatedBalanceMinor: number
      adjustmentTargetBalanceMinor: number
      occurredAt: number
      note?: string
    }
~~~

约束：

- transfer 的 from/to 不能相同；
- transfer 没有 category；
- income 必须引用 income category，expense 必须引用 expense category；
- adjustment 没有 category，且 target/calculated/delta 必须满足 delta = target - calculated；
- active transaction 只能引用 active account；历史记录可以继续引用 archived account；
- v1 每笔 income/expense 只有一个 account 和一个 category；
- 普通交易不能写入 archived account；
- 被软删除的交易不再产生余额 effect，也不出现在默认聚合中。

### 3.6 Opening balance 与 Adjustment

Opening balance 只在账户建立或无历史交易时可编辑。已产生交易后，用户通过“调整余额”输入 target balance：

~~~text
BEGIN IMMEDIATE
  calculated = deriveCurrentBalance(account)
  delta = target - calculated
  if delta != 0:
    insert adjustment(account, calculated, target, delta)
COMMIT
~~~

如果调用方带了 expectedCalculatedBalanceMinor，它必须与写事务内的 calculated 一致；否则返回 409 ledger-balance-conflict，不创建记录。若 target 等于 calculated，返回幂等 no-op，不创建零金额 adjustment。

Adjustment 不算 income/expense，也不改变分类统计；它在 Transactions 的“全部”列表中可解释地显示。

### 3.7 归档、软删除和版本

- Account 和 Category 有 archivedAt；archive 不删除历史、不改变余额、不从历史统计中移除。
- 有任何 transaction row（包括已软删除）引用的 Account/Category 不能物理删除。
- Transaction 只支持 soft delete，至少保留 deletedAt。
- 每个可更新实体有单调递增的 integer version；PATCH/DELETE 必须提交 expectedVersion。
- 版本不匹配返回 409 ledger-version-conflict 并返回当前实体的安全摘要，不能覆盖其他写入。
- 所有 Ledger 写入在 SQLite BEGIN IMMEDIATE 内完成；Adjustment 的 calculated read 和 insert 必须在同一事务内。
- 删除、编辑或 archive 后，客户端执行 authoritative refresh，不依赖可能过期的乐观余额补丁。

## 4. SQLite schema contract

以下是逻辑 schema。具体 migration 文件编号和 SQL 排版属于后续 Implementation Plan，但列语义、约束和关系是 L0 contract。ID 由服务端生成 opaque string，客户端不能指定或修改。

### 4.1 ledger_settings

单例表：

| 列 | 类型/约束 | 说明 |
| --- | --- | --- |
| singleton_id | INTEGER PK，必须为 1 | one Ledger per Docus instance |
| base_currency | TEXT NOT NULL | uppercase ISO 4217 code |
| timezone | TEXT NOT NULL | IANA timezone |
| version | INTEGER NOT NULL | optimistic concurrency |
| created_at / updated_at | INTEGER NOT NULL | UTC ms |

首次初始化必须幂等；不从 billsMockData 写入任何账户、交易或金额。

### 4.2 ledger_accounts

必须包含：

~~~text
id TEXT PRIMARY KEY
name TEXT NOT NULL
type TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'wallet', 'credit_card', 'loan', 'other'))
nature TEXT NOT NULL CHECK (nature IN ('asset', 'liability'))
opening_balance_minor INTEGER NOT NULL
opening_date TEXT NOT NULL
currency TEXT NOT NULL
note TEXT NOT NULL DEFAULT ''
archived_at INTEGER NULL
version INTEGER NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
~~~

契约：

- currency = ledger_settings.base_currency；
- type/nature 的已知组合由服务端校验，other 可选择 nature；
- name 必须非空并有统一长度上限；
- opening date 必须是严格有效的 Gregorian YYYY-MM-DD；
- 不设置 current_balance_minor、asset_total、debt_total 或其他统计快照列；
- 为交易查询提供按 archived_at、updated_at 的必要索引，实际索引名由 plan 固定。

### 4.3 ledger_categories

必须包含：

~~~text
id TEXT PRIMARY KEY
kind TEXT NOT NULL CHECK (kind IN ('income', 'expense'))
name TEXT NOT NULL
normalized_name TEXT NOT NULL
parent_id TEXT NULL REFERENCES ledger_categories(id) ON DELETE RESTRICT
archived_at INTEGER NULL
version INTEGER NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
UNIQUE(kind, normalized_name)
~~~

normalized_name 使用服务端和客户端共享的 trim() 后再调用 locale-independent toLowerCase() 的 identity contract；不做 NFKC，空字符串无效，不能依赖 SQLite locale。parent_id 必须指向同 kind 分类，且不能形成 cycle；v1 UI 可以暂不暴露 parent 编辑。

### 4.4 ledger_transactions

必须包含：

~~~text
id TEXT PRIMARY KEY
type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'adjustment'))
amount_minor INTEGER NOT NULL
account_id TEXT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT
from_account_id TEXT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT
to_account_id TEXT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT
category_id TEXT NULL REFERENCES ledger_categories(id) ON DELETE RESTRICT
occurred_at INTEGER NOT NULL
payee TEXT NOT NULL DEFAULT ''
note TEXT NOT NULL DEFAULT ''
adjustment_calculated_balance_minor INTEGER NULL
adjustment_target_balance_minor INTEGER NULL
deleted_at INTEGER NULL
version INTEGER NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
~~~

行级 invariant：

~~~text
income/expense:
  account_id != NULL
  from_account_id == NULL
  to_account_id == NULL
  category_id != NULL
  amount_minor > 0
  adjustment_* == NULL

transfer:
  account_id == NULL
  from_account_id != NULL
  to_account_id != NULL
  from_account_id != to_account_id
  category_id == NULL
  amount_minor > 0
  adjustment_* == NULL

adjustment:
  account_id != NULL
  from_account_id == NULL
  to_account_id == NULL
  category_id == NULL
  amount_minor != 0
  adjustment_calculated_balance_minor != NULL
  adjustment_target_balance_minor != NULL
  amount_minor = target - calculated
~~~

SQLite 能表达的约束应落在 schema；涉及另一张表的 category kind、currency、archived state、opening date 和未来时间由服务端在同一个 write transaction 中校验。

### 4.5 Foreign key 与物理删除

Ledger tables 使用 foreign_keys=ON。Account/Category 的 referenced delete 使用 RESTRICT，防止历史引用被级联清除。Transaction 的默认删除路径只写 deleted_at；物理 delete 不是用户 API。

### 4.6 默认分类 seed

默认分类是可管理的应用数据，不是不可变 SQL enum。首次 Ledger 初始化时以幂等 seed 创建 v1 默认分类；如果 owner 已存在同一 normalized identity，不重复插入、不覆盖显示名称。默认分类 archive 后不应在下一次启动被自动恢复。

## 5. API contract

所有 /api/ledger/* 路由继承现有 owner session middleware，使用 Cache-Control: no-store 处理敏感的财务响应。API 的金额字段统一使用 *Minor 整数，时间字段使用 UTC ms；响应使用 camelCase，SQL 保持 snake_case。

### 5.1 错误 envelope

Ledger 错误沿用 Docus 的顶层 JSON 约定：

~~~json
{
  "error": "Human-readable message",
  "code": "ledger-version-conflict",
  "details": {}
}
~~~

至少需要稳定错误码：

~~~text
ledger-validation-failed
ledger-not-found
ledger-duplicate-category
ledger-archived-account
ledger-archived-category
ledger-invalid-account-pair
ledger-currency-mismatch
ledger-opening-date-conflict
ledger-balance-conflict
ledger-version-conflict
ledger-account-has-history
ledger-category-has-history
ledger-settings-already-initialized
~~~

错误消息不能泄露 SQL、堆栈或数据库文件路径；字段级 validation details 可以返回安全的字段名和错误原因。

### 5.2 Settings

~~~text
GET  /api/ledger/settings
POST /api/ledger/settings       // 首次初始化；重复调用返回 409
PATCH /api/ledger/settings      // timezone 等可变配置，带 expectedVersion
~~~

baseCurrency 在已有账户/交易后不可切换；timezone 变更必须明确返回会影响 period projection 的提示语义。

### 5.3 Accounts

~~~text
GET    /api/ledger/accounts?includeArchived=false
POST   /api/ledger/accounts
GET    /api/ledger/accounts/:id
PATCH  /api/ledger/accounts/:id
DELETE /api/ledger/accounts/:id
POST   /api/ledger/accounts/:id/archive
POST   /api/ledger/accounts/:id/adjust
~~~

创建请求至少包含 name、type、nature、openingBalanceMinor、openingDate 和 currency。Account response 返回 currentBalanceMinor projection，但该字段只读且不得出现在 PATCH 可写字段中。

Adjustment request：

~~~json
{
  "targetBalanceMinor": 12600,
  "occurredAt": 1788300000000,
  "note": "与支付宝实际余额核对",
  "expectedCalculatedBalanceMinor": 12543
}
~~~

服务端在 BEGIN IMMEDIATE 中重算 calculated balance；成功响应同时返回 adjustment transaction 和调整后的 account projection。

### 5.4 Categories

~~~text
GET    /api/ledger/categories?kind=income|expense&includeArchived=false
POST   /api/ledger/categories
PATCH  /api/ledger/categories/:id
DELETE /api/ledger/categories/:id
POST   /api/ledger/categories/:id/archive
~~~

DELETE 只允许没有任何 transaction history 的分类；有历史时返回 ledger-category-has-history，调用方应使用 archive。修改 kind、normalized identity 或 parent 必须通过服务端规则检查并带 expectedVersion。

### 5.5 Transactions

~~~text
GET    /api/ledger/transactions
POST   /api/ledger/transactions
GET    /api/ledger/transactions/:id
PATCH  /api/ledger/transactions/:id
DELETE /api/ledger/transactions/:id
~~~

列表查询至少接受：

~~~text
type=all|income|expense|transfer
accountId
categoryId
from
to
search
includeDeleted=false
limit
cursor
~~~

adjustment 在 type=all 中返回；是否提供独立 adjustment filter 不属于 L0 必须 UI。默认列表只返回 active transactions。创建和编辑使用第 3.5 节 discriminated union；服务端忽略或拒绝与 type 不匹配的多余字段。

### 5.6 Overview / projections

~~~text
GET /api/ledger/overview?scope=today|week|month|year|all
GET /api/ledger/trend?months=6
GET /api/ledger/accounts/:id/transactions
~~~

Overview response 必须由 live accounts/categories/transactions 计算，至少包含：

~~~ts
LedgerOverview {
  currency: string
  assetTotalMinor: number
  liabilityTotalMinor: number
  netWorthMinor: number
  accounts: LedgerAccountSummary[]
  cashflow: { incomeMinor: number; expenseMinor: number; balanceMinor: number }
  categoryBreakdown: { income: LedgerCategorySlice[]; expense: LedgerCategorySlice[] }
  periods: LedgerPeriodSummary[]
  trend: LedgerTrendPoint[]
  recentTransactions: LedgerTransaction[]
}
~~~

Overview 是 read projection，不创建快照记录，也不能被客户端 POST 回写。

## 6. 写事务与并发边界

### 6.1 普通写入

Account、Category、Transaction 的 create/update/archive/delete 均在一个 SQLite write transaction 内完成：

~~~text
validate input
  → read current rows
  → check expectedVersion / lifecycle / cross-row rules
  → write mutation
  → increment version
  → return authoritative rows/projections
~~~

### 6.2 Adjustment

Adjustment 的 calculated balance read、delta calculation 和 transaction insert 不能拆成两个 HTTP 或两个 SQLite transaction。并发调整必须串行化；第二个 stale target 返回 409，而不是把两个目标余额盲目叠加。

### 6.3 编辑和删除

编辑交易可能改变账户、分类、日期和金额，因此必须在一个写事务内校验旧记录、重写整行并刷新所有受影响账户的 projection。软删除也必须提升 transaction version，使旧客户端无法再次覆盖。

### 6.4 客户端 refresh

Ledger mutation 成功后客户端以服务端响应或一次 authoritative GET 刷新受影响集合。L0 不允许通过“本地给余额加减一个估计值”作为唯一刷新路径；本地 optimistic UI 不能成为持久化事实。

## 7. Migration 与启动契约

- 新 Ledger migration 必须追加到当前 migration 序列，不能修改已发布 migration 文件。
- migration 只创建 Ledger schema、约束、索引和幂等默认分类基础；不从 billsMockData、截图或现有 Bills UI 数字回填财务记录。
- 空数据库、现有 Docus 数据库、重复启动和测试 in-memory DB 都必须得到同一 schema 结果。
- migration 失败不能部分留下“看似完成”的 Ledger schema；利用现有 migration runner 的 transaction 行为保证 schema_version 不提前推进。
- Ledger API 在 schema 不可用时 fail closed；不能回退到 mock 作为生产写入或 Dashboard 事实来源。
- 备份文档需要在 Ledger 实现完成时明确 data/docus.db、WAL/SHM 和 vault 的一起备份要求；L0 不新增第二个数据库。

## 8. L0 测试契约

L0 implementation plan 至少必须覆盖以下测试族：

### 8.1 Schema / migration

- migration 在空库和当前 schema 末端库上成功；
- schema_version、重复启动、foreign key、RESTRICT 和默认分类 seed 幂等；
- schema 中不存在 current balance 或 Dashboard snapshot source-of-truth 列；
- 金额、type discriminator 和 adjustment CHECK 约束拒绝非法行。

### 8.2 Domain / balance matrix

- asset income/expense；
- liability expense（信用卡消费）和 liability income（退款/credit）；
- asset → asset、asset → liability、liability → asset、liability → liability 的 transfer；
- transfer 不改净资产和收支统计；
- opening balance + records 的精确 minor-unit 计算；
- overdraft/credit edge state 不被 ABS() 或浮点舍入破坏；
- Adjustment target/calculated/delta 一致，零 delta no-op。

### 8.3 Lifecycle / concurrency

- account/category 无 history 可物理删除；有 history（包括 soft-deleted transaction）只能 archive；
- transaction soft delete 后不再影响余额和聚合，数据库行仍存在；
- stale expectedVersion 得到 409 且不覆盖新写入；
- 两个 SQLite 连接并发 Adjustment 只能有一个接受同一 stale target；
- 交易 edit 同时影响旧账户、新账户、旧分类和新分类时保持全局一致。

### 8.4 API / auth

- anonymous requests 被现有 owner session boundary 拒绝；
- account/category/type/currency/opening-date 交叉校验在服务端有效；
- response 使用 camelCase integer minor units，不返回 raw SQL/stack；
- overview 在插入、编辑、删除、转账、调整、重启后都从 live rows 得到正确结果。

### 8.5 Regression boundary

- 当前 Bills 原型 characterization tests 在 L0 不被无意破坏；
- e2e/ledger-workspace.spec.ts 的共享 App Shell、单 Navbar、主题和滚动边界继续通过；
- L0 不新增或改变生产 UI，因此不以 UI 截图通过作为 Foundation gate。

## 9. L0 Exit Gate

L0 只有在以下条目全部得到证据后才能进入 Implementation Plan review：

- [ ] Ledger v1 PRD 与本 L0 PRD 的金额、余额、Transfer、Adjustment 和生命周期语义无冲突。
- [ ] canonical Ledger / legacy Bills 兼容策略被接受。
- [ ] integer minor units、base currency、timezone 和 UTC timestamp 契约被接受。
- [ ] natural balance effect matrix 被接受，尤其是信用卡消费和还款。
- [ ] ledger_* schema contract、foreign keys、RESTRICT、soft delete 和 version contract 被接受。
- [ ] API route、request/response、error codes 和 owner auth 边界被接受。
- [ ] migration 不回填 mock、Overview 不保存统计快照、不写 Markdown 的边界被接受。
- [ ] 测试矩阵覆盖 transfer invariant、liability expense、Adjustment race 和 stale version。
- [ ] 仍未决定的事项不影响 L1–L4 的实现；否则必须回到 PRD 修订而不是在代码中隐式决定。

L0 完成后，下一份文档才是 Ledger Foundation Implementation Plan；在此之前不开始 Ledger 新 UI 或真实数据切换。
