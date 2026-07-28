"""Public API schemas for the persistent Prometheus memory room.

The memory room is deliberately separate from counseling sessions and from the
short-lived ``commons`` traces.  No counseling transcript or session identifier
is accepted by these schemas.
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


MemoryKind = Literal["note", "mood", "story"]
MemoryEmotion = Literal["calm", "joy", "tender", "sad", "hope", "tired"]
MemoryCardStyle = Literal["cream", "sage", "sky", "rose", "lilac"]
MemoryReportCategory = Literal[
    "personal_information",
    "crisis",
    "harassment",
    "spam",
    "copyright",
    "other",
]

MEMORY_DESIGN_MAX_BYTES = 16 * 1024
MEMORY_DESIGN_MAX_LAYERS = 20
MEMORY_DESIGN_MAX_TEXT_LAYERS = 6
MEMORY_DESIGN_MAX_STICKER_LAYERS = 12
MEMORY_DESIGN_MAX_TOTAL_TEXT = 180
MEMORY_SIGNATURE_MAX_LENGTH = 24

MemoryRelocationSurface = Literal[
    "floor.interior",
    "wall.interior.north",
    "wall.interior.west",
    "wall.interior.east",
]


class StrictMemoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StrictMemoryDesignModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class MemoryTextLayer(StrictMemoryDesignModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    type: Literal["text"]
    text: str = Field(min_length=1, max_length=MEMORY_DESIGN_MAX_TOTAL_TEXT)
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(ge=0.0, le=1.0)
    font_size: float = Field(ge=0.0, le=1.0)
    font: Literal["round", "display"]
    color: Literal["ink", "berry", "ocean", "sun"]
    align: Literal["left", "center", "right"]
    rotation_deg: float = Field(ge=-180.0, le=180.0)

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text layer must not be blank")
        return value


class MemoryStickerLayer(StrictMemoryDesignModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    type: Literal["sticker"]
    sticker_id: Literal[
        "heart",
        "sparkle",
        "leaf",
        "flower",
        "star",
        "smile",
        "speech",
        "paw",
        "thumbs-up",
        "prometheus-p",
    ]
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(ge=0.0, le=1.0)
    rotation_deg: float = Field(ge=-180.0, le=180.0)


MemoryDesignLayer = Annotated[
    MemoryTextLayer | MemoryStickerLayer,
    Field(discriminator="type"),
]


class MemoryDesignV1(StrictMemoryDesignModel):
    version: Literal[1]
    template_id: Literal["warm-paper-v1"]
    layers: list[MemoryDesignLayer] = Field(max_length=MEMORY_DESIGN_MAX_LAYERS)

    @model_validator(mode="after")
    def validate_layer_budget(self) -> "MemoryDesignV1":
        text_layers = [layer for layer in self.layers if layer.type == "text"]
        sticker_layers = [layer for layer in self.layers if layer.type == "sticker"]
        if not text_layers:
            raise ValueError("design must contain at least one text layer")
        if len(text_layers) > MEMORY_DESIGN_MAX_TEXT_LAYERS:
            raise ValueError(f"design supports at most {MEMORY_DESIGN_MAX_TEXT_LAYERS} text layers")
        if len(sticker_layers) > MEMORY_DESIGN_MAX_STICKER_LAYERS:
            raise ValueError(f"design supports at most {MEMORY_DESIGN_MAX_STICKER_LAYERS} sticker layers")
        if len({layer.id for layer in self.layers}) != len(self.layers):
            raise ValueError("design layer ids must be unique")
        if sum(len(layer.text) for layer in text_layers) > MEMORY_DESIGN_MAX_TOTAL_TEXT:
            raise ValueError(f"design text supports at most {MEMORY_DESIGN_MAX_TOTAL_TEXT} characters")
        encoded = json.dumps(
            self.model_dump(mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        if len(encoded) > MEMORY_DESIGN_MAX_BYTES:
            raise ValueError(f"design JSON supports at most {MEMORY_DESIGN_MAX_BYTES} bytes")
        return self


class MemoryDesignV2(StrictMemoryDesignModel):
    version: Literal[2]
    template_id: Literal[
        "warm-paper-v1",
        "sage-grid-v1",
        "sky-postcard-v1",
        "rose-confetti-v1",
    ]
    layers: list[MemoryDesignLayer] = Field(max_length=MEMORY_DESIGN_MAX_LAYERS)
    signature: str | None = Field(max_length=MEMORY_SIGNATURE_MAX_LENGTH)

    @field_validator("signature", mode="before")
    @classmethod
    def normalize_signature(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        normalized = unicodedata.normalize("NFKC", value)
        normalized = re.sub(r"[\u200B-\u200D\u2060\uFEFF]", "", normalized)
        normalized = " ".join(normalized.replace("\r\n", "\n").replace("\r", "\n").split()).strip()
        if not normalized:
            return None
        return normalized

    @model_validator(mode="after")
    def validate_layer_budget(self) -> "MemoryDesignV2":
        text_layers = [layer for layer in self.layers if layer.type == "text"]
        sticker_layers = [layer for layer in self.layers if layer.type == "sticker"]
        if not text_layers:
            raise ValueError("design must contain at least one text layer")
        if len(text_layers) > MEMORY_DESIGN_MAX_TEXT_LAYERS:
            raise ValueError(f"design supports at most {MEMORY_DESIGN_MAX_TEXT_LAYERS} text layers")
        if len(sticker_layers) > MEMORY_DESIGN_MAX_STICKER_LAYERS:
            raise ValueError(f"design supports at most {MEMORY_DESIGN_MAX_STICKER_LAYERS} sticker layers")
        if len({layer.id for layer in self.layers}) != len(self.layers):
            raise ValueError("design layer ids must be unique")
        total_text = sum(len(layer.text) for layer in text_layers) + len(self.signature or "")
        if total_text > MEMORY_DESIGN_MAX_TOTAL_TEXT:
            raise ValueError(f"design text supports at most {MEMORY_DESIGN_MAX_TOTAL_TEXT} characters")
        encoded = json.dumps(
            self.model_dump(mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        if len(encoded) > MEMORY_DESIGN_MAX_BYTES:
            raise ValueError(f"design JSON supports at most {MEMORY_DESIGN_MAX_BYTES} bytes")
        return self


MemoryDesign = Annotated[
    MemoryDesignV1 | MemoryDesignV2,
    Field(discriminator="version"),
]


class MemoryPlacementRequest(StrictMemoryRequest):
    surface_id: Literal[
        "wall.north",
        "wall.west",
        "floor.center",
        "floor.interior",
        "desk.main",
    ] = "wall.north"
    u: float = Field(default=0.5, ge=0.0, le=1.0)
    v: float = Field(default=0.5, ge=0.0, le=1.0)
    rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0)
    scale: float = Field(default=1.0, ge=0.75, le=1.35)
    z_index: int = Field(default=0, ge=0, le=1000)


class MemoryCreatePlacementRequest(MemoryPlacementRequest):
    """Creation additionally allows designed letters on walk-up walls."""

    surface_id: Literal[
        "wall.north",
        "wall.west",
        "wall.interior.north",
        "wall.interior.west",
        "wall.interior.east",
        "floor.center",
        "floor.interior",
        "desk.main",
    ] = "wall.north"


class MemoryCreateRequest(StrictMemoryRequest):
    kind: MemoryKind
    body: str | None = Field(default=None, max_length=500)
    emotion: MemoryEmotion | None = None
    card_style: MemoryCardStyle = "cream"
    author_alias: str | None = Field(default=None, max_length=24)
    placement: MemoryCreatePlacementRequest = Field(
        default_factory=MemoryCreatePlacementRequest
    )
    design: MemoryDesign | None = None
    client_request_id: str | None = Field(
        default=None,
        min_length=8,
        max_length=100,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    ownership_token: str | None = Field(default=None, min_length=32, max_length=200)

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split()).strip()
        if not normalized:
            raise ValueError("body must not be blank")
        return normalized

    @field_validator("author_alias")
    @classmethod
    def normalize_alias(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split()).strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_legacy_or_design_create(self) -> "MemoryCreateRequest":
        if self.design is None and self.body is None:
            raise ValueError("body is required when design is absent")
        if (
            self.design is None
            and self.placement.surface_id
            in {
                "wall.interior.north",
                "wall.interior.west",
                "wall.interior.east",
            }
        ):
            raise ValueError("walk-up walls require a designed letter")
        if (self.client_request_id is None) != (self.ownership_token is None):
            raise ValueError("client_request_id and ownership_token must be provided together")
        return self


class MemoryMoveRequest(MemoryPlacementRequest):
    expected_version: int = Field(ge=1)


class MemoryRelocationRequest(StrictMemoryRequest):
    client_request_id: UUID
    expected_version: int = Field(ge=1)
    surface_id: MemoryRelocationSurface
    u: float = Field(ge=0.0, le=1.0)
    v: float = Field(ge=0.0, le=1.0)
    rotation_deg: float = Field(ge=-180.0, le=180.0)
    scale: float = Field(ge=0.75, le=1.35)


class MemoryReportRequest(StrictMemoryRequest):
    category: MemoryReportCategory
