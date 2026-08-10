package ideamart

// Ideamart API client — Go port of templates/typescript/ideamart-client.ts.
//
// One post() helper injects credentials, applies a timeout, and turns non-S1000
// responses into typed errors. Every service is a thin wrapper that resolves its
// endpoint through Config.RequireEndpoint — so calling an API your application
// was not provisioned for fails locally with a clear message, rather than as
// E1309 from the platform.
//
// Standard library only. SERVER-SIDE ONLY.

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// timeout is a protocol constant, not configuration: a single outbound call
// should never hang.
const timeout = 15 * time.Second

// transient codes are platform-side. Worth retrying with backoff.
var transient = map[string]bool{
	"E1316": true, "E1318": true, "E1319": true, "E1332": true, "E1341": true,
	"E1360": true, "E1363": true, "E1364": true, "E1600": true, "E1601": true,
	"E1602": true, "E1603": true,
}

// configuration codes mean provisioning or credentials are wrong. Retrying will
// never help.
var configuration = map[string]bool{
	"E1301": true, "E1302": true, "E1303": true, "E1304": true, "E1305": true,
	"E1306": true, "E1307": true, "E1309": true, "E1310": true, "E1311": true,
	"E1313": true, "E1315": true, "E1322": true, "E1323": true, "E1324": true,
	"E1327": true, "E1328": true, "E1329": true, "E1336": true, "E1371": true,
	"E1381": true, "E1383": true, "E1387": true,
}

// Codes meaning "the state you wanted already holds".
const (
	BenignRegister   = "E1351" // user already registered
	BenignUnregister = "E1356" // user not registered
	BenignDebit      = "E1379" // transaction already completed
)

// Error is a non-S1000 application-level response.
type Error struct {
	StatusCode   string
	StatusDetail string
	Service      string
	Raw          map[string]any
}

func (e *Error) Error() string {
	return fmt.Sprintf("[%s] %s (%s)", e.StatusCode, e.StatusDetail, e.Service)
}

// Retryable reports whether a backoff retry is appropriate.
func (e *Error) Retryable() bool { return transient[e.StatusCode] }

// IsConfiguration reports a provisioning or credential fault. Page on these.
func (e *Error) IsConfiguration() bool { return configuration[e.StatusCode] }

// Client is safe for concurrent use. Build one at startup and share it.
type Client struct {
	config *Config
	http   *http.Client
}

// NewClient builds a client over the given config.
//
// Ideamart hosts have served an incomplete certificate chain, which Go rejects.
// Do NOT set InsecureSkipVerify — that lets anyone on the path read the
// applicationId and password that can charge your subscribers. Supply the
// intermediate CA instead:
//
//	pool := x509.NewCertPool()
//	pem, _ := os.ReadFile("certs/ideamart-chain.pem")
//	pool.AppendCertsFromPEM(pem)
//	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}
//
// See references/09-security-best-practices.md.
func NewClient(config *Config) *Client {
	return &Client{config: config, http: &http.Client{Timeout: timeout}}
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

var separators = regexp.MustCompile(`[\s()\-]`)

// ToTelAddress normalises a subscriber address. The ONLY place "tel:" is added.
//
// Accepts an already-prefixed address, a masked hash, +94…, 0094… or a local
// 07… number.
func ToTelAddress(msisdn string) (string, error) {
	trimmed := strings.TrimSpace(msisdn)
	if trimmed == "" {
		return "", fmt.Errorf("[ideamart] empty subscriber address")
	}
	if strings.HasPrefix(strings.ToLower(trimmed), "tel:") {
		return trimmed, nil
	}
	digits := strings.TrimPrefix(separators.ReplaceAllString(trimmed, ""), "+")
	digits = strings.TrimPrefix(digits, "00")
	if strings.HasPrefix(digits, "0") && len(digits) == 10 {
		digits = "94" + digits[1:]
	}
	return "tel:" + digits, nil
}

// MaskAddress masks a subscriber address for logging. Never log the raw value.
func MaskAddress(address string) string {
	body := address
	if len(body) >= 4 && strings.EqualFold(body[:4], "tel:") {
		body = body[4:]
	}
	if len(body) <= 6 {
		return "tel:***"
	}
	return "tel:" + body[:3] + strings.Repeat("*", len(body)-6) + body[len(body)-3:]
}

// GenerateExternalTrxID returns a unique, persistable idempotency key for a
// charge. Max 32 characters.
func GenerateExternalTrxID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

/* ── Core ────────────────────────────────────────────────────────────────── */

func (c *Client) post(
	ctx context.Context,
	service, url string,
	body map[string]any,
	benign ...string,
) (map[string]any, error) {
	payload := map[string]any{
		"applicationId": c.config.ApplicationID,
		"password":      c.config.Password,
	}
	for key, value := range body {
		payload[key] = value
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("[ideamart] %s: encoding payload: %w", service, err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(encoded))
	if err != nil {
		return nil, fmt.Errorf("[ideamart] %s: building request: %w", service, err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("[ideamart] %s: transport failure: %w", service, err)
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("[ideamart] %s: reading response: %w", service, err)
	}

	// response.StatusCode is deliberately not consulted: Ideamart returns 200 for
	// application-level failures, and the real outcome is statusCode in the body.
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		limit := len(raw)
		if limit > 200 {
			limit = 200
		}
		return nil, fmt.Errorf("[ideamart] %s: non-JSON response: %s", service, raw[:limit])
	}

	statusCode, _ := data["statusCode"].(string)
	if statusCode == "S1000" {
		return data, nil
	}
	for _, code := range benign {
		if statusCode == code {
			return data, nil
		}
	}
	statusDetail, _ := data["statusDetail"].(string)
	return nil, &Error{StatusCode: statusCode, StatusDetail: statusDetail, Service: service, Raw: data}
}

/* ── SMS ─────────────────────────────────────────────────────────────────── */

// SendSMS sends an MT SMS to one or more subscribers.
func (c *Client) SendSMS(ctx context.Context, to []string, message string) (map[string]any, error) {
	url, err := c.config.RequireEndpoint("smsSend")
	if err != nil {
		return nil, err
	}
	recipients := make([]string, 0, len(to))
	for _, raw := range to {
		address, err := ToTelAddress(raw)
		if err != nil {
			return nil, err
		}
		if address == "tel:all" {
			return nil, fmt.Errorf(
				"[ideamart] use BroadcastSMS for tel:all — broadcasts must be deliberate")
		}
		recipients = append(recipients, address)
	}
	return c.post(ctx, "sms-send", url, map[string]any{
		"message":              message,
		"destinationAddresses": recipients,
	})
}

// BroadcastConfirmation must be passed verbatim to BroadcastSMS.
const BroadcastConfirmation = "I_HAVE_VERIFIED_THIS_GOES_TO_ALL_SUBSCRIBERS"

// BroadcastSMS sends to the ENTIRE subscribed base.
//
// Deliberately separate from SendSMS so it can never be reached by accident —
// check the subscriber base size first, and put an authorisation check in front
// of this.
func (c *Client) BroadcastSMS(
	ctx context.Context, message, confirmation string,
) (map[string]any, error) {
	if confirmation != BroadcastConfirmation {
		return nil, fmt.Errorf("[ideamart] broadcast confirmation token missing")
	}
	url, err := c.config.RequireEndpoint("smsSend")
	if err != nil {
		return nil, err
	}
	return c.post(ctx, "sms-send", url, map[string]any{
		"message":              message,
		"destinationAddresses": []string{"tel:all"},
	})
}

/* ── USSD ────────────────────────────────────────────────────────────────── */

// SendUSSD sends a USSD screen.
//
// sessionID MUST be the one the platform sent you. Use "mt-fin" for the final
// screen — anything else leaves the session hanging until the network times out.
func (c *Client) SendUSSD(
	ctx context.Context, sessionID, destinationAddress, message, operation string,
) (map[string]any, error) {
	switch operation {
	case "mt-init", "mt-cont", "mt-fin":
	default:
		return nil, fmt.Errorf("[ideamart] invalid ussdOperation %q", operation)
	}
	url, err := c.config.RequireEndpoint("ussdSend")
	if err != nil {
		return nil, err
	}
	address, err := ToTelAddress(destinationAddress)
	if err != nil {
		return nil, err
	}
	return c.post(ctx, "ussd-send", url, map[string]any{
		"message":            message,
		"sessionId":          sessionID,
		"ussdOperation":      operation,
		"destinationAddress": address,
		"encoding":           "440",
		"version":            "1.0",
	})
}

/* ── Subscription ────────────────────────────────────────────────────────── */

// Register opts a subscriber in. Only call this with recorded, explicit consent.
//
// E1351 (already registered) is accepted as success — the desired state holds.
func (c *Client) Register(ctx context.Context, subscriberID string) (map[string]any, error) {
	return c.subscription(ctx, "subscription-register", subscriberID, "1", BenignRegister)
}

// Unregister opts a subscriber out.
//
// E1356 (not registered) is accepted as success — the desired state holds.
func (c *Client) Unregister(ctx context.Context, subscriberID string) (map[string]any, error) {
	return c.subscription(ctx, "subscription-unregister", subscriberID, "0", BenignUnregister)
}

func (c *Client) subscription(
	ctx context.Context, service, subscriberID, action, benign string,
) (map[string]any, error) {
	url, err := c.config.RequireEndpoint("subscriptionSend")
	if err != nil {
		return nil, err
	}
	address, err := ToTelAddress(subscriberID)
	if err != nil {
		return nil, err
	}
	return c.post(ctx, service, url, map[string]any{
		"subscriberId": address,
		"action":       action,
		"version":      "1.0",
	}, benign)
}

// SubscriptionStatus checks one subscriber. For reconciliation, not per-request
// gating — mirror the subscription notification callback instead.
func (c *Client) SubscriptionStatus(
	ctx context.Context, subscriberID string,
) (map[string]any, error) {
	url, err := c.config.RequireEndpoint("subscriptionStatus")
	if err != nil {
		return nil, err
	}
	address, err := ToTelAddress(subscriberID)
	if err != nil {
		return nil, err
	}
	return c.post(ctx, "subscription-status", url, map[string]any{"subscriberId": address})
}

// QueryBase returns the subscriber base size. It needs no subscriber and charges
// nothing, which also makes it the best connectivity and credential smoke test.
func (c *Client) QueryBase(ctx context.Context) (int64, error) {
	url, err := c.config.RequireEndpoint("subscriptionQueryBase")
	if err != nil {
		return 0, err
	}
	data, err := c.post(ctx, "subscription-query-base", url, map[string]any{})
	if err != nil {
		return 0, err
	}
	size, _ := data["baseSize"].(string) // documented as a string
	parsed, err := strconv.ParseInt(size, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("[ideamart] unexpected baseSize %q", size)
	}
	return parsed, nil
}

/* ── OTP ─────────────────────────────────────────────────────────────────── */

// RequestOTP sends an OTP to a plain mobile number.
//
// Rate-limit per number AND per IP before calling, or the app becomes an
// SMS-bombing tool. Keep the returned referenceNo server-side; never log it.
func (c *Client) RequestOTP(
	ctx context.Context, subscriberID string, metaData map[string]any,
) (map[string]any, error) {
	url, err := c.config.RequireEndpoint("otpRequest")
	if err != nil {
		return nil, err
	}
	address, err := ToTelAddress(subscriberID)
	if err != nil {
		return nil, err
	}
	return c.post(ctx, "otp-request", url, map[string]any{
		"subscriberId":        address,
		"applicationMetaData": metaData,
	})
}

// VerifyOTP verifies an OTP. Valid 60 minutes, maximum 3 attempts — enforce
// those limits on your side too. The returned subscriberId is the masked
// identifier to use for every subsequent call.
func (c *Client) VerifyOTP(ctx context.Context, referenceNo, otp string) (map[string]any, error) {
	url, err := c.config.RequireEndpoint("otpVerify")
	if err != nil {
		return nil, err
	}
	return c.post(ctx, "otp-verify", url, map[string]any{
		"referenceNo": referenceNo,
		"otp":         otp,
	})
}

/* ── CaaS ────────────────────────────────────────────────────────────────── */

// Debit charges a subscriber's mobile account.
//
// THIS MOVES REAL MONEY.
//
//   - externalTrxID is your idempotency key. Generate it with
//     GenerateExternalTrxID, PERSIST IT, then call this.
//   - There are deliberately no retries here. A timeout does NOT mean the charge
//     failed. Resolve unknown outcomes by re-calling with the SAME
//     externalTrxID, or by reconciling against the charging notification. Never
//     re-roll the id.
//   - E1379 (already completed) is accepted as success.
//   - amount is a string: keep money in a decimal type (shopspring/decimal, or
//     integer minor units) and format it here. Never float64.
func (c *Client) Debit(
	ctx context.Context, subscriberID, amount, externalTrxID, currency string,
) (map[string]any, error) {
	if externalTrxID == "" {
		return nil, fmt.Errorf("[ideamart] externalTrxId is required and must be persisted first")
	}
	if len(externalTrxID) > 32 {
		return nil, fmt.Errorf("[ideamart] externalTrxId must be 32 characters or fewer")
	}
	url, err := c.config.RequireEndpoint("caasDebit")
	if err != nil {
		return nil, err
	}
	address, err := ToTelAddress(subscriberID)
	if err != nil {
		return nil, err
	}
	if currency == "" {
		currency = "LKR"
	}
	return c.post(ctx, "caas-direct-debit", url, map[string]any{
		"externalTrxId": externalTrxID,
		"subscriberId":  address,
		"amount":        amount,
		"currency":      currency,
	}, BenignDebit)
}

// QueryBalance reads chargeable balance.
//
// Advisory only: the balance can change between this and the debit. Always
// handle E1378 on the debit regardless of what this returned.
func (c *Client) QueryBalance(
	ctx context.Context, subscriberID, currency string,
) (map[string]any, error) {
	url, err := c.config.RequireEndpoint("caasBalance")
	if err != nil {
		return nil, err
	}
	address, err := ToTelAddress(subscriberID)
	if err != nil {
		return nil, err
	}
	if currency == "" {
		currency = "LKR"
	}
	return c.post(ctx, "caas-balance-query", url, map[string]any{
		"subscriberId": address,
		"currency":     currency,
	})
}

/* ── LBS ─────────────────────────────────────────────────────────────────── */

// Locate finds a subscriber. Network-derived, accuracy in hundreds of metres.
//
// Requires explicit, purpose-specific consent — consent to receive SMS is not
// consent to be located. Omit the QoS fields unless you know your provisioned
// level; requesting above it fails with E1367.
func (c *Client) Locate(
	ctx context.Context, subscriberID, serviceType string,
) (map[string]any, error) {
	url, err := c.config.RequireEndpoint("lbsLocate")
	if err != nil {
		return nil, err
	}
	address, err := ToTelAddress(subscriberID)
	if err != nil {
		return nil, err
	}
	return c.post(ctx, "lbs-locate", url, map[string]any{
		"subscriberId": address,
		"serviceType":  serviceType,
	})
}

/* ── Extension point ──────────────────────────────────────────────────────
 *
 * Adding a service Ideamart publishes later:
 *
 *   1. Add its URL variable to .env.example and to endpointVars in config.go
 *   2. Add one wrapper here that calls c.post with the new endpoint key.
 *
 * It inherits credential injection, the timeout, error mapping and the
 * not-provisioned guard for free. Do not build a parallel client.
 */
