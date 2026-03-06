# Rapid Serial Visual Presentation

A browser-based speed-reading trainer.
Words are displayed one at a time at a fixed point on screen — your eyes never move, only the text does.
The **orange letter** in each word marks the *Optimal Recognition Point (ORP)*, the character your brain anchors on to instantly decode the word.

**Live app: [mike-dono-0815.github.io/rapid-serial-visual-presentation](https://mike-dono-0815.github.io/rapid-serial-visual-presentation/)**

---

## Features

| Feature | Detail |
|---|---|
| **ORP alignment** | Pivot character always at the horizontal centre using ORP positioning |
| **Fixed speed** | Choose any speed from 60 – 1200 WPM |
| **Ramp mode** | Automatically steps through 300 → 400 → 500 → 600 WPM, with each transition snapped to the nearest sentence boundary |
| **Sentence pauses** | Words ending in `.` always get a fixed 400 ms extra pause, regardless of speed |
| **Interactive seekbar** | Click or drag the time bar to jump anywhere in the sequence |
| **Transport controls** | Play/Pause · Stop · Rewind −10 words · Forward +10 words |
| **Keyboard shortcuts** | `Space` play/pause · `←` / `→` rewind/forward · `Esc` stop |
| **Text input** | Paste or type any text; special characters are stripped automatically on paste |

---

## How to use

1. **Enter your text** in the top text area (or keep the default RSVP description).
2. **Choose a speed mode**:
   - *Fixed* — set your WPM with the `−` / `+` buttons or type directly into the number field.
   - *Ramp* — speed increases automatically across four equal bands of the text.
3. **Press ▶** (or `Space`) to start reading.
4. **Focus on the orange letter** — keep your eyes fixed on it and let the words come to you.
5. Use the **seekbar** at the bottom to jump to any position, or **⏮ / ⏭** to step back/forward 10 words.

### Tips

- Start at **200–300 WPM** if you are new to RSVP; increase by 50 WPM once comprehension feels comfortable.
- Use **Ramp mode** as a training tool — it eases you in slowly and pushes you faster as you warm up.
- Short sentences (1–2 lines) work better than long paragraphs when learning.

---

## Project structure

```
rsvp-reader/
├── index.html
├── css/
│   └── style.css
└── js/
    └── app.js
```

---

## License

MIT
