from io import BytesIO

from PIL import Image

from app.services.color_estimation import STANDARD_ITEM_COLORS, estimate_standard_color, normalize_item_color


def test_estimates_color_from_bbox_instead_of_full_image(tmp_path) -> None:
    image = Image.new("RGB", (100, 100), color=(245, 245, 245))
    image.paste((20, 25, 32), (25, 25, 75, 75))
    path = tmp_path / "bbox.png"
    image.save(path)

    assert estimate_standard_color(path, bbox_x=25, bbox_y=25, bbox_width=50, bbox_height=50) == "검정"


def test_color_estimation_failure_and_standard_contract(tmp_path) -> None:
    broken = tmp_path / "broken.png"
    broken.write_bytes(BytesIO(b"not-an-image").getvalue())

    assert estimate_standard_color(broken, bbox_x=0, bbox_y=0, bbox_width=10, bbox_height=10) is None
    assert normalize_item_color(" 남색 ") == "남색"
    assert normalize_item_color("청록") is None
    assert {"검정", "흰색", "회색", "베이지", "갈색", "빨강", "주황", "노랑", "초록", "파랑", "보라", "분홍"}.issubset(STANDARD_ITEM_COLORS)
