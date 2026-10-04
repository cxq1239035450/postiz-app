# 登录页设计与验收记录

设计源：`login-concept.png`（1505 × 1045），经用户纠正平台范围后使用的版本。
实际页面：`login-desktop.png`、`login-mobile.png`。由 Codex 内置浏览器截取，桌面按设计原尺寸 1505 × 1045 验证，手机按 390 × 844 验证并保存完整页面。三个文件均已通过 `view_image` 直接对照检查。

## 设计系统与实现

- 左侧浅紫色 `#f3f0ff`，右侧纯白色 `#ffffff`，正文 `#14142b`，主按钮 `#6c46ed`。
- 桌面等宽双栏，开放式表单，无额外外框；手机隐藏装饰侧栏，保留品牌和完整表单。
- 中文无衬线字体优先使用 Noto Sans SC / 微软雅黑；标题 38px，主视觉标题最大 61px，输入框 18px，按钮 18–20px，边角 10px。
- 分离的品牌区、表单区、Google/微信按钮模块和共用按钮基础组件。所有表单、文本和交互均为真实 HTML。
- 发布插画是独立生成的位图；不包含微博和微信发布图标，只包含 Instagram、Facebook、TikTok、YouTube。

## 视觉对照

| 核对项 | 设计要求与最终结果 | 修正 |
|---|---|---|
| 文案 | 标题、介绍、Google/微信登录、邮箱/密码、忘记密码、创建账号、条款与隐私保持一致 | 首屏无新增宣传标签或数据，浏览器 AX 文案核对通过 |
| 布局 | 等宽双栏；右侧表单宽 460px，桌面与原图同尺寸对照 | 调整表单垂直位置和横向对齐 |
| 字体 | 明确标题、正文、按钮、标签与输入文字层级 | 增大标签与输入框字号，中文字体前置以避免衬线回退 |
| 颜色 | 纯白表单与浅紫背景；紫色主按钮 | 移除导致插画变脏的正片叠底，保留轻柔边缘融合 |
| 素材 | 四个正确的发布平台；登录区保留微信 | 用户指出的微博/微信发布图标已移除；独立重制发布插画 |
| 间距与遮挡 | 介绍文字和插画不重叠遮挡，按钮间距与表单留白清楚 | 调整插画大小与文字层级，去掉截图中的开发浮标 |
| 响应式 | 手机表单不横向溢出，所有控件可访问 | 390px 视口核对，长页面允许正常纵向滚动 |

保留的实现差异：品牌使用项目既有矢量 QPublish Logo，未采用生成图中略有变化的 Q 图形；发布插画为同一风格的独立素材，纸张和图标细节不做逐像素复刻；新增注册模式沿用同一设计系统并加入原有团队/公司字段。图像生成稿的文字笔画与真实字体渲染略有不同。已按纠正后的设计核对实现，无未处理的遮挡、错误平台或横向溢出问题。

## 交互与工程验证

- 内置浏览器：登录/注册切换、Google/微信未配置提示、密码显隐、邮箱登录网络失败后恢复、找回密码入口。
- 旧版登录和旧版注册页面可访问；原 `login.tsx`、`register.tsx` 无变更。
- `pnpm exec tsc --noEmit --project apps/frontend/tsconfig.json --pretty false` 通过。
- `pnpm --filter postiz-backend build` 通过。
- `node --test scripts/test-web-login.cjs` 12 项通过。
- 未进行真实 Google/微信授权，也未写入实际用户数据库。所需配置及数据库步骤见 `../web-login.md`。

## 图像生成记录

使用内置 Image Gen，不使用 API / CLI。最终设计稿编辑提示：

> Correct this QPublish login page concept exactly preserving full composition, every Chinese heading and form, colors, whitespace and typography. Only change the left publishing illustration platform badges: show exactly four badges TikTok (black with multicolor music note), Instagram (pink orange gradient camera), Facebook (blue white f), YouTube (red play), around the same 3 floating document sheets. Remove Weibo and WeChat from the left publishing illustration completely. IMPORTANT retain the green WeChat icon and 使用微信登录 button on the RIGHT login form, since WeChat is an authentication provider but not a publishing destination. Do not change any other layout.

最终素材提示：

> Create a standalone production illustration asset of ONLY the left illustration from this corrected concept, faithfully preserving its layout: 3 white floating paper sheets (center high, left low, right lower) with violet abstract lines and image/video shapes, dashed curving connectors and exactly 4 round badges Instagram, Facebook, TikTok, YouTube in the same relative positions. Remove all headings, QPublish logo, form, footer, all actual readable text. No WeChat or Weibo anywhere. Full illustration fits inside canvas with generous 6% margins. Landscape 3:2. Pale lavender #f3f0ff background, subtle violet shadows, same delicate clean style, isolated artwork for use on the login left panel.

素材保存于 `apps/frontend/public/auth/publishing.png`，设计稿及实际效果保存于本目录。
