# 🧠 Anthra's AI Brain (Chrome Extension Mod)

**Author:** anthrakys  
**Version:** 1.2.0  
**Target:** [rngidle.fun](https://rngidle.fun)

A high-performance decision-making Chrome Extension (Manifest V3) for **rngidle.fun** that analyzes rolls in real time and computes **exact mathematical profitability**, **net profit (EV)**, and **win / loss probabilities** across all 10 shop items.


---

## 🚀 Installation & Update in Chrome / Brave / Edge

1. Open your browser and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. If previously loaded: click the **Reload (🔄)** icon on the **Anthra's AI Brain** card.
   If installing for the first time: click **Load unpacked** and select `c:\Users\anthr\Desktop\RNGidle MODS`.
4. Open [https://rngidle.fun/](https://rngidle.fun/) and hard-refresh (`Ctrl + F5`).
5. The overlay will seamlessly appear on the right side of the screen.
---

## ✨ Features (v1.2.0)

1. **100% Mathematical Precision (Zero Guesswork / Zero False Positives)**:
   - Evaluates scores directly through RNGidle's canonical scoring algorithms (`composeRollResult`).
   - Every item distribution matches `shop-server.js` rules verbatim:
     - **Complex & Hypercomplex Support**: Full support for Complex numbers (1+6i, 3.14+2i, 7i), Quaternions (1+2i+3j+4k), and Octonions (1+2e_1+3e_2...). Correctly models pure imaginary transitions, component sign flips, coordinate basis exclusion, and pure non-real score explosions.
     - **Roulette Splitter (RSS)**: exact 16-slot circular wheel distribution ($\pm 1, \pm 2$).
     - **Slot Splitter (SSS)**: exact slot reel simulation ($\pm 1$ or stay).
     - **Digit Splitter (DSS)**: single digit mutation ($\times$ knife emoji 🔪).
     - **Hell's Horn**: non-6 mutation to 6 (with canonical rule validation).
     - **Function Error (Bitflip)**: exact binary bit-flip scan picking optimal score enhancement.
     - **Digit Swap**: exact pairwise permutation distribution across all digit slots.
     - **Gravity Potion**: exact modulo-10 decrement across all digits.
     - **Grinder**: exact single-digit grinding (tested with decimal preservation and special tiers like `42.0` Botanist across the point).
     - **Edge of Infinity**: bounded digit insertion sampling ($<1\text{ms}$ execution).
     - **Glitch Potion**: exact 2-digit fractional distribution ($d_1 \in [0..9], d_2 \in [1..9]$) and sign inversion.

2. **Clean, Sober Minimalist HUD Aesthetic & Gamble Mode**:
   - Modern dark matte finish (`#0c1017`) with refined typography and tabular numbers (enlarged 410px width).
   - **Gamble Mode (`🎲 TOP 3 GAMBLE PLAYS`)**: reveals top jackpot ceiling plays with win rates and direct navigation.
   - Segmented controls: toggle `[Net | Gross]` and `[All | Bag]`.
   - Compact 5px segmented odds bar: Win (green), Neutral (slate), Loss (rose).
   - High-contrast scenarios table displaying Best, Expected EV ($\mathbb{E}[X]$), and Worst outcomes.
   - Non-intrusive draggable header and minimizable pill (`AI BRAIN`).
   - Smooth horizontal mouse-wheel scrolling for item tabs with persistent scroll memory.

3. **High Performance & Safe React DOM Isolation**:
   - Asynchronous simulation yielding between evaluations — never freezes the main thread.
   - Employs non-destructive CSS attributes (`data-profit`) on in-game action buttons rather than injecting React DOM nodes, completely preventing React `removeChild` reconciliation crashes.

---

## 📦 Supported Number Items (10)

| Item | Emoji | Shop Price | Server Mechanic |
|---|---|---|---|
| **Roulette Splitter** | 🎡 | 10M EP | 16-slot wheel (one digit moved by $\pm 1$ or $\pm 2$) |
| **Slot Splitter** | 🎰 | 15M EP | Every digit spins like a reel ($\pm 1$ or stays) |
| **Digit Splitter** | 🔪 | 20M EP | Replaces one random digit with another |
| **Hell's Horn** | 😈 | 100M EP | One random non-6 digit becomes a 6 |
| **Function Error** | ⚠️ | 300M EP | Best single binary bit-flip that improves score |
| **Digit Swap** | ⇄ | 500M EP | Swaps two random digit positions |
| **Gravity Potion** | 🪨 | 4B EP | Every digit falls by 1 ($0 \to 9$) |
| **Grinder** | ⚙️ | 5B EP | Grinds one random digit away |
| **Edge of Infinity** | ♾️ | 20B EP | Adds a new random digit |
| **Glitch Potion** | 👾 | 23B EP | Breaks number (negative sign, 2-digit decimal or -404) |

---

## 🛠️ Automated Rigorous Testing

Run the built-in test suite to verify math and edge cases across 140 assertions (10 items $\times$ 14 numbers including Quaternions, Octonions, and Complex):
```bash
node scripts/test-engine-rigorous.js
```
All assertions pass at 100.0% coverage with zero false positives.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) © 2026 anthrakys.
