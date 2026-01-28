# Conflict Detection Integration Guide

This guide explains how to integrate the conflict detection UI component into the matter creation/editing flow.

## Overview

The conflict detection module (`conflict-detection.js`) provides:
- Party management UI (add/remove parties)
- Real-time conflict checking against existing matters
- Severity-based conflict warnings (critical, high, medium, low)
- User acknowledgment requirement for proceeding with conflicts
- Detailed conflict information modal

## Integration Steps

### Step 1: Include the Script

Add to the `<head>` section of `matters.html` (or just before `</body>`):

```html
<script src="js/conflict-detection.js"></script>
```

### Step 2: Add Conflict Detection Container to Matter Form

In the matter form modal (around line 410, after the "Share with Users" section), add:

```html
<!-- Conflict Detection Section -->
<div id="conflictDetectionContainer"></div>
```

Full context:
```html
        </div>
        <p class="text-xs text-gray-500 mt-1">Selected users will have read and write access to this matter.</p>
      </div>

      <!-- Conflict Detection Section -->
      <div id="conflictDetectionContainer"></div>

      <!-- Document Upload Section (only shown when editing existing matter) -->
      <div id="documentUploadSection" class="hidden">
```

### Step 3: Initialize Conflict Detection Module

In the JavaScript section (around line 1370, after `let selectedUsers = [];`), add:

```javascript
// Initialize conflict detection
let conflictDetection = null;

// Recreate conflict detection instance when modal opens
document.getElementById('createMatterBtn').addEventListener('click', () => {
  // Initialize conflict detection
  conflictDetection = new ConflictDetection(api);
  conflictDetection.initialize('conflictDetectionContainer');

  // ... rest of existing code
});
```

### Step 4: Integrate with Form Submission

Update the form submission handler (around line 4721) to include conflict checking:

```javascript
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Check if conflicts are acknowledged
  if (conflictDetection && !conflictDetection.canProceed()) {
    Toast.error('Please acknowledge the conflicts before proceeding');
    return;
  }

  const matterId = document.getElementById('matterId').value;
  const data = {
    client_name: document.getElementById('clientName').value,
    name: document.getElementById('matterName').value,
    description: document.getElementById('matterDescription').value,
    status: document.getElementById('matterStatus').value,
    visibility: document.getElementById('matterVisibility').value,
    share_with: selectedUsers.map(u => u.id)
  };

  try {
    let createdMatterId;

    if (matterId) {
      // Update existing matter
      await api.updateMatter(matterId, data);

      // Update sharing...
      // ... existing code ...

      createdMatterId = matterId;
      Toast.success('Matter updated');
    } else {
      // Create new matter
      const result = await api.createMatter(data);
      createdMatterId = result.matter?.id;
      Toast.success(`Matter created: ${result.matter?.matter_id || 'Success'}`);
    }

    // Save parties if any were added
    if (conflictDetection && conflictDetection.getParties().length > 0) {
      try {
        const response = await fetch(`${api.baseURL}/api/v1/conflicts/parties`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${api.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            matter_id: createdMatterId,
            parties: conflictDetection.getParties()
          })
        });

        if (!response.ok) {
          console.error('Failed to save parties');
        }
      } catch (error) {
        console.error('Error saving parties:', error);
      }
    }

    modal.classList.add('hidden');
    resetShareForm();
    loadMatters();
  } catch (error) {
    Toast.error(error.message);
  }
});
```

### Step 5: Load Existing Parties When Editing

Update the edit matter function (search for where `matterModalTitle` is set to "Edit Matter"):

```javascript
// When opening edit modal for existing matter
document.getElementById('matterModalTitle').textContent = 'Edit Matter';

// ... existing code to populate form fields ...

// Load existing parties if editing
if (conflictDetection && matter.id) {
  await conflictDetection.loadPartiesForMatter(matter.id);
}
```

### Step 6: Reset on Modal Close

Update the modal close/reset logic:

```javascript
function closeMatterModal() {
  modal.classList.add('hidden');
  form.reset();
  resetShareForm();

  // Reset conflict detection
  if (conflictDetection) {
    conflictDetection.reset();
  }
}

// Attach to close buttons
document.getElementById('closeMatterModal').addEventListener('click', closeMatterModal);
document.getElementById('cancelMatterBtn').addEventListener('click', closeMatterModal);
```

## API Endpoints Used

The conflict detection module uses these endpoints:

### 1. Check Conflicts
```
POST /api/v1/conflicts/check
Body: {
  parties: [{party_name, party_type, party_email?, party_phone?, party_organization?, party_role?}],
  exclude_matter_id?: "uuid"
}
Response: {
  has_conflicts: boolean,
  conflict_count: number,
  conflicts: [...],
  duration_ms: number
}
```

### 2. Add Parties to Matter
```
POST /api/v1/conflicts/parties
Body: {
  matter_id: "uuid",
  parties: [...]
}
Response: {
  parties: [...],
  count: number
}
```

### 3. Get Parties for Matter
```
GET /api/v1/conflicts/parties/:matterId
Response: {
  parties: [...],
  count: number
}
```

### 4. Clear Conflict (optional - for future use)
```
PATCH /api/v1/conflicts/parties/:partyId/clear
Body: { notes: "..." }
```

## Conflict Severity Levels

- **Critical**: Client appearing as opposing party/counsel on another matter (red)
- **High**: Same party as client on multiple matters (orange)
- **Medium**: Different roles across matters (yellow)
- **Low**: Same role on multiple matters (gray)

## User Flow

1. User opens "Create Matter" or "Edit Matter" modal
2. User fills in matter details
3. User clicks "Add Party" to add parties involved
4. For each party added:
   - User fills in party details (name, type, email, etc.)
   - User clicks "Add & Check Conflicts"
   - System checks for conflicts in real-time
5. If conflicts found:
   - Yellow/red alert appears with conflict summary
   - User can view detailed conflict information
   - User must acknowledge conflicts to proceed
6. User submits form:
   - If conflicts exist and not acknowledged → Error message
   - If no conflicts or acknowledged → Matter saved with parties

## Styling

The module uses Tailwind CSS classes and matches the existing matter form design:
- Indigo primary colors
- Gray neutral colors
- Red for critical warnings
- Yellow for medium warnings
- Responsive grid layouts
- Rounded corners and shadows

## Testing

Test the integration with these scenarios:

1. **No Conflicts**: Add a new party that doesn't exist in any matter
2. **Low Severity**: Add same person as client on two different matters
3. **High Severity**: Add same person with different roles
4. **Critical Severity**: Add existing client as opposing party
5. **Acknowledgment**: Try to save without acknowledging conflicts
6. **Edit Matter**: Load existing parties when editing a matter

## Troubleshooting

### Conflict Detection Not Showing
- Check browser console for errors
- Verify `conflict-detection.js` is loaded
- Verify `conflictDetectionContainer` exists in the DOM
- Check API endpoints are accessible

### Conflicts Not Being Detected
- Check network tab for API calls to `/api/v1/conflicts/check`
- Verify authentication token is valid
- Check backend logs for errors

### Form Submission Failing
- Verify `conflictDetection.canProceed()` logic
- Check if parties are being saved via `/api/v1/conflicts/parties`
- Verify matter ID is passed correctly

## Future Enhancements

1. **Auto-save Draft**: Save parties as draft before matter creation
2. **Conflict Search**: Search for specific parties before adding
3. **Bulk Import**: Import multiple parties from CSV/Excel
4. **Conflict Reports**: Generate conflict check reports for clients
5. **Email Notifications**: Notify when conflicts are detected
6. **Clear Conflict**: Allow authorized users to manually clear conflicts

## Support

For issues or questions, contact the development team or refer to:
- Backend API documentation: `src/services/processor/routes/conflict-detection.routes.js`
- Service logic: `src/services/processor/conflict-detection/conflict-detection.service.js`
- Database schema: `src/migrations/2026-01-27-add-matter-parties-conflict-detection.sql`
