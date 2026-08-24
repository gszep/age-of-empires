#!/usr/bin/env bash
# Deploy the open-content client to the existing Cloud Run service.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${GCP_PROJECT:-ninth-iris-405514}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE="${GCP_SERVICE:-empires}"
BUILD_SA="empires-build@$PROJECT.iam.gserviceaccount.com"
RUNTIME_SA="empires-runtime@$PROJECT.iam.gserviceaccount.com"

cd "$ROOT"

# Fail locally if the legal public artifact boundary regresses. .gcloudignore
# independently prevents owned/generated files from entering the upload.
npm run build:public
if find dist -path '*imported*' -print -quit | grep -q .; then
  echo "Refusing deployment: public build contains imported content" >&2
  exit 2
fi

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT" \
  --region "$REGION" \
  --platform managed \
  --no-invoker-iam-check \
  --port 8080 \
  --memory 256Mi \
  --cpu 1 \
  --min 0 \
  --max 3 \
  --service-account "$RUNTIME_SA" \
  --build-service-account "projects/$PROJECT/serviceAccounts/$BUILD_SA" \
  --quiet
