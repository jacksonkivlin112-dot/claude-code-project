#!/usr/bin/env python3
"""One-page PDF that Etsy buyers download: the "Make a copy" link plus quick-start steps.

    python3 make_delivery_pdf.py                                   # placeholder link
    python3 make_delivery_pdf.py --link "https://docs.google.com/spreadsheets/d/XXXX/copy"
    options: --shop "Your Shop Name"  --email "hello@yourshop.com"  --out FILE.pdf
"""
import argparse

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

p = argparse.ArgumentParser()
p.add_argument("--link", default=None, help="your docs.google.com/.../copy link")
p.add_argument("--shop", default="[Your Shop Name]")
p.add_argument("--email", default="[your contact email or Etsy messages]")
p.add_argument("--out", default="2027_Paycheck_Budget_Planner_ACCESS.pdf")
a = p.parse_args()

SAGE, CREAM, CHARCOAL, ACCENT, SOFT = (HexColor(x) for x in ("#A8BBA3", "#FAF7F2", "#2F2F2F", "#D4A373", "#E8EFE5"))
W, H = letter
c = canvas.Canvas(a.out, pagesize=letter)
c.setTitle("2027 Paycheck Budget Planner - Access Your Template")
c.setAuthor(a.shop)

# Background and header band.
c.setFillColor(CREAM); c.rect(0, 0, W, H, stroke=0, fill=1)
c.setFillColor(SAGE); c.rect(0, H - 150, W, 150, stroke=0, fill=1)
c.setFillColor(CHARCOAL)
c.setFont("Helvetica-Bold", 28); c.drawCentredString(W / 2, H - 70, "2027 Paycheck Budget Planner")
c.setFont("Helvetica", 13); c.drawCentredString(W / 2, H - 98, "Google Sheets Template  •  Thank you for your purchase!")
c.setFillColor(ACCENT); c.rect(W / 2 - 40, H - 120, 80, 3, stroke=0, fill=1)

# Link button.
y = H - 215
c.setFillColor(CHARCOAL); c.setFont("Helvetica-Bold", 15)
c.drawCentredString(W / 2, y + 24, "Get your planner:")
bw, bh = 380, 54
bx, by = (W - bw) / 2, y - bh
c.setFillColor(ACCENT); c.roundRect(bx, by, bw, bh, 14, stroke=0, fill=1)
c.setFillColor(CHARCOAL); c.setFont("Helvetica-Bold", 18)
c.drawCentredString(W / 2, by + 20, "CLICK HERE TO MAKE YOUR COPY")
if a.link:
    c.linkURL(a.link, (bx, by, bx + bw, by + bh), relative=0)
    shown = a.link if len(a.link) < 95 else a.link[:92] + "..."
    c.setFont("Helvetica", 9); c.setFillColor(HexColor("#6B6B6B"))
    c.drawCentredString(W / 2, by - 16, f"or paste this into your browser: {shown}")
else:
    c.setFont("Helvetica-Bold", 11); c.setFillColor(HexColor("#C62828"))
    c.drawCentredString(W / 2, by - 18, "SELLER: re-run make_delivery_pdf.py with --link \"your .../copy link\" before uploading")

# Steps.
y = by - 60
c.setFillColor(CHARCOAL); c.setFont("Helvetica-Bold", 16); c.drawString(72, y, "Quick start")
steps = [
    ("Click the button above.", "Sign in to your free Google account if asked."),
    ("Click \"Make a copy\".", "The planner is saved to your own Google Drive. It's yours to edit."),
    ("Open the \"Start Here\" tab.", "Enter your name, pay frequency, first payday of 2027 and currency."),
    ("Clear the sample data.", "Delete the example numbers in the light green cells (Start Here explains how)."),
    ("Add your bills, then log spending.", "Your Dashboard, charts and savings goals update automatically."),
]
y -= 30
for i, (head, body) in enumerate(steps, 1):
    c.setFillColor(SAGE); c.circle(86, y + 4, 12, stroke=0, fill=1)
    c.setFillColor(CHARCOAL); c.setFont("Helvetica-Bold", 12); c.drawCentredString(86, y, str(i))
    c.setFont("Helvetica-Bold", 12); c.drawString(108, y + 4, head)
    c.setFont("Helvetica", 11); c.setFillColor(HexColor("#555555")); c.drawString(108, y - 11, body)
    y -= 42

# Tips box.
y -= 4
bh2 = 118
c.setFillColor(SOFT); c.roundRect(60, y - bh2, W - 120, bh2, 12, stroke=0, fill=1)
c.setFillColor(CHARCOAL); c.setFont("Helvetica-Bold", 13); c.drawString(78, y - 24, "Good to know")
c.setFont("Helvetica", 10.5)
tips = [
    "•  Type only in the light green cells. Cream cells hold formulas and fill in for you.",
    "•  Works on computer, tablet and phone in the free Google Sheets app.",
    "•  Prefer Excel? In your copy: File > Download > Microsoft Excel (.xlsx).",
    "•  Lost the link? It never expires. Re-download this PDF from Etsy (You > Purchases).",
]
for k, t in enumerate(tips):
    c.drawString(78, y - 44 - k * 17, t)

# Footer.
c.setFillColor(HexColor("#6B6B6B")); c.setFont("Helvetica", 9.5)
c.drawCentredString(W / 2, 74, f"Questions? Message us: {a.email}")
c.drawCentredString(W / 2, 58, f"© 2026 {a.shop}. For personal use only. Please don't share, resell or redistribute this template.")
c.drawCentredString(W / 2, 42, "This planner is a budgeting tool, not financial advice.")
c.save()
print(f"Saved {a.out}")
