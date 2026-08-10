<?php

declare(strict_types=1);

namespace App\Ideamart;

use Throwable;

/**
 * Ideamart callback (inbound webhook) handlers — framework-neutral PHP.
 *
 * Routes to register in the IdeaPro portal:
 *   MO SMS                    POST /api/ideamart/sms/mo
 *   Delivery report           POST /api/ideamart/sms/dlr
 *   USSD receive              POST /api/ideamart/ussd
 *   Subscription notification POST /api/ideamart/subscription/notification
 *   Charging notification     POST /api/ideamart/charging/notification
 *
 * The contract, for all five:
 *   - Respond {"statusCode":"S1000","statusDetail":"Success"}
 *   - Respond FIRST, work afterwards
 *   - Always HTTP 200, even for payloads you reject
 *   - Be idempotent — every callback can arrive more than once
 *   - Never trust the body; it is unauthenticated JSON from the internet
 *
 * Laravel: make each method a controller action returning response()->json(self::ACK),
 * put the routes in routes/api.php (which is CSRF-exempt), and dispatch a queued
 * Job instead of calling handleJob() inline.
 *
 * Full rules: references/07-callbacks.md.
 */
final class IdeamartCallbacks
{
    /** The only response Ideamart expects. */
    public const ACK = ['statusCode' => 'S1000', 'statusDetail' => 'Success'];

    /**
     * Restrict to Ideamart's egress IPs. Ideamart signs nothing, so there is no
     * signature to verify — source IP is the strongest control available. Ask
     * support for the current list. Prefer enforcing it at the firewall or load
     * balancer; this is the fallback for when you cannot.
     *
     * @var list<string>
     */
    public const IDEAMART_SOURCE_IPS = [];

    public function __construct(
        private readonly IdeamartConfig $config,
        private readonly IdeamartClient $client,
        private readonly UssdSessionStore $sessions,
        private readonly DedupeStore $dedupe,
        private readonly JobQueue $queue,
    ) {
    }

    /* ── Shared guards ────────────────────────────────────────────────────── */

    public static function isAllowedSource(?string $remoteAddress): bool
    {
        if (self::IDEAMART_SOURCE_IPS === []) {
            return true; // not configured yet
        }

        return $remoteAddress !== null
            && in_array($remoteAddress, self::IDEAMART_SOURCE_IPS, true);
    }

    /**
     * Read the JSON body without failing the response on malformed input.
     *
     * @return array<string, mixed>|null
     */
    public static function readJson(string $raw): ?array
    {
        $decoded = json_decode($raw, true);

        return is_array($decoded) ? $decoded : null;
    }

    /** Reject payloads addressed to a different application. Cheap noise filter. */
    private function isOurApp(array $body): bool
    {
        return ($body['applicationId'] ?? null) === $this->config->applicationId;
    }

    /* ── 1. MO SMS ────────────────────────────────────────────────────────── */

    /** @param array<string, mixed>|null $body */
    public function moSms(?array $body): array
    {
        if ($body === null || !$this->isOurApp($body) || empty($body['requestId'])) {
            return self::ACK;
        }
        if ($this->dedupe->isDuplicate('mo:' . $body['requestId'])) {
            return self::ACK;
        }

        // Message content deliberately not logged — it is user communication.
        error_log(sprintf(
            '[ideamart] mo-sms requestId=%s from=%s',
            (string) $body['requestId'],
            IdeamartClient::maskAddress((string) ($body['sourceAddress'] ?? ''))
        ));

        $this->queue->push('sms.mo', $body);

        return self::ACK;
    }

    /* ── 2. SMS delivery report ───────────────────────────────────────────── */

    /** Ideamart and the SMPP gateway use different spellings. Normalise both. */
    private const DELIVERY_STATUS = [
        'DELIVRD' => 'DELIVERED',
        'UNDELIV' => 'UNDELIVERABLE',
        'ACCEPTD' => 'ACCEPTED',
        'REJECTD' => 'REJECTED',
    ];

    /** @param array<string, mixed>|null $body */
    public function deliveryReport(?array $body): array
    {
        if ($body === null || empty($body['requestId']) || empty($body['deliveryStatus'])) {
            return self::ACK;
        }

        $raw = (string) $body['deliveryStatus'];
        $status = self::DELIVERY_STATUS[$raw] ?? $raw;
        if ($this->dedupe->isDuplicate("dlr:{$body['requestId']}:{$status}")) {
            return self::ACK;
        }

        error_log(sprintf(
            '[ideamart] delivery-report requestId=%s status=%s',
            (string) $body['requestId'],
            $status
        ));

        $this->queue->push('sms.dlr', array_merge($body, ['deliveryStatus' => $status]));

        return self::ACK;
    }

    /**
     * Timestamps arrive as either yyMMddHHmm (10) or yyyyMMddHHmmss (14).
     * Parse both; return null rather than guessing.
     */
    public static function parseIdeamartTimestamp(string $raw): ?\DateTimeImmutable
    {
        $format = match (strlen($raw)) {
            14 => 'YmdHis',
            10 => 'ymdHi',
            default => null,
        };
        if ($format === null || !ctype_digit($raw)) {
            return null;
        }

        $parsed = \DateTimeImmutable::createFromFormat(
            $format,
            $raw,
            new \DateTimeZone('UTC')
        );

        return $parsed === false ? null : $parsed;
    }

    /* ── 3. USSD receive ──────────────────────────────────────────────────── */

    /**
     * The response body here is ONLY an acknowledgement. The screen the user
     * sees comes from a separate POST /ussd/send — which is why the reply is
     * queued rather than returned.
     *
     * USSD sessions time out in seconds. Do nothing slow before acknowledging.
     *
     * @param array<string, mixed>|null $body
     */
    public function ussd(?array $body): array
    {
        if ($body === null || !$this->isOurApp($body)) {
            return self::ACK;
        }
        if (empty($body['sessionId']) || empty($body['sourceAddress'])) {
            return self::ACK;
        }
        if ($this->dedupe->isDuplicate('ussd:' . ($body['requestId'] ?? ''))) {
            return self::ACK;
        }

        error_log(sprintf(
            '[ideamart] ussd sessionId=%s operation=%s from=%s',
            (string) $body['sessionId'],
            (string) ($body['ussdOperation'] ?? ''),
            IdeamartClient::maskAddress((string) $body['sourceAddress'])
        ));

        $this->queue->push('ussd.receive', $body);

        return self::ACK;
    }

    /**
     * The menu logic, run out of band. Replies via sendUssd().
     *
     * @param array<string, mixed> $payload
     */
    public function handleUssdInput(array $payload): void
    {
        $sessionId = (string) $payload['sessionId'];
        $source = (string) $payload['sourceAddress'];
        $input = trim((string) ($payload['message'] ?? ''));

        if (($payload['ussdOperation'] ?? '') === 'mo-init') {
            $this->sessions->set($sessionId, 'root', $source);
            $this->client->sendUssd(
                $sessionId,
                $source,
                "Welcome to Acme\n1. Balance\n2. Support\n0. Exit",
                'mt-cont'
            );

            return;
        }

        if ($this->sessions->get($sessionId) === null) {
            // Expired or unknown — close cleanly rather than leaving it hanging.
            $this->client->sendUssd(
                $sessionId,
                $source,
                'Session expired. Please dial again.',
                'mt-fin'
            );

            return;
        }

        // Terminal screens MUST use mt-fin, or the session hangs until the
        // network times it out.
        switch ($input) {
            case '0':
                $this->sessions->end($sessionId);
                $this->client->sendUssd($sessionId, $source, 'Thank you.', 'mt-fin');

                return;

            case '1':
                $this->sessions->end($sessionId);
                $this->client->sendUssd(
                    $sessionId,
                    $source,
                    'Your balance is Rs. 300.00',
                    'mt-fin'
                );

                return;

            case '2':
                $this->sessions->set($sessionId, 'support', $source);
                $this->client->sendUssd(
                    $sessionId,
                    $source,
                    "Support\n1. Call us\n2. SMS us\n0. Exit",
                    'mt-cont'
                );

                return;

            default:
                // Invalid input: reshow rather than dropping the session.
                $this->client->sendUssd(
                    $sessionId,
                    $source,
                    "Invalid option\n1. Balance\n2. Support\n0. Exit",
                    'mt-cont'
                );
        }
    }

    /* ── 4. Subscription notification ─────────────────────────────────────── */

    /**
     * The authoritative source of subscription state — including changes you did
     * not initiate (a user texting STOP, an operator removal, a billing
     * failure). Consuming this is what lets you keep a local mirror instead of
     * polling getStatus.
     *
     * @param array<string, mixed>|null $body
     */
    public function subscriptionNotification(?array $body): array
    {
        if ($body === null || !$this->isOurApp($body)) {
            return self::ACK;
        }
        if (empty($body['subscriberId']) || empty($body['status'])) {
            return self::ACK;
        }

        $key = sprintf(
            'sub:%s:%s:%s',
            $body['subscriberId'],
            $body['status'],
            $body['timeStamp'] ?? ''
        );
        if ($this->dedupe->isDuplicate($key)) {
            return self::ACK;
        }

        error_log(sprintf(
            '[ideamart] subscription-notification subscriber=%s status=%s',
            IdeamartClient::maskAddress((string) $body['subscriberId']),
            (string) $body['status']
        ));

        $this->queue->push('subscription.notification', $body);

        return self::ACK;
    }

    /* ── 5. Charging notification ─────────────────────────────────────────── */

    /**
     * Your reconciliation channel. Every charge left unknown after a timeout gets
     * resolved here. Idempotency is not optional — a duplicate that
     * double-counts revenue is a real bug with real consequences.
     *
     * The Charging Notification URL is a documented provisioning field, but its
     * PAYLOAD IS NOT PUBLISHED. The fields read below are inferred from the
     * debit response and are not guaranteed. Log the raw body once in Limited
     * Production and adjust to what actually arrives.
     *
     * @param array<string, mixed>|null $body
     */
    public function chargingNotification(?array $body): array
    {
        if ($body === null) {
            return self::ACK;
        }

        $key = $body['externalTrxId'] ?? $body['internalTrxId'] ?? null;
        if ($key === null) {
            return self::ACK;
        }
        if ($this->dedupe->isDuplicate("charge:{$key}:" . ($body['statusCode'] ?? ''))) {
            return self::ACK;
        }

        error_log(sprintf(
            '[ideamart] charging-notification externalTrxId=%s statusCode=%s',
            (string) ($body['externalTrxId'] ?? ''),
            (string) ($body['statusCode'] ?? '')
        ));

        $this->queue->push('charging.notification', $body);

        return self::ACK;
    }

    /* ── Job dispatch ─────────────────────────────────────────────────────── */

    /** @param array<string, mixed> $payload */
    public function handleJob(string $job, array $payload): void
    {
        try {
            match ($job) {
                'ussd.receive' => $this->handleUssdInput($payload),
                // Honour opt-out keywords, then handle your own commands.
                'sms.mo' => null,
                // Persist the latest status keyed by requestId.
                'sms.dlr' => null,
                // Upsert your local subscription mirror.
                'subscription.notification' => null,
                // Reconcile against your transaction ledger by externalTrxId.
                'charging.notification' => null,
                default => error_log("[ideamart] unknown job {$job}"),
            };
        } catch (Throwable $error) {
            error_log("[ideamart] job {$job} failed: " . $error->getMessage());
            // Send to a dead-letter queue here.
        }
    }
}

/**
 * Deduplication. The array implementation below lives only as long as one
 * request, which is useless — wire this to Redis (SETNX + TTL) or a unique
 * database constraint, because duplicates arrive as separate requests.
 */
interface DedupeStore
{
    public function isDuplicate(string $key): bool;
}

/**
 * USSD session store: keyed by sessionId, ~2 minute TTL, shared across
 * processes. PHP has no long-lived process to hold sessions in, so Redis (or a
 * database table with an expiry column) is the only correct implementation here.
 */
interface UssdSessionStore
{
    public function get(string $sessionId): ?string;

    public function set(string $sessionId, string $node, string $sourceAddress): void;

    public function end(string $sessionId): void;
}

/**
 * Work handed off so the HTTP response does not wait for it.
 *
 * PHP-FPM has no background worker of its own: a queue (Laravel queues, a Redis
 * list drained by a worker, a database table with a cron consumer) is required.
 * fastcgi_finish_request() flushes the response early and is an acceptable
 * stopgap for USSD, but it does not survive a crash — never use it for charging
 * reconciliation.
 */
interface JobQueue
{
    /** @param array<string, mixed> $payload */
    public function push(string $job, array $payload): void;
}

/* ── Front controller ──────────────────────────────────────────────────────
 *
 * A plain-PHP entry point, for projects without a framework router:
 *
 *   $body = IdeamartCallbacks::readJson(file_get_contents('php://input') ?: '');
 *   $callbacks = new IdeamartCallbacks($config, $client, $sessions, $dedupe, $queue);
 *
 *   $response = match ($_SERVER['REQUEST_URI'] ?? '') {
 *       '/api/ideamart/sms/mo'                    => $callbacks->moSms($body),
 *       '/api/ideamart/sms/dlr'                   => $callbacks->deliveryReport($body),
 *       '/api/ideamart/ussd'                      => $callbacks->ussd($body),
 *       '/api/ideamart/subscription/notification' => $callbacks->subscriptionNotification($body),
 *       '/api/ideamart/charging/notification'     => $callbacks->chargingNotification($body),
 *       default                                   => IdeamartCallbacks::ACK,
 *   };
 *
 *   http_response_code(200);                      // ALWAYS 200
 *   header('Content-Type: application/json');
 *   echo json_encode($response);
 *
 * Keep these paths out of any auth middleware and rely on the source-IP
 * allowlist instead — or you have left an open endpoint.
 */
