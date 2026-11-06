"""1: store Open-Meteo weather on activities

Fork-only. Dreeve shows temperature, humidity and wind on an activity; this
column holds the same hour from Open-Meteo for the start GPS point.

Revision ID: a1c0e0d4b782
Revises: d54bdd779392
Create Date: 2026-11-06 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c0e0d4b782"
down_revision: str | None = "d54bdd779392"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column(
            "weather",
            sa.JSON(),
            nullable=True,
            comment="Open-Meteo hour at the activity start (temperature, humidity, wind)",
        ),
    )
    op.add_column(
        "activities",
        sa.Column(
            "weather_next_lookup_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Earliest time the weather backfill retries an activity with no weather",
        ),
    )


def downgrade() -> None:
    op.drop_column("activities", "weather_next_lookup_at")
    op.drop_column("activities", "weather")
