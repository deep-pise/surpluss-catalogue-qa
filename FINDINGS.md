# Findings

## Overview

During testing, I identified six defects covering catalogue lifecycle handling, access control, and object-level authorization.

The defects are reproduced through automated tests in:

* `tests/business.test.ts`
* `tests/security.test.ts`

The affected tests are intentionally marked as expected failures where the current application behavior contradicts the expected business or security behavior.

---

## BUG-01 — Active published catalogue is incorrectly marked as expired

### Area

Catalogue lifecycle

### Severity

High

### Description

A published catalogue with a future validity/expiry date is incorrectly returned as `expired`.

### Reproduction Steps

1. Use a catalogue with status `published`.
2. Set its expiry date to a future date.
3. Evaluate the effective catalogue status.
4. Observe that the application returns `expired`.

### Expected Behavior

A published catalogue whose expiry date is still in the future should remain `published`.

### Actual Behavior

The application returns `expired`.

### Business Impact

An active catalogue can be incorrectly treated as unavailable or expired. This can prevent buyers from accessing valid catalogue information and may interrupt the sales process.

### Automated Test

`tests/business.test.ts`

Test:

```text
keeps an active published catalogue published
```

The test is intentionally expected to fail against the current implementation.

---

## BUG-02 — Expired published catalogue is not marked as expired

### Area

Catalogue lifecycle

### Severity

High

### Description

A published catalogue whose validity date has already passed is incorrectly returned as `published`.

### Reproduction Steps

1. Use a catalogue with status `published`.
2. Set its expiry date to a date in the past.
3. Evaluate the effective catalogue status.
4. Observe that the application returns `published`.

### Expected Behavior

A published catalogue whose expiry date has passed should be treated as `expired`.

### Actual Behavior

The application returns `published`.

### Business Impact

Expired catalogue content can continue to be treated as active. This can expose stale pricing or availability information to buyers.

### Automated Test

`tests/business.test.ts`

Test:

```text
marks a published catalogue past its validity date as expired
```

The test is intentionally expected to fail against the current implementation.

---

## BUG-03 — Staff user can delete a catalogue

### Area

Authorization / Server Action

### Severity

High

### Description

Catalogue deletion is intended to be an Admin-only operation, but the server action verifies that a user is authenticated without enforcing the Admin role.

### Reproduction Steps

1. Sign in as the seeded Staff user:

   * Email: `staff@catalogue.test`
   * Role: `staff`
2. Attempt to call the catalogue deletion server action.
3. Provide a valid catalogue ID.
4. Observe that the deletion operation can proceed instead of returning an authorization error.

### Expected Behavior

A Staff user should not be able to delete a catalogue.

The operation should return:

```text
Only an admin can delete a catalogue.
```

### Actual Behavior

The current server action checks authentication but does not enforce the Admin role before deleting the catalogue.

### Business Impact

Deleting a catalogue can destroy catalogue data and potentially affect associated sales history. The assessment specifically identifies catalogue deletion as an Admin-only action.

### Automated Test

`tests/security.test.ts`

Test:

```text
does not allow a staff user to delete a catalogue
```

The test is expected to fail against the current implementation.

---

## BUG-04 — Staff can publish a catalogue through the admin API

### Area

Authorization / API

### Severity

High

### Description

The catalogue update API authenticates the user but does not enforce the required Admin role before allowing catalogue status changes.

### Reproduction Steps

1. Authenticate as a Staff user.
2. Obtain a valid catalogue ID.
3. Send a `PATCH` request to the admin catalogue endpoint.
4. Submit a valid catalogue payload with:

   ```json
   {
     "status": "published"
   }
   ```
5. Observe that the request is processed instead of being rejected because the user is Staff.

### Expected Behavior

Only an Admin should be able to change a catalogue between Draft and Published states.

### Actual Behavior

The route checks whether the request is authenticated but does not perform the required Staff-vs-Admin authorization check.

### Business Impact

A Staff user could publish catalogue information without the required administrative authorization. Publishing exposes catalogue information to buyers and can expose commercially sensitive pricing or inventory.

### Automated Test

`tests/security.test.ts`

The Staff-vs-Admin API authorization test demonstrates this access-control issue.

---

## BUG-05 — Listing ID can be modified across catalogues

### Area

Object-level authorization / IDOR

### Severity

High

### Description

The catalogue listing update endpoint validates that both the catalogue ID and listing ID are syntactically valid, but it does not verify that the listing actually belongs to the specified catalogue.

### Reproduction Steps

1. Obtain a valid catalogue ID.
2. Obtain a valid listing ID belonging to a different catalogue.
3. Send an authenticated `PATCH` request using:

   * Catalogue A's ID in the URL.
   * Catalogue B's listing ID in the URL.
4. Provide an otherwise valid listing update payload.
5. Observe that the listing can be modified.

### Expected Behavior

The application should verify that the listing identified by `listingId` belongs to the catalogue identified by `id`.

A cross-catalogue modification should be rejected.

### Actual Behavior

The update operation uses the listing ID directly without including the catalogue relationship in the update condition.

### Business Impact

An authorized user could modify a product listing belonging to another catalogue by changing the object ID. This is an object-level authorization issue and could result in incorrect catalogue content.

### Automated Test

`tests/security.test.ts`

The ID-tampering test covers this scenario.

---

## BUG-06 — Listing ID can be deleted across catalogues

### Area

Object-level authorization / IDOR

### Severity

High

### Description

The catalogue listing deletion endpoint similarly validates the IDs but does not verify that the listing belongs to the specified catalogue before deleting it.

### Reproduction Steps

1. Obtain a valid catalogue ID.
2. Obtain a valid listing ID belonging to another catalogue.
3. Send an authenticated `DELETE` request using the catalogue ID and unrelated listing ID.
4. Observe that the listing can be deleted.

### Expected Behavior

The application should verify the catalogue-to-listing relationship before performing the deletion.

A listing belonging to another catalogue should not be deleted.

### Actual Behavior

The delete operation uses only the listing ID when executing the deletion.

### Business Impact

Cross-catalogue deletion can remove products from catalogues that the request should not have authority to modify.

### Automated Test

`tests/security.test.ts`

The ID-tampering/deletion test covers this scenario.

---

## Test Evidence

The automated test suite currently reports:

```text
43 passed | 6 expected fail
```

The six expected failures correspond to the defects documented above.

The purpose of the expected failures is to demonstrate that the automated tests detect the current application defects rather than silently passing.

No application code was modified to make these defects pass.
