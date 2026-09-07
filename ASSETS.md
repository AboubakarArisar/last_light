# Asset provenance

All footballer geometry, animations, stadium geometry, procedural pitch and ball textures, club insignia, advertising text, UI artwork and synthesized sound are authored in this repository. No real club badges, stadium models, player likenesses or licensed match footage are used.

| Asset | Source | License |
| --- | --- | --- |
| Barlow Condensed, weights 500/600/700/800 | Google Fonts / Jeremy Tribby; local `public/fonts/font-1.ttf` through `font-4.ttf` | SIL Open Font License 1.1; `public/fonts/Barlow-OFL.txt` |
| DM Sans, weights 400/500/600/700 | Google Fonts / DM Sans project; local `public/fonts/font-5.ttf` through `font-8.ttf` | SIL Open Font License 1.1; `public/fonts/DM-Sans-OFL.txt` |
| Three.js and bundled utilities | npm `three`, version pinned in package-lock.json | MIT; `node_modules/three/LICENSE` |

Font files were downloaded from the Google Fonts CSS endpoint and fonts.gstatic.com. License texts come from the corresponding `google/fonts` OFL directories. The build includes the font license texts. There are no runtime requests to Google Fonts.
