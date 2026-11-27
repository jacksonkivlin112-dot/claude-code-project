# 2027 Paycheck Budget Planner (Etsy Google Sheets template)

| File | What it is |
| --- | --- |
| `2027_Paycheck_Budget_Planner.xlsx` | the template, with sample data, ready to upload to Google Sheets |
| `build_planner.py` | rebuilds the workbook (`python3 build_planner.py`) |
| `2027_Paycheck_Budget_Planner_ACCESS.pdf` | the one-page file Etsy buyers download |
| `make_delivery_pdf.py` | rebuilds the PDF with your real link: `python3 make_delivery_pdf.py --link "https://docs.google.com/spreadsheets/d/XXXX/copy" --shop "Shop Name" --email "you@shop.com"` |
| `LISTING.md` | Etsy title, 13 tags and description |

## Turn it into a Google Sheets "Make a copy" link

1. Go to **drive.google.com** and make a folder, for example "Etsy masters".
2. **New → File upload** and pick `2027_Paycheck_Budget_Planner.xlsx`.
3. Right-click the uploaded file → **Open with → Google Sheets**. If the title bar shows an `.XLSX` badge, click **File → Save as Google Sheets**. You now have a native Google Sheet; delete the uploaded .xlsx to avoid mix-ups.
4. Tidy up after the import (2 minutes):
   - **Bills tab:** select `F5:F34` → **Insert → Checkbox**. The TRUE/FALSE values become real checkboxes.
   - **Every tab:** if gridlines show on Start Here or Dashboard, use **View → Show → Gridlines** to turn them off.
   - **Dashboard:** click each chart and drag it or resize it if it shifted. Optional: **Edit chart → Customize** to fine-tune colors and fonts.
   - **File → Settings → Locale:** set it to the country your buyers are in (usually United States). It controls how dates are typed and shown.
   - Optional: **Data → Protect sheets and ranges** → protect the Dashboard tab and the cream formula columns with **"Show a warning when editing this range"**. Buyers can still edit, but get a warning before overwriting a formula.
5. Rename the file **2027 Paycheck Budget Planner**.
6. Click **Share** → under General access choose **Anyone with the link** → role **Viewer** → **Done**. Never give buyers Editor access to your master.
7. Click **Copy link**. It looks like `https://docs.google.com/spreadsheets/d/1AbC...xyz/edit?usp=sharing`. Replace everything from `/edit` onward with `/copy`:
   `https://docs.google.com/spreadsheets/d/1AbC...xyz/copy`
8. Test it in a private/incognito window. You should see a "Copy document?" page with a **Make a copy** button, and the copy should open with all tabs, charts and checkboxes.
9. Rebuild the PDF with your link, shop name and email, open it, and click the button to test it:
   `python3 make_delivery_pdf.py --link "https://docs.google.com/spreadsheets/d/1AbC...xyz/copy" --shop "Your Shop" --email "Etsy messages"`
10. In your Etsy listing, set the type to **Digital** and upload `2027_Paycheck_Budget_Planner_ACCESS.pdf` as the file.

Keep the master private apart from the Viewer link. Any change you make to it shows up in every future buyer's copy, but not in copies already made.

## What can look different after importing into Google Sheets

- **Savings Goals data bars:** the green bar inside the "% Complete" cells is an Excel feature Google Sheets doesn't import. The text progress bar (█░) in the Progress column still works.
- **Charts:** Google redraws them. Colors usually carry over, but fonts, label positions, the pie's percentage labels and the chart size can change. Check and adjust them once on the master.
- **Paid checkboxes:** they import as TRUE/FALSE with a dropdown until you do step 4 above.
- **"Type here" notes:** they show as Google Sheets notes (hover a cell's black corner). Nothing changes.
- **Merged wrapped text on Start Here:** row heights can differ slightly. Drag a row taller if any text is cut off.
- **Progress bar characters (█░):** Arial doesn't contain them, so Sheets uses a fallback font. They look the same, just slightly different in width.
- **Dates:** they follow the spreadsheet's locale (File → Settings).
- **Currency:** the symbol from Settings appears in headers and on the Dashboard cards. Amount cells are plain numbers (1,800.00), so any currency works.
- **Gridlines:** hidden on Start Here and Dashboard in the file; if Google shows them, turn them off as in step 4.

## How the calculations work

- **Paydays** come from the first payday and pay frequency (52 weekly, 26 biweekly, 24 semi-monthly on the payday and 15 days later, or 12 monthly). Paydays after Dec 31, 2027 are left blank, and month-end paydays (the 31st) are capped at the last day of shorter months.
- **Bills assigned** to a paycheck are the bills due from that payday up to the day before the next one, wrapping into the next month. Bills due before the first 2027 payday belong to your last December 2026 paycheck, so they don't appear in 2027.
- **Total Saved** = income − expenses. Transfers to savings don't need to be logged as expenses; logging them counts them as spent.
- **Dashboard expenses** = the sum of every row on the Expenses tab. A check line shows any amount dated outside 2027 (it should be 0).
- **Functions used** (all work in both Excel and Google Sheets): SUM, SUMIF, SUMIFS, COUNTIFS, IF, IFERROR, OR, AND, ISNUMBER, VLOOKUP, TEXT, DATE, YEAR, MONTH, DAY, INT, MOD, MIN, ROUND, REPT. There are no macros, tables or structured references.
