# パーソナルAI秘書/パーソナルAIアシスタント市場調査(2026年時点)

## 要約

2026年、パーソナルAIアシスタント市場は急拡大しており、市場規模は2025年の約34億ドルから2026年に約48億ドルへ(CAGR約42%)、AIエージェント向け「メモリ」機能単体の市場も2026年に約63億ドル規模と推計されている。汎用LLM(ChatGPT/Gemini/Copilot)は軒並み「過去の会話から学習し続けるメモリ」を標準搭載し、パーソナライズは差別化要素というより前提条件になりつつある。技術的にはベクトル検索単体から、時系列を扱えるナレッジグラフとのハイブリッド構成へ移行が進んでいる。一方で常時記録型ウェアラブル(Limitless等)は買収・撤退が相次ぎ、プライバシーとビジネスモデルの持続性が課題として顕在化している。

## 1. 主要プレイヤーと製品トレンド

| 製品/カテゴリ | カテゴリ | パーソナライズ手法 | 特徴・2026年時点の状況 |
|---|---|---|---|
| ChatGPT Memory | 汎用LLMメモリ | 明示的な「Saved memories」+ 暗黙的な過去チャット参照(2026年6月に再設計され「Dreaming」と命名)。会話ごとに要約をコンテキストに注入 | 名前・役割・進行中プロジェクト・好みを自動抽出して保存。ユーザーが編集・オフ可能 |
| Gemini Personal context | 汎用LLMメモリ | Googleアカウントに紐づく自動蓄積型メモリ。ユーザーが手動で編集する仕組みは薄く、裏側で継続学習 | 「Personal Intelligence」設定配下。他社チャット履歴のZIPインポートにも対応。EU等一部地域は未提供 |
| Microsoft 365 Copilot Memory | 汎用LLMメモリ(業務向け) | チャット履歴から作業スタイル・目標・繰り返しタスクを抽出し「Saved Memory」として保持 | 2025年11月プレビュー→2026年1月GA。企業向けガバナンス・オフ機能を重視 |
| Personal AI | パーソナルAI専業 | ユーザー固有の「AIペルソナ」を作り会話・文書から継続学習 | 長期記憶系アシスタントの老舗の一つだが競合台頭で相対的地位は低下 |
| Rewind AI | 常時記録型(画面/音声) | 画面録画・音声録音をローカル保存し、埋め込み検索で「見た・聞いたこと」を想起 | 2025年12月19日にMacアプリの画面/音声キャプチャを停止。事実上サービス終了 |
| Limitless AI | 常時記録型(ウェアラブル) | 常時装着ペンダントで会話を録音・文字起こしし、要約・アクションアイテム・事前ブリーフを自動生成 | 2025年12月にMetaが買収、新規販売は停止。既存ユーザーは2026年内は無料継続 |
| Mem | ナレッジ管理/セカンドブレイン | ノートを自動タグ付け・自動整理し、AIが横断検索・統合 | 「ゼロファイリング」志向。月額約10ドル、クラウド型 |
| Reflect | ナレッジ管理/デイリーノート | 暗号化されたデイリーノートにAI検索・要約を付加 | 高速・プライバシー配慮を強調。月額約10ドル |
| Notion AI | ナレッジ管理 | Notionワークスペース内のドキュメントを横断してQ&A・要約 | 既存Notionユーザー向けアドオン、月額約8ドル/席 |
| Motion | タスク管理/スケジューリングAI | タスクの優先度・締切・所要時間に基づき自動でカレンダーを再構築するルールベース+AIエンジン | プロジェクト管理丸ごと代替を志向 |
| Reclaim.ai | タスク管理/スケジューリングAI | 会話型AIがスケジュール理解・競合分析・最適化を提案し、カレンダーに直接アクションを実行 | 既存カレンダー/PMツールの「賢いレイヤー」として動作 |

## 2. パーソナライズの技術的アプローチ

- **要約蓄積+コンテキスト注入**: ChatGPT・Gemini・Copilotなど汎用LLM勢の主流。会話ログから「事実」を抽出・要約し、次回以降のプロンプトに差し込む。実装はシンプルだが、蓄積が増えると要約の劣化・矛盾が課題になる。
- **ベクトル検索(埋め込み)**: Rewind・Mem・多くのAIエージェントフレームワーク(Mem0など)が採用。発話やメモを埋め込みベクトル化し、類似度検索で関連記憶を都度呼び出す。実装が容易で汎用性が高いが、時系列関係(いつ・どんな順序で変化したか)の表現が弱い。
- **ナレッジグラフ(時間軸付き)**: Zepの「Graphiti」に代表される手法。事実をノード・エッジとして構造化し、時間経過による変化(昇進した、引っ越した等)を追跡できる。ベンチマーク(LongMemEval)ではベクトル単体より高精度との報告がある一方、実装・運用コストは高い。
- **ハイブリッド型**: Mem0はベクトルストアを主軸にしつつ、上位プランでグラフメモリを追加提供するなど、業界全体として「ベクトル+グラフ」のハイブリッドが実運用でのデファクト傾向になりつつある。
- **常時記録+ローカル処理**: Limitless/Rewindのような常時記録型は、録音・スクリーンキャプチャをローカルに蓄積し、文字起こし後に埋め込み検索・要約を行う。プライバシー配慮(同意チャイムなど)を組み込む例もある。

## 3. 市場トレンドと今後の方向性(2025-2026年)

- **メモリの「標準機能化」**: 2025年まで差別化要素だった長期記憶は、2026年には主要プラットフォームの標準搭載機能となり、「記憶があること」自体はコモディティ化しつつある。競争軸は精度・粒度・プライバシー制御に移行。
- **常時記録型ウェアラブルの淘汰**: Limitlessのメタ買収、Rewindの機能停止など、常時録音型パーソナルAIは規制・プライバシー・ビジネスモデルの壁に直面し、勢いが鈍化している。
- **エージェント化の進展**: Gartnerは2026年末までにエンタープライズアプリの40%がタスク特化型AIエージェントを組み込むと予測。記憶はエージェントが自律的にタスクを遂行するための基盤インフラという位置づけが強まっている。
- **技術的にはグラフ+ベクトルのハイブリッドが本流**: 単純な類似度検索だけでなく、時間的変化を扱えるグラフ構造との併用が、精度重視のプロダクトで採用され始めている。
- **プライバシー/オンデバイス処理への回帰**: 常時記録型の逆風もあり、ローカル処理・オンデバイス推論への関心が高まっている。

## 4. 個人が自前で構築する場合の代表的アプローチ

- **ローカル埋め込みモデル**: `all-MiniLM-L6-v2`(384次元、無料・軽量)などのHugging Faceモデルがオンデバイス埋め込みの定番。
- **軽量ローカルベクトルDB**: 個人・プロトタイプ規模では Chroma、LanceDB、sqlite-vec、DuckDB(VSS拡張)などがセットアップの手軽さから推奨される。より本格運用ならQdrant(OSSセルフホスト可)も選択肢。
- **OSSメモリフレームワーク**: Mem0(ベクトル+オプションでグラフ)、Zep/Graphiti(時間軸付きナレッジグラフ)、LangMem(LangChain向け)、Letta(長時間稼働エージェント向け)などがOSSまたはセルフホスト可能な形で提供されており、Mem0はClaude Codeとの連携ドキュメントも公開している。
- **Claude Codeのユーザーレベル資産**: `~/.claude/skills/`配下に置く個人用スキルは全プロジェクト共通で利用可能。また`~/.claude/`配下にMCPサーバー設定を置くことで、ユーザースコープの記憶ツールをどのプロジェクトからも呼び出せる。Claude Code自体も`memory`機能(Markdownベースのノート蓄積)を持つが、本プロジェクトが目指すような構造化された継続的パーソナライズとは別物。

## 5. 本プロジェクトの位置づけと考察

「Claude Codeのユーザーレベルスキル + ローカル軽量ベクトルDB(MCPサーバー)」というアプローチは、既存市場の中で以下のように位置づけられる。

**強み**
- **データ主権とプライバシー**: 記憶が完全にローカルに閉じるため、Limitless/Rewindが直面したような常時記録・クラウド送信に伴うプライバシーリスクや事業継続リスクを回避できる。
- **ツール非依存の横断性**: ChatGPT MemoryやGemini Personal contextは各社サービス内に閉じるが、本アプローチはClaude Codeというコーディング環境を起点に、どのプロジェクト・チャットでも同じ人格・記憶を呼び出せる。開発者の日常ワークフローに直結する点は差別化になる。
- **低コスト・軽量**: 商用メモリレイヤー(Mem0 Pro月額249ドル等)やサブスク型パーソナルAI(月額8〜10ドル/月)と比較し、ローカル埋め込み+軽量ベクトルDBはほぼゼロコストで運用できる。
- **カスタマイズ自由度**: ペルソナ(スキル)と記憶(MCP)を自分で設計できるため、汎用LLMの画一的なメモリ挙動と異なり、記憶の粒度・要約ロジック・想起トリガーを完全に制御できる。

**弱み・課題**
- **精度面での見劣りリスク**: 業界の本流はベクトル単体からグラフ+ベクトルのハイブリッドへ移行しつつあり、単純なベクトル検索だけでは時系列変化(「昔はAが好きだったが今はBを好む」等)の扱いに弱さが出る可能性がある。将来的に軽量なナレッジグラフ層の追加を検討する余地がある。
- **マルチデバイス/マルチアプリ対応の欠如**: Gemini/ChatGPTのようにモバイルアプリやブラウザなど生活全般を横断する常時利用の入口を持たないため、記憶が蓄積される機会がClaude Codeの利用シーンに限定される。
- **運用・保守の負荷**: 商用プロダクトはUI・同期・バックアップ・チューニングが提供されるが、自前構築ではこれらをすべて自分で設計・保守する必要がある。
- **スケール時の検索品質管理**: 埋め込みモデルやチャンク設計、要約の陳腐化対策など、記憶が増えるほど品質担保の設計コストが増す。

**総括**: 本プロジェクトは、汎用LLMの「メモリ」機能や常時記録型ウェアラブルとは異なる、「開発者自身のワークフローに深く統合された、プライバシー重視・低コストのパーソナルAI」というニッチに位置する。市場全体がメモリを標準機能化し、かつグラフ+ベクトルのハイブリッド化に向かう中、まずはシンプルなベクトルDBで実用最小限を構築し、将来的に時系列・関係性を扱う軽量グラフ層を追加する拡張余地を残す設計が妥当と考えられる。

## 参考情報源

- [Memory FAQ (OpenAI)](https://help.openai.com/en/articles/8590148-memory-faq)
- [ChatGPT Started Dreaming: How Its Memory Actually Works](https://x.com/mem0ai/article/2071990201531118063)
- [ChatGPT Memory: How It Works (2026 Guide)](https://memx.app/glossary/chatgpt-memory/)
- [Does Gemini Have Memory? How Gemini Memory Works in 2026](https://blog.memoryplugin.com/how-gemini-memory-works/)
- [Gemini gets personal as Google rolls out a big memory upgrade](https://www.androidauthority.com/google-gemini-personal-intelligence-rollout-3632287/)
- [Configure personalization and memory (Google Cloud)](https://docs.cloud.google.com/gemini/enterprise/docs/configure-personalization)
- [Personalize what Microsoft 365 Copilot remembers](https://support.microsoft.com/en-us/topic/get-started-with-personalizing-what-microsoft-365-copilot-remembers-frontier-cba7b79a-c46f-4ca7-b46e-2fa22c563f90)
- [Introducing Copilot Memory (Microsoft Tech Community)](https://techcommunity.microsoft.com/blog/microsoft365copilotblog/introducing-copilot-memory-a-more-productive-and-personalized-ai-for-the-way-you/4432059)
- [10 Best AI Assistants with Long-Term Memory in 2026 (EverMind)](https://evermind.ai/blogs/10-best-ai-assistants-with-long-term-memory-in-2026)
- [Rewind AI Shut Down: Your On-Device Replacement (2026)](https://luci.memories.ai/blog/rewind-ai-shut-down-on-device-replacement)
- [Limitless AI Review 2026: Pendant, App, Pricing, Verdict](https://fast.io/resources/limitless-ai-review-2026/)
- [Limitless AI's $499 pendant promises to be your always-on memory assistant](https://getcoai.com/news/limitless-ais-499-pendant-promises-to-be-your-always-on-memory-assistant/)
- [Best AI Note-Taking and Second-Brain Tools 2026: Notion AI vs Mem vs Reflect](https://www.frankx.ai/blog/best-ai-note-taking-tools-2026)
- [Motion vs Reclaim.ai (2026): AI Scheduling Showdown](https://ellieplanner.com/comparisons/motion-vs-reclaim)
- [Reclaim vs. Motion](https://reclaim.ai/compare/motion-alternative)
- [Best AI Agent Memory Frameworks in 2026: Compared and Ranked (Atlan)](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)
- [Zep vs Mem0: Which AI Memory Layer Fits Your Stack?](https://atlan.com/know/zep-vs-mem0/)
- [State of AI Agent Memory 2026: Benchmarks & Trends Report (Mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Mem0 vs Zep (Graphiti): AI Agent Memory Compared (2026)](https://vectorize.io/articles/mem0-vs-zep)
- [ベクトルDB比較(Zenn)](https://zenn.dev/serio/articles/733b53d2b912d1)
- [無料・OSSのベクトルデータベース｜sqlite-vec/pgvector](https://crystal-method.com/blog/vector-database-free/)
- [Personal AI Assistant Market Report 2026 (Research and Markets)](https://www.researchandmarkets.com/reports/6226037/personal-ai-assistant-market-report)
- [Top 15 Agentic AI Trends to Watch in 2026 (Firecrawl)](https://www.firecrawl.dev/blog/agentic-ai-trends)
- [Claude Code - Mem0 (mem0.ai公式ドキュメント)](https://docs.mem0.ai/integrations/claude-code)
- [Understanding Claude Code's Full Stack: MCP, Skills, Subagents](https://alexop.dev/posts/understanding-claude-code-full-stack/)
