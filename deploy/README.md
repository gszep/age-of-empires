# GCP deployment

The open-content client is hosted at <https://empires.gszep.com>.

| Resource | Value |
|---|---|
| Project | `ninth-iris-405514` (`Sites`) |
| Region | `europe-west1` |
| Cloud Run service | `empires` |
| Build identity | `empires-build@ninth-iris-405514.iam.gserviceaccount.com` |
| Runtime identity | `empires-runtime@ninth-iris-405514.iam.gserviceaccount.com` |
| Workload Identity pool | `github-actions` (provider `github-oidc`, attribute-conditioned to this repository) |
| Cloud DNS zone | `gszep-com` |
| DNS record | `empires.gszep.com. CNAME ghs.googlehosted.com.` |

The service has no minimum instances, at most three instances, 1 CPU, and 256 MiB memory. The runtime service account has no project roles.

## Automated deployment (GitHub Actions)

Every push to `main` deploys automatically via `.github/workflows/deploy.yml`,
and manual runs are possible from the Actions tab. The workflow authenticates
with **Workload Identity Federation**: an ephemeral, repository-conditioned
token impersonates the build identity, so **no service-account keys or other
secret material are stored** in GitHub, and no human account participates.

The build identity's grants (added 2026-10-18, each earned by a named
permission error during the pipeline's first automated deploys):

- `roles/run.builder` (original build role)
- `roles/run.developer` (deploy the service)
- `roles/iam.serviceAccountUser` on the runtime identity (actAs) and on itself
  (the source build's self-actAs requirement)
- `roles/artifactregistry.writer` on `cloud-run-source-deploy` (europe-west1)
- `roles/storage.admin` and `roles/storage.objectAdmin` on the
  `run-sources-ninth-iris-405514-europe-west1` staging bucket only
- `roles/storage.viewer` (project-level, read-only bucket listing)
- `roles/cloudbuild.builds.editor` (create the source build)

A failed deploy never leaves the site dark: Cloud Run keeps the previous
revision serving, and `gcloud run revisions list` shows the rollback path.

## Manual deployment

Authenticate as a project owner/deployer, then run:

```bash
gcloud auth login
deploy/gcp.sh
```

The build identity's name and runtime identity come from
[deploy/gcp.sh](../deploy/gcp.sh); the local `deploy/gcp.sh` path is for
maintenance use — routine deploys go through Actions. If the manual path is
used, prefer a dedicated gcloud configuration selected per command with
`CLOUDSDK_ACTIVE_CONFIG_NAME` so the human active configuration is untouched.
