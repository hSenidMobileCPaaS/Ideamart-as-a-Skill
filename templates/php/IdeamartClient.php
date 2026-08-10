<?php

declare(strict_types=1);

namespace App\Ideamart;

use InvalidArgumentException;
use RuntimeException;

/**
 * Ideamart API client — PHP port of templates/typescript/ideamart-client.ts.
 *
 * One post() helper injects credentials, applies a timeout, and turns non-S1000
 * responses into typed errors. Every service is a thin wrapper that resolves its
 * endpoint through IdeamartConfig::requireEndpoint() — so calling an API your
 * application was not provisioned for fails locally with a clear message, rather
 * than as E1309 from the platform.
 *
 * Uses the cURL extension so it drops into any project without Composer
 * dependencies. Guzzle is a fine substitute — replace request() and keep
 * everything else, but do NOT enable http_errors as a success check: Ideamart
 * returns HTTP 200 for its own failures.
 *
 * Requires PHP 8.1+ (readonly properties, enums-free but typed constants). IdeamartException
 * shares this file for readability — split it into its own file if you autoload with PSR-4.
 *
 * SERVER-SIDE ONLY.
 */
final class IdeamartClient
{
    /** A single outbound call should never hang. Protocol constant, not config. */
    private const TIMEOUT_SECONDS = 15;

    /** Platform-side. Worth retrying with backoff. */
    public const TRANSIENT = [
        'E1316', 'E1318', 'E1319', 'E1332', 'E1341',
        'E1360', 'E1363', 'E1364', 'E1600', 'E1601', 'E1602', 'E1603',
    ];

    /** Provisioning or credentials are wrong. Retrying will never help. */
    public const CONFIGURATION = [
        'E1301', 'E1302', 'E1303', 'E1304', 'E1305', 'E1306', 'E1307',
        'E1309', 'E1310', 'E1311', 'E1313', 'E1315', 'E1322', 'E1323',
        'E1324', 'E1327', 'E1328', 'E1329', 'E1336', 'E1371', 'E1381',
        'E1383', 'E1387',
    ];

    /** Codes meaning "the state you wanted already holds". */
    public const BENIGN_REGISTER   = 'E1351'; // user already registered
    public const BENIGN_UNREGISTER = 'E1356'; // user not registered
    public const BENIGN_DEBIT      = 'E1379'; // transaction already completed

    public const BROADCAST_CONFIRMATION = 'I_HAVE_VERIFIED_THIS_GOES_TO_ALL_SUBSCRIBERS';

    public function __construct(private readonly IdeamartConfig $config)
    {
    }

    /* ── Helpers ──────────────────────────────────────────────────────────── */

    /**
     * Normalise a subscriber address. The ONLY place `tel:` is added.
     *
     * Accepts an already-prefixed address, a masked hash, +94…, 0094… or a
     * local 07… number.
     */
    public static function toTelAddress(string $msisdn): string
    {
        $trimmed = trim($msisdn);
        if ($trimmed === '') {
            throw new InvalidArgumentException('[ideamart] Empty subscriber address');
        }
        if (stripos($trimmed, 'tel:') === 0) {
            return $trimmed;
        }

        $digits = ltrim((string) preg_replace('/[\s()\-]/', '', $trimmed), '+');
        if (str_starts_with($digits, '00')) {
            $digits = substr($digits, 2);
        }
        if (str_starts_with($digits, '0') && strlen($digits) === 10) {
            $digits = '94' . substr($digits, 1);
        }

        return 'tel:' . $digits;
    }

    /** Mask a subscriber address for logging. Never log the raw value. */
    public static function maskAddress(string $address): string
    {
        $body = (string) preg_replace('/^tel:/i', '', $address);
        if (strlen($body) <= 6) {
            return 'tel:***';
        }

        return 'tel:' . substr($body, 0, 3)
            . str_repeat('*', strlen($body) - 6)
            . substr($body, -3);
    }

    /** A unique, persistable idempotency key for a charge. Max 32 characters. */
    public static function generateExternalTrxId(): string
    {
        return bin2hex(random_bytes(16));
    }

    /* ── Core ─────────────────────────────────────────────────────────────── */

    /**
     * @param array<string, mixed> $body
     * @param list<string>         $benignCodes
     *
     * @return array<string, mixed>
     */
    private function post(string $service, string $url, array $body, array $benignCodes = []): array
    {
        $payload = json_encode(
            array_merge(
                [
                    'applicationId' => $this->config->applicationId,
                    'password'      => $this->config->password,
                ],
                $body
            ),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES
        );

        $data = $this->request($service, $url, $payload);

        $statusCode = (string) ($data['statusCode'] ?? '');
        if ($statusCode === 'S1000' || in_array($statusCode, $benignCodes, true)) {
            return $data;
        }

        throw new IdeamartException(
            $statusCode,
            (string) ($data['statusDetail'] ?? ''),
            $service,
            $data
        );
    }

    /** @return array<string, mixed> */
    private function request(string $service, string $url, string $payload): array
    {
        $handle = curl_init($url);
        if ($handle === false) {
            throw new RuntimeException("[ideamart] {$service}: could not initialise cURL");
        }

        curl_setopt_array($handle, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => self::TIMEOUT_SECONDS,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            // Ideamart hosts have served an incomplete certificate chain. Do NOT
            // "fix" that with CURLOPT_SSL_VERIFYPEER => false — that lets anyone
            // on the path read the applicationId and password that can charge
            // your subscribers. Supply the intermediate CA instead:
            //   CURLOPT_CAINFO => __DIR__ . '/certs/ideamart-chain.pem',
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);

        $raw = curl_exec($handle);
        $error = curl_error($handle);
        curl_close($handle);

        if ($raw === false) {
            throw new RuntimeException("[ideamart] {$service}: transport failure: {$error}");
        }

        // The HTTP status is deliberately not consulted: Ideamart returns 200 for
        // application-level failures, and the real outcome is statusCode.
        $decoded = json_decode((string) $raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException(
                "[ideamart] {$service}: non-JSON response: " . substr((string) $raw, 0, 200)
            );
        }

        return $decoded;
    }

    /* ── SMS ──────────────────────────────────────────────────────────────── */

    /**
     * Send an MT SMS to one or more subscribers.
     *
     * @param string|list<string>  $to
     * @param array<string, mixed> $options sourceAddress, deliveryStatusRequest,
     *                                      encoding, chargingAmount
     *
     * @return array<string, mixed>
     */
    public function sendSms(string|array $to, string $message, array $options = []): array
    {
        $recipients = array_map(
            [self::class, 'toTelAddress'],
            is_array($to) ? $to : [$to]
        );
        if (in_array('tel:all', $recipients, true)) {
            throw new InvalidArgumentException(
                '[ideamart] Use broadcastSms() for tel:all — broadcasts must be deliberate.'
            );
        }

        return $this->post('sms-send', $this->config->requireEndpoint('smsSend'), array_merge(
            ['message' => $message, 'destinationAddresses' => array_values($recipients)],
            $options
        ));
    }

    /**
     * Send to the ENTIRE subscribed base.
     *
     * Deliberately separate from sendSms() so it can never be reached by
     * accident — check the subscriber base size first, and put an authorisation
     * check in front of this.
     *
     * @param array<string, mixed> $options
     *
     * @return array<string, mixed>
     */
    public function broadcastSms(string $message, string $confirmation, array $options = []): array
    {
        if ($confirmation !== self::BROADCAST_CONFIRMATION) {
            throw new InvalidArgumentException('[ideamart] Broadcast confirmation token missing');
        }

        return $this->post('sms-send', $this->config->requireEndpoint('smsSend'), array_merge(
            ['message' => $message, 'destinationAddresses' => ['tel:all']],
            $options
        ));
    }

    /* ── USSD ─────────────────────────────────────────────────────────────── */

    /**
     * Send a USSD screen.
     *
     * $sessionId MUST be the one the platform sent you. Use 'mt-fin' for the
     * final screen — anything else leaves the session hanging until the network
     * times out.
     *
     * @return array<string, mixed>
     */
    public function sendUssd(
        string $sessionId,
        string $destinationAddress,
        string $message,
        string $operation
    ): array {
        if (!in_array($operation, ['mt-init', 'mt-cont', 'mt-fin'], true)) {
            throw new InvalidArgumentException("[ideamart] Invalid ussdOperation '{$operation}'");
        }

        return $this->post('ussd-send', $this->config->requireEndpoint('ussdSend'), [
            'message'            => $message,
            'sessionId'          => $sessionId,
            'ussdOperation'      => $operation,
            'destinationAddress' => self::toTelAddress($destinationAddress),
            'encoding'           => '440',
            'version'            => '1.0',
        ]);
    }

    /* ── Subscription ─────────────────────────────────────────────────────── */

    /**
     * Opt a subscriber in. Only call this with recorded, explicit consent.
     *
     * E1351 (already registered) is accepted as success — the desired state holds.
     *
     * @return array<string, mixed>
     */
    public function register(string $subscriberId): array
    {
        return $this->post(
            'subscription-register',
            $this->config->requireEndpoint('subscriptionSend'),
            [
                'subscriberId' => self::toTelAddress($subscriberId),
                'action'       => '1',
                'version'      => '1.0',
            ],
            [self::BENIGN_REGISTER]
        );
    }

    /**
     * Opt a subscriber out.
     *
     * E1356 (not registered) is accepted as success — the desired state holds.
     *
     * @return array<string, mixed>
     */
    public function unregister(string $subscriberId): array
    {
        return $this->post(
            'subscription-unregister',
            $this->config->requireEndpoint('subscriptionSend'),
            [
                'subscriberId' => self::toTelAddress($subscriberId),
                'action'       => '0',
                'version'      => '1.0',
            ],
            [self::BENIGN_UNREGISTER]
        );
    }

    /**
     * Check one subscriber's status. For reconciliation, not per-request gating.
     *
     * @return array<string, mixed>
     */
    public function subscriptionStatus(string $subscriberId): array
    {
        return $this->post(
            'subscription-status',
            $this->config->requireEndpoint('subscriptionStatus'),
            ['subscriberId' => self::toTelAddress($subscriberId)]
        );
    }

    /**
     * Subscriber base size. Needs no subscriber and charges nothing, which also
     * makes it the best connectivity and credential smoke test.
     */
    public function queryBase(): int
    {
        $data = $this->post(
            'subscription-query-base',
            $this->config->requireEndpoint('subscriptionQueryBase'),
            []
        );

        return (int) ($data['baseSize'] ?? 0); // documented as a string
    }

    /* ── OTP ──────────────────────────────────────────────────────────────── */

    /**
     * Send an OTP to a plain mobile number.
     *
     * Rate-limit per number AND per IP before calling, or the app becomes an
     * SMS-bombing tool. Keep the returned referenceNo server-side; never log it.
     *
     * @param array<string, mixed> $applicationMetaData
     *
     * @return array<string, mixed>
     */
    public function requestOtp(string $subscriberId, array $applicationMetaData): array
    {
        return $this->post('otp-request', $this->config->requireEndpoint('otpRequest'), [
            'subscriberId'        => self::toTelAddress($subscriberId),
            'applicationMetaData' => $applicationMetaData,
        ]);
    }

    /**
     * Verify an OTP. Valid 60 minutes, maximum 3 attempts — enforce those limits
     * on your side too. The returned subscriberId is the masked identifier to
     * use for every subsequent call.
     *
     * @return array<string, mixed>
     */
    public function verifyOtp(string $referenceNo, string $otp): array
    {
        return $this->post('otp-verify', $this->config->requireEndpoint('otpVerify'), [
            'referenceNo' => $referenceNo,
            'otp'         => $otp,
        ]);
    }

    /* ── CaaS ─────────────────────────────────────────────────────────────── */

    /**
     * Charge a subscriber's mobile account.
     *
     * THIS MOVES REAL MONEY.
     *
     * - $externalTrxId is your idempotency key. Generate it with
     *   generateExternalTrxId(), PERSIST IT, then call this.
     * - There are deliberately no retries here. A timeout does NOT mean the
     *   charge failed. Resolve unknown outcomes by re-calling with the SAME
     *   externalTrxId, or by reconciling against the charging notification.
     *   Never re-roll the id.
     * - E1379 (already completed) is accepted as success.
     * - $amount is a string: keep money in bcmath or integer minor units. A
     *   float will eventually charge someone 99.99999 rupees.
     *
     * @return array<string, mixed>
     */
    public function debit(
        string $subscriberId,
        string $amount,
        string $externalTrxId,
        string $currency = 'LKR'
    ): array {
        if ($externalTrxId === '') {
            throw new InvalidArgumentException(
                '[ideamart] externalTrxId is required and must be persisted first'
            );
        }
        if (strlen($externalTrxId) > 32) {
            throw new InvalidArgumentException(
                '[ideamart] externalTrxId must be 32 characters or fewer'
            );
        }

        return $this->post(
            'caas-direct-debit',
            $this->config->requireEndpoint('caasDebit'),
            [
                'externalTrxId' => $externalTrxId,
                'subscriberId'  => self::toTelAddress($subscriberId),
                'amount'        => $amount,
                'currency'      => $currency,
            ],
            [self::BENIGN_DEBIT]
        );
    }

    /**
     * Query chargeable balance.
     *
     * Advisory only: the balance can change between this and the debit. Always
     * handle E1378 on the debit regardless of what this returned.
     *
     * @return array<string, mixed>
     */
    public function queryBalance(string $subscriberId, string $currency = 'LKR'): array
    {
        return $this->post('caas-balance-query', $this->config->requireEndpoint('caasBalance'), [
            'subscriberId' => self::toTelAddress($subscriberId),
            'currency'     => $currency,
        ]);
    }

    /* ── LBS ──────────────────────────────────────────────────────────────── */

    /**
     * Locate a subscriber. Network-derived, accuracy in hundreds of metres.
     *
     * Requires explicit, purpose-specific consent — consent to receive SMS is
     * not consent to be located. Omit the QoS fields unless you know your
     * provisioned level; requesting above it fails with E1367.
     *
     * @return array<string, mixed>
     */
    public function locate(string $subscriberId, string $serviceType): array
    {
        return $this->post('lbs-locate', $this->config->requireEndpoint('lbsLocate'), [
            'subscriberId' => self::toTelAddress($subscriberId),
            'serviceType'  => $serviceType,
        ]);
    }

    /* ── Extension point ───────────────────────────────────────────────────
     *
     * Adding a service Ideamart publishes later:
     *
     *   1. Add its URL variable to .env.example and to ENDPOINT_VARS in
     *      IdeamartConfig
     *   2. Add one wrapper here that calls $this->post() with the new key.
     *
     * It inherits credential injection, the timeout, error mapping and the
     * not-provisioned guard for free. Do not build a parallel client.
     */
}

/** A non-S1000 application-level response. */
final class IdeamartException extends RuntimeException
{
    /** @param array<string, mixed> $raw */
    public function __construct(
        public readonly string $statusCode,
        public readonly string $statusDetail,
        public readonly string $service,
        public readonly array $raw = [],
    ) {
        parent::__construct("[{$statusCode}] {$statusDetail} ({$service})");
    }

    public function isRetryable(): bool
    {
        return in_array($this->statusCode, IdeamartClient::TRANSIENT, true);
    }

    public function isConfiguration(): bool
    {
        return in_array($this->statusCode, IdeamartClient::CONFIGURATION, true);
    }
}
