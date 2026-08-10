"""Create one explicit ADMIN account without storing credentials in source code."""

from argparse import ArgumentParser
from getpass import getpass

from app.core.security import hash_password, normalize_email, utc_now
from app.db.session import SessionLocal
from app.models import User
from app.repositories.user_flow import get_user_by_email


def main() -> None:
    parser = ArgumentParser(description="Create a FlowLink administrator account")
    parser.add_argument("--email", required=True)
    parser.add_argument("--nickname", required=True)
    args = parser.parse_args()
    password = getpass("Admin password: ")
    if len(password) < 8 or password != getpass("Confirm password: "):
        raise SystemExit("Password must be at least 8 characters and both entries must match.")

    email = normalize_email(args.email)
    with SessionLocal() as db:
        if get_user_by_email(db, email) is not None:
            raise SystemExit("An account with this email already exists; existing roles are not modified.")
        now = utc_now()
        db.add(User(email=email, password_hash=hash_password(password), nickname=args.nickname.strip(), role="ADMIN", active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now))
        db.commit()
    print(f"ADMIN account created for {email}")


if __name__ == "__main__":
    main()
