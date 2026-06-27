# スキルズ仕様書

歌詞フレーズの演出バリエーション（variant）と色（tone）の定義・現状・改善目標をまとめる。

---

## Tone（色）

フレーズ本文のハッシュ × セクションで決まる。直前と同じ tone は回避される。

| tone | 主色 | グロー | 用途 |
|---|---|---|---|
| **cyan** | `#ecfffb` | `rgba(57,197,187,0.78)` | 基本。Aメロ・Bメロ・イントロ |
| **hot** | `#fff0f8` | `rgba(255,92,168,0.76)` | サビの熱量 |
| **warm** | `#fff7d9` | `rgba(255,209,102,0.72)` | 間奏・フィナーレの緊張緩和 |
| **white** | `#ffffff` | `rgba(185,255,245,0.64)` | 引き算。周囲が派手なときに使う |

---

## セクション × variant 対応表

| セクション | variants | tones |
|---|---|---|
| intro | burst / slide / slash | cyan / white |
| amelo | slide / slash / echo | cyan / white |
| bmelo | vertical / slash / glitch | cyan / white |
| chorus | burst / slide / glitch | hot / warm / white |
| interlude | echo / slash / vertical | cyan / warm |
| finale | burst / slide / glitch | warm / white / hot |

---

## Variant 仕様

### slide

**配置**: 左下 (left 4%, top 52%)  
**入場**: 左から -3.2rem スライド + skewX(-7deg) → skew 解除  
**退場**: 右へ +1.1rem + フェードアウト  
**特徴**: 一番オーソドックスな横書き。可読性最高。

**現状の問題**:
- カラオケモード時に `pvCharPop`（1文字ずつポップ）がキャンセルされる
- 入場中の "文字が光りながら出てくる" 感がなくなる

**改善目標**:
- カラオケ時はマスクスイープで全文字が一気に現れる → `onWord` で単語ごとに輝く、の2段階にする
- 退場はやや加速させて "引っ張られるように消える" 演出へ

---

### slash

**配置**: 右寄り (right 4%, top 46%)、`--pv-angle` で傾き (-12deg〜+12deg)  
**入場**: マスクスイープ  
**特徴**: 斜めが曲のスピード感を演出。Bメロでも使う汎用性がある。

**現状の問題**:
- 傾きが `index % 5` で決まるが、連続すると同じ角度になりやすい
- 右端に配置されるので長いフレーズが切れる可能性

**改善目標**:
- 傾きを `seed` + 直前回避で選ぶ
- 長文時のフォントサイズ自動縮小を検討

---

### echo

**配置**: 左上 (left 9%, top 10%)  
**入場**: マスクスイープ  
**残像**: テキストコピー × 3（ずれ＋半透明）がゆっくり漂う  
**特徴**: 広い空間を使って"残響"を視覚化する。間奏に合う。

**現状の問題**:
- 残像コピーは固定テキストでカラオケと無関係
- copy-1/2/3 のずれ方向が固定でワンパターン

**改善目標**:
- `onWord` 発火時に最古コピーがその単語だけ光る（遅れてエコー）
- コピーのずれ量を `seed` で少しランダム化

---

### glitch

**配置**: 中央下 (left 50%, top 46%, translateX(-50%))  
**入場**: マスクスイープ  
**グリッチ**: `pvGlitchShift` で横ずれ×4フレーム  
**残像**: テキストコピー × 2

**現状の問題**:
- グリッチが入場時の1回しか起きない（0.46s × 2 回）
- RGBずれ（色チャンネル分離）がない → 安っぽく見える

**改善目標**:
- CSS `::before` / `::after` で赤/青チャンネルを ±0.08em ずらして常時重ねる
- `onWord` 時に短い追加グリッチを発火させる（0.12s だけ揺らす）

---

### burst

**配置**: 中央 (left 50%, top 42%, translate(-50%,-50%))  
**入場**: マスクスイープ、中央寄せ、scale(1.04)  
**特徴**: サビの「ドカン」感。最大スケール・中央配置でインパクト重視。

**現状の問題**:
- `is-chorus` フレーズで `is-singing` のみ脈動するが、フレーズ全体の "呼吸" がない
- サビ以外（intro）で burst が来たときにスケール感が過剰

**改善目標**:
- サビの burst は `.pv-mask` 自体が `scale: calc(1 + --pv-vocal * 0.04)` で全体呼吸
- intro / finale の burst は scale を少し抑えた別クラス（`burst-sm`）を検討

---

### vertical

**配置**: 右上 (right 7%, top 5%)  
**入場**: 上から下にマスクドロップ (`pvMaskDrop`)  
**特徴**: 縦書き。Bメロの「システムスキャン」の硬質さを演出。

**現状の問題**:
- カラオケ（`is-karaoke`）時の縦書き文字ハイライトが未検証
- `writing-mode: vertical-rl` 時に `scale` 方向が変わる（横が縦になる）

**改善目標**:
- カラオケ時の `is-singing` で `scale` を `scaleX` に切り替える（縦書きで横に太くなる）
- 2行（`pv-text-rows`）時に行方向を列（flex-direction: row）で正しく並ぶか確認

---

## 退場演出（全 variant 共通の課題）

現状はすべて同じ `pvExit`（opacity 0 + translateY(-0.5rem)）。

| variant | 理想の退場 |
|---|---|
| slide | 右へ滑り出る + フェード |
| slash | 傾きを強めて斜めに飛ぶ |
| echo | コピーが先に消えて本体がフェード |
| glitch | ブレながらバラけて消える |
| burst | スケールアウト（scale 1→1.1）しながらフェード |
| vertical | 上にドロップしながらフェード |

---

## 未使用 CSS の整理候補

以下は style.css に定義があるが JS から呼ばれていない。削除 or 再活用を判断する。

- `.pv-word-hit` / `.pv-word-hit.lane-*` — 単語バッジ（`onWord` が noop のため未使用）
- `.pv-char-tick` / `.pv-char-tick.dot-*` — 文字チック（`onChar` が noop のため未使用）
