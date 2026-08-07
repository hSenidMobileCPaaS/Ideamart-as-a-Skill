<#
.SYNOPSIS
    Ideamart smoke tests (Windows / PowerShell).

.DESCRIPTION
    Verifies credentials, IP whitelisting, and every endpoint you have
    configured.

    Only the services with a URL set in your environment are tested — an unset
    endpoint means that API is not enabled on your application, so there is
    nothing to test. Configure them in .env; see templates/.env.example.

    RUN THIS FROM THE SERVER THAT WILL CALL IDEAMART. Running it from a laptop
    tests the laptop's IP, which is not what you whitelisted.

    Credentials come from the environment. Never paste them into this file.

.EXAMPLE
    .\scripts\smoke-test.ps1

.EXAMPLE
    .\scripts\smoke-test.ps1 -WithSms -TestMsisdn 94771234567
#>
[CmdletBinding()]
param(
    [switch]$WithSms,
    [switch]$WithCharge,
    [switch]$WithLbs,
    [string]$TestMsisdn = $(if ($env:TEST_MSISDN) { $env:TEST_MSISDN } else { "94771234567" })
)

# Load .env if present (KEY=VALUE lines, skipping comments).
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
            Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim('"').Trim()
        }
    }
}

if (-not $env:IDEAMART_APP_ID)   { throw "Set IDEAMART_APP_ID (see templates/.env.example)" }
if (-not $env:IDEAMART_PASSWORD) { throw "Set IDEAMART_PASSWORD (see templates/.env.example)" }

$script:Pass = 0
$script:Fail = 0
$script:Skip = 0

function Skip-Test {
    param([string]$Name, [string]$Reason)
    Write-Host ("{0,-28}" -f $Name) -NoNewline
    Write-Host $Reason -ForegroundColor DarkGray
    $script:Skip++
}

function Invoke-IdeamartCall {
    param([string]$Name, [string]$Url, [hashtable]$Body)

    Write-Host ("{0,-28}" -f $Name) -NoNewline

    $payload = ($Body + @{
        applicationId = $env:IDEAMART_APP_ID
        password      = $env:IDEAMART_PASSWORD
    }) | ConvertTo-Json -Depth 5 -Compress

    try {
        $response = Invoke-RestMethod -Uri $Url -Method Post `
            -ContentType 'application/json' -Body $payload -TimeoutSec 20
    }
    catch {
        Write-Host "NO RESPONSE" -ForegroundColor Red -NoNewline
        Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkGray
        $script:Fail++
        return
    }

    switch -Regex ($response.statusCode) {
        '^S1000$' { Write-Host "S1000 OK" -ForegroundColor Green; $script:Pass++ }
        '^E1303$' { Write-Host "E1303" -ForegroundColor Red -NoNewline
                    Write-Host "  This IP is not whitelisted. Run: curl -4 https://myip.ideamart.io" -ForegroundColor DarkGray
                    $script:Fail++ }
        '^E1313$' { Write-Host "E1313" -ForegroundColor Red -NoNewline
                    Write-Host "  Auth failure - check IDEAMART_APP_ID / IDEAMART_PASSWORD" -ForegroundColor DarkGray
                    $script:Fail++ }
        '^E1309$' { Write-Host "E1309" -ForegroundColor Yellow -NoNewline
                    Write-Host "  Service not provisioned - remove this URL from your .env" -ForegroundColor DarkGray
                    $script:Fail++ }
        '^E1343$' { Write-Host "E1343" -ForegroundColor Yellow -NoNewline
                    Write-Host "  $TestMsisdn is not in Whitelisted Numbers" -ForegroundColor DarkGray
                    $script:Fail++ }
        '^E1351$' { Write-Host "E1351  Already registered (benign)" -ForegroundColor Green; $script:Pass++ }
        '^E1356$' { Write-Host "E1356  Not registered (benign for unregister)" -ForegroundColor Green; $script:Pass++ }
        default   { Write-Host "$($response.statusCode)" -ForegroundColor Red -NoNewline
                    Write-Host "  $($response.statusDetail)" -ForegroundColor DarkGray
                    $script:Fail++ }
    }
}

Write-Host ""
Write-Host "Ideamart smoke test"
Write-Host "  app id     $($env:IDEAMART_APP_ID)"
Write-Host "  password   ***redacted***"
try {
    Write-Host "  egress IP  $(Invoke-RestMethod -Uri 'https://myip.ideamart.io' -TimeoutSec 10)"
} catch {
    Write-Host "  egress IP  (could not determine)"
}
Write-Host "             ^ this must be in your app's Allowed Host Addresses"
Write-Host ""

Write-Host "-- Subscription --------------------------------"
if ($env:IDEAMART_SUBSCRIPTION_QUERY_BASE_URL) {
    Invoke-IdeamartCall "Query Base (base size)" $env:IDEAMART_SUBSCRIPTION_QUERY_BASE_URL @{}
} else { Skip-Test "Query Base (base size)" "IDEAMART_SUBSCRIPTION_QUERY_BASE_URL not set" }

if ($env:IDEAMART_SUBSCRIPTION_STATUS_URL) {
    Invoke-IdeamartCall "Get Status" $env:IDEAMART_SUBSCRIPTION_STATUS_URL @{ subscriberId = "tel:$TestMsisdn" }
} else { Skip-Test "Get Status" "IDEAMART_SUBSCRIPTION_STATUS_URL not set" }

if ($env:IDEAMART_SUBSCRIPTION_SEND_URL) {
    Invoke-IdeamartCall "Register (opt-in)"    $env:IDEAMART_SUBSCRIPTION_SEND_URL @{ version = "1.0"; action = "1"; subscriberId = "tel:$TestMsisdn" }
    Invoke-IdeamartCall "Unregister (opt-out)" $env:IDEAMART_SUBSCRIPTION_SEND_URL @{ version = "1.0"; action = "0"; subscriberId = "tel:$TestMsisdn" }
} else { Skip-Test "Register / Unregister" "IDEAMART_SUBSCRIPTION_SEND_URL not set" }

Write-Host ""
Write-Host "-- CaaS ----------------------------------------"
if ($env:IDEAMART_CAAS_BALANCE_URL) {
    Invoke-IdeamartCall "Query Balance" $env:IDEAMART_CAAS_BALANCE_URL @{ subscriberId = "tel:$TestMsisdn"; currency = "LKR" }
} else { Skip-Test "Query Balance" "IDEAMART_CAAS_BALANCE_URL not set" }

if (-not $env:IDEAMART_CAAS_DEBIT_URL) {
    Skip-Test "Direct Debit" "IDEAMART_CAAS_DEBIT_URL not set"
} elseif (-not $WithCharge) {
    Skip-Test "Direct Debit" "skipped (-WithCharge to run - charges real money)"
} else {
    Write-Host "  !! This charges REAL MONEY from $TestMsisdn" -ForegroundColor Yellow
    $trxId = [guid]::NewGuid().ToString("N")
    Write-Host "  externalTrxId: $trxId  (persist this before charging, in real code)" -ForegroundColor DarkGray
    Invoke-IdeamartCall "Direct Debit (LKR 1)" $env:IDEAMART_CAAS_DEBIT_URL @{
        externalTrxId = $trxId; subscriberId = "tel:$TestMsisdn"; amount = "1"; currency = "LKR"
    }
}

Write-Host ""
Write-Host "-- SMS -----------------------------------------"
if (-not $env:IDEAMART_SMS_SEND_URL) {
    Skip-Test "SMS Send" "IDEAMART_SMS_SEND_URL not set"
} elseif (-not $WithSms) {
    Skip-Test "SMS Send" "skipped (-WithSms to run - sends a real SMS)"
} else {
    Invoke-IdeamartCall "SMS Send" $env:IDEAMART_SMS_SEND_URL @{
        destinationAddresses = @("tel:$TestMsisdn"); message = "Ideamart smoke test"
    }
}

Write-Host ""
Write-Host "-- LBS -----------------------------------------"
if (-not $env:IDEAMART_LBS_URL) {
    Skip-Test "Locate" "IDEAMART_LBS_URL not set"
} elseif (-not $WithLbs) {
    Skip-Test "Locate" "skipped (-WithLbs to run - requires consent)"
} else {
    Invoke-IdeamartCall "Locate" $env:IDEAMART_LBS_URL @{ subscriberId = "tel:$TestMsisdn"; serviceType = "IMMEDIATE" }
}

Write-Host ""
Write-Host "-----------------------------------------------"
Write-Host "  passed $($script:Pass)" -ForegroundColor Green -NoNewline
Write-Host "   failed $($script:Fail)" -ForegroundColor Red -NoNewline
Write-Host "   skipped $($script:Skip)" -ForegroundColor DarkGray
if ($script:Pass -eq 0 -and $script:Fail -eq 0) {
    Write-Host "  Nothing ran - no service endpoints are configured in .env." -ForegroundColor Yellow
}
Write-Host ""

if ($script:Fail -gt 0) { exit 1 }
