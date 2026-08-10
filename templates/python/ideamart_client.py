"""
Ideamart API client — Python port of templates/typescript/ideamart-client.ts.

One `_post()` helper injects credentials, applies a timeout, and turns non-S1000
responses into typed errors. Every service is a thin wrapper that resolves its
endpoint through `config.require_endpoint()` — so calling an API your
application was not provisioned for fails locally with a clear message, rather
than as E1309 from the platform.

Standard library only, so it drops into any project without adding a dependency.
Using httpx or requests instead is fine and usually better in an existing
codebase — replace `_request()` and keep everything else:

    resp = httpx.post(url, json=payload, timeout=TIMEOUT_SECONDS)
    data = resp.json()          # note: still do NOT call resp.raise_for_status()
                                # as a success check — see _post().

SERVER-SIDE ONLY.
"""

from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.request
import uuid
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Union

from ideamart_config import config

#: A single outbound call should never hang. Protocol constant, not config.
TIMEOUT_SECONDS = 15

#: Ideamart hosts have served an incomplete certificate chain, which strict
#: clients reject. Do NOT "fix" that with ssl._create_unverified_context() or
#: verify=False — that lets anyone on the path read the applicationId and
#: password that can charge your subscribers. Supply the intermediate CA:
#:
#:     SSL_CONTEXT = ssl.create_default_context(cafile="certs/ideamart-chain.pem")
#:
#: See references/09-security-best-practices.md.
SSL_CONTEXT = ssl.create_default_context()

# ── Errors ───────────────────────────────────────────────────────────────────

#: Platform-side. Worth retrying with backoff.
TRANSIENT = frozenset(
    {
        "E1316", "E1318", "E1319", "E1332", "E1341",
        "E1360", "E1363", "E1364", "E1600", "E1601", "E1602", "E1603",
    }
)

#: Provisioning or credentials are wrong. Retrying will never help.
CONFIGURATION = frozenset(
    {
        "E1301", "E1302", "E1303", "E1304", "E1305", "E1306", "E1307",
        "E1309", "E1310", "E1311", "E1313", "E1315", "E1322", "E1323",
        "E1324", "E1327", "E1328", "E1329", "E1336", "E1371", "E1381",
        "E1383", "E1387",
    }
)

#: Codes meaning "the state you wanted already holds".
BENIGN_REGISTER = "E1351"    # user already registered
BENIGN_UNREGISTER = "E1356"  # user not registered
BENIGN_DEBIT = "E1379"       # transaction already completed


class IdeamartError(Exception):
    def __init__(
        self,
        status_code: str,
        status_detail: str,
        service: str,
        raw: Optional[Mapping[str, Any]] = None,
    ) -> None:
        super().__init__(f"[{status_code}] {status_detail} ({service})")
        self.status_code = status_code
        self.status_detail = status_detail
        self.service = service
        self.raw = raw

    @property
    def retryable(self) -> bool:
        return self.status_code in TRANSIENT

    @property
    def is_configuration(self) -> bool:
        return self.status_code in CONFIGURATION


# ── Helpers ──────────────────────────────────────────────────────────────────

_SEPARATORS = re.compile(r"[\s()\-]")


def to_tel_address(msisdn: str) -> str:
    """
    Normalise a subscriber address. The ONLY place `tel:` is added.

    Accepts an already-prefixed address, a masked hash, +94…, 0094… or a local
    07… number.
    """
    trimmed = (msisdn or "").strip()
    if not trimmed:
        raise ValueError("[ideamart] Empty subscriber address")
    if trimmed.lower().startswith("tel:"):
        return trimmed

    digits = _SEPARATORS.sub("", trimmed).lstrip("+")
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 10:
        digits = "94" + digits[1:]
    return f"tel:{digits}"


def mask_address(address: str) -> str:
    """Mask a subscriber address for logging. Never log the raw value."""
    body = re.sub(r"^tel:", "", address, flags=re.IGNORECASE)
    if len(body) <= 6:
        return "tel:***"
    return f"tel:{body[:3]}{'*' * (len(body) - 6)}{body[-3:]}"


def generate_external_trx_id() -> str:
    """A unique, persistable idempotency key for a charge. Max 32 characters."""
    return uuid.uuid4().hex


def format_amount(amount: Union[Decimal, str]) -> str:
    """
    Money crosses the wire as a string. Keep it in Decimal in your own code —
    a float will eventually charge someone 99.99999 rupees.
    """
    if isinstance(amount, float):  # pragma: no cover - guard against a real bug
        raise TypeError("[ideamart] Use Decimal or str for money, never float")
    return str(amount)


# ── Core ─────────────────────────────────────────────────────────────────────


def _request(url: str, body: bytes) -> Dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
    )
    try:
        with urllib.request.urlopen(
            request, timeout=TIMEOUT_SECONDS, context=SSL_CONTEXT
        ) as response:
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # Ideamart answers 200 even for its own errors, so a non-2xx here is a
        # gateway/proxy problem — but the body may still be the real answer.
        text = exc.read().decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"[ideamart] Non-JSON response: {text[:200]}") from exc


def _post(
    service: str,
    url: str,
    body: Mapping[str, Any],
    benign_codes: Iterable[str] = (),
) -> Dict[str, Any]:
    payload = {
        "applicationId": config.application_id,
        "password": config.password,
        **body,
    }
    data = _request(url, json.dumps(payload).encode("utf-8"))

    status = data.get("statusCode")
    if status == "S1000" or status in set(benign_codes):
        return data
    raise IdeamartError(
        str(status), str(data.get("statusDetail", "")), service, data
    )


# ── SMS ──────────────────────────────────────────────────────────────────────


def send_sms(
    to: Union[str, Sequence[str]],
    message: str,
    *,
    source_address: Optional[str] = None,
    delivery_status_request: Optional[str] = None,
    encoding: Optional[str] = None,
    charging_amount: Optional[str] = None,
) -> Dict[str, Any]:
    """Send an MT SMS to one or more subscribers."""
    recipients: List[str] = [
        to_tel_address(x) for x in ([to] if isinstance(to, str) else list(to))
    ]
    if "tel:all" in recipients:
        raise ValueError(
            "[ideamart] Use broadcast_sms() for tel:all — broadcasts must be deliberate."
        )
    body: Dict[str, Any] = {"message": message, "destinationAddresses": recipients}
    if source_address:
        body["sourceAddress"] = source_address
    if delivery_status_request:
        body["deliveryStatusRequest"] = delivery_status_request
    if encoding:
        body["encoding"] = encoding
    if charging_amount:
        body["chargingAmount"] = charging_amount
    return _post("sms-send", config.require_endpoint("sms_send"), body)


BROADCAST_CONFIRMATION = "I_HAVE_VERIFIED_THIS_GOES_TO_ALL_SUBSCRIBERS"


def broadcast_sms(message: str, confirmation: str, **options: Any) -> Dict[str, Any]:
    """
    Send to the ENTIRE subscribed base.

    Deliberately separate from send_sms so it can never be reached by accident —
    check the subscriber base size first, and put an authorisation check in
    front of this.
    """
    if confirmation != BROADCAST_CONFIRMATION:
        raise ValueError("[ideamart] Broadcast confirmation token missing")
    body: Dict[str, Any] = {"message": message, "destinationAddresses": ["tel:all"]}
    body.update({k: v for k, v in options.items() if v is not None})
    return _post("sms-send", config.require_endpoint("sms_send"), body)


# ── USSD ─────────────────────────────────────────────────────────────────────


def send_ussd(
    *, session_id: str, destination_address: str, message: str, operation: str
) -> Dict[str, Any]:
    """
    Send a USSD screen.

    `session_id` MUST be the one the platform sent you. Use "mt-fin" for the
    final screen — anything else leaves the session hanging until the network
    times out.
    """
    if operation not in {"mt-init", "mt-cont", "mt-fin"}:
        raise ValueError(f"[ideamart] Invalid ussdOperation '{operation}'")
    return _post(
        "ussd-send",
        config.require_endpoint("ussd_send"),
        {
            "message": message,
            "sessionId": session_id,
            "ussdOperation": operation,
            "destinationAddress": to_tel_address(destination_address),
            "encoding": "440",
            "version": "1.0",
        },
    )


# ── Subscription ─────────────────────────────────────────────────────────────


def register(subscriber_id: str) -> Dict[str, Any]:
    """
    Opt a subscriber in. Only call this with recorded, explicit consent.

    E1351 (already registered) is accepted as success — the desired state holds.
    """
    return _post(
        "subscription-register",
        config.require_endpoint("subscription_send"),
        {
            "subscriberId": to_tel_address(subscriber_id),
            "action": "1",
            "version": "1.0",
        },
        [BENIGN_REGISTER],
    )


def unregister(subscriber_id: str) -> Dict[str, Any]:
    """
    Opt a subscriber out.

    E1356 (not registered) is accepted as success — the desired state holds.
    """
    return _post(
        "subscription-unregister",
        config.require_endpoint("subscription_send"),
        {
            "subscriberId": to_tel_address(subscriber_id),
            "action": "0",
            "version": "1.0",
        },
        [BENIGN_UNREGISTER],
    )


def get_subscription_status(subscriber_id: str) -> Dict[str, Any]:
    """Check one subscriber's status. For reconciliation, not per-request gating."""
    return _post(
        "subscription-status",
        config.require_endpoint("subscription_status"),
        {"subscriberId": to_tel_address(subscriber_id)},
    )


def query_base() -> Dict[str, Any]:
    """
    Subscriber base size. Needs no subscriber and charges nothing, which also
    makes it the best connectivity and credential smoke test.

    `baseSize` comes back as a string, so a parsed integer is added alongside.
    """
    response = _post(
        "subscription-query-base",
        config.require_endpoint("subscription_query_base"),
        {},
    )
    return {**response, "size": int(response.get("baseSize") or 0)}


# ── OTP ──────────────────────────────────────────────────────────────────────


def request_otp(
    *,
    subscriber_id: str,
    meta_data: Mapping[str, Any],
    application_hash: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Send an OTP to a plain mobile number.

    Rate-limit per number AND per IP before calling, or the app becomes an
    SMS-bombing tool. Keep the returned referenceNo server-side; never log it.
    """
    body: Dict[str, Any] = {
        "subscriberId": to_tel_address(subscriber_id),
        "applicationMetaData": dict(meta_data),
    }
    if application_hash:
        body["applicationHash"] = application_hash
    return _post("otp-request", config.require_endpoint("otp_request"), body)


def verify_otp(*, reference_no: str, otp: str) -> Dict[str, Any]:
    """
    Verify an OTP. Valid 60 minutes, maximum 3 attempts — enforce those limits
    on your side too. The returned subscriberId is the masked identifier to use
    for every subsequent call.
    """
    return _post(
        "otp-verify",
        config.require_endpoint("otp_verify"),
        {"referenceNo": reference_no, "otp": otp},
    )


# ── CaaS ─────────────────────────────────────────────────────────────────────


def debit(
    *,
    subscriber_id: str,
    amount: Union[Decimal, str],
    external_trx_id: str,
    currency: str = "LKR",
    account_id: Optional[str] = None,
    payment_instrument: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Charge a subscriber's mobile account.

    THIS MOVES REAL MONEY.

    - `external_trx_id` is your idempotency key. Generate it with
      generate_external_trx_id(), PERSIST IT, then call this.
    - There are deliberately no retries here. A timeout does NOT mean the charge
      failed. Resolve unknown outcomes by re-calling with the SAME
      external_trx_id, or by reconciling against the charging notification.
      Never re-roll the id.
    - E1379 (already completed) is accepted as success.
    """
    if not external_trx_id:
        raise ValueError(
            "[ideamart] external_trx_id is required and must be persisted first"
        )
    if len(external_trx_id) > 32:
        raise ValueError("[ideamart] external_trx_id must be 32 characters or fewer")

    body: Dict[str, Any] = {
        "externalTrxId": external_trx_id,
        "subscriberId": to_tel_address(subscriber_id),
        "amount": format_amount(amount),
        "currency": currency,
    }
    if account_id:
        body["accountId"] = account_id
    if payment_instrument:
        body["paymentInstrument"] = payment_instrument
    return _post(
        "caas-direct-debit",
        config.require_endpoint("caas_debit"),
        body,
        [BENIGN_DEBIT],
    )


def query_balance(
    *,
    subscriber_id: str,
    currency: str = "LKR",
    account_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Query chargeable balance.

    Advisory only: the balance can change between this and the debit. Always
    handle E1378 on the debit regardless of what this returned.

    Not configuring IDEAMART_CAAS_BALANCE_URL is how you disable this on an
    application without the "Enable Query Balance Requests" toggle.
    """
    body: Dict[str, Any] = {
        "subscriberId": to_tel_address(subscriber_id),
        "currency": currency,
    }
    if account_id:
        body["accountId"] = account_id
    return _post("caas-balance-query", config.require_endpoint("caas_balance"), body)


# ── LBS ──────────────────────────────────────────────────────────────────────


def locate(
    *,
    subscriber_id: str,
    service_type: str,
    version: Optional[str] = None,
    response_time: Optional[str] = None,
    horizontal_accuracy: Optional[str] = None,
    freshness: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Locate a subscriber. Network-derived, accuracy in hundreds of metres.

    Requires explicit, purpose-specific consent — consent to receive SMS is not
    consent to be located. Omit the QoS fields unless you know your provisioned
    level; requesting above it fails with E1367.
    """
    body: Dict[str, Any] = {
        "subscriberId": to_tel_address(subscriber_id),
        "serviceType": service_type,
    }
    for key, value in (
        ("version", version),
        ("responseTime", response_time),
        ("horizontalAccuracy", horizontal_accuracy),
        ("freshness", freshness),
    ):
        if value:
            body[key] = value
    return _post("lbs-locate", config.require_endpoint("lbs_locate"), body)


# ── Extension point ──────────────────────────────────────────────────────────
#
# Adding a service Ideamart publishes later:
#
#   1. Add its URL variable to .env.example and to _ENDPOINT_VARS in
#      ideamart_config.py
#   2. Add one wrapper here:
#
#          def new_thing(**kwargs):
#              return _post("new-thing", config.require_endpoint("new_thing"), kwargs)
#
# It inherits credential injection, the timeout, error mapping and the
# not-provisioned guard for free. Do not build a parallel client.
