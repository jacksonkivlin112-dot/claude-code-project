#!/usr/bin/env python3
"""Builds "2027_Paycheck_Budget_Planner.xlsx", a Google Sheets-ready budget template.

    python3 build_planner.py [output.xlsx]

Formulas are limited to functions that behave the same in Excel and Google Sheets:
SUM, SUMIF, SUMIFS, COUNTIFS, IF, IFERROR, OR, AND, ISNUMBER, VLOOKUP, TEXT, DATE,
YEAR, MONTH, DAY, INT, MOD, MIN, ROUND, REPT. No macros, tables or structured references.
"""
import sys
from datetime import date

from openpyxl import Workbook
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.series import DataPoint
from openpyxl.comments import Comment
from openpyxl.formatting.rule import DataBarRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = sys.argv[1] if len(sys.argv) > 1 else "2027_Paycheck_Budget_Planner.xlsx"

# ---- Palette and styles -------------------------------------------------------------
SAGE, CREAM, CHARCOAL, ACCENT = "A8BBA3", "FAF7F2", "2F2F2F", "D4A373"
INPUT_FILL = "E8EFE5"   # light sage tint = "type here"
LINE = "E2DBD0"         # soft table borders
GREEN, RED = "2E7D32", "C62828"

FONT = "Arial"
f_body = Font(name=FONT, size=11, color=CHARCOAL)
f_bold = Font(name=FONT, size=11, color=CHARCOAL, bold=True)
f_small = Font(name=FONT, size=10, color="6B6B6B", italic=True)
f_title = Font(name=FONT, size=18, color=CHARCOAL, bold=True)
f_h2 = Font(name=FONT, size=14, color=CHARCOAL, bold=True)
f_kpi = Font(name=FONT, size=16, color=CHARCOAL, bold=True)

fill_cream = PatternFill("solid", fgColor=CREAM)
fill_sage = PatternFill("solid", fgColor=SAGE)
fill_input = PatternFill("solid", fgColor=INPUT_FILL)
fill_accent = PatternFill("solid", fgColor=ACCENT)
fill_white = PatternFill("solid", fgColor="FFFFFF")

thin = Side(style="thin", color=LINE)
box = Border(left=thin, right=thin, top=thin, bottom=thin)

MONEY = '#,##0.00;-#,##0.00;"-"'
DATEF = "mmm d, yyyy"
PCT = '0.0%;-0.0%;"-"'
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]

# Settings cells on "Start Here" (referenced everywhere).
NAME = "'Start Here'!$C$17"
FREQ = "'Start Here'!$C$18"
FIRST = "'Start Here'!$C$19"
CUR = "'Start Here'!$C$20"
COUNT = "'Start Here'!$C$21"

# Data ranges.
PLAN_FIRST, PLAN_LAST = 5, 56          # 52 paycheck rows
BILL_FIRST, BILL_LAST = 5, 34          # 30 bills
EXP_FIRST, EXP_LAST = 5, 504           # 500 transactions
CAT_FIRST, CAT_LAST = 6, 25            # 20 category slots (12 filled)
GOAL_FIRST, GOAL_LAST = 5, 9           # 5 goals

CAT_LIST = f"Categories!$A${CAT_FIRST}:$A${CAT_LAST}"
EXP_DATE = f"Expenses!$A${EXP_FIRST}:$A${EXP_LAST}"
EXP_CAT = f"Expenses!$C${EXP_FIRST}:$C${EXP_LAST}"
EXP_AMT = f"Expenses!$D${EXP_FIRST}:$D${EXP_LAST}"
BILL_AMT = f"Bills!$B${BILL_FIRST}:$B${BILL_LAST}"
BILL_DUE = f"Bills!$C${BILL_FIRST}:$C${BILL_LAST}"


def note(text):
    c = Comment(text, "Planner")
    c.width, c.height = 220, 70
    return c


def paint(ws, rows, cols):
    """Cream background + Arial on the whole working area."""
    for r in range(1, rows + 1):
        ws.row_dimensions[r].height = ws.row_dimensions[r].height or 18
        for c in range(1, cols + 1):
            cell = ws.cell(r, c)
            cell.fill = fill_cream
            cell.font = f_body


def widths(ws, spec):
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


def header(ws, row, labels, start_col=1, height=26):
    for i, text in enumerate(labels):
        cell = ws.cell(row, start_col + i, text)
        cell.fill = fill_sage
        cell.font = f_bold
        cell.border = box
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[row].height = height


def put(ws, ref, value, font=None, fill=None, fmt=None, align=None, border=True):
    cell = ws[ref]
    cell.value = value
    cell.font = font or f_body
    if fill is not None:
        cell.fill = fill
    if fmt:
        cell.number_format = fmt
    if align:
        cell.alignment = align
    if border:
        cell.border = box
    return cell


def title(ws, text, sub, merge_to="H"):
    put(ws, "A1", text, f_title, border=False, align=Alignment(vertical="center"))
    ws.row_dimensions[1].height = 34
    put(ws, "A2", sub, f_small, border=False, align=Alignment(vertical="top", wrap_text=True))
    ws.merge_cells(f"A2:{merge_to}2")
    ws.row_dimensions[2].height = 32


def input_cell(ws, ref, value=None, fmt=None, align=None):
    return put(ws, ref, value, fill=fill_input, fmt=fmt, align=align)


def calc_cell(ws, ref, formula, fmt=None, font=None, align=None):
    return put(ws, ref, formula, font=font, fill=fill_cream, fmt=fmt, align=align)


wb = Workbook()

# =====================================================================================
# 1. Start Here
# =====================================================================================
ws = wb.active
ws.title = "Start Here"
paint(ws, 45, 10)
ws.sheet_view.showGridLines = False
widths(ws, {"A": 3, "B": 28, "C": 26, "D": 16, "E": 16, "F": 16, "G": 16, "H": 16, "I": 3, "J": 3})
wrap = Alignment(wrap_text=True, vertical="top")

put(ws, "B2", "2027 Paycheck Budget Planner", f_title, border=False)
ws.row_dimensions[2].height = 34
put(ws, "B3", "Plan every paycheck, track every dollar, and watch your savings grow.", f_small, border=False)

put(ws, "B5", "Welcome!", f_h2, border=False)
put(ws, "B6", ("Thank you for your purchase! This planner splits your money paycheck by paycheck: each payday "
               "shows the bills it needs to cover, what you set aside for savings, and what's left to spend. "
               "Log your spending as you go and the Dashboard updates itself."), border=False, align=wrap)
ws.merge_cells("B6:H6")
ws.row_dimensions[6].height = 48

put(ws, "B8", "How to use it in 5 steps", f_h2, border=False)
steps = [
    "1.  Fill in the Settings below: your name, how often you're paid, your first payday of 2027 and your currency symbol.",
    "2.  Bills tab: list your recurring bills with the amount, due day and category. Tick \"Paid\" as you pay them.",
    "3.  Paycheck Planner tab: type what each paycheck actually paid you and how much you're saving. The bills due before your next payday and your \"left to spend\" fill in automatically.",
    "4.  Expenses tab: log every purchase with its date, a short description, a category and the amount. Set monthly budgets on the Categories tab.",
    "5.  Check the Dashboard and Savings Goals any time to see your year at a glance.",
]
for i, s in enumerate(steps):
    r = 9 + i
    put(ws, f"B{r}", s, border=False, align=wrap)
    ws.merge_cells(f"B{r}:H{r}")
    ws.row_dimensions[r].height = 34 if len(s) > 110 else 20

put(ws, "B16", "Settings", f_h2, border=False)
settings = [
    (17, "Your name", "Alex", None),
    (18, "Pay frequency", "Biweekly", None),
    (19, "First payday of 2027", date(2027, 1, 8), DATEF),
    (20, "Currency symbol", "$", None),
]
for r, label, val, fmt in settings:
    put(ws, f"B{r}", label, f_bold)
    c = input_cell(ws, f"C{r}", val, fmt, Alignment(horizontal="left"))
    c.comment = note(f"Type here: {label.lower()}.")
put(ws, "B21", "Paychecks this year", f_bold)
calc_cell(ws, "C21", f'=IF({FREQ}="Weekly",52,IF({FREQ}="Biweekly",26,IF({FREQ}="Semi-monthly",24,12)))',
          "0", align=Alignment(horizontal="left"))
put(ws, "D21", "calculated from your pay frequency", f_small, border=False)
put(ws, "D18", "pick from the list", f_small, border=False)
put(ws, "D19", "e.g. Jan 8, 2027 (semi-monthly: use the 1st or 15th)", f_small, border=False)

dv_freq = DataValidation(type="list", formula1='"Weekly,Biweekly,Semi-monthly,Monthly"', allow_blank=False,
                         showErrorMessage=True, errorTitle="Pay frequency", error="Pick Weekly, Biweekly, Semi-monthly or Monthly.")
ws.add_data_validation(dv_freq)
dv_freq.add("C18")
dv_first = DataValidation(type="date", operator="between", formula1="DATE(2027,1,1)", formula2="DATE(2027,12,31)",
                          showErrorMessage=True, errorTitle="First payday", error="Enter a date in 2027, e.g. 1/8/2027.")
ws.add_data_validation(dv_first)
dv_first.add("C19")

put(ws, "B23", "Color guide", f_h2, border=False)
c = input_cell(ws, "B24", "Light green")
c.comment = note("Light green cells are yours: type here.")
put(ws, "C24", "Type here: your numbers, names and dates", border=False)
calc_cell(ws, "B25", "Cream")
put(ws, "C25", "Calculated for you: please don't type over these", border=False)
put(ws, "B26", "Gold", f_bold, fill_accent)
put(ws, "C26", "Totals", border=False)

put(ws, "B28", "About the sample data", f_h2, border=False)
put(ws, "B29", ("The planner comes filled with one example month (January, two $1,800 biweekly paychecks) so you can see "
                "how everything works. To start fresh, select the light green cells with sample data and press Delete in: "
                "Paycheck Planner (Amount Received, Savings, Notes), Bills (all columns; set Paid back to unticked), "
                "Expenses (all columns) and Savings Goals (all columns). Keep the Categories list and just change the "
                "budgets. Never delete the cream cells: they hold the formulas."), border=False, align=wrap)
ws.merge_cells("B29:H29")
ws.row_dimensions[29].height = 80

put(ws, "B31", "Good to know", f_h2, border=False)
tips = [
    "• \"Saved\" on the Dashboard is everything you earned but didn't spend, so you don't need to log transfers to savings as expenses.",
    "• A paycheck covers the bills due from its payday up to the day before the next payday.",
    "• Add your own categories in the empty rows of the Categories tab; they appear in every dropdown automatically.",
]
for i, t in enumerate(tips):
    put(ws, f"B{32 + i}", t, border=False, align=wrap)
    ws.merge_cells(f"B{32 + i}:H{32 + i}")
    ws.row_dimensions[32 + i].height = 20

# =====================================================================================
# 4. Bills (built before the planner/dashboard, which reference it)
# =====================================================================================
wb.create_sheet("Dashboard")
wb.create_sheet("Paycheck Planner")
ws = wb.create_sheet("Bills")
paint(ws, BILL_LAST + 6, 9)
widths(ws, {"A": 28, "B": 16, "C": 11, "D": 18, "E": 11, "F": 9, "G": 3, "H": 22, "I": 16})
title(ws, "Bills", "Your recurring monthly bills. The Paycheck Planner assigns each bill to the paycheck before its due day. Tick Paid as you go.", "F")
header(ws, 4, ["Bill", "", "Due Day (1-31)", "Category", "Autopay?", "Paid"])
ws["B4"] = f'="Amount ("&{CUR}&")"'
for col in "ABCDEF":
    ws[f"{col}4"].comment = note("Type here (light green cells below).")
bills = [
    ("Rent", 1250, 1, "Rent", "No", False),
    ("Gym membership", 30, 5, "Subscriptions", "Yes", False),
    ("Streaming services", 23, 9, "Subscriptions", "Yes", True),
    ("Electricity", 95, 12, "Utilities", "Yes", True),
    ("Phone plan", 55, 15, "Phone", "Yes", True),
    ("Internet", 60, 18, "Utilities", "Yes", True),
    ("Car insurance", 128, 20, "Insurance", "Yes", True),
    ("Student loan", 180, 25, "Debt Payment", "No", False),
]
for r in range(BILL_FIRST, BILL_LAST + 1):
    row = bills[r - BILL_FIRST] if r - BILL_FIRST < len(bills) else (None, None, None, None, None, None)
    input_cell(ws, f"A{r}", row[0])
    input_cell(ws, f"B{r}", row[1], MONEY)
    input_cell(ws, f"C{r}", row[2], "0", Alignment(horizontal="center"))
    input_cell(ws, f"D{r}", row[3])
    input_cell(ws, f"E{r}", row[4], align=Alignment(horizontal="center"))
    input_cell(ws, f"F{r}", row[5], align=Alignment(horizontal="center"))
tr = BILL_LAST + 1
put(ws, f"A{tr}", "Total monthly bills", f_bold, fill_accent)
put(ws, f"B{tr}", f"=SUM(B{BILL_FIRST}:B{BILL_LAST})", f_bold, fill_accent, MONEY)
for col in "CDEF":
    put(ws, f"{col}{tr}", None, f_bold, fill_accent)
put(ws, "H4", "Summary", f_bold, fill_sage, align=Alignment(horizontal="center", vertical="center"))
put(ws, "I4", "", f_bold, fill_sage)
ws.merge_cells("H4:I4")
put(ws, "H5", "Paid so far")
calc_cell(ws, "I5", f"=SUMIF(F{BILL_FIRST}:F{BILL_LAST},TRUE,B{BILL_FIRST}:B{BILL_LAST})", MONEY)
put(ws, "H6", "Still to pay")
calc_cell(ws, "I6", f"=B{tr}-I5", MONEY)
put(ws, "H7", "On autopay")
calc_cell(ws, "I7", f'=SUMIF(E{BILL_FIRST}:E{BILL_LAST},"Yes",B{BILL_FIRST}:B{BILL_LAST})', MONEY)
ws.freeze_panes = "A5"

dv = DataValidation(type="list", formula1=f"={CAT_LIST}", allow_blank=True, showErrorMessage=True,
                    errorTitle="Category", error="Pick a category from the list (add new ones on the Categories tab).")
ws.add_data_validation(dv)
dv.add(f"D{BILL_FIRST}:D{BILL_LAST}")
dv = DataValidation(type="list", formula1='"Yes,No"', allow_blank=True)
ws.add_data_validation(dv)
dv.add(f"E{BILL_FIRST}:E{BILL_LAST}")
dv = DataValidation(type="list", formula1='"TRUE,FALSE"', allow_blank=True)
ws.add_data_validation(dv)
dv.add(f"F{BILL_FIRST}:F{BILL_LAST}")
dv = DataValidation(type="whole", operator="between", formula1="1", formula2="31", allow_blank=True,
                    showErrorMessage=True, errorTitle="Due day", error="Enter the day of the month, 1 to 31.")
ws.add_data_validation(dv)
dv.add(f"C{BILL_FIRST}:C{BILL_LAST}")
# Paid bills fade to grey.
ws.conditional_formatting.add(f"A{BILL_FIRST}:E{BILL_LAST}",
                              FormulaRule(formula=[f"$F{BILL_FIRST}=TRUE"], font=Font(name=FONT, color="9A9A9A")))

# =====================================================================================
# 5. Expenses
# =====================================================================================
ws = wb.create_sheet("Expenses")
paint(ws, EXP_LAST + 2, 7)
widths(ws, {"A": 16, "B": 34, "C": 18, "D": 16, "E": 3, "F": 22, "G": 16})
title(ws, "Expenses", "Log every purchase: date, what it was, a category and the amount. 500 rows are ready to fill.", "D")
header(ws, 4, ["Date", "Description", "Category", ""])
ws["D4"] = f'="Amount ("&{CUR}&")"'
for col in "ABCD":
    ws[f"{col}4"].comment = note("Type here (light green cells below).")
tx = [
    (1, "Rent - January", "Rent", 1250), (3, "Grocery run", "Groceries", 96.40), (4, "Gas", "Gas", 44.10),
    (5, "Gym membership", "Subscriptions", 30), (6, "Coffee with friends", "Dining Out", 12.75),
    (9, "Streaming services", "Subscriptions", 22.99), (10, "Grocery run", "Groceries", 112.35),
    (11, "Gas", "Gas", 41.80), (12, "Electric bill", "Utilities", 95), (13, "Takeout pizza", "Dining Out", 28.60),
    (15, "Phone plan", "Phone", 55), (16, "New running shoes", "Shopping", 64.99), (17, "Grocery run", "Groceries", 88.20),
    (18, "Internet", "Utilities", 60), (19, "Gas", "Gas", 47.25), (20, "Car insurance", "Insurance", 128),
    (22, "Birthday gift", "Shopping", 35), (23, "Dinner out", "Dining Out", 42.30), (24, "Grocery run", "Groceries", 101.65),
    (25, "Student loan payment", "Debt Payment", 180), (26, "Haircut", "Other", 25), (27, "Gas", "Gas", 39.90),
    (29, "Brunch", "Dining Out", 19.40), (30, "Pharmacy", "Other", 14.85), (31, "Grocery run", "Groceries", 58.10),
]
for r in range(EXP_FIRST, EXP_LAST + 1):
    i = r - EXP_FIRST
    d, desc, cat, amt = tx[i] if i < len(tx) else (None, None, None, None)
    input_cell(ws, f"A{r}", date(2027, 1, d) if d else None, DATEF, Alignment(horizontal="left"))
    input_cell(ws, f"B{r}", desc)
    input_cell(ws, f"C{r}", cat)
    input_cell(ws, f"D{r}", amt, MONEY)
put(ws, "F4", "Summary", f_bold, fill_sage, align=Alignment(horizontal="center", vertical="center"))
put(ws, "G4", "", f_bold, fill_sage)
ws.merge_cells("F4:G4")
put(ws, "F5", "Total spent", f_bold, fill_accent)
put(ws, "G5", f"=SUM(D{EXP_FIRST}:D{EXP_LAST})", f_bold, fill_accent, MONEY)
put(ws, "F6", "Transactions logged")
calc_cell(ws, "G6", f'=COUNTIFS(D{EXP_FIRST}:D{EXP_LAST},"<>")', "0")
put(ws, "F7", "Missing a category")
calc_cell(ws, "G7", f'=COUNTIFS(D{EXP_FIRST}:D{EXP_LAST},"<>",C{EXP_FIRST}:C{EXP_LAST},"")', "0")
ws.freeze_panes = "A5"
dv = DataValidation(type="list", formula1=f"={CAT_LIST}", allow_blank=True, showErrorMessage=True,
                    errorTitle="Category", error="Pick a category from the list (add new ones on the Categories tab).")
ws.add_data_validation(dv)
dv.add(f"C{EXP_FIRST}:C{EXP_LAST}")
dv = DataValidation(type="date", operator="greaterThan", formula1="DATE(2000,1,1)", allow_blank=True,
                    showErrorMessage=True, errorTitle="Date", error="Enter a date, e.g. 1/15/2027.")
ws.add_data_validation(dv)
dv.add(f"A{EXP_FIRST}:A{EXP_LAST}")

# =====================================================================================
# 6. Categories
# =====================================================================================
ws = wb.create_sheet("Categories")
paint(ws, CAT_LAST + 3, 9)
widths(ws, {"A": 20, "B": 16, "C": 18, "D": 15, "E": 14, "F": 17, "G": 16, "H": 16, "I": 3, "J": 12, "K": 6})
title(ws, "Categories", "Your spending categories and monthly budgets. Rename, add or remove categories in the list; every dropdown updates.", "H")
put(ws, "A3", "Show month:", f_bold, border=False, align=Alignment(horizontal="right"))
c = input_cell(ws, "B3", "January")
c.comment = note("Type here: pick a month to compare budget vs. actual.")
dv = DataValidation(type="list", formula1='"' + ",".join(MONTHS) + '"', allow_blank=False)
ws.add_data_validation(dv)
dv.add("B3")
# Month lookup (hidden helper columns J:K).
for i, m in enumerate(MONTHS):
    ws[f"J{CAT_FIRST + i}"] = m
    ws[f"K{CAT_FIRST + i}"] = i + 1
    ws[f"J{CAT_FIRST + i}"].font = f_body
    ws[f"K{CAT_FIRST + i}"].font = f_body
ws["J5"] = "Month #"
ws["K5"] = f"=IFERROR(VLOOKUP($B$3,$J${CAT_FIRST}:$K${CAT_FIRST + 11},2,FALSE),1)"
ws["J5"].font = f_body
ws["K5"].font = f_body
ws.column_dimensions["J"].hidden = True
ws.column_dimensions["K"].hidden = True
MON = "$K$5"

header(ws, 5, ["Category", "Monthly Budget", "Spent in Selected Month", "Remaining", "Status",
               "Spent Year-to-Date", "Yearly Budget", "Left for the Year"], height=36)
ws["A5"].comment = note("Type here: category names (light green). Budgets go in column B.")
ws["B5"].comment = note("Type here: how much you plan to spend each month.")
cats = [("Rent", 1250), ("Utilities", 160), ("Groceries", 400), ("Gas", 160), ("Insurance", 130), ("Phone", 55),
        ("Subscriptions", 55), ("Dining Out", 120), ("Shopping", 120), ("Debt Payment", 180), ("Savings", 400), ("Other", 60)]
for r in range(CAT_FIRST, CAT_LAST + 1):
    i = r - CAT_FIRST
    name, bud = cats[i] if i < len(cats) else (None, None)
    input_cell(ws, f"A{r}", name)
    input_cell(ws, f"B{r}", bud, MONEY)
    month_spent = (f'SUMIFS({EXP_AMT},{EXP_CAT},A{r},{EXP_DATE},">="&DATE(2027,{MON},1),'
                   f'{EXP_DATE},"<"&DATE(2027,{MON}+1,1))')
    calc_cell(ws, f"C{r}", f'=IF(A{r}="","",{month_spent})', MONEY)
    calc_cell(ws, f"D{r}", f'=IF(OR(A{r}="",B{r}=""),"",B{r}-C{r})', MONEY)
    calc_cell(ws, f"E{r}", f'=IF(A{r}="","",IF(B{r}="","No budget",IF(C{r}>B{r},"Over budget","On track")))',
              align=Alignment(horizontal="center"))
    calc_cell(ws, f"F{r}", f'=IF(A{r}="","",SUMIF({EXP_CAT},A{r},{EXP_AMT}))', MONEY)
    calc_cell(ws, f"G{r}", f'=IF(OR(A{r}="",B{r}=""),"",B{r}*12)', MONEY)
    calc_cell(ws, f"H{r}", f'=IF(OR(A{r}="",B{r}=""),"",G{r}-F{r})', MONEY)
tr = CAT_LAST + 1
put(ws, f"A{tr}", "Total", f_bold, fill_accent)
for col in "BCDFGH":
    put(ws, f"{col}{tr}", f"=SUM({col}{CAT_FIRST}:{col}{CAT_LAST})", f_bold, fill_accent, MONEY)
put(ws, f"E{tr}", None, f_bold, fill_accent)
ws.freeze_panes = "A6"
for rng in (f"D{CAT_FIRST}:D{tr}", f"H{CAT_FIRST}:H{tr}"):
    first = rng.split(":")[0]
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f"AND(ISNUMBER({first}),{first}<0)"], font=Font(name=FONT, color=RED, bold=True)))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f"AND(ISNUMBER({first}),{first}>=0)"], font=Font(name=FONT, color=GREEN)))
ws.conditional_formatting.add(f"E{CAT_FIRST}:E{CAT_LAST}", FormulaRule(formula=[f'E{CAT_FIRST}="Over budget"'], font=Font(name=FONT, color=RED, bold=True)))
ws.conditional_formatting.add(f"E{CAT_FIRST}:E{CAT_LAST}", FormulaRule(formula=[f'E{CAT_FIRST}="On track"'], font=Font(name=FONT, color=GREEN)))

# =====================================================================================
# 3. Paycheck Planner
# =====================================================================================
ws = wb["Paycheck Planner"]
paint(ws, PLAN_LAST + 3, 8)
widths(ws, {"A": 6, "B": 16, "C": 17, "D": 17, "E": 10, "F": 15, "G": 16, "H": 42, "I": 12})
title(ws, "Paycheck Planner",
      "One row per paycheck. Type the amount you received and what you're saving; the bills due before your next payday and what's left to spend are calculated.", "H")
header(ws, 4, ["#", "Pay Date", "", "Bills Assigned", "# of Bills", "Savings", "Left to Spend", "Notes"])
ws["C4"] = f'="Amount Received ("&{CUR}&")"'
ws["C4"].comment = note("Type here: what this paycheck actually paid you.")
ws["F4"].comment = note("Type here: how much of this paycheck goes to savings.")
ws["H4"].comment = note("Type here: anything to remember about this paycheck.")
ws["B4"].comment = note("Filled in from your first payday and pay frequency on Start Here.")
ws["D4"].comment = note("Bills from the Bills tab due from this payday up to the day before the next one.")
ws.column_dimensions["I"].hidden = True   # helper: raw pay date
sample_pay = {1: (1800, 200, "Electric + phone + internet + insurance"), 2: (1800, 200, "Covers February rent")}
for r in range(PLAN_FIRST, PLAN_LAST + 1):
    n = r - PLAN_FIRST + 1
    put(ws, f"A{r}", n, align=Alignment(horizontal="center"), fill=fill_cream)
    raw = (f'=IF({FIRST}="","",IF({FREQ}="Weekly",{FIRST}+7*(A{r}-1),IF({FREQ}="Biweekly",{FIRST}+14*(A{r}-1),'
           # Semi-monthly: payday and payday+15 each month; monthly: same day each month.
           # Both are capped at the month's last day (DATE(y, m+1, 0)), so the 31st never spills into the next month.
           f'IF({FREQ}="Semi-monthly",DATE(YEAR({FIRST}),MONTH({FIRST})+INT((A{r}-1)/2),'
           f'MIN(DAY({FIRST})+IF(MOD(A{r}-1,2)=1,15,0),DAY(DATE(YEAR({FIRST}),MONTH({FIRST})+INT((A{r}-1)/2)+1,0)))),'
           f'DATE(YEAR({FIRST}),MONTH({FIRST})+A{r}-1,MIN(DAY({FIRST}),DAY(DATE(YEAR({FIRST}),MONTH({FIRST})+A{r},0))))))))')
    ws[f"I{r}"] = raw
    ws[f"I{r}"].number_format = DATEF
    ws[f"I{r}"].font = f_body
    calc_cell(ws, f"B{r}", f'=IF(OR(I{r}="",A{r}>{COUNT}),"",IF(I{r}>DATE(2027,12,31),"",I{r}))', DATEF,
              align=Alignment(horizontal="left"))
    amt, sav, memo = sample_pay.get(n, (None, None, None))
    input_cell(ws, f"C{r}", amt, MONEY)
    nxt = f"B{r + 1}"
    # Bills due from this payday up to the day before the next one (wrapping into next month).
    sum_same = f'SUMIFS({BILL_AMT},{BILL_DUE},">="&DAY(B{r}),{BILL_DUE},"<"&DAY({nxt}))'
    sum_from = f'SUMIFS({BILL_AMT},{BILL_DUE},">="&DAY(B{r}))'
    sum_to = f'SUMIFS({BILL_AMT},{BILL_DUE},"<"&DAY({nxt}))'
    cnt_same = f'COUNTIFS({BILL_AMT},"<>",{BILL_DUE},">="&DAY(B{r}),{BILL_DUE},"<"&DAY({nxt}))'
    cnt_from = f'COUNTIFS({BILL_AMT},"<>",{BILL_DUE},">="&DAY(B{r}))'
    cnt_to = f'COUNTIFS({BILL_AMT},"<>",{BILL_DUE},"<"&DAY({nxt}))'
    if r == PLAN_LAST:
        # The row below is the Total row, so the last paycheck covers the rest of its month.
        d_formula = f'=IF(B{r}="","",{sum_from})'
        e_formula = f'=IF(B{r}="","",{cnt_from})'
    else:
        d_formula = f'=IF(B{r}="","",IF({nxt}="",{sum_from},IF(MONTH({nxt})=MONTH(B{r}),{sum_same},{sum_from}+{sum_to})))'
        e_formula = f'=IF(B{r}="","",IF({nxt}="",{cnt_from},IF(MONTH({nxt})=MONTH(B{r}),{cnt_same},{cnt_from}+{cnt_to})))'
    calc_cell(ws, f"D{r}", d_formula, MONEY)
    calc_cell(ws, f"E{r}", e_formula, "0", align=Alignment(horizontal="center"))
    input_cell(ws, f"F{r}", sav, MONEY)
    calc_cell(ws, f"G{r}", f'=IF(OR(B{r}="",C{r}=""),"",C{r}-D{r}-F{r})', MONEY, font=f_bold)
    input_cell(ws, f"H{r}", memo)
tr = PLAN_LAST + 1
put(ws, f"A{tr}", "", f_bold, fill_accent)
put(ws, f"B{tr}", "Total", f_bold, fill_accent)
for col in "CDFG":
    put(ws, f"{col}{tr}", f"=SUM({col}{PLAN_FIRST}:{col}{PLAN_LAST})", f_bold, fill_accent, MONEY)
put(ws, f"E{tr}", None, f_bold, fill_accent)
put(ws, f"H{tr}", None, f_bold, fill_accent)
ws.freeze_panes = "A5"
g = f"G{PLAN_FIRST}"
ws.conditional_formatting.add(f"G{PLAN_FIRST}:G{tr}", FormulaRule(formula=[f"AND(ISNUMBER({g}),{g}>0)"],
                              font=Font(name=FONT, color=GREEN, bold=True), fill=PatternFill("solid", fgColor="E3F1E1")))
ws.conditional_formatting.add(f"G{PLAN_FIRST}:G{tr}", FormulaRule(formula=[f"AND(ISNUMBER({g}),{g}<0)"],
                              font=Font(name=FONT, color=RED, bold=True), fill=PatternFill("solid", fgColor="F8E1E1")))

# =====================================================================================
# 7. Savings Goals
# =====================================================================================
ws = wb.create_sheet("Savings Goals")
paint(ws, GOAL_LAST + 4, 7)
widths(ws, {"A": 26, "B": 17, "C": 20, "D": 15, "E": 13, "F": 30})
title(ws, "Savings Goals", "Up to 5 goals. Update \"Saved So Far\" whenever you add to a goal.", "F")
header(ws, 4, ["Goal", "", "", "Remaining", "% Complete", "Progress"])
ws["B4"] = f'="Target ("&{CUR}&")"'
ws["C4"] = f'="Saved So Far ("&{CUR}&")"'
for col in "ABC":
    ws[f"{col}4"].comment = note("Type here (light green cells below).")
goals = [("Emergency fund", 3000, 650), ("Summer vacation", 1500, 300), ("New laptop", 1200, 450)]
for r in range(GOAL_FIRST, GOAL_LAST + 1):
    i = r - GOAL_FIRST
    name, tgt, saved = goals[i] if i < len(goals) else (None, None, None)
    input_cell(ws, f"A{r}", name)
    input_cell(ws, f"B{r}", tgt, MONEY)
    input_cell(ws, f"C{r}", saved, MONEY)
    calc_cell(ws, f"D{r}", f'=IF(OR(B{r}="",B{r}=0),"",IF(B{r}-C{r}<0,0,B{r}-C{r}))', MONEY)
    calc_cell(ws, f"E{r}", f'=IF(OR(B{r}="",B{r}=0),"",IFERROR(MIN(1,C{r}/B{r}),0))', PCT, align=Alignment(horizontal="center"))
    calc_cell(ws, f"F{r}", f'=IF(E{r}="","",REPT("█",ROUND(E{r}*20,0))&REPT("░",20-ROUND(E{r}*20,0)))',
              font=Font(name=FONT, size=11, color="7E9A78"))
tr = GOAL_LAST + 1
put(ws, f"A{tr}", "All goals", f_bold, fill_accent)
for col in "BCD":
    put(ws, f"{col}{tr}", f"=SUM({col}{GOAL_FIRST}:{col}{GOAL_LAST})", f_bold, fill_accent, MONEY)
put(ws, f"E{tr}", f"=IFERROR(MIN(1,C{tr}/B{tr}),0)", f_bold, fill_accent, PCT, Alignment(horizontal="center"))
put(ws, f"F{tr}", f'=REPT("█",ROUND(E{tr}*20,0))&REPT("░",20-ROUND(E{tr}*20,0))',
    Font(name=FONT, size=11, color=CHARCOAL, bold=True), fill_accent)
ws.freeze_panes = "A5"
ws.conditional_formatting.add(f"E{GOAL_FIRST}:E{GOAL_LAST}",
                              DataBarRule(start_type="num", start_value=0, end_type="num", end_value=1, color=SAGE))

# =====================================================================================
# 2. Dashboard
# =====================================================================================
ws = wb["Dashboard"]
paint(ws, 50, 18)
ws.sheet_view.showGridLines = False
widths(ws, {"A": 3, "B": 16, "C": 16, "D": 16, "E": 16, "F": 16, "G": 3})
for col in "HIJKLMNOPQ":
    ws.column_dimensions[col].width = 11
put(ws, "B2", f'=IF({NAME}="","My 2027 Budget",{NAME}&"\'s 2027 Budget")', f_title, border=False)
ws.row_dimensions[2].height = 34
put(ws, "B3", "Everything here updates automatically from the Paycheck Planner and Expenses tabs.", f_small, border=False)

TBL, T0 = 9, 10                     # header row, first month row
TT = T0 + 12                       # total row (22)
kpis = [("B", "Total Income", f"C{TT}", "money"), ("C", "Total Expenses", f"D{TT + 2}", "money"),
        ("E", "Total Saved", f"E{TT}", "money"), ("F", "Savings Rate", f"F{TT}", "pct")]
for col, label, src, kind in kpis:
    put(ws, f"{col}5", label, f_bold, fill_sage, align=Alignment(horizontal="center", vertical="center"))
    if kind == "money":
        formula = f'=IFERROR({CUR}&TEXT({src},"#,##0.00"),"")'
        put(ws, f"{col}6", formula, f_kpi, fill_white, align=Alignment(horizontal="center", vertical="center"))
    else:
        put(ws, f"{col}6", f"={src}", f_kpi, fill_white, PCT, Alignment(horizontal="center", vertical="center"))
# Make the middle card two columns wide (Total Expenses spans C:D).
ws.merge_cells("C5:D5")
ws.merge_cells("C6:D6")
ws.row_dimensions[5].height = 24
ws.row_dimensions[6].height = 40

put(ws, "B8", "Month by month", f_h2, border=False)
header(ws, TBL, ["Month", "", "", "", "Savings Rate"], start_col=2)
ws[f"C{TBL}"] = f'="Income ("&{CUR}&")"'
ws[f"D{TBL}"] = f'="Expenses ("&{CUR}&")"'
ws[f"E{TBL}"] = f'="Saved ("&{CUR}&")"'
PL_D = f"'Paycheck Planner'!$B${PLAN_FIRST}:$B${PLAN_LAST}"
PL_A = f"'Paycheck Planner'!$C${PLAN_FIRST}:$C${PLAN_LAST}"
for i, m in enumerate(MONTHS):
    r = T0 + i
    put(ws, f"B{r}", m[:3], align=Alignment(horizontal="left"), fill=fill_cream)
    calc_cell(ws, f"C{r}", f'=SUMIFS({PL_A},{PL_D},">="&DATE(2027,{i + 1},1),{PL_D},"<"&DATE(2027,{i + 2},1))', MONEY)
    calc_cell(ws, f"D{r}", f'=SUMIFS({EXP_AMT},{EXP_DATE},">="&DATE(2027,{i + 1},1),{EXP_DATE},"<"&DATE(2027,{i + 2},1))', MONEY)
    calc_cell(ws, f"E{r}", f"=C{r}-D{r}", MONEY)
    calc_cell(ws, f"F{r}", f'=IFERROR(E{r}/C{r},0)', PCT, align=Alignment(horizontal="center"))
put(ws, f"B{TT}", "Total 2027", f_bold, fill_accent)
for col in "CDE":
    put(ws, f"{col}{TT}", f"=SUM({col}{T0}:{col}{TT - 1})", f_bold, fill_accent, MONEY)
put(ws, f"F{TT}", f"=IFERROR(E{TT}/C{TT},0)", f_bold, fill_accent, PCT, Alignment(horizontal="center"))
# Tie-out: every row of the Expenses tab, including anything dated outside 2027.
put(ws, f"B{TT + 2}", "All logged expenses", f_bold)
ws.merge_cells(f"B{TT + 2}:C{TT + 2}")
calc_cell(ws, f"D{TT + 2}", f"=SUM({EXP_AMT})", MONEY, font=f_bold)
put(ws, f"B{TT + 3}", "Dated outside 2027 / no date", f_small)
ws.merge_cells(f"B{TT + 3}:C{TT + 3}")
calc_cell(ws, f"D{TT + 3}", f"=D{TT + 2}-D{TT}", MONEY, font=f_small)
put(ws, f"E{TT + 3}", "should be 0", f_small, border=False)

# Charts.
bar = BarChart()
bar.type = "col"
bar.grouping = "clustered"
bar.title = "Monthly Income vs. Expenses"
bar.add_data(Reference(ws, min_col=3, max_col=4, min_row=TBL, max_row=TT - 1), titles_from_data=True)
bar.set_categories(Reference(ws, min_col=2, min_row=T0, max_row=TT - 1))
bar.series[0].graphicalProperties.solidFill = SAGE
bar.series[0].graphicalProperties.line.solidFill = SAGE
bar.series[1].graphicalProperties.solidFill = ACCENT
bar.series[1].graphicalProperties.line.solidFill = ACCENT
bar.gapWidth = 60
bar.y_axis.numFmt = "#,##0"
bar.y_axis.majorGridlines = None
bar.x_axis.delete = False
bar.y_axis.delete = False
bar.legend.position = "b"
bar.legend.overlay = False
bar.title.overlay = False
bar.roundedCorners = False
bar.width, bar.height = 19, 9
ws.add_chart(bar, "H4")

cats_ws = wb["Categories"]
pie = PieChart()
pie.title = "Spending by Category (year to date)"
pie.add_data(Reference(cats_ws, min_col=6, min_row=CAT_FIRST, max_row=CAT_FIRST + 11), titles_from_data=False)
pie.set_categories(Reference(cats_ws, min_col=1, min_row=CAT_FIRST, max_row=CAT_FIRST + 11))
palette = ["A8BBA3", "D4A373", "7E9A78", "E9C9A3", "5F7A61", "C7D3C2", "B5835A", "EADBC8", "8FA68A", "F1E3D3", "6E6E6E", "CCD5AE"]
for idx, colr in enumerate(palette):
    pt = DataPoint(idx=idx)
    pt.graphicalProperties.solidFill = colr
    pt.graphicalProperties.line.solidFill = "FFFFFF"
    pie.series[0].dPt.append(pt)
pie.dataLabels = DataLabelList()
pie.dataLabels.showPercent = True
pie.dataLabels.showVal = False
pie.dataLabels.showCatName = False
pie.dataLabels.showSerName = False
pie.legend.position = "r"
pie.legend.overlay = False
pie.title.overlay = False
pie.roundedCorners = False
pie.width, pie.height = 19, 10
ws.add_chart(pie, "H23")

# ---- Workbook-wide touches --------------------------------------------------------------
for sheet in wb.worksheets:
    sheet.sheet_properties.tabColor = SAGE
    sheet.sheet_view.zoomScale = 100
wb["Start Here"].sheet_properties.tabColor = ACCENT
wb["Dashboard"].sheet_properties.tabColor = ACCENT
wb.active = 0

wb.save(OUT)
print(f"Saved {OUT}")
