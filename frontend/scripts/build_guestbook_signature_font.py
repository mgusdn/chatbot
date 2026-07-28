"""Build the self-hosted guestbook signature WOFF2 from Google Fonts.

The upstream Nanum Pen Script family has a Reserved Font Name. Converting its
container counts as a modification under the OFL, so the generated webfont is
renamed to "Pume Hand Script" in every user-facing name-table record.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from fontTools.ttLib import TTFont


def rename_font(font: TTFont) -> None:
    names = {
        1: "Pume Hand Script",
        2: "Regular",
        3: "Pume Hand Script Regular; 1.000; PUME",
        4: "Pume Hand Script Regular",
        6: "PumeHandScript-Regular",
        16: "Pume Hand Script",
        17: "Regular",
    }
    name_table = font["name"]
    for record in name_table.names:
        replacement = names.get(record.nameID)
        if replacement is not None:
            record.string = replacement.encode(record.getEncoding())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_ttf", type=Path)
    parser.add_argument("output_woff2", type=Path)
    args = parser.parse_args()

    font = TTFont(args.source_ttf, recalcTimestamp=False)
    rename_font(font)
    font.flavor = "woff2"
    args.output_woff2.parent.mkdir(parents=True, exist_ok=True)
    font.save(args.output_woff2, reorderTables=False)


if __name__ == "__main__":
    main()
