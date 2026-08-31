# Design System

## Infra NEXUS — UI/UX Design Reference

**Version:** 1.0  
**Last Updated:** 2026-08-31

---

## 1. Color Palette

### 1.1 Primary Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Blue | `#3B82F6` | Primary actions, links, active states |
| Blue Dark | `#2563EB` | Hover states |
| Blue Light | `#DBEAFE` | Backgrounds, badges |

### 1.2 Status Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Green | `#22C55E` | Success, active, online, approved |
| Yellow | `#EAB308` | Warning, pending, in_progress |
| Red | `#EF4444` | Error, offline, rejected, down |
| Orange | `#F97316` | High priority, urgent |
| Gray | `#6B7280` | Inactive, disabled, unknown |

### 1.3 Background Colors

| Color | Hex | Usage |
|-------|-----|-------|
| White | `#FFFFFF` | Card backgrounds |
| Gray 50 | `#F9FAFB` | Page background |
| Gray 100 | `#F3F4F6` | Table headers, hover |
| Gray 200 | `#E5E7EB` | Borders |

---

## 2. Typography

### 2.1 Font Family

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

### 2.2 Font Sizes

| Element | Size | Weight |
|---------|------|--------|
| Page Title | 24px | 700 (bold) |
| Section Title | 18px | 600 (semibold) |
| Card Title | 16px | 600 |
| Body Text | 14px | 400 (normal) |
| Small Text | 12px | 400 |
| Badge | 12px | 500 |

---

## 3. Layout

### 3.1 Sidebar

- Width: 256px (fixed)
- Background: White
- Border: Right 1px solid gray-200
- Contains: Logo, navigation links, user info

### 3.2 Main Content

- Background: Gray 50 (`#F9FAFB`)
- Padding: 24px (all sides)
- Max-width: None (full width)

### 3.3 Map Pages

- **Edge-to-edge** (no padding)
- Full viewport width and height
- Overlay controls on map

### 3.4 Cards

- Background: White
- Border: 1px solid gray-200
- Border-radius: 8px
- Padding: 16px
- Shadow: None (flat design)

---

## 4. Components

### 4.1 Buttons

```css
/* Primary */
.btn-primary {
  background: #3B82F6;
  color: white;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 500;
}

/* Secondary */
.btn-secondary {
  background: white;
  border: 1px solid #E5E7EB;
  color: #374151;
}

/* Danger */
.btn-danger {
  background: #EF4444;
  color: white;
}
```

### 4.2 Forms

```css
/* Input */
input, select {
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
}

input:focus {
  border-color: #3B82F6;
  outline: none;
  ring: 2px solid #DBEAFE;
}
```

### 4.3 Tables

```css
table {
  width: 100%;
  border-collapse: collapse;
}

th {
  background: #F9FAFB;
  font-weight: 600;
  text-align: left;
  padding: 12px;
  border-bottom: 1px solid #E5E7EB;
}

td {
  padding: 12px;
  border-bottom: 1px solid #F3F4F6;
}

tr:hover {
  background: #F9FAFB;
}
```

### 4.4 Badges

```css
/* Status badges */
.badge-pending { background: #FEF3C7; color: #92400E; }
.badge-approved { background: #D1FAE5; color: #065F46; }
.badge-rejected { background: #FEE2E2; color: #991B1B; }
.badge-active { background: #D1FAE5; color: #065F46; }
.badge-offline { background: #FEE2E2; color: #991B1B; }
.badge-unknown { background: #F3F4F6; color: #6B7280; }
```

### 4.5 Cards

```css
.card {
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  padding: 16px;
}
```

---

## 5. Navigation

### 5.1 Sidebar Links

| Icon | Label | Path | Permission |
|------|-------|------|-----------|
| 📊 | Dashboard | `/` | All |
| 🖥️ | Devices | `/devices` | All |
| 📡 | ONUs | `/onus` | All |
| 🔗 | Bindings | `/bindings` | All |
| 👥 | Subscribers | `/subscribers` | All |
| 🎫 | Tickets | `/tickets` | All |
| 📡 | ACS | `/acs` | All |
| ⚡ | Live Downs | `/live-downs` | ops+ |
| 🗺️ | Network Map | `/network-map` | All |
| 🔌 | Fiber Map | `/fiber-map` | All |
| 📈 | Reports | `/reports` | All |
| 🔄 | BGP Routing | `/routing` | All |
| 👤 | Users | `/users` | admin |
| 📋 | Scans | `/scans` | All |
| ⏰ | Jobs | `/schedule-jobs` | All |
| ✅ | Approvals | `/approvals` | All |

### 5.2 Sidebar Badge

- Pending approval count shown as red badge
- Auto-refreshes every 15 seconds
- Only visible when count > 0

---

## 6. Maps

### 6.1 Leaflet Configuration

```javascript
// Default center
center: [22.700673, 90.354323]

// Default zoom
zoom: 12

// Tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
})
```

### 6.2 Map Controls

- Zoom: Top-right corner
- Layer toggle: Top-right
- Draw tools: Left side (Fiber Map only)
- GPS input: Bottom-left

### 6.3 Point Markers

- **ONU:** Circle marker
  - Green: Active
  - Red: Offline
  - Yellow: Inactive
  - Gray: Unknown
- **TJ Box:** Square marker (blue)
- **Splitter:** Diamond marker (purple)
- **Cable Cut:** X marker (red)
- **NOC:** Star marker (gold)
- **POP:** Triangle marker (orange)

---

## 7. Responsive Design

### 7.1 Breakpoints

| Breakpoint | Width | Layout |
|-----------|-------|--------|
| Mobile | < 768px | Collapsed sidebar |
| Tablet | 768px - 1024px | Sidebar overlay |
| Desktop | > 1024px | Full sidebar |

### 7.2 Mobile Considerations

- Sidebar becomes hamburger menu
- Tables become card lists
- Forms stack vertically
- Maps are full-screen

---

## 8. Dashboard Layout

### 8.1 Summary Cards (Top Row)

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│ OLTs    │ ONUs    │ Active  │ Bound   │ Downs   │
│ 10      │ 2500    │ 2100    │ 1800    │ 3       │
└─────────┴─────────┴─────────┴─────────┴─────────┘
```

### 8.2 Charts (Second Row)

```
┌─────────────────────┬─────────────────────┐
│ Signal Histogram    │ Router Brands       │
│ (Bar chart)         │ (Pie chart)         │
└─────────────────────┴─────────────────────┘
```

### 8.3 Tables (Third Row)

```
┌─────────────────────┬─────────────────────┐
│ Weakest ONUs        │ Mass-Down Areas     │
│ (Sortable table)    │ (List)              │
└─────────────────────┴─────────────────────┘
```

### 8.4 Jobs (Bottom)

```
┌───────────────────────────────────────────┐
│ Scheduled Jobs                            │
│ (Status table with live refresh)          │
└───────────────────────────────────────────┘
```

---

## 9. Approval Queue Layout

### 9.1 Filter Tabs

```
┌─────┬─────────┬──────────┬──────────┬──────────┬───────────┐
│ All │ Pending │ Approved │ Rejected │ Returned │ Resubmit  │
│ 50  │ 12      │ 25       │ 8        │ 3        │ 2         │
└─────┴─────────┴──────────┴──────────┴──────────┴───────────┘
```

### 9.2 Table Columns

| Column | Width | Description |
|--------|-------|-------------|
| ID | 60px | Request ID |
| Submitted | 120px | Submitter name |
| Entity | 100px | Entity type badge |
| Action | 80px | create/update/delete |
| Status | 100px | Status badge |
| Priority | 80px | Priority badge |
| Date | 120px | Submission date |
| Actions | 100px | View/Approve/Reject |

### 9.3 Detail Page

```
┌─────────────────────────────────────────────┐
│ Approval #42 - TJ Box Creation              │
├─────────────────────────────────────────────┤
│ Status: Pending | Priority: Normal          │
│ Submitted: Field User | Date: 2026-08-31    │
├─────────────────────────────────────────────┤
│ ┌─────────────────┬───────────────────────┐ │
│ │ New Data        │ Previous Data         │ │
│ │ (Payload JSON)  │ (Snapshot)            │ │
│ └─────────────────┴───────────────────────┘ │
├─────────────────────────────────────────────┤
│ Photos: [photo1.jpg] [photo2.jpg]           │
├─────────────────────────────────────────────┤
│ Actions: [Approve] [Reject] [Return]       │
└─────────────────────────────────────────────┘
```

---

## 10. Empty States

### 10.1 No Data

```
┌─────────────────────────────────────┐
│                                     │
│         📭 No data available        │
│                                     │
│    Create your first OLT device     │
│         to get started              │
│                                     │
│         [Add OLT]                   │
│                                     │
└─────────────────────────────────────┘
```

### 10.2 No Search Results

```
┌─────────────────────────────────────┐
│                                     │
│         🔍 No results found         │
│                                     │
│     Try a different search term     │
│                                     │
└─────────────────────────────────────┘
```

---

## 11. Loading States

### 11.1 Page Load

- Skeleton screens for cards
- Spinner for tables
- Progress bar for file uploads

### 11.2 Action Loading

- Button spinner during API calls
- Disabled state during submission
- Toast notification on completion

---

## 12. Toast Notifications

### 12.1 Positions

- Top-right corner
- Auto-dismiss after 3 seconds
- Stack vertically

### 12.2 Types

| Type | Color | Icon | Usage |
|------|-------|------|-------|
| Success | Green | ✓ | Operation completed |
| Error | Red | ✗ | Operation failed |
| Warning | Yellow | ⚠ | Caution needed |
| Info | Blue | ℹ | Information |

---

## 13. Icons

- **Library:** Emoji-based (no icon library)
- **Size:** 16px-24px
- **Alignment:** Left of text

### 13.1 Common Icons

| Icon | Usage |
|------|-------|
| 📊 | Dashboard |
| 🖥️ | Devices |
| 📡 | ONUs/Network |
| 🔗 | Bindings |
| 👥 | Subscribers |
| 🎫 | Tickets |
| ⚡ | Live Downs |
| 🗺️ | Maps |
| 📈 | Reports |
| 🔄 | BGP/Routing |
| 👤 | Users |
| ✅ | Approvals |
| ⏰ | Scheduled Jobs |
