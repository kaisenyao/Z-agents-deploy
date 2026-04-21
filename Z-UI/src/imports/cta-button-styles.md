Fix CTA button visibility and hierarchy for:
- “View Performance History” (Portfolio Performance section)
- “Trade History” (Holdings section)

Current issue:
Buttons have low contrast and appear washed out against dark background.
They look disabled or inactive.

---

DESIGN GOAL

Make CTAs:
- Clearly visible
- Consistent with ClearPath dark system
- Not white / not overly bright
- Strong enough to be clickable, but still secondary to primary actions

---

BUTTON TYPE

These are SECONDARY ACTION buttons (NOT primary like “Generate Report”)

---

STYLE SYSTEM

Use the following button styles:

DEFAULT STATE:
- Background: rgba(255,255,255,0.04)
- Border: 1px solid rgba(255,255,255,0.12)
- Text color: rgba(255,255,255,0.85)
- Border radius: 10–12px
- Padding: 10px 16px

HOVER STATE:
- Background: rgba(80, 200, 120, 0.12)   // subtle green tint
- Border: 1px solid rgba(80, 200, 120, 0.35)
- Text color: #FFFFFF
- Add soft glow:
  box-shadow: 0 0 0 2px rgba(80,200,120,0.15)

ACTIVE / CLICK:
- Background: rgba(80,200,120,0.18)
- Border: rgba(80,200,120,0.5)

DISABLED (if needed):
- Opacity: 0.4
- No glow
- Muted text

---

ICON (OPTIONAL BUT RECOMMENDED)

Add subtle icon to improve affordance:

- View Performance History → chart / line icon
- Trade History → clock / history icon

Icon color:
- default: rgba(255,255,255,0.6)
- hover: #FFFFFF

Spacing:
- icon + text gap: 8px

---

PLACEMENT RULES

1. Portfolio Performance card:
   - Place “View Performance History” at bottom-right
   - Align with chart edge
   - Do NOT float

2. Holdings section:
   - Place “Trade History” top-right of the table
   - Same visual weight and style as above

---

CONSISTENCY RULE

Ensure:
- Same height
- Same padding
- Same border radius
- Same hover behavior

These buttons must look like part of ONE system.

---

ANTI-PATTERNS (REMOVE)

- No white filled buttons
- No low-opacity text (below 70%)
- No invisible borders
- No flat gray buttons with no hover

---

RESULT

Buttons should:
- Be clearly visible on dark background
- Feel interactive immediately
- Match modern trading UI (Bloomberg / Robinhood dark / Linear style)