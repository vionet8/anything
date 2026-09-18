# ツール・MCPのメモ

## 繋ぎたいMCP

- **X (Twitter) の MCP**
- **Typefully の MCP** — Xのスレッド作成・下書き・予約投稿のサービス
- **Figma の MCP** — 公式の Dev Mode MCP server がある。コンポーネント構造
  (名前・バリアント・プロパティ)、変数とスタイル(色・余白・タイポグラフィの
  トークン)、レイヤーツリー、ノードのレンダリング画像を、スクショではなく
  機械可読な形でエージェントに渡す。Code Connect を設定してあれば、Figmaの
  コンポーネント→実際のコードのコンポーネントと import パスの対応まで読める。
  デスクトップ版サーバは有料プランの Dev/Full シートで利用可。将来は従量課金に
  なる予定で、ベータ期間中は無料
- **HyperFrames の MCP** — HeyGen の OSS。HTML/CSS/メディア/シーク可能な
  アニメーションを決定論的にMP4へレンダリングする。MCPは複数実装があり、
  HeyGen公式のホスト型コネクタ(HeyGenアカウント経由、CLI不要)のほか、CLIを
  MCPツールとして包んだもの、レンダリング基盤に繋ぐ有料のリモートMCPなど

用途としては、作ったもの(レンダリング画像やプロトタイプ)を動画にして、Xに
出すところまでセッション内で完結させる想定。Figmaは逆向きで、デザインを
入力としてコードやシーンに持ち込む側。

この組み合わせだと Figma(入力) → 実装 → HyperFrames(動画化) → Typefully/X
(公開) が一本の線になる。

### 現状 (2026-09-18 時点)

このリポジトリには MCP の設定が無い。`.mcp.json` は存在せず、`~/.claude.json`
の `mcpServers` も空。今セッションに来ていた MCP は全部クラウド側のハーネスが
挿しているもので、内訳は GitHub / Gmail / Google Calendar / Google Drive /
Claude Docs / Claude Code Remote。**XもTypefullyも繋がっていない。**

### 繋ぐときに決めること

- サーバの実体(パッケージ名・コマンド)と、提供されるツール —— 未調査
- 認証。XのAPIは有料プランによって投稿権限が変わるので、そこが実質の制約に
  なりやすい。Typefully は API キー方式
- 置き場所: リポジトリ共有なら `.mcp.json`、個人利用なら claude.ai 側の
  コネクタ設定かユーザ設定

XとTypefullyについてはサーバの実体と認証を確認していないので、繋ぐ前に実在と
権限を確かめること。FigmaとHyperFramesは公式のMCPがあることまでは確認済み
(2026-09-18)だが、このリポジトリでは未接続。

## 参考動画: MCP紹介まとめ (KEITO WEB&AI CH)

スクリーンショットから書き起こし。チャプター一覧の上部は見切れていて、
Gmail より前の項目は不明。URLとタイトルは未確認。

| 時刻 | 項目 |
|---|---|
| (見切れ) | Gmail MCP |
| 05:16 | Google カレンダー MCP |
| 06:27 | Google ドライブ MCP |
| 07:40 | Notion MCP |
| 09:39 | Obsidian・ファイルシステム MCP |
| 11:22 | Zoom MCP |
| 12:50 | X MCP |
| 14:45 | Typefully MCP |
| 16:27 | Figma MCP |
| 18:20 | Hyperframe MCP |
| 20:08 | fal MCP |
| 22:58 | Fiksfield MCP (表記が読み取りづらい。要確認) |
| 24:17 | Cloudflare MCP |
| 26:56 | Vercel MCP |
| 27:43 | Playwright MCP |
| 28:56 | freee・マネーフォワード MCP |
| 31:12 | Zapier・Make MCP |
| 34:14 | **Blender MCP** |
| 35:32 | MCP運用の注意点・まとめ |

上で「繋ぎたい」と書いた X / Typefully / Figma / Hyperframe は、いずれもこの
動画で扱われている。

### Blender MCP (34:14) について

今回の縁側シーン制作で一番効いた制約が、これで解ける可能性がある。

今回は `blender --background --python` で毎回プロセスを起動して捨てていたので、
(1) シーンを毎回ゼロから組み直す (2) ビューポートが無いので確認は必ず
レンダリング、という2点が固定費だった。動いているBlenderに接続する型のMCPなら
セッションが永続するので、両方とも消える。

ただし前提として、GUI付きのBlenderが動いている必要がある。このクラウド
コンテナはヘッドレスなので、仮想ディスプレイ(xvfb)で動かせるかは未検証。
ローカルのBlenderに繋ぐ使い方なら素直に効くはず。

なお、MCPが無くても今回のループは40倍速くできた(Workbench 6.6秒 対 Cycles
4分)。速いループが欲しいときに、まずMCPを探すのは順番が違う。
