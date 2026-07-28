# Bundled fonts

## Pume Hand Script

`PumeHandScript-Regular.woff2` is the self-hosted Korean handwriting font used
for the optional guestbook signature. It is built from Nanum Pen Script by NHN,
published in the official Google Fonts repository under the SIL Open Font
License 1.1.

- Official source: https://github.com/google/fonts/tree/main/ofl/nanumpenscript
- Source file: `NanumPenScript-Regular.ttf`
- Source SHA-256: `6f0d1ab29c7894010dc88831fb7a0a51edb79136e450344183de5b1a8b52bd43`
- Output SHA-256: `f886a771d5a7c2b4a34e3a312d735c6f51474b128181eede04748133364b29c0`
- Build: `python3 scripts/build_guestbook_signature_font.py SOURCE_TTF public/fonts/PumeHandScript-Regular.woff2`
- License text: `OFL-PumeHandScript.txt`

The OFL lists Nanum-related names as Reserved Font Names. Because a format
conversion is a modified version under the license, the build script renames
the family and PostScript records to `Pume Hand Script` before producing WOFF2.

## Bagel Fat One

`BagelFatOne-Regular.woff2` is Bagel Fat One by Kyungwon Kim and JAMO,
distributed by Google Fonts under the SIL Open Font License 1.1.

- Official specimen: https://fonts.google.com/specimen/Bagel+Fat+One
- License text: `OFL-BagelFatOne.txt`
- Runtime use: entry-screen titles and the guestbook display-text option
