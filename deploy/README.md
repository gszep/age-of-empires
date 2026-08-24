# GCP deployment

The open-content client is hosted at <https://empires.gszep.com>.

| Resource | Value |
|---|---|
| Project | `ninth-iris-405514` (`Sites`) |
| Region | `europe-west1` |
| Cloud Run service | `empires` |
| Build identity | `empires-build@ninth-iris-405514.iam.gserviceaccount.com` |
| Runtime identity | `empires-runtime@ninth-iris-405514.iam.gserviceaccount.com` |
| Cloud DNS zone | `gszep-com` |
| DNS record | `empires.gszep.com. CNAME ghs.googlehosted.com.` |

The service has no minimum instances, at most three instances, 1 CPU, and 256 MiB memory. It uses a dedicated runtime service account with no project roles. The build account has only `roles/run.builder`. Public invocation uses Cloud Run's invoker-IAM-check setting because the Workspace organization disallows an `allUsers` IAM policy binding.

## Deploy a revision

Authenticate as a project owner/deployer, then run:

```bash
gcloud auth login
deploy/gcp.sh
```

`deploy/gcp.sh` first creates and inspects an open-content build. `.gcloudignore`, `.dockerignore`, and Vite's `OPEN_CONTENT_ONLY` mode independently exclude `public/imported/`, `.local/`, `.tools/`, and owned depot files. Never weaken those exclusions to publish the imported AoE2DE mode.

After deployment:

```bash
curl -fsSI https://empires.gszep.com
```

Cloud Run keeps prior revisions for rollback. To inspect or move traffic:

```bash
gcloud run revisions list --project ninth-iris-405514 --region europe-west1 --service empires
gcloud run services update-traffic empires \
  --project ninth-iris-405514 --region europe-west1 \
  --to-revisions REVISION=100
```

## One-time infrastructure evidence

The required APIs are `run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`, and `dns.googleapis.com`. The domain is verified to `contact@gszep.com`. Cloud Run's managed domain mapping reports the required CNAME, and Google provisions/renews TLS automatically.

The source-deploy Artifact Registry repository and staging bucket are managed by Google Cloud. Do not upload local `public/imported/` content to either one.
