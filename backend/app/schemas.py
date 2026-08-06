from enum import Enum

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Arm(str, Enum):
    baseline = "baseline"
    optimized = "optimized"


class ExperimentCreateRequest(BaseModel):
    name: str = Field(default="사용자", min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name must not be blank")
        return normalized


class TurnRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    arms: list[Arm] = Field(
        default_factory=lambda: [Arm.baseline, Arm.optimized],
        min_length=1,
        max_length=2,
    )

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be blank")
        return normalized

    @field_validator("arms")
    @classmethod
    def unique_arms(cls, value: list[Arm]) -> list[Arm]:
        if len(set(value)) != len(value):
            raise ValueError("arms must be unique")
        return value


class RatingRequest(BaseModel):
    run_id: str = Field(min_length=1, max_length=100)
    arm: Arm
    score: int = Field(ge=1, le=5)
    note: str = Field(default="", max_length=1000)


class KeepsakeCreateRequest(BaseModel):
    arm: Arm = Arm.baseline


def _normalize_public_text(value: str) -> str:
    return " ".join(value.split()).strip()


class GuestbookCreateRequest(BaseModel):
    anchor_key: Literal["today-wall"] = "today-wall"
    message: str = Field(min_length=1, max_length=60)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        normalized = _normalize_public_text(value)
        if not normalized:
            raise ValueError("message must not be blank")
        if len(normalized) > 60:
            raise ValueError("message must be at most 60 characters")
        return normalized


class InstallationCreateRequest(BaseModel):
    anchor_key: str | None = Field(default=None, max_length=40, pattern=r"^installation-(0[1-9]|1[0-6])$")
    object_kind: Literal["flower", "lantern", "book", "stone"]
    message: str | None = Field(default=None, max_length=60)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = _normalize_public_text(value)
        if not normalized:
            return None
        if len(normalized) > 60:
            raise ValueError("message must be at most 60 characters")
        return normalized


class CommonsReportRequest(BaseModel):
    category: Literal["personal_information", "crisis", "harassment", "spam"]
