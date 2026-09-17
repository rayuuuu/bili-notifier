# 贡献指南

感谢你愿意参与改进这个项目。下面是本地调试、代码约定与提交前的验证方式。

## 本地开发

项目零依赖、零构建，**不需要 npm install，也没有打包步骤**，改完代码直接刷新扩展即可。

1. 克隆仓库后，在 `chrome://extensions` 打开开发者模式
2. 点击 **加载已解压的扩展程序**，选择项目根目录
3. 修改代码后，回到 `chrome://extensions` 点击该扩展卡片上的刷新按钮
4. 点击卡片上的 **Service Worker** 链接可打开后台控制台，查看日志与错误

调试入口速查：

| 想调试什么 | 打开方式 |
|---|---|
| 后台轮询、通知、消息路由 | 扩展卡片上的 **Service Worker** 控制台 |
| 弹窗界面 | 在弹窗上右键，选择检查 |
| 设置页 | 在设置页右键，选择检查 |
| 本地数据 | 任一控制台执行 `await chrome.storage.local.get(null)` |
| 定时器状态 | `await chrome.alarms.getAll()` |


## 代码约定

- **保持零依赖**：不引入 npm 包、打包器或 TypeScript，需要的算法（如 MD5）自带实现。
- **ES Module**：所有脚本使用 `import` 与 `export`，后台在 `manifest.json` 中声明为 `type: module`。
- **2 空格缩进**，语句结尾带分号，字符串优先用单引号。
- **不使用 innerHTML**：界面元素一律通过 `document.createElement` 构建，杜绝注入风险。
- **接口字段一律用可选链**：B 站返回结构随时可能变动，解析失败的条目直接跳过而不是抛异常。
- **注释用中文**，只在解释「为什么」时添加，不复述代码本身。
- **权限最小化**：新增功能若需要新权限，请在 PR 描述中说明理由。


## 分层约定

- `lib/` 只放纯逻辑与浏览器 API 封装，不直接操作界面。
- `background/` 负责编排（轮询、通知、消息路由），不处理底层协议细节。
- `popup/` 与 `options/` 只通过 `chrome.runtime.sendMessage` 取数据，不直接调用 B 站接口。
- 新增消息类型时，同步更新 `lib/constants.js` 中的 `MESSAGE_TYPES` 与 `background/service-worker.js` 的路由。


## 提交 Issue

反馈问题时请尽量附上：

- 浏览器与版本（如 Chrome 131）
- 扩展版本（见 `manifest.json` 中的 `version`）
- 复现步骤，以及 Service Worker 控制台里的报错信息
- 如果与具体 UP 主相关，请提供其 UID

## 提交 Pull Request

1. 从 `main` 切出功能分支，一个 PR 只做一件事
2. 提交信息建议使用 `feat:`、`fix:`、`docs:`、`refactor:` 前缀
3. 提交前按下方验证清单自测，并在 PR 描述中说明测过哪些场景
4. 涉及界面改动时，附上截图会很有帮助


## 验证清单

### 纯函数自检

在 `chrome://extensions` 点击本扩展的 **Service Worker** 打开控制台，逐条粘贴执行：

```js
// 1. MD5 标准向量
const { md5, selfTest } = await import('/lib/md5.js');
selfTest();                  // -> { ok: true, failures: [] }
md5('');                     // -> 'd41d8cd98f00b204e9800998ecf8427e'
md5('abc');                  // -> '900150983cd24fb0d6963f7d28e17f72'

// 2. WBI mixin_key
const { getMixinKey, signWbi } = await import('/lib/wbi.js');
getMixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45');
// -> 'ea1db124af3c7062474693fa704f4ff8'

// 3. WBI 签名
signWbi({ foo: '114', bar: '514', zab: 1919810 }, 'ea1db124af3c7062474693fa704f4ff8', 1702204169);
// -> 'bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4'

// 4. 真实接口
const { fetchSpaceDynamics, fetchNavInfo } = await import('/lib/bili-api.js');
await fetchNavInfo();
(await fetchSpaceDynamics('2')).length;

// 5. 动态解析
const { parseDynamicList } = await import('/lib/dynamic-parser.js');
parseDynamicList(await fetchSpaceDynamics('2'), { uid: '2' });
```


### 端到端场景

| 场景 | 预期结果 |
|---|---|
| 首次添加订阅 | 回填昵称与头像，建立已读基线，不弹任何通知，徽章为空 |
| 新动态后点「立即检查」 | 弹出桌面通知（标题含昵称与类型），徽章加一，弹窗顶部出现未读高亮条目 |
| 点击桌面通知 | 新标签页打开正确链接，该条转为已读，徽章减一 |
| 点击弹窗条目 | 同上，并关闭弹窗 |
| 点击「全部已读」 | 所有条目取消高亮，徽章清空 |
| 轮询间隔改为 1 分钟 | 控制台 `await chrome.alarms.getAll()` 显示 `periodInMinutes: 1` |
| 删除订阅 | 该 UP 主从列表消失，其动态条目被清理，徽章相应减少 |
| 输入非法或不存在的 UID | 设置页红字提示「UID 无效或用户不存在」，不写入订阅列表 |
| 输入 `https://space.bilibili.com/2/dynamic` | 正确解析出 `2` |
| 重复添加同一 UID | 提示「已订阅该 UP 主」，列表不产生重复项 |
| 未登录 B 站 | 自动取匿名 `buvid3`，仍能拉到公开动态，设置页显示「匿名模式」 |
| 中途退出 B 站登录 | Cookie 变化触发规则刷新，下一轮自动降级为匿名模式，不报错崩溃 |
| 接口返回 `-352` 或 HTTP 412 | 进入指数退避，自动轮询被跳过，设置页显示风控告警条 |
| 断网 | 控制台记录错误，无通知、界面不崩溃，恢复网络后下一轮正常 |
| UP 主置顶了一条旧动态 | 置顶项被过滤，不产生通知 |
| 一轮出现 10 条新动态 | 最多 3 条独立通知加 1 条「还有 7 条新动态」汇总，弹窗列表完整显示 10 条 |
| 未知动态类型 | 类型标签显示「动态」，链接回退到 `t.bilibili.com/{id_str}`，不抛异常 |
| 动态条目超过 200 条 | 自动裁剪最旧条目 |
| Service Worker 被终止后定时器触发 | 后台重新拉起，从存储恢复状态并完成本轮轮询 |
