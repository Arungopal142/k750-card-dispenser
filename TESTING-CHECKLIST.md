# K750 Card Dispenser — Testing Checklist

## Functional Tests

### Authentication
- [ ] Operator login with valid credentials
- [ ] Operator login with invalid credentials → error message
- [ ] Admin login with valid credentials
- [ ] Admin login with invalid credentials → error message
- [ ] Deactivated user login → blocked with message
- [ ] Register new user → auto-admin if first user
- [ ] Register new user → user role if not first
- [ ] Logout → redirects to login

### Operator Pages
- [ ] Dashboard shows correct stats (issued, today, collected)
- [ ] Issue Card — connect device
- [ ] Issue Card — fill form → Issue → Processing → Success/Failed
- [ ] Issue Card — double-click prevention
- [ ] Issue Card — empty form → disabled button
- [ ] My Cards — shows own cards only
- [ ] My Cards — Checkout button works
- [ ] My Cards — Collected status updates
- [ ] Profile — shows correct info
- [ ] Profile — logout works

### Admin Pages
- [ ] Dashboard — all 6 KPI cards show correct data
- [ ] Dashboard — recent activity table shows latest
- [ ] Users — list all users
- [ ] Users — edit name/role
- [ ] Users — activate/deactivate
- [ ] Employees — add new employee
- [ ] Employees — edit employee
- [ ] Employees — delete employee
- [ ] Cards — list all card issues
- [ ] Cards — search by ID/name
- [ ] Cards — filter by department
- [ ] Cards — filter by date
- [ ] Cards — Checkout button works
- [ ] Cards — Export CSV works
- [ ] Device — connect/disconnect
- [ ] Device — status display
- [ ] Device — firmware version
- [ ] Device — reset
- [ ] Logs — filter by user
- [ ] Logs — filter by action
- [ ] Logs — filter by date
- [ ] Logs — Export CSV
- [ ] Reports — daily/weekly/monthly/dept/operator filters
- [ ] Reports — status filter (All/Issued/Collected/Failed)
- [ ] Reports — summary stats
- [ ] Reports — Export CSV
- [ ] Settings — update company name
- [ ] Settings — logout

## Security Tests

### Firestore Rules
- [ ] Operator cannot read other users' cards
- [ ] Operator cannot modify users collection
- [ ] Operator cannot modify employees collection
- [ ] Operator cannot read activity_logs
- [ ] Operator cannot read device_logs
- [ ] Operator cannot modify settings
- [ ] Inactive user cannot read any collection
- [ ] Admin can read/write all collections

### Client-Side
- [ ] Operator cannot access /admin/* routes (redirected)
- [ ] Inactive user cannot access any page (redirected)
- [ ] Role check not trusted alone (rules enforce)

## Hardware Tests (with K750 connected)

### Basic Commands
- [ ] AP — status query returns data
- [ ] FC7 — dispense card to reader
- [ ] FC0 — eject card
- [ ] RS — reset device
- [ ] GV — get firmware version

### Issue Flow
- [ ] Pre-check: box empty → error
- [ ] Pre-check: card in channel → error
- [ ] Pre-check: card jam → error
- [ ] Pre-check: all clear → proceed
- [ ] FC7 → card at sensor3 → success
- [ ] FC7 → timeout → failure
- [ ] FC0 → card ejected → success
- [ ] FC0 → timeout → failure

### Error Scenarios
- [ ] USB disconnected during operation
- [ ] Serial permission denied
- [ ] Machine not responding
- [ ] Multiple rapid commands
- [ ] Browser refresh during transaction

### Checkout Flow
- [ ] Card in return slot → Check Out → FC0 ejects
- [ ] Check Out → Firestore updated with checkoutAt
- [ ] Check Out → activity logged

## Transaction Safety
- [ ] Processing status saved before device commands
- [ ] Issued status saved on success
- [ ] Failed status saved on failure
- [ ] Error message saved on failure
- [ ] No false success (card not dispensed but marked issued)

## Deployment
- [ ] App builds without errors
- [ ] Environment variables configured
- [ ] Firebase config correct
- [ ] Works in Chrome
- [ ] Works in Edge
- [ ] Mobile responsive
