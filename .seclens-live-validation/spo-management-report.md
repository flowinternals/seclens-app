# SecLens Consolidated Report

- **Repository:** ITC2-AUS/SPO_Management (https://github.com/ITC2-AUS/SPO_Management/tree/staging)
- **Ref:** staging
- **Generated:** 2026-04-30T15:48:50.727Z
- **Languages:** TypeScript
- **Summary Risk:** Ready with caution - Ready with caution based on the completed dimension results from this run.

## Executive Posture Summary

SecLens completed 8 of 8 planned security dimensions for this repository. This run surfaced 0 confirmed issue(s), 5 observed protection(s), and 9 area(s) requiring pre-launch action.

- **Detected profiles:** frontend SPA, backend API, CLI/tooling, library/package, monolith, mixed/multi-surface repo
- **Profile confidence:** high
- **Profile rationale:** Repo profile inferred from 980 repository path signal(s): frontend framework/build surfaces detected; API/server route surfaces detected; CLI entrypoint/tooling surfaces detected; library/package distribution surfaces detected; CI/workflow automation surfaces detected.
- **Applicability weighting:** Auth / Session / Authorization: 100% (applicable) - Applicability is derived from detected repository profile (frontend SPA, backend API, CLI/tooling, library/package, monolith, mixed/multi-surface repo) and retained repository evidence signals.; Invite / Token / Claims: 90% (applicable) - Applicability is derived from detected repository profile (frontend SPA, backend API, CLI/tooling, library/package, monolith, mixed/multi-surface repo) and retained repository evidence signals.; Validation / Input / Trust Boundaries: 100% (applicable) - Applicability is derived from detected repository profile (frontend SPA, backend API, CLI/tooling, library/package, monolith, mixed/multi-surface repo) and retained repository evidence signals.; Rate Limiting / Abuse Controls: 95% (applicable) - Applicability is derived from detected repository profile (frontend SPA, backend API, CLI/tooling, library/package, monolith, mixed/multi-surface repo) and retained repository evidence signals.; CI/CD / Secrets / Deployment: 90% (applicable) - Applicability is derived from detected repository profile (frontend SPA, backend API, CLI/tooling, library/package, monolith, mixed/multi-surface repo) and retained repository evidence signals.; Config / Policy / Rules: 90% (applicable) - Applicability is derived from detected repository profile (frontend SPA, backend API, CLI/tooling, library/package, monolith, mixed/multi-surface repo) and retained repository evidence signals.; Data Access / Persistence: 85% (applicable) - Applicability is derived from detected repository profile (frontend SPA, backend API, CLI/tooling, library/package, monolith, mixed/multi-surface repo) and retained repository evidence signals.; Client Auth Bridge / Frontend Guarding: 100% (applicable) - Applicability is derived from detected repository profile (frontend SPA, backend API, CLI/tooling, library/package, monolith, mixed/multi-surface repo) and retained repository evidence signals.

This export is built from the structured dimension results only. It does not go back and re-read the full repository during report generation.

## Confirmed Protections

- **Auth / Session / Authorization:** The session context caching mechanism is implemented to improve performance.
- **Validation / Input / Trust Boundaries:** The validateReadyForApproval function implements checks for closure readiness, ensuring that necessary fields are validated before transitioning to readyForApproval.
- **Config / Policy / Rules:** Role-based access control is implemented in Firestore rules, allowing only specific roles to access certain data.
- **Config / Policy / Rules:** The invite process includes a check for existing users to prevent duplicate invites.
- **Client Auth Bridge / Frontend Guarding:** Input validation is implemented for risk assessment fields, ensuring that only valid data is processed.

## Priority Risks Requiring Review

- No confirmed launch-blocking risks were recorded from admitted findings in this run.

## Dimension Summaries

### Auth / Session / Authorization

- **Status:** healthy
- **Progress:** ready
- **Coverage:** Reviewed 39 files directly related to auth / session / authorization.
- **Counts:** 0 finding(s), 1 observed control(s), 0 unverified control(s), 0 recommendation(s).
- **Launch-relevant review basis:** SecLens reviewed 39 paths for auth / session / authorization and retained citations for the strongest evidence it found.
- **Launch-ready strengths:** The session context caching mechanism is implemented to improve performance.
- **Launch risk to address before sign-off:** This dimension requires targeted reviewer validation before launch sign-off.
- **Required next action:** Use the retained citations as a spot-check sample before treating this dimension as complete.

### Invite / Token / Claims

- **Status:** healthy
- **Progress:** ready
- **Coverage:** Reviewed 16 files directly related to invite / token / claims.
- **Counts:** 0 finding(s), 0 observed control(s), 0 unverified control(s), 0 recommendation(s).
- **Launch-relevant review basis:** SecLens reviewed 16 paths for invite / token / claims and retained citations for the strongest evidence it found.
- **Launch-ready strengths:** The reviewed evidence did not surface an obvious break in invite / token / claims, but that is not the same as a hard security guarantee.
- **Launch risk to address before sign-off:** This dimension requires targeted reviewer validation before launch sign-off.
- **Required next action:** Use the retained citations as a spot-check sample before treating this dimension as complete.

### Validation / Input / Trust Boundaries

- **Status:** attention
- **Progress:** ready
- **Coverage:** Reviewed 15 files directly related to validation / input / trust boundaries.
- **Counts:** 0 finding(s), 1 observed control(s), 1 unverified control(s), 0 recommendation(s).
- **Launch-relevant review basis:** SecLens reviewed 15 paths for validation / input / trust boundaries and retained citations for the strongest evidence it found.
- **Launch-ready strengths:** The validateReadyForApproval function implements checks for closure readiness, ensuring that necessary fields are validated before transitioning to readyForApproval.
- **Launch risk to address before sign-off:** At scanned evidence `functions/src/issues/upsertRequestValidation.ts:1-77`, verify validation controls before admitting a finding; the evidence suggests an important control that could not be conclusively proven in this run.
- **Required next action:** Manually verify the control claimed above in the cited files before treating this dimension as healthy.

### Rate Limiting / Abuse Controls

- **Status:** healthy
- **Progress:** ready
- **Coverage:** Reviewed 1 file directly related to rate limiting / abuse controls.
- **Counts:** 0 finding(s), 0 observed control(s), 0 unverified control(s), 0 recommendation(s).
- **Launch-relevant review basis:** SecLens reviewed 1 path for rate limiting / abuse controls and retained citations for the strongest evidence it found.
- **Launch-ready strengths:** The reviewed evidence did not surface an obvious break in rate limiting / abuse controls, but that is not the same as a hard security guarantee.
- **Launch risk to address before sign-off:** This dimension requires targeted reviewer validation before launch sign-off.
- **Required next action:** Use the retained citations as a spot-check sample before treating this dimension as complete.

### CI/CD / Secrets / Deployment

- **Status:** attention
- **Progress:** ready
- **Coverage:** Reviewed 19 files directly related to ci/cd / secrets / deployment.
- **Counts:** 0 finding(s), 0 observed control(s), 0 unverified control(s), 1 recommendation(s).
- **Launch-relevant review basis:** SecLens reviewed 19 paths for ci/cd / secrets / deployment and retained citations for the strongest evidence it found.
- **Launch-ready strengths:** The reviewed evidence did not surface an obvious break in ci/cd / secrets / deployment, but that is not the same as a hard security guarantee.
- **Launch risk to address before sign-off:** This dimension requires targeted reviewer validation before launch sign-off.
- **Required next action:** To mitigate the risk of accidental exposure of sensitive files like service account keys, implement pre-commit hooks or CI checks that prevent the inclusion of these files in version control.

### Config / Policy / Rules

- **Status:** attention
- **Progress:** ready
- **Coverage:** Reviewed 49 files directly related to config / policy / rules.
- **Counts:** 0 finding(s), 2 observed control(s), 1 unverified control(s), 2 recommendation(s).
- **Launch-relevant review basis:** SecLens reviewed 49 paths for config / policy / rules and retained citations for the strongest evidence it found.
- **Launch-ready strengths:** Role-based access control is implemented in Firestore rules, allowing only specific roles to access certain data.
- **Launch risk to address before sign-off:** At scanned evidence `docs/platform/config/stage-7-slice5-support-and-tenant-lifecycle.md:1-150`, verify validation controls before admitting a finding; the evidence suggests an important control that could not be conclusively proven in this run.
- **Required next action:** It is recommended to enhance validation in Firestore rules to ensure stricter access controls.

### Data Access / Persistence

- **Status:** healthy
- **Progress:** ready
- **Coverage:** Reviewed 8 files directly related to data access / persistence.
- **Counts:** 0 finding(s), 0 observed control(s), 0 unverified control(s), 0 recommendation(s).
- **Launch-relevant review basis:** SecLens reviewed 8 paths for data access / persistence and retained citations for the strongest evidence it found.
- **Launch-ready strengths:** The reviewed evidence did not surface an obvious break in data access / persistence, but that is not the same as a hard security guarantee.
- **Launch risk to address before sign-off:** This dimension requires targeted reviewer validation before launch sign-off.
- **Required next action:** Use the retained citations as a spot-check sample before treating this dimension as complete.

### Client Auth Bridge / Frontend Guarding

- **Status:** attention
- **Progress:** ready
- **Coverage:** Reviewed 320 files directly related to client auth bridge / frontend guarding.
- **Counts:** 0 finding(s), 1 observed control(s), 7 unverified control(s), 3 recommendation(s).
- **Launch-relevant review basis:** SecLens reviewed 320 paths for client auth bridge / frontend guarding and retained citations for the strongest evidence it found.
- **Launch-ready strengths:** Input validation is implemented for risk assessment fields, ensuring that only valid data is processed.
- **Launch risk to address before sign-off:** The application does not appear to implement rate limiting on authentication actions, which could expose it to brute-force attacks.
- **Required next action:** It is recommended to implement role-based access control checks for all user management functionalities.

## Prioritized Next Actions

1. **CI/CD / Secrets / Deployment:** To mitigate the risk of accidental exposure of sensitive files like service account keys, implement pre-commit hooks or CI checks that prevent the inclusion of these files in version control. Evidence target: `functions/USER_MANAGEMENT_DEPLOYMENT.md:1-116`. Confidence: medium.
2. **Client Auth Bridge / Frontend Guarding:** Input validation should be enhanced to cover all edge cases, including negative values and non-numeric inputs. Evidence target: `src/components/shared/EntityModals/Risk/stages/AnalysisStage.tsx:1-339`. Confidence: medium.
3. **Config / Policy / Rules:** It is recommended to enhance validation in Firestore rules to ensure stricter access controls. Evidence target: `firestore.rules:1-442`. Confidence: medium.
4. **Config / Policy / Rules:** It is recommended to implement input validation for user emails in the invite process. Evidence target: `docs/platform/config/stage-7-slice5-support-and-tenant-lifecycle.md:1-150`. Confidence: medium.
5. **Client Auth Bridge / Frontend Guarding:** It is recommended to implement role validation checks when assigning roles to project members to prevent unauthorized access. Evidence target: `src/components/ProjectRiskPlanning/components/ProjectMembersList.tsx:1-518`. Confidence: medium.
6. **Client Auth Bridge / Frontend Guarding:** It is recommended to implement role-based access control checks for all user management functionalities. Evidence target: `src/components/OrganisationSetup/pages/OrgDepartments.tsx:1-834`. Confidence: medium.

## Confidence & Coverage

- Reviewed files counted across dimensions: 467
- High confidence dimensions: 1
- Medium confidence dimensions: 6
- Low confidence dimensions: 1

Coverage values are derived from retained cited paths attached to each dimension result.

## Evidence Appendix

- **Auth / Session / Authorization:** `src/services/sessionService.ts:1-322`
- **Auth / Session / Authorization:** `functions/src/__tests__/authorization.test.ts:1-159`
- **Auth / Session / Authorization:** `functions/src/auth/permissionPolicy.ts:1-345`
- **Auth / Session / Authorization:** `functions/src/auth/resolveOrgRoleForWrite.ts:1-209`
- **Auth / Session / Authorization:** `src/contexts/AuthContext.tsx:1-409`
- **Auth / Session / Authorization:** `functions/src/auth/roleKeys.ts:1-73`
- **Auth / Session / Authorization:** `functions/src/auth/sessionAllowedRoutes.ts:1-74`
- **Auth / Session / Authorization:** `functions/src/utils/authorization.ts:1-238`
- **Invite / Token / Claims:** `functions/src/createUserAndInvite.ts:1-906`
- **Invite / Token / Claims:** `functions/src/inviteManagement.ts:1-297`
- **Invite / Token / Claims:** `functions/src/utils/inviteToken.ts:1-44`
- **Invite / Token / Claims:** `functions/src/validateInvite.ts:1-230`
- **Invite / Token / Claims:** `src/components/Auth/AcceptInvitePage.tsx:1-256`
- **Invite / Token / Claims:** `test/unit/components/Auth/AcceptInvitePage.test.tsx:1-108`
- **Invite / Token / Claims:** `functions/src/__tests__/claims.createUserAndInvite.test.ts:1-278`
- **Invite / Token / Claims:** `functions/src/__tests__/invite.acceptance.test.ts:1-402`
- **Validation / Input / Trust Boundaries:** `functions/src/projectClosure/closureReadinessValidation.ts:1-64`
- **Validation / Input / Trust Boundaries:** `functions/src/issues/upsertRequestValidation.ts:1-77`
- **Validation / Input / Trust Boundaries:** `docs/reviews/stage_5_release_readiness_and_validation_waiver.md:1-93`
- **Validation / Input / Trust Boundaries:** `functions/src/removeEntity/removeEntityValidation.ts:1-37`
- **Validation / Input / Trust Boundaries:** `src/components/IssueRiskManagement/issueForm/issueFormValidation.ts:1-46`
- **Validation / Input / Trust Boundaries:** `src/hooks/useOrgSetupFormValidation.ts:1-237`
- **Validation / Input / Trust Boundaries:** `src/hooks/useValidatedOrgId.ts:1-131`
- **Validation / Input / Trust Boundaries:** `src/hooks/useValidatedProjectId.ts:1-26`
- **Rate Limiting / Abuse Controls:** `functions/src/utils/rateLimit.ts:1-160`
- **CI/CD / Secrets / Deployment:** `functions/USER_MANAGEMENT_DEPLOYMENT.md:1-116`
- **CI/CD / Secrets / Deployment:** `.github/workflows/ci-staging.yml:1-93`
- **CI/CD / Secrets / Deployment:** `.github/workflows/deploy-staging-hosting.yml:1-62`
- **CI/CD / Secrets / Deployment:** `functions/src/migrations/migrateSectorFinancialToFinancialServices.ts:1-57`
- **CI/CD / Secrets / Deployment:** `functions/src/issueSequencing.ts:1-154`
- **CI/CD / Secrets / Deployment:** `docs/platform/config/stage-7-slice6-release-rollback-incident.md:1-107`
- **CI/CD / Secrets / Deployment:** `docs/reviews/programme_2/stage_19_ci_cd_and_environment_promotion_review_implementation_plan.md:1-222`
- **CI/CD / Secrets / Deployment:** `docs/reviews/stages/stage_2_canonical_domain_decisions.md:1-616`
- **Config / Policy / Rules:** `firestore.rules:1-442`
- **Config / Policy / Rules:** `docs/platform/config/stage-7-slice5-support-and-tenant-lifecycle.md:1-150`
- **Config / Policy / Rules:** `.eslintrc.cjs:1-63`
- **Config / Policy / Rules:** `eslint.config.cjs:1-117`
- **Config / Policy / Rules:** `firebase.json:1-63`
- **Config / Policy / Rules:** `functions/.eslintrc.js:1-34`
- **Config / Policy / Rules:** `functions/jest.config.js:1-14`
- **Config / Policy / Rules:** `functions/tsconfig.json:1-24`
- **Data Access / Persistence:** `src/components/ui/StandardButton.tsx:1-187`
- **Data Access / Persistence:** `firestore.indexes.json:1-226`
- **Data Access / Persistence:** `functions/src/issues/upsertFirestoreUtil.ts:1-38`
- **Data Access / Persistence:** `functions/src/removeEntity/removeEntityPersistence.ts:1-103`
- **Data Access / Persistence:** `src/components/MonitoringHub/FirestoreUsageTab.tsx:1-615`
- **Data Access / Persistence:** `src/components/ui/StandardBadge.tsx:1-188`
- **Data Access / Persistence:** `src/hooks/useFirestoreMonitoring.ts:1-183`
- **Data Access / Persistence:** `src/services/unifiedFirestoreMonitoring.ts:1-603`
- **Client Auth Bridge / Frontend Guarding:** `src/components/shared/EntityModals/Risk/stages/AnalysisStage.tsx:1-339`
- **Client Auth Bridge / Frontend Guarding:** `src/components/Auth/LoginScreen.tsx:1-255`
- **Client Auth Bridge / Frontend Guarding:** `src/components/FrameworkToolkit/pages/AgreementsTool.tsx:1-464`
- **Client Auth Bridge / Frontend Guarding:** `src/components/ManageProjects/ManageProjects.tsx:1-56`
- **Client Auth Bridge / Frontend Guarding:** `src/components/OrganisationSetup/pages/OrgDepartments.tsx:1-834`
- **Client Auth Bridge / Frontend Guarding:** `src/components/OrganisationSetup/pages/OrgExternalOrganisations.tsx:1-580`
- **Client Auth Bridge / Frontend Guarding:** `src/components/ProjectRiskPlanning/components/ProjectMembersList.tsx:1-518`
- **Client Auth Bridge / Frontend Guarding:** `src/components/shared/EntityModals/Risk/EditRiskModal.tsx:1-726`