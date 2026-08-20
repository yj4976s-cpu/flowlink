from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image, ImageStat, UnidentifiedImageError


# FlowLink 분실 신고 색상 metadata와 동일한 표준 색상명입니다.
STANDARD_ITEM_COLORS: tuple[str, ...] = (
    "검정", "흰색", "회색", "아이보리", "크림", "베이지", "카멜", "갈색",
    "빨강", "주황", "노랑", "연두", "초록", "민트", "하늘", "파랑",
    "진파랑", "남색", "보라", "분홍",
)

_ITEM_COLOR_ALIASES: dict[str, str] = {
    **{color.casefold(): color for color in STANDARD_ITEM_COLORS},
    **{f"{color}색".casefold(): color for color in STANDARD_ITEM_COLORS if not color.endswith("색")},
    "검은색": "검정",
    "흑색": "검정",
    "블랙": "검정",
    "black": "검정",
    "하얀색": "흰색",
    "백색": "흰색",
    "화이트": "흰색",
    "white": "흰색",
    "빨간색": "빨강",
    "적색": "빨강",
    "레드": "빨강",
    "red": "빨강",
    "파란색": "파랑",
    "청색": "파랑",
    "블루": "파랑",
    "blue": "파랑",
    "네이비": "남색",
    "navy": "남색",
}

_COLOR_RGB: dict[str, tuple[int, int, int]] = {
    "검정": (25, 25, 28), "흰색": (242, 242, 240), "회색": (128, 130, 134),
    "아이보리": (238, 232, 207), "크림": (241, 222, 174), "베이지": (202, 181, 145),
    "카멜": (177, 126, 72), "갈색": (105, 70, 46), "빨강": (200, 45, 48),
    "주황": (225, 112, 37), "노랑": (225, 197, 50), "연두": (145, 190, 65),
    "초록": (48, 125, 70), "민트": (85, 183, 155), "하늘": (112, 181, 220),
    "파랑": (45, 100, 190), "진파랑": (30, 67, 135), "남색": (35, 45, 82),
    "보라": (115, 70, 145), "분홍": (220, 130, 160),
}


def normalize_item_color(value: str | None) -> str | None:
    normalized = value.strip().casefold() if value else ""
    return _ITEM_COLOR_ALIASES.get(normalized)


def _color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    left_h, left_s, left_v = colorsys.rgb_to_hsv(*(channel / 255 for channel in left))
    right_h, right_s, right_v = colorsys.rgb_to_hsv(*(channel / 255 for channel in right))
    hue_delta = min(abs(left_h - right_h), 1 - abs(left_h - right_h))
    return hue_delta * hue_delta * 3.2 + (left_s - right_s) ** 2 * 1.4 + (left_v - right_v) ** 2 * 1.1


def estimate_standard_color(image_path: Path, *, bbox_x: float, bbox_y: float, bbox_width: float, bbox_height: float) -> str | None:
    """Estimate a reviewable standard color from the detected bbox."""
    try:
        with Image.open(image_path) as source:
            image = source.convert("RGB")
            left = max(0, min(image.width, round(bbox_x)))
            top = max(0, min(image.height, round(bbox_y)))
            right = max(left, min(image.width, round(bbox_x + bbox_width)))
            bottom = max(top, min(image.height, round(bbox_y + bbox_height)))
            if right - left < 2 or bottom - top < 2:
                return None
            crop = image.crop((left, top, right, bottom))
            inset_x, inset_y = round(crop.width * .08), round(crop.height * .08)
            if crop.width - inset_x * 2 >= 2 and crop.height - inset_y * 2 >= 2:
                crop = crop.crop((inset_x, inset_y, crop.width - inset_x, crop.height - inset_y))
            crop.thumbnail((96, 96))
            median = tuple(round(value) for value in ImageStat.Stat(crop).median[:3])
    except (OSError, UnidentifiedImageError, ValueError):
        return None
    _, saturation, brightness = colorsys.rgb_to_hsv(*(channel / 255 for channel in median))
    if brightness < .2:
        return "검정"
    if saturation < .08:
        if brightness > .88:
            return "흰색"
        return "회색"
    return min(STANDARD_ITEM_COLORS, key=lambda name: _color_distance(median, _COLOR_RGB[name]))
