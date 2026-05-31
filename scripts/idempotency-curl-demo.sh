#!/usr/bin/env bash
set -euo pipefail

BASE=${BASE_URL:-http://localhost:8080}
uuid() { node -e "console.log(require('crypto').randomUUID())"; }

echo "== sign up a merchant =="
SIGNUP=$(curl -s -X POST "$BASE/v1/merchants" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Demo Shop\",\"email\":\"demo+$(uuid)@example.com\"}")
echo "$SIGNUP" | jq .
KEY=$(echo "$SIGNUP" | jq -r .api_key.secret_key)

echo
echo "== create a payment: amount=50000 INR =="
PAYMENT=$(curl -s -X POST "$BASE/v1/payments" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuid)" \
  -d '{"amount":50000,"currency":"INR"}')
echo "$PAYMENT" | jq .
PAY_ID=$(echo "$PAYMENT" | jq -r .id)

KEY_CONFIRM=$(uuid)
echo
echo "== firing TWO confirm requests, SAME Idempotency-Key, at the same time =="
echo "   Idempotency-Key: $KEY_CONFIRM"
echo

curl -s -o /tmp/confirm-a.json -w "request A -> HTTP %{http_code}\n" -X POST \
  "$BASE/v1/payments/$PAY_ID/confirm" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY_CONFIRM" \
  -d '{"payment_method":"pm_card_visa"}' &

curl -s -o /tmp/confirm-b.json -w "request B -> HTTP %{http_code}\n" -X POST \
  "$BASE/v1/payments/$PAY_ID/confirm" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY_CONFIRM" \
  -d '{"payment_method":"pm_card_visa"}' &

wait

echo
echo "--- request A body ---"
jq . /tmp/confirm-a.json
echo "--- request B body ---"
jq . /tmp/confirm-b.json

echo
echo "== fetching the payment once more: only ONE charge should have gone through =="
curl -s "$BASE/v1/payments/$PAY_ID" -H "Authorization: Bearer $KEY" | jq .
