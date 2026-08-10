from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="USER")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    terms_agreed_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    privacy_agreed_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    lost_reports: Mapped[list[LostReport]] = relationship(back_populates="user")
    ownership_claims: Mapped[list[OwnershipClaim]] = relationship(
        back_populates="user", foreign_keys="OwnershipClaim.user_id"
    )
    reviewed_claims: Mapped[list[OwnershipClaim]] = relationship(
        back_populates="reviewer", foreign_keys="OwnershipClaim.reviewed_by"
    )
    notifications: Mapped[list[Notification]] = relationship(back_populates="user")
    detection_events: Mapped[list[DetectionEvent]] = relationship(back_populates="user")


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    area_name: Mapped[str] = mapped_column(String(100), nullable=False)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    detection_events: Mapped[list[DetectionEvent]] = relationship(back_populates="camera")


class ObjectClass(Base):
    __tablename__ = "object_classes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name_ko: Mapped[str] = mapped_column(String(50), nullable=False)
    group_code: Mapped[str] = mapped_column(String(30), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    found_items: Mapped[list[FoundItem]] = relationship(back_populates="object_class")
    lost_reports: Mapped[list[LostReport]] = relationship(back_populates="object_class")
    detected_objects: Mapped[list[DetectedObject]] = relationship(
        back_populates="object_class",
        foreign_keys="DetectedObject.object_class_id",
    )


class DetectionEvent(Base):
    __tablename__ = "detection_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    camera_id: Mapped[int | None] = mapped_column(ForeignKey("cameras.id", ondelete="SET NULL"))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    purpose: Mapped[str] = mapped_column(String(20), nullable=False, default="OPERATION")
    source_type: Mapped[str] = mapped_column(String(10), nullable=False)
    original_media_url: Mapped[str] = mapped_column(Text, nullable=False)
    result_media_url: Mapped[str | None] = mapped_column(Text)
    media_width: Mapped[int | None] = mapped_column(Integer)
    media_height: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    captured_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    processing_started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    processing_completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    user: Mapped[User | None] = relationship(back_populates="detection_events")
    camera: Mapped[Camera | None] = relationship(back_populates="detection_events")
    detected_objects: Mapped[list[DetectedObject]] = relationship(back_populates="detection_event")
    video_job: Mapped[VideoJob | None] = relationship(back_populates="detection_event", uselist=False)


class VideoJob(Base):
    __tablename__ = "video_jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    detection_event_id: Mapped[int] = mapped_column(
        ForeignKey("detection_events.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    processing_progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tracking_algorithm: Mapped[str] = mapped_column(String(20), nullable=False, default="BYTE_TRACK")
    video_duration_seconds: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    processing_started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    processing_completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    detection_event: Mapped[DetectionEvent] = relationship(back_populates="video_job")


class DetectedObject(Base):
    __tablename__ = "detected_objects"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    detection_event_id: Mapped[int] = mapped_column(
        ForeignKey("detection_events.id", ondelete="CASCADE"), nullable=False
    )
    object_class_id: Mapped[int] = mapped_column(ForeignKey("object_classes.id"), nullable=False)
    final_class_code: Mapped[str | None] = mapped_column(String(50), ForeignKey("object_classes.code"))
    processing_status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    admin_memo: Mapped[str | None] = mapped_column(Text)
    track_id: Mapped[int | None] = mapped_column(BigInteger)
    confidence: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False)
    bbox_x: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    bbox_y: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    bbox_width: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    bbox_height: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    cropped_image_url: Mapped[str | None] = mapped_column(Text)
    first_seen_ms: Mapped[int | None] = mapped_column(BigInteger)
    last_seen_ms: Mapped[int | None] = mapped_column(BigInteger)
    appearance_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    detected_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    detection_event: Mapped[DetectionEvent] = relationship(back_populates="detected_objects")
    object_class: Mapped[ObjectClass] = relationship(
        back_populates="detected_objects",
        foreign_keys=[object_class_id],
    )
    found_item: Mapped[FoundItem | None] = relationship(back_populates="detected_object")


class FoundItem(Base):
    __tablename__ = "found_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    detected_object_id: Mapped[int | None] = mapped_column(
        ForeignKey("detected_objects.id", ondelete="SET NULL"), unique=True
    )
    object_class_id: Mapped[int] = mapped_column(ForeignKey("object_classes.id"), nullable=False)
    registered_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    color: Mapped[str | None] = mapped_column(String(50))
    public_description: Mapped[str | None] = mapped_column(String(500))
    private_features: Mapped[str | None] = mapped_column(Text)
    area_name: Mapped[str] = mapped_column(String(100), nullable=False)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    found_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="DETECTED")
    storage_location: Mapped[str | None] = mapped_column(String(255))
    admin_memo: Mapped[str | None] = mapped_column(Text)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    object_class: Mapped[ObjectClass] = relationship(back_populates="found_items")
    detected_object: Mapped[DetectedObject | None] = relationship(back_populates="found_item")
    match_candidates: Mapped[list[MatchCandidate]] = relationship(back_populates="found_item")
    ownership_claims: Mapped[list[OwnershipClaim]] = relationship(back_populates="found_item")


class LostReport(Base):
    __tablename__ = "lost_reports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    object_class_id: Mapped[int] = mapped_column(ForeignKey("object_classes.id"), nullable=False)
    color: Mapped[str | None] = mapped_column(String(50))
    description: Mapped[str] = mapped_column(Text, nullable=False)
    area_name: Mapped[str] = mapped_column(String(100), nullable=False)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    lost_from: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    lost_to: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    image_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="OPEN")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="lost_reports")
    object_class: Mapped[ObjectClass] = relationship(back_populates="lost_reports")
    match_candidates: Mapped[list[MatchCandidate]] = relationship(back_populates="lost_report")
    ownership_claims: Mapped[list[OwnershipClaim]] = relationship(back_populates="lost_report")


class MatchCandidate(Base):
    __tablename__ = "match_candidates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lost_report_id: Mapped[int] = mapped_column(
        ForeignKey("lost_reports.id", ondelete="CASCADE"), nullable=False
    )
    found_item_id: Mapped[int] = mapped_column(
        ForeignKey("found_items.id", ondelete="CASCADE"), nullable=False
    )
    total_score: Mapped[int] = mapped_column(Integer, nullable=False)
    type_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    area_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    time_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    keyword_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SUGGESTED")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    lost_report: Mapped[LostReport] = relationship(back_populates="match_candidates")
    found_item: Mapped[FoundItem] = relationship(back_populates="match_candidates")


class OwnershipClaim(Base):
    __tablename__ = "ownership_claims"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    lost_report_id: Mapped[int | None] = mapped_column(ForeignKey("lost_reports.id", ondelete="SET NULL"))
    found_item_id: Mapped[int] = mapped_column(
        ForeignKey("found_items.id", ondelete="CASCADE"), nullable=False
    )
    verification_details: Mapped[str] = mapped_column(Text, nullable=False)
    additional_image_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    admin_memo: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="ownership_claims", foreign_keys=[user_id])
    reviewer: Mapped[User | None] = relationship(back_populates="reviewed_claims", foreign_keys=[reviewed_by])
    lost_report: Mapped[LostReport | None] = relationship(back_populates="ownership_claims")
    found_item: Mapped[FoundItem] = relationship(back_populates="ownership_claims")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    notification_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    related_type: Mapped[str | None] = mapped_column(String(50))
    related_id: Mapped[int | None] = mapped_column(BigInteger)
    read_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="notifications")


class ProcessingHistory(Base):
    __tablename__ = "processing_histories"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    previous_status: Mapped[str | None] = mapped_column(String(30))
    new_status: Mapped[str | None] = mapped_column(String(30))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)

    actor: Mapped[User | None] = relationship()
