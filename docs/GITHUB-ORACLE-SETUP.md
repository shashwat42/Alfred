# Enable automatic backend deployment to Oracle

The workflow is `.github/workflows/deploy-oracle.yml`.

- Backend pull requests targeting `main`: TypeScript, isolated development tests,
  deployment configuration tests and Compose validation. No deployment or server secrets.
- Backend changes pushed/merged to `main`: the same checks, then build the API
  image on GitHub, transfer it to Oracle and replace the backend container.
- Frontend-only changes: no backend deployment.
- Workflow changes and root `AGENTS.md` changes also trigger checks/deployment.
- Manual **Run workflow** is supported on `main`.

The server uses Atlas and keeps Caddy's HTTPS configuration. The workflow does not
start MongoDB, compile the backend on the VM, or require Docker Hub credentials.

## 1. Add repository secrets now

Open your repository on GitHub → **Settings → Secrets and variables → Actions →
Secrets → New repository secret**. These are repository secrets, not environment
secrets. No GitHub deployment environment is required.

| Secret name | What to paste |
| --- | --- |
| `OCI_HOST` | `137.23.49.88` |
| `OCI_SSH_PRIVATE_KEY` | Entire contents of `D:\Secrets\ssh-key-2026-10-18(1).key`, including its BEGIN/END lines. Paste the key contents, not the file path. This is the key that successfully connected to the current VM. |
| `OCI_SSH_KNOWN_HOSTS` | Entire recorded host-key entry from `.deployment/oracle/known_hosts` in your local checkout. It was recorded during the successful SSH connection. Do not paste the private key here. |
| `JWT_SECRET` | Existing `JWT_SECRET` value from `Alfred_Backend/.env`; use the same value as the live server to preserve sessions. |
| `GOOGLE_CLIENT_ID` | Existing `GOOGLE_CLIENT_ID` value from `Alfred_Backend/.env`. |
| `GOOGLE_CLIENT_SECRET` | Existing `GOOGLE_CLIENT_SECRET` value from `Alfred_Backend/.env`. |
| `LLM_API_KEY` | Existing `LLM_API_KEY` value from `Alfred_Backend/.env`. |
| `MONGODB_URI` | Existing full Atlas `MONGODB_URI` value from `Alfred_Backend/.env`, including `/alfred` and connection options. |

For `.env` entries, paste only the value after `=`, without the variable name or
surrounding quotes. Keep existing URL encoding in the Atlas URI. Do not commit
environment files or private key files.

## 2. Add repository variables now

On the same Actions settings page select **Variables → New repository variable**.

| Variable name | Value |
| --- | --- |
| `OCI_SSH_USER` | `ubuntu` |
| `OCI_SSH_PORT` | `22` |
| `OCI_PLATFORM` | `linux/amd64` |
| `FRONTEND_URL` | `https://tauri.localhost` |
| `ALLOWED_ORIGINS` | `http://tauri.localhost,https://tauri.localhost` |
| `GOOGLE_CALLBACK_URL` | `https://alfred-137-23-49-88.sslip.io/auth/google/callback` |
| `PUBLIC_HEALTH_URL` | `https://alfred-137-23-49-88.sslip.io/ready` |
| `ALFRED_SETTINGS_JSON` | Copy the value of this property from the local `.deployment/oracle/github-variables.json` file. It preserves the provider/model settings used for the initial deployment. |

`.deployment/oracle/github-variables.json` contains the complete copyable variable
values and no secret values. For `ALFRED_SETTINGS_JSON`, paste the JSON object
represented by the string, without its outer JSON-string quotes or escape
backslashes. It can be displayed directly from the project root with:

```powershell
(Get-Content .deployment/oracle/github-variables.json -Raw | ConvertFrom-Json).ALFRED_SETTINGS_JSON
```

`OCI_BUILD_RUNNER` is optional; leave it unset for this AMD VM. The default is
`ubuntu-24.04`. No obsolete `MONGO_ROOT_*`, `MONGO_APP_*`, replica-key or Mongo-volume
settings are needed. Keep paid GitHub Actions usage disabled if you want only the
included/free runner allowance.

## 3. Activate and check the first run

Commit the updated workflow and backend deployment files, then push/merge them to
`main`. Local files are not uploaded until you commit and push them.

Open **Actions → Deploy backend to Oracle**. The `validate` job must pass before
`deploy` runs. A successful deployment adds the commit SHA and public readiness
URL to the run summary. The current API is:

<https://alfred-137-23-49-88.sslip.io/ready>

To redeploy after changing a GitHub secret or variable, use **Run workflow → main**.
Editing a secret alone does not start a workflow or update a running container.

Automated tests use `MODE=development` and isolated databases. Deployment starts
the actual production API with its normal production quotas. The pipeline was
validated locally; its first GitHub-hosted run requires the settings above and
committed/pushed files.

## When to change these settings later

| Change | GitHub settings to update |
| --- | --- |
| Normal backend code changes | None; merge to `main`. |
| New VM/public IP | `OCI_HOST`, `OCI_SSH_KNOWN_HOSTS`, and the SSH key if it changed. Update the Atlas IP access list, HTTPS hostname and URL variables too. |
| SSH key rotation | `OCI_SSH_PRIVATE_KEY`, after authorizing its public key on the VM. |
| Atlas username/password/cluster changes | `MONGODB_URI`. |
| Google OAuth credential rotation | `GOOGLE_CLIENT_ID` and/or `GOOGLE_CLIENT_SECRET`. |
| API hostname changes | `GOOGLE_CALLBACK_URL`, `PUBLIC_HEALTH_URL`, the Google client's registered redirect URI, Caddy and installed app configuration. |
| AI key/provider/model changes | `LLM_API_KEY` and/or `ALFRED_SETTINGS_JSON`. |
| Intentional session-signing key rotation | `JWT_SECRET`; existing sessions will need sign-in again. |

After changing settings, manually run the workflow or merge a backend change.

References: [GitHub repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[workflow triggers and path filters](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
