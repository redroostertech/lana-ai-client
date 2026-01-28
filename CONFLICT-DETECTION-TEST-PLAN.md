# Conflict Detection - Browser Testing Plan

## Pre-Test Checklist

### 1. Backend Status
```bash
cd /Users/redroostertechnologies/Desktop/LANA-AI
pm2 status
# Ensure lana-api is online
```

### 2. Test Data Available
```bash
# Run API test to create test parties
node tests/manual/test-conflict-detection.js
```

### 3. Launch Client
```bash
cd /Users/redroostertechnologies/Desktop/lana-client
npm run electron:dev
```

---

## Test Scenarios

### ✅ Test 1: UI Loads Without Errors

**Steps:**
1. Open Electron client
2. Navigate to Matters page
3. Click "New Matter" button
4. Scroll down in the modal

**Expected:**
- Modal opens successfully
- Form loads without errors
- "Parties Involved" section visible
- "Add Party" button visible
- No console errors

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 2: Add Party (No Conflict)

**Steps:**
1. Click "New Matter"
2. Fill in matter details:
   - Name: "Test Matter Conflict Detection"
   - Description: "Testing conflict detection feature"
3. Click "Add Party"
4. Fill in party details:
   - Name: "Alice Johnson"
   - Type: "Client"
   - Email: "alice.johnson@unique.test"
5. Click "Add & Check Conflicts"

**Expected:**
- Party form appears when clicking "Add Party"
- Form fields are editable
- After clicking "Add & Check Conflicts":
  - Party appears in list with blue "Client" badge
  - No conflict warning appears
  - Party card shows name, email, and type
- Can click X to remove party

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 3: Detect High Severity Conflict

**Steps:**
1. Click "New Matter" (or use existing form)
2. Add matter details
3. Click "Add Party"
4. Fill in party details:
   - Name: "John Doe" (use name from previous test)
   - Type: "Client"
   - Email: "john.doe@example.com"
5. Click "Add & Check Conflicts"

**Expected:**
- Yellow/orange warning box appears
- Warning shows:
  - "⚠️ Potential Conflicts Detected"
  - Conflict count (e.g., "1 party has potential conflicts")
  - Severity badge: "HIGH"
  - Matter number where conflict exists
  - Conflict type: "same party multiple matters"
- Checkbox: "I acknowledge these conflicts and wish to proceed"
- "View Details" link

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 4: Detect Critical Severity Conflict

**Steps:**
1. Click "New Matter"
2. Add matter details
3. Click "Add Party"
4. Fill in party details:
   - Name: "John Doe" (use name from client on another matter)
   - Type: "Opposing Party" (IMPORTANT: different role)
   - Email: "john.doe@example.com"
5. Click "Add & Check Conflicts"

**Expected:**
- Red warning box appears (not yellow)
- Warning shows:
  - "⚠️ Critical Conflict Detected"
  - "Critical conflicts require immediate review"
  - Severity badge: "CRITICAL" (red background)
  - Conflict type: "client opposing conflict"
- Checkbox for acknowledgment still present

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 5: View Conflict Details

**Steps:**
1. Create conflict (use Test 3 or 4)
2. Click "View Details" link in warning box

**Expected:**
- Modal opens with detailed conflict information
- Shows:
  - Party name and email
  - Conflict severity badge (colored)
  - Conflict type description
  - Existing matter number and name
  - Existing party type
  - Match reason (e.g., "matching name, matching email")
- Modal can be closed with X button
- Modal is scrollable if multiple conflicts

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 6: Acknowledgment Required

**Steps:**
1. Create matter with conflicted party
2. Do NOT check acknowledgment checkbox
3. Click "Save Matter"

**Expected:**
- Form does NOT submit
- Red toast error appears: "Please acknowledge the conflicts before proceeding"
- Modal stays open
- No matter created

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 7: Proceed with Acknowledged Conflict

**Steps:**
1. Create matter with conflicted party
2. CHECK acknowledgment checkbox: "I acknowledge these conflicts and wish to proceed"
3. Click "Save Matter"

**Expected:**
- Form submits successfully
- Green toast: "Matter created: MATT-XXXXX"
- Modal closes
- Matter appears in matters list
- Parties saved to database

**Verify in DB:**
```bash
psql -d lana_chef -c "SELECT party_name, party_type FROM matter_parties WHERE matter_id = (SELECT id FROM client_matters ORDER BY created_at DESC LIMIT 1);"
```

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 8: Add Multiple Parties

**Steps:**
1. Click "New Matter"
2. Add party 1: Alice Johnson (Client)
3. Add party 2: Bob Smith (Opposing Counsel)
4. Add party 3: Carol White (Witness)
5. Save matter

**Expected:**
- All 3 parties appear in list
- Each has appropriate colored badge
- No conflicts (if names are unique)
- All parties saved successfully

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 9: Remove Party

**Steps:**
1. Add 2-3 parties
2. Click X button on middle party
3. Party should disappear
4. Conflicts re-checked automatically

**Expected:**
- Party removed from list
- Other parties remain
- Conflict warning updates if needed

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 10: Cancel/Close Modal

**Steps:**
1. Open "New Matter"
2. Add 1-2 parties
3. Click "Cancel" or X to close modal
4. Re-open "New Matter"

**Expected:**
- Parties list is empty (reset)
- No conflict warnings showing
- Clean slate for new matter

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 11: Save Matter Without Parties

**Steps:**
1. Click "New Matter"
2. Fill in matter details only
3. Do NOT add any parties
4. Click "Save Matter"

**Expected:**
- Matter saves successfully
- No errors about parties
- No conflict checking happens

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 12: Party Type Colors

**Steps:**
1. Add parties with different types:
   - Client (should be blue)
   - Opposing Party (should be red)
   - Opposing Counsel (should be purple)
   - Witness (should be green)
   - Expert (should be yellow)

**Expected:**
- Each party type has distinct colored badge
- Colors match design:
  - Client: Blue
  - Opposing Party: Red
  - Opposing Counsel: Purple
  - Witness: Green
  - Expert: Yellow
  - Judge: Gray
  - Arbitrator: Indigo
  - Mediator: Teal

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 13: Validation

**Steps:**
1. Click "Add Party"
2. Leave Name empty
3. Select Type
4. Click "Add & Check Conflicts"

**Expected:**
- Error message or validation warning
- Party NOT added to list

**Repeat with:**
- Empty Type field
- Both fields empty

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 14: Party with Full Details

**Steps:**
1. Add party with ALL fields filled:
   - Name: David Lee
   - Type: Expert
   - Email: david.lee@example.com
   - Phone: 555-1234
   - Organization: Expert Consulting LLC
   - Role: Financial Expert

**Expected:**
- Party card shows all information
- Icons displayed for email, phone, organization, role
- Card is well-formatted and readable

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 15: Mobile Responsiveness (if applicable)

**Steps:**
1. Resize browser window to mobile width (< 768px)
2. Open "New Matter" modal
3. Scroll to Parties section
4. Add a party

**Expected:**
- Layout responsive
- Form fields stack vertically
- Buttons accessible
- Text readable
- No horizontal scroll

**Status:** [ ] Pass [ ] Fail

---

## Console Checks

### Open Browser DevTools (F12 or Cmd+Option+I)

**Console Tab:**
- [ ] No red errors
- [ ] No warnings about missing elements
- [ ] API calls to `/api/v1/conflicts/check` succeed (200 status)
- [ ] API calls to `/api/v1/conflicts/parties` succeed (201 status)

**Network Tab:**
- [ ] `/api/v1/conflicts/check` returns JSON with conflicts array
- [ ] `/api/v1/conflicts/parties` returns success response
- [ ] No 401/403 authentication errors
- [ ] No 500 server errors

**Elements Tab:**
- [ ] `<div id="conflictDetectionContainer">` exists and contains HTML
- [ ] Party cards render correctly
- [ ] Conflict warning renders when expected

---

## Performance Checks

**Conflict Check Speed:**
- [ ] Conflict check completes in < 500ms (should see loading state briefly)
- [ ] No lag when adding parties
- [ ] Form submission responsive

**Memory:**
- [ ] No memory leaks when opening/closing modal multiple times
- [ ] Console shows no "out of memory" warnings

---

## Database Verification

After creating a matter with parties, verify in database:

```bash
# Get latest matter ID
psql -d lana_chef -c "SELECT id, matter_id, name FROM client_matters ORDER BY created_at DESC LIMIT 1;"

# Check parties were saved
psql -d lana_chef -c "SELECT party_name, party_type, party_email, is_active FROM matter_parties WHERE matter_id = '<matter-id-from-above>';"
```

**Expected:**
- All parties present
- Correct data types
- is_active = true

---

## Error Scenarios

### ✅ Test 16: Backend Down

**Steps:**
1. Stop backend: `pm2 stop lana-api`
2. Try to add party and check conflicts

**Expected:**
- Error message: "Failed to check for conflicts. Please try again."
- Party still added to local list
- Can continue working offline

**Status:** [ ] Pass [ ] Fail

---

### ✅ Test 17: Invalid Token

**Steps:**
1. Manually expire session or clear token
2. Try to add party

**Expected:**
- 401 authentication error
- Error message shown
- Redirected to login (if auth logic implemented)

**Status:** [ ] Pass [ ] Fail

---

## Final Checklist

- [ ] All 17 tests passed
- [ ] No console errors
- [ ] No visual bugs
- [ ] Performance acceptable
- [ ] Database entries correct
- [ ] Documentation matches actual behavior

---

## Known Issues / Notes

(Document any issues found during testing here)

---

## Sign Off

**Tester:** ___________________
**Date:** ___________________
**Build:** lana-client (Electron)
**Backend:** LANA-AI v2.0.0

**Overall Status:** [ ] PASS [ ] FAIL [ ] NEEDS FIXES

---

## Next Steps After Testing

If all tests pass:
1. ✅ Mark feature as production-ready
2. 📝 Write user documentation
3. 🎥 Create demo video
4. 📧 Notify stakeholders

If tests fail:
1. 🐛 Document bugs in GitHub issues
2. 🔧 Fix critical issues
3. ✅ Re-test
4. 🚀 Deploy when stable
