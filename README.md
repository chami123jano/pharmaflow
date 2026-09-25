# PharmaFlow

A point-of-sale and stock system for a small pharmacy. A keyboard-first till
that keeps working with no internet at all, and an optional website that still
answers when the shop computer is switched off.

Built for a Sri Lankan pharmacy, so it counts in rupees and ships with a
catalogue of 429 medicines sold locally — but nothing in it is specific to one
shop. Fill in your own name in Settings and the whole thing follows.

---

## The two halves

**`app-desktop/`** — the till. Electron + React, SQLite on the shop's own
machine. This is the source of truth. It sells with the network unplugged,
because a pharmacy cannot stop serving people when the line goes down.

**`web/`** — the companion site. A static React app reading a cloud mirror of
the same data, so the owner can check takings from a phone while the shop is
closed. Optional: the till does not need it.

## What it does

- **Billing by keyboard.** Type part of a name, arrow to the medicine, Enter,
  type the quantity, Enter. Numpad `+` then Enter moves the sale on a stage.
  A cashier's hands never need to leave the keys.
- **Batches and expiry.** One medicine can sit on the shelf under several
  expiry dates. Stock is the sum of its batches, and selling takes from the
  soonest-expiring one first, so stock does not quietly go out of date.
  Expired stock is refused to cashiers and allowed to an admin.
- **Discount approval.** Above a set percentage, the till asks for an admin
  password before it will take the discount.
- **Hold and recall.** Park a bill, serve someone else, bring it back.
- **Receipts** printed to a 76mm roll and archived as PDF automatically.
- **Staff lockdown.** The till can require an admin password to close, and run
  fullscreen so the desktop is out of reach.
- **Sync, two ways.** Between two machines through a private GitHub repo, with
  no server at all; or to Supabase, which also feeds the website. A file export
  covers a shop with no internet.
- **Roles.** Owner sees takings and reports. Staff see stock and nothing about
  money.

## Running it

```bash
cd app-desktop
npm install
npm run dev
```

First launch seeds an admin: `admin@local` / `admin123`. Change it.

The website is optional and has [its own README](web/README.md).

## Making it yours

Nothing is hardcoded to a particular pharmacy. In the app, **Settings → Shop
details**: name, address, phone, registration number, and the line printed at
the bottom of the bill. Everything — the header, the window title, the
receipt — follows.

To brand the Windows program itself:

```bash
SHOP_NAME="Your Pharmacy" npm run package
```

Left alone it builds as PharmaFlow.

## Design notes

Three rules the code keeps, which are easy to break by accident:

1. **Stock never travels as an absolute number**, only as a change. A sale at
   the shop and a delivery entered from home must both land; last-write-wins
   on a stock column silently erases one of them.
2. **Every sync event has an id and is applied at most once**, so syncing twice
   is harmless.
3. **Every query that sums revenue filters out voided sales**, or a voided bill
   inflates the takings.

There is more in [CLAUDE.md](CLAUDE.md), which is the working notes for anyone
— human or otherwise — picking this up.

## Licence

MIT. Do what you like with it.
