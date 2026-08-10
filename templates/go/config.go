// Package ideamart is a Go port of templates/typescript.
//
// Configuration is the ONLY place that reads the environment.
//
// Two credentials, plus one URL per service you provisioned. Nothing else is
// configuration: timeouts and encodings are constants in the client, because
// they are properties of the protocol rather than of your deployment.
//
// An endpoint that is not set means that API is not enabled on your
// application. The client refuses to call it, so you get a clear local error
// instead of E1309 from the platform.
//
// Call LoadConfig once from main() and fail the process if it errors — a
// misconfigured deployment must refuse to start rather than accept traffic it
// cannot serve.
//
// SERVER-SIDE ONLY.
package ideamart

import (
	"fmt"
	"os"
	"sort"
	"strings"
)

// endpointVars maps a service key to its environment variable. The names are
// identical in every language template, so a polyglot estate has one deployment
// story.
var endpointVars = map[string]string{
	"smsSend":               "IDEAMART_SMS_SEND_URL",
	"ussdSend":              "IDEAMART_USSD_SEND_URL",
	"subscriptionSend":      "IDEAMART_SUBSCRIPTION_SEND_URL",
	"subscriptionStatus":    "IDEAMART_SUBSCRIPTION_STATUS_URL",
	"subscriptionQueryBase": "IDEAMART_SUBSCRIPTION_QUERY_BASE_URL",
	"otpRequest":            "IDEAMART_OTP_REQUEST_URL",
	"otpVerify":             "IDEAMART_OTP_VERIFY_URL",
	"caasDebit":             "IDEAMART_CAAS_DEBIT_URL",
	"caasBalance":           "IDEAMART_CAAS_BALANCE_URL",
	"lbsLocate":             "IDEAMART_LBS_URL",
}

// Config holds the credentials and the endpoints this deployment may call.
type Config struct {
	// Never log these. Never send them to a client.
	ApplicationID string
	Password      string
	// Only the services enabled on your application. Point any of these at a
	// local mock during development — that is the whole environment switch.
	Endpoints map[string]string
}

// LoadConfig reads and validates the environment.
func LoadConfig() (*Config, error) {
	appID, err := requireEnv("IDEAMART_APP_ID")
	if err != nil {
		return nil, err
	}
	password, err := requireEnv("IDEAMART_PASSWORD")
	if err != nil {
		return nil, err
	}

	endpoints := make(map[string]string)
	for service, variable := range endpointVars {
		if value := strings.TrimRight(strings.TrimSpace(os.Getenv(variable)), "/"); value != "" {
			endpoints[service] = value
		}
	}
	return &Config{ApplicationID: appID, Password: password, Endpoints: endpoints}, nil
}

func requireEnv(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return "", fmt.Errorf(
			"[ideamart] missing required environment variable %s\n"+
				"Copy .env.example to .env and fill in your Ideamart credentials.\n"+
				"In production, set it in your host's secret manager", name)
	}
	return value, nil
}

// RequireEndpoint resolves an endpoint, or fails with a message that names the
// missing variable. This is the guard that keeps you from calling an API your
// application was never provisioned for.
func (c *Config) RequireEndpoint(service string) (string, error) {
	variable, known := endpointVars[service]
	if !known {
		return "", fmt.Errorf("[ideamart] unknown service %q", service)
	}
	url, configured := c.Endpoints[service]
	if !configured {
		return "", fmt.Errorf(
			"[ideamart] %s is not configured. Either the API is not enabled on your "+
				"application in IdeaPro, or %s is missing from the environment. "+
				"See .env.example", service, variable)
	}
	return url, nil
}

// EnabledServices lists what this deployment can actually call. Useful at startup.
func (c *Config) EnabledServices() []string {
	services := make([]string, 0, len(c.Endpoints))
	for service := range c.Endpoints {
		services = append(services, service)
	}
	sort.Strings(services)
	return services
}

// Describe returns a redacted view, safe to log at startup to confirm what the
// process loaded.
func (c *Config) Describe() string {
	return fmt.Sprintf(
		"ideamart{applicationId=%s password=***redacted*** enabledServices=%v}",
		c.ApplicationID, c.EnabledServices())
}
