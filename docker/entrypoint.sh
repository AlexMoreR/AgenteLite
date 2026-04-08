#!/bin/sh
set -eu

TARGET_MIGRATION="20260402130000_add_official_api_module_base"

run_deploy() {
  DEPLOY_STATUS=0
  DEPLOY_OUTPUT="$(npx prisma migrate deploy 2>&1)" || DEPLOY_STATUS=$?
  echo "$DEPLOY_OUTPUT"
  return "$DEPLOY_STATUS"
}

if [ "${PRISMA_AUTO_RESOLVE_FAILED_OFFICIAL_API_MIGRATION:-false}" = "true" ]; then
  echo "Running Prisma migrate deploy with auto-recovery..."
  if ! run_deploy; then
    if echo "$DEPLOY_OUTPUT" | grep -q "P3009" && echo "$DEPLOY_OUTPUT" | grep -q "$TARGET_MIGRATION"; then
      echo "Detected failed migration $TARGET_MIGRATION. Trying resolve --rolled-back..."
      npx prisma migrate resolve --rolled-back "$TARGET_MIGRATION" || true

      if ! run_deploy; then
        if echo "$DEPLOY_OUTPUT" | grep -Eiq "already exists|duplicate|ya existe"; then
          echo "Detected existing objects from partial migration. Trying resolve --applied..."
          npx prisma migrate resolve --applied "$TARGET_MIGRATION"
          npx prisma migrate deploy
        else
          echo "Migration deploy failed after auto-recovery."
          exit 1
        fi
      fi
    else
      echo "Migration deploy failed and did not match auto-recovery conditions."
      exit 1
    fi
  fi
else
  npx prisma migrate deploy
fi

exec npm run start
