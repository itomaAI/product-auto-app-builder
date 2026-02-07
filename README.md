# MetaForge v2 - Local AI App Builder

**MetaForge** は、ブラウザだけで動作する自律型 AI Webアプリ構築ツールです。
Node.js や Python は一切不要。`index.html` を開くだけで、最新の **Gemini** モデルがあなたの代わりにコーディング、デバッグ、プレビュー作成、そしてプロジェクト管理を行います。

v2 では **IndexedDB による自動保存** と **マルチプロジェクト管理** に対応し、実用性が大幅に向上しました。

## 🚀 特徴

*   **完全ローカル & サーバーレス**: すべての処理はブラウザ内の JavaScript で完結します。バックエンドサーバーは存在しません。
*   **自律型エージェント**: Gemini が思考 (Thinking) → 計画 (Plan) → 実行 (Tools) → 確認 (Preview/Screenshot) のループを自律的に回します。
*   **プロジェクト永続化 (New)**: IndexedDB を使用し、作業内容をリアルタイムで自動保存。リロードしてもデータは消えません。
*   **マルチプロジェクト管理 (New)**: 複数のアプリを並行して開発可能。サイドバーからプロジェクトの切り替え、リネーム、削除ができます。
*   **仮想ファイルシステム (VFS)**: メモリ上にファイル構造を構築し、Blob URL 技術を用いてリアルタイムにプレビューを実行します。
*   **LPML (Local Prompt Markup Language)**: AIとの通信に最適化された独自のマークアップ言語を採用し、複雑なファイル操作を正確に指示します。

## 🎬 デモ動画
[Screencast from 2026-02-07 01-13-01.webm](https://github.com/user-attachments/assets/507ac655-b0a5-413e-a830-c412fea35269)

## 🛠️ 前提条件

*   **Google Gemini API Key**: [Google AI Studio](https://aistudio.google.com/) で取得してください。
*   **推奨モデル**: `gemini-3-pro-preview` または `gemini-3-flash^preview` (設定ファイルで変更可能)。
*   **モダンブラウザ**: Google Chrome, Edge, Firefox, Safari (最新版推奨)。

## 📦 インストールと起動

1.  このリポジトリをダウンロード（または Clone）します。
2.  フォルダ内の `index.html` をブラウザで直接開きます。
    *   ⚠️ ローカルサーバー (`http://localhost:xxxx`) 経由での起動を推奨しますが、`file://` プロトコルでも基本動作は可能です。
3.  右上の入力欄に **Gemini API Key** を入力し、Save ボタンを押します。
4.  左上の「+ (New Project)」ボタン、または初期プロジェクトでチャット欄にアイデアを入力してください。

> **プロンプト例:**
> *   「モダンなデザインのTODOリストアプリを作って。データはローカルストレージに保存して」
> *   「ブロック崩しゲームを作って。スコア機能と効果音もつけて」
> *   「CSVファイルを読み込んでグラフ表示するダッシュボードを作って」

## ⚙️ 設定 (Configuration)

`js/config.js` を編集することで、使用モデルや言語設定を変更できます。

```javascript
const CONFIG = {
    // 使用するモデル名
    MODEL_NAME: "gemini-3-pro-preview", 

    // AIがレポートを行う際の言語
    LANGUAGE: "Japanese", 
    
    // ...
};
```

## 🏗️ アーキテクチャと技術的制約

本ツールは「ブラウザサンドボックス内でのローカル実行」という特殊な環境下にあるため、いくつかの技術的制約と、それを回避するための独自の工夫があります。

### 1. No ES Modules (`import` / `export` 禁止)
VFS内のファイルはそれぞれ独立した Blob URL (`blob:https://.../uuid`) に変換されるため、相対パスによる `import` が解決できません。
*   ❌ `import React from 'react';`
*   ❌ `import { utils } from './utils.js';`
*   ✅ `<script src="https://cdn.../react.js"></script>` (CDN利用)
*   ✅ `js/utils.js` でグローバル関数を定義し、`<script src="js/utils.js"></script>` で読み込む。

**AIへの指示:** システムプロンプトにより、AIはこの制約を理解し、ES Modules を使わないコード（Global Scope パターン）を生成するように調整されています。

### 2. ファイル操作の安全性
AIによるコード破壊を防ぐため、以下の安全策を講じています。
*   **厳格な `edit_file`**: 行番号の推測を禁止し、編集直前の `read_file` を義務付けています。
*   **LPML パーサー**: 正規表現ベースの独自パーサーにより、AIの出力ストリームからファイル操作コマンドを抽出・実行します。

### 3. セキュリティ (Sandbox)
生成されたアプリは `iframe` 内で実行されますが、機能実現のために `allow-same-origin` が付与されています。
*   ⚠️ **注意**: 生成されたコードは親ウィンドウ（エディタ自体）と同じオリジンを持つため、理論上は親の LocalStorage (API Key等) にアクセス可能です。
*   本ツールは**信頼できるユーザー自身がコードを生成・実行する**ことを前提としたプロトタイピングツールです。外部から入手した怪しいプロジェクトファイルを読み込まないでください。

## 📂 ディレクトリ構成

```text
metaforge/
├── index.html       # エントリーポイント & レイアウト
├── js/
│   ├── core.js      # アプリの初期化、メインループ、状態管理
│   ├── config.js    # 設定ファイル
│   ├── storage.js   # IndexedDB ラッパー (プロジェクト永続化)
│   ├── vfs.js       # 仮想ファイルシステム & 変更監視
│   ├── gemini.js    # Gemini API クライアント (Streaming対応)
│   ├── lpml.js      # AIレスポンスパーサー
│   ├── prompts.js   # システムプロンプト & ツール定義
│   ├── tools.js     # ツール実行ロジック
│   ├── compiler.js  # Blob URL コンパイラ
│   └── ui.js        # UIイベントハンドラ & DOM操作
└── README.md
```

## 🛡️ トラブルシューティング

*   **Q. リロードしたらデータは消えますか？**
    *   A. v2 からは **IndexedDB に自動保存** されるため、消えません。左サイドバー上部の履歴から過去の状態に戻ることも可能です。
*   **Q. プレビューが真っ白になる / エラーが出る**
    *   A. AIが `import` 構文を使っている可能性があります。チャットで「importを使わずに書き直して」「CDNのscriptタグを使って」と指示してください。
*   **Q. 画像が表示されない**
    *   A. HTML内の `<img src="...">` は自動解決されますが、CSS内の `background-image: url(...)` は Blob URL への変換が効かない場合があります。HTML側の `style` 属性で指定させるか、Base64エンコードを指示してください。

## 📜 License

MIT License
