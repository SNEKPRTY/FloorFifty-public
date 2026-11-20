#!/usr/bin/env bash
# One-time Azure setup so CI can deploy staging without SSH, through
# `az vm run-command` (owner, 2026-10-17: SSH on the VM is limited to the
# owner's home IP).
#
# Run on the owner's Mac after `az login`. It creates:
#   - a storage account and container where CI drops release.tgz for the VM
#   - an app registration "floor-fifty-ci" that GitHub Actions signs in as
#     with OIDC (no stored password), trusted only for this repo's `staging`
#     environment
#   - roles for it: run commands on the staging VM, and write and sign blobs in
#     that one container
# It prints the four values to store as `staging` environment secrets.
# Safe to run again: each step reuses what already exists.
set -euo pipefail

rg="floor-fifty"
vm="floor-fifty-staging"
repo="SNEKPRTY/FloorFifty"
# GitHub's ID-bound OIDC subject, verified against this repository and owner.
# A name-only subject no longer matches the assertion sent by Actions.
oidc_subject="repo:SNEKPRTY@334282915/FloorFifty@1375202945:environment:staging"
app_name="floor-fifty-ci"
container="releases"
# Storage account names are global, 3-24 lowercase letters and digits.
account="${FF_STORAGE_ACCOUNT:-ffstaging$(az account show --query id -o tsv | tr -d - | cut -c1-8)}"

sub="$(az account show --query id -o tsv)"
tenant="$(az account show --query tenantId -o tsv)"
# The VM's region, not the group's: the subscription only allows some
# regions, and the group's (eastus2) is not one of them.
location="$(az vm show -g "$rg" -n "$vm" --query location -o tsv)"
vm_id="$(az vm show -g "$rg" -n "$vm" --query id -o tsv)"

echo "== storage account $account in $location"
az storage account show -g "$rg" -n "$account" -o none 2>/dev/null ||
  az storage account create -g "$rg" -n "$account" -l "$location" \
    --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 \
    --allow-blob-public-access false -o none
az storage container create --account-name "$account" -n "$container" --auth-mode login -o none
# Releases are fetched once by the VM; drop leftovers after a day.
az storage account management-policy create -g "$rg" --account-name "$account" --policy '{
  "rules": [{"enabled": true, "name": "expire-releases", "type": "Lifecycle",
    "definition": {"filters": {"blobTypes": ["blockBlob"], "prefixMatch": ["'"$container"'/"]},
      "actions": {"baseBlob": {"delete": {"daysAfterModificationGreaterThan": 1}}}}}]}' -o none
container_scope="$(az storage account show -g "$rg" -n "$account" --query id -o tsv)/blobServices/default/containers/$container"

echo "== app registration $app_name"
app_id="$(az ad app list --display-name "$app_name" --query '[0].appId' -o tsv)"
if [[ -z "$app_id" ]]; then
  app_id="$(az ad app create --display-name "$app_name" --query appId -o tsv)"
fi
az ad sp show --id "$app_id" -o none 2>/dev/null || az ad sp create --id "$app_id" -o none
trust='{
  "name": "staging-env",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "'"$oidc_subject"'",
  "audiences": ["api://AzureADTokenExchange"]}'
# Refresh existing trust too: skipping it leaves a stale subject in place.
# Keep lookup outside the conditional so an Azure error stops setup.
credential_id="$(az ad app federated-credential list --id "$app_id" --query "[?name=='staging-env'].id | [0]" -o tsv)"
if [[ -n "$credential_id" ]]; then
  az ad app federated-credential update --id "$app_id" \
    --federated-credential-id "$credential_id" --parameters "$trust" -o none
else
  az ad app federated-credential create --id "$app_id" --parameters "$trust" -o none
fi

echo "== roles"
az role assignment create --assignee "$app_id" --role "Virtual Machine Contributor" --scope "$vm_id" -o none
# Writing the blob, and signing the read link the VM downloads it with.
az role assignment create --assignee "$app_id" --role "Storage Blob Data Contributor" --scope "$container_scope" -o none
az role assignment create --assignee "$app_id" --role "Storage Blob Delegator" \
  --scope "$(az storage account show -g "$rg" -n "$account" --query id -o tsv)" -o none

cat <<EOF

Done. Store these as secrets of the GitHub environment "staging" ($repo):
  AZURE_CLIENT_ID=$app_id
  AZURE_TENANT_ID=$tenant
  AZURE_SUBSCRIPTION_ID=$sub
  STAGING_STORAGE_ACCOUNT=$account
With gh:
  gh secret set AZURE_CLIENT_ID --env staging -R $repo -b "$app_id"
  gh secret set AZURE_TENANT_ID --env staging -R $repo -b "$tenant"
  gh secret set AZURE_SUBSCRIPTION_ID --env staging -R $repo -b "$sub"
  gh secret set STAGING_STORAGE_ACCOUNT --env staging -R $repo -b "$account"
EOF
